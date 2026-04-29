import { Inject, Logger, Module, OnModuleInit, type DynamicModule } from '@nestjs/common';
import type { Pool } from 'pg';
import type { DataDaemonConfig } from './config';
import { DatabaseModule } from './common/database.module';
import { CollectionsModule } from './collections/collections.module';
import { DocumentsModule } from './documents/documents.module';
import { DATA_CONFIG, DB_POOL } from './common/constants';
import { bootstrapSharedObjects, enumerateAndMigrateAllOrgs } from './common/schema-provisioner';

@Module({})
export class AppModule implements OnModuleInit {
  private readonly logger = new Logger(AppModule.name);

  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  async onModuleInit(): Promise<void> {
    this.logger.log('Bootstrapping shared objects...');
    await bootstrapSharedObjects(this.pool);
    this.logger.log('Migrating existing data org schemas...');
    const result = await enumerateAndMigrateAllOrgs(this.pool);
    this.logger.log(`Schema sweep complete: total=${result.total} migrated=${result.migrated}`);
  }

  static forRoot(config: DataDaemonConfig): DynamicModule {
    return {
      module: AppModule,
      global: true,
      imports: [
        DatabaseModule.forRoot(config),
        CollectionsModule,
        DocumentsModule,
      ],
      providers: [{ provide: DATA_CONFIG, useValue: config }],
      exports: [DATA_CONFIG],
    };
  }
}
