import { CollectionsService } from './collections.service';
import { ConflictException, NotFoundException, ForbiddenException } from '@nestjs/common';
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
      query: async (sql: string, params?: unknown[]) => {
        queries.push({ sql, params: params ?? [] });
        return { rows: [], rowCount: 0 };
      },
      release: () => undefined,
    })),
  } as unknown as Pool;
  return { pool, queries, responses };
}

const ORG = '11111111-1111-1111-1111-111111111111';
const NS  = '22222222-2222-2222-2222-222222222222';
const COLL_ID = '33333333-3333-3333-3333-333333333333';

function collRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: COLL_ID,
    namespace_id: NS,
    name: 'pets',
    schema_version: 1,
    metadata: {},
    created_at: new Date('2026-04-24T00:00:00Z'),
    updated_at: new Date('2026-04-24T00:00:00Z'),
    ...overrides,
  };
}

describe('CollectionsService', () => {
  it('create returns the new row', async () => {
    const { pool, responses } = makePool();
    responses.push({ match: /INSERT INTO ".*"\.collections/, result: { rows: [collRow()] } });
    const svc = new CollectionsService(pool);
    const out = await svc.create(ORG, NS, 'pets', 1, {});
    expect(out.id).toBe(COLL_ID);
    expect(out.namespaceId).toBe(NS);
    expect(out.name).toBe('pets');
  });

  it('create maps 23505 unique violation to ConflictException', async () => {
    const pool = {
      query: jest.fn(async () => {
        const err = new Error('duplicate key') as Error & { code: string };
        err.code = '23505';
        throw err;
      }),
      connect: jest.fn(async () => ({
        query: async () => ({ rows: [], rowCount: 0 }),
        release: () => undefined,
      })),
    } as unknown as Pool;
    const svc = new CollectionsService(pool);
    await expect(svc.create(ORG, NS, 'pets', 1, {})).rejects.toBeInstanceOf(ConflictException);
  });

  it('list with no accessible namespaces returns empty without querying', async () => {
    const { pool, queries } = makePool();
    const svc = new CollectionsService(pool);
    const out = await svc.list(ORG, []);
    expect(out).toEqual([]);
    // ensureOrgSchema may query (connect), but the main SELECT must not run
    expect(queries.find((q) => /FROM ".*"\.collections/.test(q.sql))).toBeUndefined();
  });

  it('getByName throws NotFound when no row matches', async () => {
    const { pool } = makePool();
    const svc = new CollectionsService(pool);
    await expect(svc.getByName(ORG, [NS], 'pets')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('getByName throws Forbidden when caller has no namespaces', async () => {
    const { pool } = makePool();
    const svc = new CollectionsService(pool);
    await expect(svc.getByName(ORG, [], 'pets')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('ensure returns created=true when insert succeeds', async () => {
    const { pool, responses } = makePool();
    responses.push({
      match: /INSERT INTO ".*"\.collections[\s\S]*ON CONFLICT/,
      result: { rows: [collRow()] },
    });
    const svc = new CollectionsService(pool);
    const out = await svc.ensure(ORG, NS, 'pets', 1, {});
    expect(out.created).toBe(true);
    expect(out.collection.name).toBe('pets');
  });

  it('ensure returns created=false + existing row on conflict', async () => {
    const { pool, responses } = makePool();
    // INSERT ... ON CONFLICT DO NOTHING returns no rows when collision
    responses.push({
      match: /INSERT INTO ".*"\.collections[\s\S]*ON CONFLICT/,
      result: { rows: [] },
    });
    responses.push({
      match: /SELECT \* FROM ".*"\.collections WHERE namespace_id/,
      result: { rows: [collRow({ name: 'pets' })] },
    });
    const svc = new CollectionsService(pool);
    const out = await svc.ensure(ORG, NS, 'pets', 1, {});
    expect(out.created).toBe(false);
    expect(out.collection.name).toBe('pets');
  });

  it('delete throws NotFound when nothing is removed', async () => {
    const { pool } = makePool();
    const svc = new CollectionsService(pool);
    await expect(svc.delete(ORG, [NS], 'pets')).rejects.toBeInstanceOf(NotFoundException);
  });
});
