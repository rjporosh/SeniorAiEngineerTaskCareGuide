import { Global, Inject, Logger, Module, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { APP_CONFIG } from './app.tokens.js';
import type { AppConfig } from './config/env.schema.js';
import type { QueuePort } from './application/queue.js';
import type { Repositories } from './application/ports.js';
import { OutboxRelay } from './application/outbox-relay.js';
import { createQueue, retryPolicyOf } from './infrastructure/queue/queue.factory.js';
import type { HealthProbe } from './health/health.tokens.js';
import { REPOSITORIES } from './persistence.module.js';

export const QUEUE = Symbol('QUEUE');
export const OUTBOX_RELAY = Symbol('OUTBOX_RELAY');

@Global()
@Module({
  providers: [
    { provide: QUEUE, inject: [APP_CONFIG], useFactory: (c: AppConfig) => createQueue(c) },
    {
      provide: OUTBOX_RELAY, inject: [REPOSITORIES, QUEUE, APP_CONFIG],
      useFactory: (r: Repositories, q: QueuePort, c: AppConfig) =>
        new OutboxRelay(r.outbox, q, new Logger('OutboxRelay'), { backoff: retryPolicyOf(c) }),
    },
  ],
  exports: [QUEUE, OUTBOX_RELAY],
})
export class QueueModule implements OnApplicationBootstrap, OnApplicationShutdown {
  constructor(
    @Inject(OUTBOX_RELAY) private readonly relay: OutboxRelay,
    @Inject(QUEUE) private readonly queue: QueuePort,
  ) {}
  onApplicationBootstrap(): void { this.relay.start(); }
  async onApplicationShutdown(): Promise<void> {
    await this.relay.stop();
    await this.queue.close();
  }
}

export const queueHealthProbe = (q: QueuePort): HealthProbe => ({ name: `queue:${q.provider}`, check: () => q.ping() });
