import { Module } from '@nestjs/common';
import { BrokerModule } from '../broker/broker.module';
import { ChainModule } from '../chain/chain.module';
import { OrdersModule } from '../orders/orders.module';
import { ClaimService } from './claim.service';
import { OrderProcessor } from './order.processor';
import { WorkerService } from './worker.service';

/** Shared pieces (claims + processor) without the loop, for the reconciler and API. */
@Module({
  imports: [OrdersModule, BrokerModule, ChainModule],
  providers: [ClaimService, OrderProcessor],
  exports: [ClaimService, OrderProcessor],
})
export class ProcessingModule {}

@Module({
  imports: [ProcessingModule, OrdersModule],
  providers: [WorkerService],
})
export class WorkerModule {}
