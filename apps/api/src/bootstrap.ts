import { NestFactory } from '@nestjs/core';
import type { INestApplication, Type } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import type { AppConfig } from './config/env.schema.js';

export const API_PREFIX = 'api/v1';

/** Applies cross-cutting HTTP hardening. Shared by main.ts and the integration tests. */
export function configureApp(app: NestExpressApplication, config: Pick<AppConfig, 'CORS_ORIGINS' | 'TRUST_PROXY' | 'NODE_ENV'>): void {
  app.set('trust proxy', config.TRUST_PROXY ? 1 : false);
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], scriptSrc: ["'self'", "'unsafe-inline'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:'] } } }));
  app.useBodyParser('json', { limit: '256kb' });
  app.setGlobalPrefix(API_PREFIX);
  app.enableCors({ origin: config.CORS_ORIGINS, methods: ['GET', 'POST', 'PATCH', 'DELETE'], allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-Correlation-Id'], exposedHeaders: ['X-Correlation-Id'], maxAge: 600 });
  app.enableShutdownHooks();
}

export function setupDocs(app: INestApplication, enabled: boolean): void {
  if (!enabled) return;
  const doc = new DocumentBuilder()
    .setTitle('Document Intelligence API').setVersion('1.0.0')
    .setDescription('Upload, extract, validate, search and review business documents. All responses use a common envelope: { success, data | errors, traceId, timestamp }.')
    .addBearerAuth().build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, doc), { jsonDocumentUrl: 'api/docs/openapi.json' });
}

export async function createApp(module: Type<unknown>): Promise<NestExpressApplication> {
  return NestFactory.create<NestExpressApplication>(module, { bufferLogs: true });
}
