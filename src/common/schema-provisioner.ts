/**
 * Per-org schemas for the data daemon.
 *
 * Layout (one schema per organization):
 *   data_<orgid-no-dashes>.collections   (name, namespace, metadata)
 *   data_<orgid-no-dashes>.documents     (JSONB payload keyed by collection)
 *
 * Shape is deliberately minimal — named collections + JSON documents
 * with optional shallow filtering. Schema evolution of the payload is
 * the caller's responsibility; we store opaque JSONB.
 */
import type { Pool, PoolClient } from 'pg';

export const SCHEMA_VERSION = 1;
const ADVISORY_LOCK_KEY = 'data-schema-migrate';

export function orgSchemaName(orgId: string): string {
  return 'data_' + orgId.replace(/-/g, '');
}

export function schemaToOrgId(schemaName: string): string {
  const m = /^data_([0-9a-f]{32})$/i.exec(schemaName);
  if (!m) throw new Error(`Not a data schema: ${schemaName}`);
  const h = m[1]!;
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function ident(name: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) throw new Error(`Invalid identifier: ${name}`);
  return `"${name}"`;
}

// ── Shared objects in public schema ───────────────────────────────────

export async function bootstrapSharedObjects(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.data_schema_versions (
      schema_name TEXT PRIMARY KEY,
      version INT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

// ── Per-org schema migration ──────────────────────────────────────────

async function getSchemaVersion(client: PoolClient, schemaName: string): Promise<number> {
  const result = await client.query(
    `SELECT version FROM public.data_schema_versions WHERE schema_name = $1`,
    [schemaName],
  );
  return result.rows.length > 0 ? (result.rows[0].version as number) : 0;
}

async function setSchemaVersion(
  client: PoolClient,
  schemaName: string,
  version: number,
): Promise<void> {
  await client.query(
    `INSERT INTO public.data_schema_versions (schema_name, version, applied_at)
     VALUES ($1, $2, now())
     ON CONFLICT (schema_name) DO UPDATE
       SET version = EXCLUDED.version, applied_at = EXCLUDED.applied_at`,
    [schemaName, version],
  );
}

export async function ensureOrgSchema(pool: Pool, orgId: string): Promise<string> {
  const schema = orgSchemaName(orgId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await getSchemaVersion(client, schema);

    if (current < 1) await migrateV0ToV1(client, schema);

    if (current < SCHEMA_VERSION) {
      await setSchemaVersion(client, schema, SCHEMA_VERSION);
    }

    await client.query('COMMIT');
    return schema;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function migrateV0ToV1(client: PoolClient, schemaName: string): Promise<void> {
  const s = ident(schemaName);

  await client.query(`CREATE SCHEMA IF NOT EXISTS ${s}`);

  // Collections: one row per (namespace, name). Acts as the addressable
  // container for documents. `schema_version` is caller-managed metadata
  // — the daemon stores it but doesn't interpret it.
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${s}.collections (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      namespace_id UUID NOT NULL,
      name TEXT NOT NULL,
      schema_version INT NOT NULL DEFAULT 1,
      metadata JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (namespace_id, name)
    )
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_collections_ns ON ${s}.collections (namespace_id)`);

  // Documents: opaque JSONB payloads keyed by id. `data` is the user's
  // object; we keep it under a single column for simplicity + GIN-index
  // ability. `schema_version` mirrors the owning collection at insert
  // time so docs written before a version bump are distinguishable.
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${s}.documents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      collection_id UUID NOT NULL REFERENCES ${s}.collections(id) ON DELETE CASCADE,
      data JSONB NOT NULL,
      schema_version INT NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_documents_collection_created ON ${s}.documents (collection_id, created_at DESC)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_documents_data_gin ON ${s}.documents USING GIN (data jsonb_path_ops)`);
}

export async function enumerateAndMigrateAllOrgs(
  pool: Pool,
): Promise<{ total: number; migrated: number }> {
  const client = await pool.connect();
  try {
    await client.query(`SELECT pg_advisory_lock(hashtext($1))`, [ADVISORY_LOCK_KEY]);

    const { rows } = await client.query<{ schema_name: string }>(
      `SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'data\\_%' ESCAPE '\\'`,
    );

    let migrated = 0;
    for (const row of rows) {
      const orgId = schemaToOrgId(row.schema_name);
      client.release();
      await ensureOrgSchema(pool, orgId);
      migrated++;
    }

    return { total: rows.length, migrated };
  } finally {
    try {
      await client.query(`SELECT pg_advisory_unlock(hashtext($1))`, [ADVISORY_LOCK_KEY]);
    } catch {
      // best-effort release; we already hold the schema lock via per-org client
    }
    try {
      client.release();
    } catch {
      // client may already have been released inside the loop
    }
  }
}
