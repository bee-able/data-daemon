#!/usr/bin/env bash
#
# Build and deploy the data-daemon image from the devbox.
#
# Uses a Kaniko job with an init container to clone fresh source from GitHub.
# After the build, rolls the `data-daemon` Deployment in the `beeable`
# namespace to the new image.
#
# Usage:
#   ./data-daemon/deploy.sh          # build + deploy
#   ./data-daemon/deploy.sh --build  # build only (push to GHCR, don't roll)
#
set -euo pipefail

NAMESPACE="beeable"
REGISTRY="ghcr.io/bee-able/data-daemon"
REPO="bee-able/api"
CONTEXT_SUB_PATH="data-daemon"
TAG=$(date -u +%Y%m%dT%H%M)
JOB_NAME="build-data-daemon-$(echo "$TAG" | tr 'T' '-')"
BUILD_ONLY=false

[[ "${1:-}" == "--build" ]] && BUILD_ONLY=true

# ── Resolve GitHub token ────────────────────────────────────────────
GITHUB_TOKEN=$(kubectl get secret beeable-api-secrets -n "$NAMESPACE" \
  -o jsonpath='{.data.GITHUB_TOKEN_BEEABLE}' | base64 -d)
if [[ -z "$GITHUB_TOKEN" ]]; then
  echo "✗ GITHUB_TOKEN_BEEABLE not set in secret beeable-api-secrets"
  exit 1
fi

echo "▸ Building ${REGISTRY}:${TAG}"
echo "  Source: github.com/${REPO} (HEAD of main)"

# ── Create Kaniko job ───────────────────────────────────────────────
cat <<EOF | kubectl apply -n "$NAMESPACE" -f -
apiVersion: batch/v1
kind: Job
metadata:
  name: ${JOB_NAME}
spec:
  backoffLimit: 0
  ttlSecondsAfterFinished: 300
  template:
    spec:
      restartPolicy: Never
      initContainers:
      - name: clone
        image: alpine/git:latest
        command: ["sh", "-c", "git clone --depth 1 https://${GITHUB_TOKEN}@github.com/${REPO}.git /repo && cp -r /repo/${CONTEXT_SUB_PATH}/* /build/"]
        volumeMounts:
        - {name: repo, mountPath: /repo}
        - {name: build, mountPath: /build}
      containers:
      - name: kaniko
        image: gcr.io/kaniko-project/executor:latest
        args:
        - "--context=/build"
        - "--dockerfile=Dockerfile"
        - "--destination=${REGISTRY}:${TAG}"
        - "--destination=${REGISTRY}:latest"
        - "--cache=false"
        volumeMounts:
        - {name: docker-config, mountPath: /kaniko/.docker/}
        - {name: build, mountPath: /build}
        resources:
          requests: {memory: "2Gi", cpu: "1"}
          limits: {memory: "3Gi"}
      volumes:
      - {name: docker-config, secret: {secretName: ghcr-creds, items: [{key: config.json, path: config.json}]}}
      - {name: repo, emptyDir: {}}
      - {name: build, emptyDir: {}}
EOF

# ── Wait for build ──────────────────────────────────────────────────
echo "▸ Waiting for build..."
if ! kubectl wait --for=condition=complete "job/${JOB_NAME}" -n "$NAMESPACE" --timeout=900s 2>/dev/null; then
  echo "✗ Build failed or timed out. Logs:"
  kubectl logs "job/${JOB_NAME}" -n "$NAMESPACE" --tail=30
  exit 1
fi

PUSHED=$(kubectl logs "job/${JOB_NAME}" -n "$NAMESPACE" | grep -c "Pushed" || true)
if [[ "$PUSHED" -eq 0 ]]; then
  echo "✗ Image was not pushed. Logs:"
  kubectl logs "job/${JOB_NAME}" -n "$NAMESPACE" --tail=10
  exit 1
fi

echo "✓ Built and pushed ${REGISTRY}:${TAG} (also :latest)"

if $BUILD_ONLY; then
  echo "  (--build only, skipping rollout)"
  exit 0
fi

# ── Roll the Deployment ─────────────────────────────────────────────
# The deployment uses `ghcr.io/bee-able/data-daemon:latest`; we still
# set the image to the dated tag to force a fresh pull and a rolling
# restart. `:latest` is overwritten above so anyone who redeploys without
# running this script lands on the same commit.
echo "▸ Rolling deployment/data-daemon..."
kubectl set image deployment/data-daemon \
  -n "$NAMESPACE" \
  "data-daemon=${REGISTRY}:${TAG}" >/dev/null

kubectl rollout status deployment/data-daemon -n "$NAMESPACE" --timeout=180s

echo "✓ Deployed ${REGISTRY}:${TAG}"
