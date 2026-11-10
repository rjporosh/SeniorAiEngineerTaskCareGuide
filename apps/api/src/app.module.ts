import { Module } from '@nestjs/common';
import type { Repositories } from './application/ports.js';
import type { QueuePort } from './application/queue.js';
import { ConfigModule } from './config.module.js';
import { HealthController } from './health/health.controller.js';
import { HEALTH_PROBES } from './health/health.tokens.js';
import { PersistenceModule, REPOSITORIES, databaseHealthProbe } from './persistence.module.js';
import { QUEUE, QueueModule, queueHealthProbe } from './queue.module.js';

@Module({
  imports: [ConfigModule, PersistenceModule, QueueModule],
  controllers: [HealthController],
  providers: [
    {
      provide: HEALTH_PROBES, inject: [REPOSITORIES, QUEUE],
      useFactory: (r: Repositories, q: QueuePort) => [databaseHealthProbe(r), queueHealthProbe(q)],
    },
  ],
})
export class AppModule {}
