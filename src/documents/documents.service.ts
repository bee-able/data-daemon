import { Inject, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import type { Pool } from 'pg';
import { DB_POOL } from '../common/constants';
import { ensureOrgSchema, orgSchemaName } from '../common/schema-provisioner';
import { CollectionsService } from '../collections/collections.service';

function ident(name: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) throw new Error(`Invalid identifier: ${name}`);
  return `"${name}"`;
}

export interface DocumentRow {
  id: string;
  collectionId: string;
  data: Record<string, unknown>;
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
}

function rowToDoc(r: {
  id: string;
  collection_id: string;
  data: Record<string, unknown>;
  schema_version: number;
  created_at: Date;
  updated_at: Date;
}): DocumentRow {
  return {
    id: r.id,
    collectionId: r.collection_id,
    data: r.data,
    schemaVersion: r.schema_version,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

export interface ListOptions {
  where?: Record<string, unknown>;
  limit?: number;
  offset?: number;
}

@Injectable()
export class DocumentsService {
  constructor(
    @Inject(DB_POOL) private readonly pool: Pool,
    private readonly collections: CollectionsService,
  ) {}

  async insert(
    orgId: string,
    accessibleNamespaceIds: string[],
    collectionName: string,
    data: Record<string, unknown>,
  ): Promise<DocumentRow> {
    const collection = await this.collections.getByName(orgId, accessibleNamespaceIds, collectionName);
    await ensureOrgSchema(this.pool, orgId);
    const s = ident(orgSchemaName(orgId));
    const { rows } = await this.pool.query(
      `INSERT INTO ${s}.documents (collection_id, data, schema_version)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [collection.id, data, collection.schemaVersion],
    );
    return rowToDoc(rows[0]);
  }

  async list(
    orgId: string,
    accessibleNamespaceIds: string[],
    collectionName: string,
    options: ListOptions,
  ): Promise<DocumentRow[]> {
    const collection = await this.collections.getByName(orgId, accessibleNamespaceIds, collectionName);
    await ensureOrgSchema(this.pool, orgId);
    const s = ident(orgSchemaName(orgId));

    const params: unknown[] = [collection.id];
    let sql = `SELECT * FROM ${s}.documents WHERE collection_id = $1`;

    if (options.where && Object.keys(options.where).length > 0) {
      params.push(options.where);
      sql += ` AND data @> $${params.length}::jsonb`;
    }

    sql += ' ORDER BY created_at DESC';
    if (typeof options.limit === 'number') {
      params.push(options.limit);
      sql += ` LIMIT $${params.length}`;
    }
    if (typeof options.offset === 'number') {
      params.push(options.offset);
      sql += ` OFFSET $${params.length}`;
    }

    const { rows } = await this.pool.query(sql, params);
    return rows.map(rowToDoc);
  }

  async count(
    orgId: string,
    accessibleNamespaceIds: string[],
    collectionName: string,
    where?: Record<string, unknown>,
  ): Promise<number> {
    const collection = await this.collections.getByName(orgId, accessibleNamespaceIds, collectionName);
    await ensureOrgSchema(this.pool, orgId);
    const s = ident(orgSchemaName(orgId));

    const params: unknown[] = [collection.id];
    let sql = `SELECT COUNT(*)::int AS n FROM ${s}.documents WHERE collection_id = $1`;
    if (where && Object.keys(where).length > 0) {
      params.push(where);
      sql += ` AND data @> $${params.length}::jsonb`;
    }
    const { rows } = await this.pool.query(sql, params);
    return rows[0].n as number;
  }

  async get(
    orgId: string,
    accessibleNamespaceIds: string[],
    collectionName: string,
    id: string,
  ): Promise<DocumentRow> {
    const collection = await this.collections.getByName(orgId, accessibleNamespaceIds, collectionName);
    await ensureOrgSchema(this.pool, orgId);
    const s = ident(orgSchemaName(orgId));
    const { rows } = await this.pool.query(
      `SELECT * FROM ${s}.documents WHERE collection_id = $1 AND id = $2`,
      [collection.id, id],
    );
    if (rows.length === 0) throw new NotFoundException(`Document ${id} not found`);
    return rowToDoc(rows[0]);
  }

  async replace(
    orgId: string,
    accessibleNamespaceIds: string[],
    collectionName: string,
    id: string,
    data: Record<string, unknown>,
  ): Promise<DocumentRow> {
    const collection = await this.collections.getByName(orgId, accessibleNamespaceIds, collectionName);
    await ensureOrgSchema(this.pool, orgId);
    const s = ident(orgSchemaName(orgId));
    const { rows } = await this.pool.query(
      `UPDATE ${s}.documents
         SET data = $3, updated_at = now()
         WHERE collection_id = $1 AND id = $2
         RETURNING *`,
      [collection.id, id, data],
    );
    if (rows.length === 0) throw new NotFoundException(`Document ${id} not found`);
    return rowToDoc(rows[0]);
  }

  async patch(
    orgId: string,
    accessibleNamespaceIds: string[],
    collectionName: string,
    id: string,
    changes: Record<string, unknown>,
  ): Promise<DocumentRow> {
    if (Object.keys(changes).length === 0) {
      throw new BadRequestException('patch body must have at least one key');
    }
    const collection = await this.collections.getByName(orgId, accessibleNamespaceIds, collectionName);
    await ensureOrgSchema(this.pool, orgId);
    const s = ident(orgSchemaName(orgId));
    // `||` on JSONB is shallow merge: right side overrides left per top-level key.
    const { rows } = await this.pool.query(
      `UPDATE ${s}.documents
         SET data = data || $3::jsonb, updated_at = now()
         WHERE collection_id = $1 AND id = $2
         RETURNING *`,
      [collection.id, id, changes],
    );
    if (rows.length === 0) throw new NotFoundException(`Document ${id} not found`);
    return rowToDoc(rows[0]);
  }

  async delete(
    orgId: string,
    accessibleNamespaceIds: string[],
    collectionName: string,
    id: string,
  ): Promise<void> {
    const collection = await this.collections.getByName(orgId, accessibleNamespaceIds, collectionName);
    await ensureOrgSchema(this.pool, orgId);
    const s = ident(orgSchemaName(orgId));
    const { rowCount } = await this.pool.query(
      `DELETE FROM ${s}.documents WHERE collection_id = $1 AND id = $2`,
      [collection.id, id],
    );
    if (rowCount === 0) throw new NotFoundException(`Document ${id} not found`);
  }
}
