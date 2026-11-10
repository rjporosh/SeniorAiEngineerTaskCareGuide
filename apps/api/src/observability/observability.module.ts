import { Global, Module } from '@nestjs/common';
import { APP_CONFIG } from '../app.tokens.js';
import type { AppConfig } from '../config/env.schema.js';
import type { QueuePort } from '../application/queue.js';
import { QUEUE } from '../queue.module.js';
import { AccessLogMiddleware } from './access-log.middleware.js';
import { AppLogger, createPino } from './logger.js';
import { AppMetrics } from './metrics.js';
import { MetricsController } from './metrics.controller.js';
import { OBS_LOGGER, OBS_METRICS } from './observability.tokens.js';

@Global()
@Module({
  controllers: [MetricsController],
  providers: [
    { provide: OBS_LOGGER, inject: [APP_CONFIG], useFactory: (c: AppConfig) => new AppLogger(createPino(c.LOG_LEVEL, 'docint-api')) },
    { provide: OBS_METRICS, inject: [QUEUE], useFactory: (q: QueuePort) => new AppMetrics({ queue: () => q.stats() }) },
    AccessLogMiddleware,
  ],
  exports: [OBS_LOGGER, OBS_METRICS, AccessLogMiddleware],
})
export class ObservabilityModule {}
