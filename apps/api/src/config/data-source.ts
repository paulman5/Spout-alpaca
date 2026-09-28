import 'reflect-metadata';
import { DataSource, DataSourceOptions } from 'typeorm';
import { loadEnv } from './env';
import { Order } from '../orders/entities/order.entity';
import { RawEvent } from '../orders/entities/raw-event.entity';
import { OrderEvent } from '../orders/entities/order-event.entity';
import { Alert } from '../orders/entities/alert.entity';
import { ListenerCursor } from '../orders/entities/listener-cursor.entity';
import { PipelineSetting } from '../orders/entities/pipeline-setting.entity';
import { InitialSchema1757200000000 } from '../migrations/1757200000000-InitialSchema';
import { PipelineSettings1757200001000 } from '../migrations/1757200001000-PipelineSettings';
import { RawEventLogs1757200002000 } from '../migrations/1757200002000-RawEventLogs';

export function dataSourceOptions(): DataSourceOptions {
  const env = loadEnv();
  return {
    type: 'postgres',
    url: env.DATABASE_URL,
    entities: [Order, RawEvent, OrderEvent, Alert, ListenerCursor, PipelineSetting],
    migrations: [InitialSchema1757200000000, PipelineSettings1757200001000, RawEventLogs1757200002000],
    synchronize: false,
    logging: false,
  };
}

export default new DataSource(dataSourceOptions());
