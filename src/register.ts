/**
 * Register the data daemon in the platform:
 * 1. Create/update `apps` row (catalog + sync metadata)
 * 2. Create/update `app_installations` row (runtime + proxy, kind='daemon')
 *
 * Run:
 *   DATABASE_URL=... \
 *   SERVICE_HOST=data-daemon.beeable.svc.cluster.local:3000 \
 *   npx tsx src/register.ts
 */
import { Pool } from 'pg';
import { configSchema } from './config';

const config = configSchema.parse(process.env);
const SERVICE_HOST = process.env.SERVICE_HOST ?? 'data-daemon.beeable.svc.cluster.local:3000';
const GITHUB_REPO_URL = 'https://github.com/bee-able/data-daemon';
const IMAGE_REPOSITORY = 'ghcr.io/bee-able/data-daemon';

async function register() {
  const pool = new Pool({
    connectionString: config.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const platformNs = await client.query(
      `SELECT id FROM namespaces WHERE name = 'platform' AND parent_id = (SELECT id FROM namespaces WHERE name = 'beeable' AND parent_id IS NULL)`,
    );
    const platformNsId = platformNs.rows[0]?.id ?? null;

    // ── 1. apps row (catalog + sync metadata) ──
    const existingApp = await client.query(
      `SELECT id FROM apps WHERE source = 'platform' AND name = 'data-daemon'`,
    );

    let catalogId: string;
    if (existingApp.rows.length > 0) {
      catalogId = existingApp.rows[0].id;
      await client.query(
        `UPDATE apps SET github_repo_url = $1, image_repository = $2, updated_at = now() WHERE id = $3`,
        [GITHUB_REPO_URL, IMAGE_REPOSITORY, catalogId],
      );
      console.log(`Updated apps catalog entry: ${catalogId}`);
    } else {
      const result = await client.query(
        `INSERT INTO apps (id, source, name, display_name, description, category, gitea_org, gitea_repo, is_published, github_repo_url, image_repository, created_at, updated_at)
         VALUES (gen_random_uuid(), 'platform', 'data-daemon', 'Data',
                 'Data daemon — named JSON-document collections with CRUD, backed by Postgres JSONB',
                 'platform', 'platform', 'data-daemon', false, $1, $2, now(), now())
         RETURNING id`,
        [GITHUB_REPO_URL, IMAGE_REPOSITORY],
      );
      catalogId = result.rows[0].id;
      console.log(`Created apps catalog entry: ${catalogId}`);
    }

    // ── 2. app_installations row (runtime + proxy) ──
    const existingInstall = await client.query(
      `SELECT id FROM app_installations WHERE name = 'data-daemon' AND scope = 'platform'`,
    );

    let installId: string;
    if (existingInstall.rows.length > 0) {
      installId = existingInstall.rows[0].id;
      await client.query(
        `UPDATE app_installations SET service_host = $1, namespace_id = $2, status = 'running', app_id = $3, updated_at = now() WHERE id = $4`,
        [SERVICE_HOST, platformNsId, catalogId, installId],
      );
      console.log(`Updated app_installations entry: ${installId}`);
    } else {
      const result = await client.query(
        `INSERT INTO app_installations (id, organization_id, namespace_id, name, display_name, description, gitea_org, gitea_repo, status, scope, kind, service_host, app_id, created_at, updated_at)
         VALUES (gen_random_uuid(), NULL, $1, 'data-daemon', 'Data',
                 'Data daemon — named JSON-document collections with CRUD, backed by Postgres JSONB',
                 'platform', 'data-daemon', 'running', 'platform', 'daemon', $2, $3, now(), now())
         RETURNING id`,
        [platformNsId, SERVICE_HOST, catalogId],
      );
      installId = result.rows[0].id;
      console.log(`Created app_installations entry: ${installId}`);
    }

    await client.query('COMMIT');
    console.log('\nRegistration complete.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

register().catch((err) => {
  console.error('Registration failed:', err);
  process.exit(1);
});
