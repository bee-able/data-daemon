import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { SwaggerModule, DocumentBuilder, type OpenAPIObject } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { DB_POOL } from './common/constants';
import type { DataDaemonConfig } from './config';

export const openApiMockConfig: DataDaemonConfig = {
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  PLATFORM_API_URL: 'http://localhost:4000',
  EXECUTION_TOKEN_SIGNING_KEY: 'x'.repeat(32),
  PORT: 3000,
};

export const openApiMockPool = {
  query: async () => ({ rows: [] }),
  connect: async () => ({
    query: async () => ({ rows: [] }),
    release: () => undefined,
  }),
  end: async () => undefined,
};

export async function createOpenApiDocument(): Promise<{
  app: NestFastifyApplication;
  document: OpenAPIObject;
}> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(openApiMockConfig)],
  })
    .overrideProvider(DB_POOL).useValue(openApiMockPool)
    .compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Beeable Data Daemon')
    .setDescription('Generic named JSON-document collections backed by Postgres JSONB')
    .setVersion('1.0')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  return { app, document };
}
