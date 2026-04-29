/**
 * Resolve the caller's chosen namespace and the full accessible map from
 * proxy-set headers. The platform's app-proxy is the only thing that
 * writes these; the daemon trusts them because the ClusterIP service is
 * unreachable from outside.
 *
 * Headers:
 *   x-beeable-namespace  — the name the caller pinned (set by the SDK's
 *                         `configureBeeable({ namespace })` call).
 *   x-namespace-map      — `name=id,name=id` list of every namespace the
 *                         caller can access, scoped to the pin if present.
 *   x-namespace-ids      — comma-separated ids. Legacy; only used when
 *                         x-namespace-map is absent.
 */
import { BadRequestException, ForbiddenException } from '@nestjs/common';

export interface ResolvedNamespace {
  id: string;
  name: string;
}

export interface NamespaceContext {
  /** The namespace the caller chose via `x-beeable-namespace`, already
   *  resolved against the accessible map. Required on write endpoints. */
  chosen: ResolvedNamespace | null;
  /** Every namespace the caller can access this request. Used for reads
   *  that span namespaces (e.g. listCollections across accessible ns). */
  accessible: ResolvedNamespace[];
}

function parseMap(raw: string | undefined): ResolvedNamespace[] {
  if (!raw) return [];
  return raw.split(',').flatMap((pair) => {
    const eq = pair.indexOf('=');
    if (eq < 0) return [];
    const name = pair.slice(0, eq).trim();
    const id = pair.slice(eq + 1).trim();
    return id ? [{ id, name }] : [];
  });
}

function parseIds(raw: string | undefined): ResolvedNamespace[] {
  if (!raw) return [];
  return raw.split(',').filter(Boolean).map((id) => ({ id, name: '' }));
}

/**
 * Assemble the namespace context from request headers. Does not enforce
 * that a namespace was chosen — that's the caller's decision (reads don't
 * require it, writes do).
 */
export function readNamespaceContext(headers: Record<string, string | undefined>): NamespaceContext {
  const map = parseMap(headers['x-namespace-map']);
  const accessible = map.length > 0 ? map : parseIds(headers['x-namespace-ids']);

  const chosenName = headers['x-beeable-namespace']?.trim();
  if (!chosenName) {
    return { chosen: null, accessible };
  }

  const match = accessible.find((n) => n.name === chosenName);
  if (!match) {
    // The proxy is supposed to reject this before it reaches us (it pins
    // the accessible set to just the chosen namespace), so landing here
    // means a badly-formed header or a client that bypassed the proxy.
    throw new ForbiddenException(`Caller cannot access namespace "${chosenName}"`);
  }
  return { chosen: match, accessible: [match] };
}

/**
 * For write endpoints: demand that the caller chose a namespace (via the
 * `x-beeable-namespace` header). Explicit is better than implicit — we'd
 * rather 400 than default to a namespace that won't be obvious to the
 * caller.
 */
export function requireChosenNamespace(ctx: NamespaceContext): ResolvedNamespace {
  if (!ctx.chosen) {
    throw new BadRequestException(
      'x-beeable-namespace header is required for this operation. Configure the SDK with `configureBeeable({ namespace })` or pin it with `beeable.withNamespace(name)`.',
    );
  }
  return ctx.chosen;
}
