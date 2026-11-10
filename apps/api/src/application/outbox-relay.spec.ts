import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createMemoryRepositories } from '../infrastructure/persistence/memory/memory.repositories.js';
import { OutboxRelay } from './outbox-relay.js';
import type { QueueMessage, QueuePort } from './queue.js';

const log = { warn: () => undefined, error: () => undefined };
const fakeQueue = (fail: () => boolean): QueuePort & { sent: QueueMessage[] } => {
  const sent: QueueMessage[] = [];
  return {
    provider: 'rabbitmq', sent,
    publish: async (m) => { if (fail()) throw new Error('broker down'); sent.push(m); },
    startConsumer: async () => undefined, stats: async () => ({ ready: 0, deadLettered: 0 }), ping: async () => undefined, close: async () => undefined,
  };
};

async function seed() {
  const repos = createMemoryRepositories();
  const u = await repos.users.create({ email: 'a@b.io', passwordHash: 'h', role: 'uploader' });
  const d = await repos.documents.createWithOutbox(
    { ownerId: u.id, originalFilename: 'a.pdf', detectedMime: 'application/pdf', byteSize: 1, sha256: 's', storageKey: randomUUID(), storageProvider: 'local', idempotencyKey: null },
    (documentId, attemptId) => ({ topic: 'document.process', payload: { documentId, attemptId } }),
  );
  return { repos, d };
}

describe('OutboxRelay', () => {
  it('publishes pending rows once with the outbox id as message id', async () => {
    const { repos, d } = await seed();
    const q = fakeQueue(() => false);
    const relay = new OutboxRelay(repos.outbox, q, log);
    expect(await relay.tick()).toBe(1);
    expect(await relay.tick()).toBe(0);
    expect(q.sent[0]).toMatchObject({ documentId: d.id, jobType: 'document.process', schemaVersion: 1 });
  });

  it('keeps rows pending on broker failure, then delivers after recovery', async () => {
    const { repos } = await seed();
    let down = true;
    const q = fakeQueue(() => down);
    const relay = new OutboxRelay(repos.outbox, q, log, { backoff: { baseDelayMs: 1, maxDelayMs: 1 } });
    expect(await relay.tick()).toBe(0);
    down = false;
    expect(await relay.tick(new Date(Date.now() + 5000))).toBe(1);
    expect(q.sent).toHaveLength(1);
  });

  it('dead-letters a row after the attempt budget', async () => {
    const { repos } = await seed();
    const q = fakeQueue(() => true);
    const relay = new OutboxRelay(repos.outbox, q, log, { maxAttempts: 2, backoff: { baseDelayMs: 1, maxDelayMs: 1 } });
    let t = Date.now();
    await relay.tick(new Date(t)); t += 5000;
    await relay.tick(new Date(t)); t += 5000;
    expect(await relay.tick(new Date(t))).toBe(0);
    expect(await repos.outbox.claimPending(10, new Date(t + 1e7))).toHaveLength(0);
  });
});
