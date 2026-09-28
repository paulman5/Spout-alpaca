import { DynamicModule, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from './config/config.module';
import { dataSourceOptions } from './config/data-source';
import { pinoModule } from './config/logger';
import { loadEnv } from './config/env';
import { ListenerModule } from './listener/listener.module';
import { WorkerModule } from './worker/worker.module';
import { ReconcileModule } from './reconcile/reconcile.module';
import { ApiModule } from './api/api.module';

/**
 * One codebase, several processes. ROLE picks which feature module is loaded;
 * the database, config and logger are shared by all of them.
 */
@Module({})
export class AppModule {
  static forRole(): DynamicModule {
    const env = loadEnv();
    const feature = {
      listener: ListenerModule,
      worker: WorkerModule,
      reconciler: ReconcileModule,
      api: ApiModule,
    }[env.ROLE as 'listener' | 'worker' | 'reconciler' | 'api'];
    return {
      module: AppModule,
      imports: [
        ConfigModule,
        pinoModule(),
        // Only the api process runs migrations; the others wait for it (compose: depends_on api healthy),
        // so a fresh database is never migrated by several processes at once.
        TypeOrmModule.forRoot({ ...dataSourceOptions(), migrationsRun: env.ROLE === 'api', autoLoadEntities: false }),
        feature,
      ],
    };
  }
}
