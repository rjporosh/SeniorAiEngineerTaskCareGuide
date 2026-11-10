import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import type { Repositories } from './application/ports.js';
import type { QueuePort } from './application/queue.js';
import type { ObjectStoragePort } from './application/storage.js';
import { AuthGuard } from './auth/auth.guard.js';
import { AuthModule } from './auth/auth.module.js';
import { AccessLogMiddleware } from './observability/access-log.middleware.js';
import { ObservabilityModule } from './observability/observability.module.js';
import { correlationMiddleware } from './common/correlation.middleware.js';
import { EnvelopeInterceptor } from './common/envelope.interceptor.js';
import { GlobalExceptionFilter } from './common/global-exception.filter.js';
import { ConfigModule } from './config.module.js';
import { DocumentsModule } from './documents/documents.module.js';
import { HealthController } from './health/health.controller.js';
import { HEALTH_PROBES } from './health/health.tokens.js';
import { DOCUMENT_PROCESSOR, ProcessingModule, processorHealthProbe } from './processing/processing.module.js';
import type { DocumentProcessorPort } from './processing/processor.client.js';
import { PersistenceModule, REPOSITORIES, databaseHealthProbe } from './persistence.module.js';
import { QUEUE, QueueModule, queueHealthProbe } from './queue.module.js';
import { SearchModule } from './search/search.module.js';
import { STORAGE, StorageModule, storageHealthProbe } from './storage.module.js';

const RATE_LIMIT = Number(process.env['RATE_LIMIT_PER_MINUTE'] ?? 120);

@Module({
  imports: [
    ConfigModule, PersistenceModule, QueueModule, ObservabilityModule, StorageModule, ProcessingModule, AuthModule, DocumentsModule, SearchModule,
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: RATE_LIMIT }]),
  ],
  controllers: [HealthController],
  providers: [
    {
      provide: HEALTH_PROBES, inject: [REPOSITORIES, QUEUE, STORAGE, DOCUMENT_PROCESSOR],
      useFactory: (r: Repositories, q: QueuePort, s: ObjectStoragePort, p: DocumentProcessorPort) => [databaseHealthProbe(r), queueHealthProbe(q), storageHealthProbe(s), processorHealthProbe(p)],
    },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void { consumer.apply(correlationMiddleware, AccessLogMiddleware).forRoutes('*path'); }
}
