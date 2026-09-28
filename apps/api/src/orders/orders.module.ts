import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order } from './entities/order.entity';
import { RawEvent } from './entities/raw-event.entity';
import { OrderEvent } from './entities/order-event.entity';
import { Alert } from './entities/alert.entity';
import { ListenerCursor } from './entities/listener-cursor.entity';
import { PipelineSetting } from './entities/pipeline-setting.entity';
import { LedgerService } from './ledger.service';
import { OrdersQueryService } from './orders-query.service';
import { PipelineControlService } from './pipeline-control.service';

@Module({
  imports: [TypeOrmModule.forFeature([Order, RawEvent, OrderEvent, Alert, ListenerCursor, PipelineSetting])],
  providers: [LedgerService, OrdersQueryService, PipelineControlService],
  exports: [TypeOrmModule, LedgerService, OrdersQueryService, PipelineControlService],
})
export class OrdersModule {}
