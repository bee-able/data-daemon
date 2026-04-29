import { DocumentsService } from './documents.service';
import { CollectionsService } from '../collections/collections.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Pool } from 'pg';

function makePool() {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const responses: Array<{ match: RegExp; result: { rows: unknown[]; rowCount?: number } }> = [];
  const pool = {
    query: jest.fn(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params: params ?? [] });
      for (const r of responses) {
        if (r.match.test(sql)) return r.result;
      }
      return { rows: [], rowCount: 0 };
    }),
    connect: jest.fn(async () => ({
      query: async () => ({ rows: [], rowCount: 0 }),
      release: () => undefined,
    })),
  } as unknown as Pool;
  return { pool, queries, responses };
}

const ORG = '11111111-1111-1111-1111-111111111111';
const NS  = '22222222-2222-2222-2222-222222222222';
const COLL_ID = '33333333-3333-3333-3333-333333333333';
const DOC_ID = '44444444-4444-4444-4444-444444444444';

function docRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: DOC_ID,
    collection_id: COLL_ID,
    data: { name: 'Mash', age: 2 },
    schema_version: 1,
    created_at: new Date('2026-04-24T00:00:00Z'),
    updated_at: new Date('2026-04-24T00:00:00Z'),
    ...overrides,
  };
}

function mockCollections(): CollectionsService {
  return {
    getByName: jest.fn(async () => ({
      id: COLL_ID,
      namespaceId: NS,
      name: 'pet_potatoes',
      schemaVersion: 1,
      metadata: {},
      createdAt: '2026-04-24T00:00:00.000Z',
      updatedAt: '2026-04-24T00:00:00.000Z',
    })),
  } as unknown as CollectionsService;
}

describe('DocumentsService', () => {
  it('insert returns the new doc', async () => {
    const { pool, responses } = makePool();
    responses.push({ match: /INSERT INTO ".*"\.documents/, result: { rows: [docRow()] } });
    const svc = new DocumentsService(pool, mockCollections());
    const out = await svc.insert(ORG, [NS], 'pet_potatoes', { name: 'Mash', age: 2 });
    expect(out.id).toBe(DOC_ID);
    expect(out.collectionId).toBe(COLL_ID);
    expect(out.data).toEqual({ name: 'Mash', age: 2 });
  });

  it('list passes where as JSONB containment predicate', async () => {
    const { pool, queries, responses } = makePool();
    responses.push({ match: /SELECT \* FROM ".*"\.documents/, result: { rows: [docRow()] } });
    const svc = new DocumentsService(pool, mockCollections());
    await svc.list(ORG, [NS], 'pet_potatoes', { where: { species: 'King Edward' } });
    const listSql = queries.find((q) => /SELECT \* FROM ".*"\.documents/.test(q.sql));
    expect(listSql).toBeDefined();
    expect(listSql!.sql).toMatch(/data @> \$2::jsonb/);
    expect(listSql!.params[1]).toEqual({ species: 'King Edward' });
  });

  it('list applies limit and offset when provided', async () => {
    const { pool, queries, responses } = makePool();
    responses.push({ match: /SELECT \* FROM ".*"\.documents/, result: { rows: [] } });
    const svc = new DocumentsService(pool, mockCollections());
    await svc.list(ORG, [NS], 'pet_potatoes', { limit: 10, offset: 20 });
    const listSql = queries.find((q) => /SELECT \* FROM ".*"\.documents/.test(q.sql));
    expect(listSql!.sql).toMatch(/LIMIT \$2/);
    expect(listSql!.sql).toMatch(/OFFSET \$3/);
    expect(listSql!.params).toEqual([COLL_ID, 10, 20]);
  });

  it('count returns a number', async () => {
    const { pool, responses } = makePool();
    responses.push({ match: /SELECT COUNT/, result: { rows: [{ n: 42 }] } });
    const svc = new DocumentsService(pool, mockCollections());
    const n = await svc.count(ORG, [NS], 'pet_potatoes');
    expect(n).toBe(42);
  });

  it('get throws NotFound when row is missing', async () => {
    const { pool } = makePool();
    const svc = new DocumentsService(pool, mockCollections());
    await expect(svc.get(ORG, [NS], 'pet_potatoes', DOC_ID)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('replace returns updated doc', async () => {
    const { pool, responses } = makePool();
    responses.push({ match: /UPDATE ".*"\.documents[\s\S]*SET data = \$3/, result: { rows: [docRow({ data: { name: 'Spud', age: 3 } })] } });
    const svc = new DocumentsService(pool, mockCollections());
    const out = await svc.replace(ORG, [NS], 'pet_potatoes', DOC_ID, { name: 'Spud', age: 3 });
    expect(out.data).toEqual({ name: 'Spud', age: 3 });
  });

  it('patch rejects empty change sets', async () => {
    const { pool } = makePool();
    const svc = new DocumentsService(pool, mockCollections());
    await expect(svc.patch(ORG, [NS], 'pet_potatoes', DOC_ID, {})).rejects.toBeInstanceOf(BadRequestException);
  });

  it('patch merges via JSONB concatenation', async () => {
    const { pool, queries, responses } = makePool();
    responses.push({ match: /UPDATE ".*"\.documents[\s\S]*SET data = data \|\| \$3::jsonb/, result: { rows: [docRow({ data: { name: 'Mash', age: 3 } })] } });
    const svc = new DocumentsService(pool, mockCollections());
    const out = await svc.patch(ORG, [NS], 'pet_potatoes', DOC_ID, { age: 3 });
    const patchSql = queries.find((q) => /data \|\| \$3::jsonb/.test(q.sql));
    expect(patchSql).toBeDefined();
    expect(patchSql!.params[2]).toEqual({ age: 3 });
    expect(out.data).toEqual({ name: 'Mash', age: 3 });
  });

  it('delete throws NotFound when nothing removed', async () => {
    const { pool } = makePool();
    const svc = new DocumentsService(pool, mockCollections());
    await expect(svc.delete(ORG, [NS], 'pet_potatoes', DOC_ID)).rejects.toBeInstanceOf(NotFoundException);
  });
});
