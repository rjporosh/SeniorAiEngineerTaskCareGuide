import { NestFactory } from '@nestjs/core';
import type { INestApplication, Type } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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

export const DOCS_TITLE = 'Document Intelligence API';
const DESCRIPTION = `Upload invoices, receipts and spreadsheets, extract structured data (rules, Ollama or OpenAI), validate it, search it and review it.

**Envelope.** Every JSON response is \`{ success, data | errors, traceId, timestamp }\`. Validation failures list every problem at once.

**Auth.** \`POST /auth/login\` returns a short-lived bearer token; send it as \`Authorization: Bearer <token>\`. Roles: \`admin\`, \`reviewer\`, \`uploader\`.

**Idempotency.** \`POST /documents\` and \`POST /documents/{id}/reprocess\` accept an \`Idempotency-Key\` header.`;

const SCALAR_BUNDLE_URL = 'api/docs/scalar.js';
const here = dirname(fileURLToPath(import.meta.url));
/** Compiled builds ship the bundle in dist/assets; tsx/vitest runs read it from the linked devDependency. */
const scalarBundle = (): string | null =>
  [join(here, 'assets/scalar-api-reference.js'), join(here, '../node_modules/@scalar/api-reference/dist/browser/standalone.js')].find((p) => existsSync(p)) ?? null;

const REFERENCE_CSP = "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'";

const referenceHtml = (): string => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${DOCS_TITLE} · Reference</title></head>
<body>
<script id="api-reference" data-url="/api/docs/openapi.json" data-configuration='${JSON.stringify({ theme: 'default', layout: 'modern', hideClientButton: false, defaultOpenAllTags: false, metaData: { title: `${DOCS_TITLE} · Reference` } })}'></script>
<script src="/${SCALAR_BUNDLE_URL}"></script>
</body></html>`;

/** Scalar reference at /api/docs, Swagger UI at /api/swagger, raw OpenAPI at /api/docs/openapi.json. */
export function setupDocs(app: INestApplication, enabled: boolean): void {
  if (!enabled) return;
  const doc = new DocumentBuilder()
    .setTitle(DOCS_TITLE).setVersion('1.0.0').setDescription(DESCRIPTION)
    .setContact('Document Intelligence', '', '').setLicense('MIT', 'https://opensource.org/licenses/MIT')
    .addBearerAuth()
    .addTag('Auth', 'Sign in, refresh tokens and manage users').addTag('Documents', 'Upload, list, inspect, download and reprocess documents')
    .addTag('Review', 'Corrections and validation-issue resolution').addTag('Search', 'Keyword and semantic search')
    .addTag('Health', 'Liveness and readiness probes').build();
  const document = SwaggerModule.createDocument(app, doc);
  SwaggerModule.setup('api/swagger', app, document, { jsonDocumentUrl: 'api/docs/openapi.json', customSiteTitle: `${DOCS_TITLE} · Swagger UI` });

  const http = app.getHttpAdapter();
  http.get('/api/docs', (_req: unknown, res: { setHeader(k: string, v: string): void; type(t: string): void; send(b: string): void }) => {
    res.setHeader('Content-Security-Policy', REFERENCE_CSP);
    res.type('html'); res.send(referenceHtml());
  });
  http.get(`/${SCALAR_BUNDLE_URL}`, (_req: unknown, res: { setHeader(k: string, v: string): void; status(c: number): { end(): void }; sendFile(p: string): void }) => {
    const file = scalarBundle();
    if (!file) { res.status(404).end(); return; }
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
    res.sendFile(file);
  });
}

export async function createApp(module: Type<unknown>): Promise<NestExpressApplication> {
  return NestFactory.create<NestExpressApplication>(module, { bufferLogs: true });
}
