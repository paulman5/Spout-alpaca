import { Module } from '@nestjs/common';
import { ChainModule } from '../chain/chain.module';
import { OrdersModule } from '../orders/orders.module';
import { IngestService } from './ingest.service';
import { ListenerService } from './listener.service';

/** Ingest-only module (used by api for replays) */
@Module({
  imports: [ChainModule, OrdersModule],
  providers: [IngestService],
  exports: [IngestService],
})
export class IngestModule {}

/** Full listener process */
@Module({
  imports: [ChainModule, OrdersModule, IngestModule],
  providers: [ListenerService],
})
export class ListenerModule {}
