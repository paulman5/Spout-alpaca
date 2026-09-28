import { Module } from '@nestjs/common';
import { BrokerModule } from '../broker/broker.module';
import { ChainModule } from '../chain/chain.module';
import { OrdersModule } from '../orders/orders.module';
import { ProcessingModule } from '../worker/worker.module';
import { ReconcileService } from './reconcile.service';

@Module({
  imports: [OrdersModule, BrokerModule, ChainModule, ProcessingModule],
  providers: [ReconcileService],
  exports: [ReconcileService],
})
export class ReconcileModule {}
