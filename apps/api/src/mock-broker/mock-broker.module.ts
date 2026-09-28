import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { pinoModule } from '../config/logger';
import { MockBrokerController } from './mock-broker.controller';
import { MockBrokerService } from './mock-broker.service';

@Module({
  imports: [ConfigModule, pinoModule()],
  controllers: [MockBrokerController],
  providers: [MockBrokerService],
})
export class MockBrokerAppModule {}
