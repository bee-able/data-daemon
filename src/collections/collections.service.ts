import { Inject, Injectable, NotFoundException, ConflictException, ForbiddenException } from '@nestjs/common';
import type { Pool } from 'pg';
import { DB_POOL } from '../common/constants';
import { ensureOrgSchema, orgSchemaName } from '../common/schema-provisioner';

function ident(name: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) throw new Error(`Invalid identifier: ${name}`);
  return `"${name}"`;
}

export interface CollectionRow {
  id: string;
  namespaceId: string;
  name: string;
  schemaVersion: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

function rowToCollection(r: {
  id: string;
  namespace_id: string;
  name: string;
  schema_version: number;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}): CollectionRow {
  return {
    id: r.id,
    namespaceId: r.namespace_id,
    name: r.name,
    schemaVersion: r.schema_version,
    metadata: r.metadata,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

@Injectable()
export class CollectionsService {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  async create(
    orgId: string,
    namespaceId: string,
    name: string,
    schemaVersion: number,
    metadata: Record<string, unknown>,
  ): Promise<CollectionRow> {
    await ensureOrgSchema(this.pool, orgId);
    const s = ident(orgSchemaName(orgId));
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO ${s}.collections (namespace_id, name, schema_version, metadata)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [namespaceId, name, schemaVersion, metadata],
      );
      return rowToCollection(rows[0]);
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        throw new ConflictException(`Collection "${name}" already exists in this namespace`);
      }
      throw err;
    }
  }

  async list(orgId: string, accessibleNamespaceIds: string[]): Promise<CollectionRow[]> {
    await ensureOrgSchema(this.pool, orgId);
    const s = ident(orgSchemaName(orgId));
    if (accessibleNamespaceIds.length === 0) return [];
    const { rows } = await this.pool.query(
      `SELECT * FROM ${s}.collections WHERE namespace_id = ANY($1::uuid[]) ORDER BY name`,
      [accessibleNamespaceIds],
    );
    return rows.map(rowToCollection);
  }

  async getByName(
    orgId: string,
    accessibleNamespaceIds: string[],
    name: string,
  ): Promise<CollectionRow> {
    await ensureOrgSchema(this.pool, orgId);
    const s = ident(orgSchemaName(orgId));
    if (accessibleNamespaceIds.length === 0) {
      throw new ForbiddenException('No accessible namespaces');
    }
    const { rows } = await this.pool.query(
      `SELECT * FROM ${s}.collections WHERE namespace_id = ANY($1::uuid[]) AND name = $2`,
      [accessibleNamespaceIds, name],
    );
    if (rows.length === 0) {
      throw new NotFoundException(`Collection "${name}" not found`);
    }
    return rowToCollection(rows[0]);
  }

  async ensure(
    orgId: string,
    namespaceId: string,
    name: string,
    schemaVersion: number,
    metadata: Record<string, unknown>,
  ): Promise<{ collection: CollectionRow; created: boolean }> {
    await ensureOrgSchema(this.pool, orgId);
    const s = ident(orgSchemaName(orgId));
    // Try insert first; on conflict fetch the existing row. Keeps the
    // common case (collection already exists) to one round-trip when it
    // conflicts + zero mutation.
    const insertRes = await this.pool.query(
      `INSERT INTO ${s}.collections (namespace_id, name, schema_version, metadata)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (namespace_id, name) DO NOTHING
       RETURNING *`,
      [namespaceId, name, schemaVersion, metadata],
    );
    if (insertRes.rows.length > 0) {
      return { collection: rowToCollection(insertRes.rows[0]), created: true };
    }
    const existing = await this.pool.query(
      `SELECT * FROM ${s}.collections WHERE namespace_id = $1 AND name = $2`,
      [namespaceId, name],
    );
    return { collection: rowToCollection(existing.rows[0]), created: false };
  }

  async delete(orgId: string, accessibleNamespaceIds: string[], name: string): Promise<void> {
    await ensureOrgSchema(this.pool, orgId);
    const s = ident(orgSchemaName(orgId));
    if (accessibleNamespaceIds.length === 0) {
      throw new ForbiddenException('No accessible namespaces');
    }
    const { rowCount } = await this.pool.query(
      `DELETE FROM ${s}.collections WHERE namespace_id = ANY($1::uuid[]) AND name = $2`,
      [accessibleNamespaceIds, name],
    );
    if (rowCount === 0) {
      throw new NotFoundException(`Collection "${name}" not found`);
    }
  }
}
