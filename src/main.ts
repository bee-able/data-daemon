import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { configSchema } from './config';

async function bootstrap() {
  const config = configSchema.parse(process.env);

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.forRoot(config),
    new FastifyAdapter(),
    { rawBody: true },
  );

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Beeable Data Daemon')
    .setDescription('Generic named JSON-document collections backed by Postgres JSONB')
    .setVersion('1.0')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  app.getHttpAdapter().get(
    '/_platform/apps/data-daemon/openapi.json',
    (_req: unknown, res: { send: (body: unknown) => void }) => {
      res.send(document);
    },
  );

  app.getHttpAdapter().get(
    '/_platform/apps',
    (_req: unknown, res: { send: (body: unknown) => void }) => {
      res.send([
        {
          id: 'data-daemon',
          name: 'data-daemon',
          displayName: 'Data',
          description: 'Named JSON-document collections with CRUD, backed by Postgres JSONB',
          version: '1.0.0',
          capabilities: ['collections', 'documents'],
          hasApi: true,
          hasUi: false,
          hasOpenApiSpec: true,
        },
      ]);
    },
  );

  await app.listen(config.PORT, '0.0.0.0');
  Logger.log(`Data daemon listening on port ${config.PORT}`, 'Bootstrap');
}

void bootstrap();
