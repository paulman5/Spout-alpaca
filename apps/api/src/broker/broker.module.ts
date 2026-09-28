import { Module } from '@nestjs/common';
import { ENV, type Env } from '../config/env';
import { BROKER_CLIENT } from './broker.types';
import { AlpacaBrokerClient } from './alpaca/alpaca-broker.client';
import { MockBrokerClient } from './mock/mock-broker.client';

/** BROKER=mock | alpaca picks the implementation; the worker only knows BrokerClient. */
@Module({
  providers: [
    {
      provide: BROKER_CLIENT,
      inject: [ENV],
      useFactory: (env: Env) => (env.BROKER === 'alpaca' ? new AlpacaBrokerClient(env) : new MockBrokerClient(env)),
    },
  ],
  exports: [BROKER_CLIENT],
})
export class BrokerModule {}
