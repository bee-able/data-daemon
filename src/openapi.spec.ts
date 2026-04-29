import { readFileSync, readdirSync } from 'fs';
import { join, relative } from 'path';

import type { OpenAPIObject } from '@nestjs/swagger';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createOpenApiDocument } from './openapi.bootstrap';

const DAEMON_ROOT = join(__dirname, '..');

function findTsFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== 'dist') {
      results.push(...findTsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') && !entry.name.endsWith('.d.ts')) {
      results.push(full);
    }
  }
  return results;
}

function countRouteDecorators(content: string): { routes: number; operations: number } {
  const routeRe = /@(Get|Post|Put|Patch|Delete|Head|Options|All)\s*\(/g;
  const opRe = /@ApiOperation\s*\(/g;
  let routes = 0;
  let operations = 0;
  while (routeRe.exec(content)) routes++;
  while (opRe.exec(content)) operations++;
  return { routes, operations };
}

describe('OpenAPI documentation', () => {
  describe('operation coverage (file-based)', () => {
    const srcDir = join(DAEMON_ROOT, 'src');
    const controllerFiles = findTsFiles(srcDir).filter(
      (f) => f.includes('controller') && !f.includes('.spec.') && !f.includes('__mocks__'),
    );

    it('found controller files', () => {
      expect(controllerFiles.length).toBeGreaterThan(0);
    });

    for (const file of controllerFiles) {
      const relPath = relative(DAEMON_ROOT, file);
      const content = readFileSync(file, 'utf-8');
      const { routes, operations } = countRouteDecorators(content);

      if (routes > 0) {
        it(`${relPath}: every route has @ApiOperation (${operations}/${routes})`, () => {
          expect(operations).toBe(routes);
        });
      }
    }
  });

  describe('generated spec', () => {
    let document: OpenAPIObject;
    let app: NestFastifyApplication;

    beforeAll(async () => {
      ({ app, document } = await createOpenApiDocument());
    }, 30_000);

    afterAll(async () => {
      if (app) await app.close();
    });

    it('has paths defined', () => {
      expect(Object.keys(document.paths ?? {}).length).toBeGreaterThan(3);
    });

    it('every operation has a non-empty summary', () => {
      const missing: string[] = [];
      for (const [path, methods] of Object.entries(document.paths ?? {})) {
        for (const [method, operation] of Object.entries(methods as Record<string, any>)) {
          if (['parameters', 'summary', 'description'].includes(method)) continue;
          if (!operation?.summary?.trim()) {
            missing.push(`${method.toUpperCase()} ${path}`);
          }
        }
      }
      if (missing.length > 0) {
        throw new Error(`Operations without summary:\n  ${missing.join('\n  ')}`);
      }
    });

    it('every operation has an operationId', () => {
      const missing: string[] = [];
      for (const [path, methods] of Object.entries(document.paths ?? {})) {
        for (const [method, operation] of Object.entries(methods as Record<string, any>)) {
          if (['parameters', 'summary', 'description'].includes(method)) continue;
          if (!operation?.operationId) {
            missing.push(`${method.toUpperCase()} ${path}`);
          }
        }
      }
      if (missing.length > 0) {
        throw new Error(`Operations without operationId (SDK codegen needs these):\n  ${missing.join('\n  ')}`);
      }
    });

    it('committed openapi.json matches the in-memory spec (drift check)', () => {
      const committedPath = join(DAEMON_ROOT, 'openapi.json');
      const committed = JSON.parse(readFileSync(committedPath, 'utf-8'));
      const generated = JSON.parse(JSON.stringify(document));
      if (JSON.stringify(committed) !== JSON.stringify(generated)) {
        throw new Error(
          'data-daemon/openapi.json is out of sync with the Nest decorators.\n' +
          'Run `pnpm openapi` from data-daemon/ to regenerate, then commit the result.',
        );
      }
    });
  });
});
