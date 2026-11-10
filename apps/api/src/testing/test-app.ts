import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../app.module.js';
import { configureApp } from '../bootstrap.js';
import { OUTBOX_RELAY, QUEUE } from '../queue.module.js';
import { DOCUMENT_PROCESSOR } from '../processing/processing.module.js';
import type { DocumentProcessorPort } from '../processing/processor.client.js';
import { ProcessorError } from '../processing/processor.client.js';
import type { OutboxRelay } from '../application/outbox-relay.js';
import type { MessageHandler } from '../application/queue.js';
import { response, textPage } from './blocks.js';
import { REPOSITORIES } from '../persistence.module.js';
import type { QueueMessage, QueuePort } from '../application/queue.js';
import type { Repositories } from '../application/ports.js';
import { loadConfig } from '../config/env.schema.js';

export const ADMIN = { email: 'admin@example.com', password: 'admin-password-123' };

export interface TestApp {
  app: NestExpressApplication; base: string; published: QueueMessage[]; repos: Repositories;
  login(email: string, password: string): Promise<string>;
  /** Relays the outbox and delivers every queued message to the worker handler (as the broker would). */
  drain(): Promise<void>;
  close(): Promise<void>;
}

export async function startTestApp(env: Record<string, string> = {}): Promise<TestApp> {
  Object.assign(process.env, {
    NODE_ENV: 'test', DATABASE_PROVIDER: 'memory', QUEUE_PROVIDER: 'rabbitmq', RABBITMQ_URL: 'amqp://unused',
    OBJECT_STORAGE_PROVIDER: 'local', STORAGE_LOCAL_ROOT: mkdtempSync(join(tmpdir(), 'docint-')),
    PROCESSOR_SERVICE_TOKEN: 't'.repeat(24), JWT_ACCESS_SECRET: 'j'.repeat(40),
    SEED_ADMIN_EMAIL: ADMIN.email, SEED_ADMIN_PASSWORD: ADMIN.password, RATE_LIMIT_PER_MINUTE: '1000', ...env,
  });
  const published: QueueMessage[] = [];
  let handler: MessageHandler | null = null;
  const queue: QueuePort = {
    provider: 'rabbitmq', publish: async (m) => { published.push(m); }, startConsumer: async (h) => { handler = h; },
    stats: async () => ({ ready: 0, deadLettered: 0 }), ping: async () => undefined, close: async () => undefined,
  };
  const processor: DocumentProcessorPort = {
    ping: async () => undefined,
    process: async (body) => {
      const chunks: Buffer[] = [];
      for await (const c of body) chunks.push(Buffer.from(c));
      const text = Buffer.concat(chunks).toString('utf8');
      const fail = /FAIL:(\w+)/.exec(text);
      if (fail) throw new ProcessorError(fail[1]!, 'scripted failure', fail[1] === 'PROCESSOR_UNAVAILABLE');
      return response([textPage(1, /INVOICE_TEXT:([\s\S]*)\n%%EOF/.exec(text)?.[1]?.trim() ?? '')]);
    },
  };
  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(QUEUE).useValue(queue).overrideProvider(DOCUMENT_PROCESSOR).useValue(processor).compile();
  const app = mod.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app, loadConfig());
  await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}/api/v1`;
  const login = async (email: string, password: string) => {
    const r = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
    return ((await r.json()) as { data: { accessToken: string } }).data.accessToken;
  };
  const relay = mod.get<OutboxRelay>(OUTBOX_RELAY);
  let delivered = 0;
  const drain = async () => {
    await app.init();
    await relay.tick(new Date(Date.now() + 120_000));
    while (delivered < published.length) {
      const m = published[delivered++]!;
      try { await handler?.(m, { attempt: 1, maxAttempts: 3, isFinalAttempt: false }); } catch { /* a retry would be scheduled by the broker */ }
    }
  };
  return { app, base, published, repos: mod.get<Repositories>(REPOSITORIES), login, drain, close: () => app.close() };
}

export const pdfBytes = (extra = ''): Buffer => Buffer.from(`%PDF-1.4\n1 0 obj<<>>endobj\n${extra}\n%%EOF`);
/** A "PDF" whose scripted extraction text is `text` (the test processor reads the INVOICE_TEXT marker). */
export const invoicePdf = (text: string): Buffer => pdfBytes(`INVOICE_TEXT:${text}`);

export function multipart(files: { name: string; data: Buffer; type?: string }[]): FormData {
  const form = new FormData();
  for (const f of files) form.append('files', new Blob([new Uint8Array(f.data)], { type: f.type ?? 'application/octet-stream' }), f.name);
  return form;
}
