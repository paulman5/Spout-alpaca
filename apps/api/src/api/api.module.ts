import { Module } from '@nestjs/common';
import { ChainModule } from '../chain/chain.module';
import { IngestModule } from '../listener/listener.module';
import { OrdersModule } from '../orders/orders.module';
import { ReconcileModule } from '../reconcile/reconcile.module';
import { ApiController } from './api.controller';
import { AdminGuard } from './admin.guard';
import { ProcessingModule } from '../worker/worker.module';

@Module({
  imports: [OrdersModule, IngestModule, ReconcileModule, ChainModule, ProcessingModule],
  controllers: [ApiController],
  providers: [AdminGuard],
})
export class ApiModule {}
