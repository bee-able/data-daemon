import 'reflect-metadata';
import { writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const outputPath = resolve(__dirname, '..', 'openapi.json');

async function main() {
  const { createOpenApiDocument } = await import('./openapi.bootstrap');
  const { app, document } = await createOpenApiDocument();
  writeFileSync(outputPath, JSON.stringify(document, null, 2));
  await app.close();
  console.log(`OpenAPI spec written to ${outputPath}`);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});

// Safety net mirroring the platform exporter: detect "promised an output file
// and never wrote one" and flip the exit code. The platform exporter's comment
// documents the tsx/esbuild decorator-metadata bug that motivated this guard.
process.on('exit', (code) => {
  if (code === 0 && !existsSync(outputPath)) {
    process.stderr.write(
      `\nopenapi.export: process exited 0 but ${outputPath} was never written.\n` +
      `Make sure 'pnpm openapi' is using 'tsc && node dist/openapi.export.js'\n` +
      `(NOT 'tsx src/openapi.export.ts').\n`,
    );
    process.exitCode = 1;
  }
});
