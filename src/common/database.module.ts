import { Module, type DynamicModule } from '@nestjs/common';
import { Pool } from 'pg';
import type { DataDaemonConfig } from '../config';
import { DB_POOL } from './constants';

@Module({})
export class DatabaseModule {
  static forRoot(config: DataDaemonConfig): DynamicModule {
    const pool = new Pool({
      connectionString: config.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 20,
    });

    return {
      module: DatabaseModule,
      global: true,
      providers: [{ provide: DB_POOL, useValue: pool }],
      exports: [DB_POOL],
    };
  }
}
