import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { PermanentJobError, type DeliveryContext, type QueueMessage, type QueuePort } from '../application/queue.js';

export const makeMessage = (over: Partial<QueueMessage> = {}): QueueMessage => ({
  messageId: randomUUID(), jobType: 'document.process', schemaVersion: 1, documentId: randomUUID(), attemptId: randomUUID(),
  correlationId: 'corr-1', idempotencyKey: randomUUID(), createdAt: new Date().toISOString(), payload: {}, ...over,
});

const until = async (cond: () => boolean | Promise<boolean>, ms = 15_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await cond()) return; await new Promise((r) => setTimeout(r, 25)); }
  throw new Error('condition not met in time');
};

/** Behavioural contract for every broker adapter. `create` must return an isolated (namespaced) queue with maxAttempts = 3. */
export function runQueueContract(name: string, create: () => Promise<QueuePort>): void {
  describe(`queue contract: ${name}`, () => {
    const open: QueuePort[] = [];
    const fresh = async () => { const q = await create(); open.push(q); return q; };
    afterEach(async () => { while (open.length) await open.pop()!.close(); });

    it('delivers a published message exactly once and acknowledges it', async () => {
      const q = await fresh();
      const seen: { m: QueueMessage; c: DeliveryContext }[] = [];
      await q.startConsumer(async (m, c) => { seen.push({ m, c }); }, { concurrency: 2 });
      const msg = makeMessage();
      await q.publish(msg);
      await until(() => seen.length === 1);
      expect(seen[0]?.m).toMatchObject({ messageId: msg.messageId, documentId: msg.documentId, attemptId: msg.attemptId });
      expect(seen[0]?.c).toEqual({ attempt: 1, maxAttempts: 3, isFinalAttempt: false });
      await until(async () => (await q.stats()).ready === 0);
      expect((await q.stats()).deadLettered).toBe(0);
    });

    it('retries transient failures with an increasing attempt counter', async () => {
      const q = await fresh();
      const attempts: number[] = [];
      await q.startConsumer(async (_m, c) => { attempts.push(c.attempt); if (c.attempt < 3) throw new Error('transient'); }, { concurrency: 1 });
      await q.publish(makeMessage());
      await until(() => attempts.length === 3);
      expect(attempts).toEqual([1, 2, 3]);
      await until(async () => (await q.stats()).ready === 0);
      expect((await q.stats()).deadLettered).toBe(0);
    });

    it('dead-letters permanent failures without retrying', async () => {
      const q = await fresh();
      let calls = 0;
      await q.startConsumer(async () => { calls++; throw new PermanentJobError('corrupt file'); }, { concurrency: 1 });
      await q.publish(makeMessage());
      await until(async () => (await q.stats()).deadLettered === 1);
      expect(calls).toBe(1);
    });

    it('dead-letters after the retry budget is exhausted and flags the final attempt', async () => {
      const q = await fresh();
      const finals: boolean[] = [];
      await q.startConsumer(async (_m, c) => { finals.push(c.isFinalAttempt); throw new Error('always'); }, { concurrency: 1 });
      await q.publish(makeMessage());
      await until(async () => (await q.stats()).deadLettered === 1);
      expect(finals).toEqual([false, false, true]);
    });

    it('is healthy while connected', async () => {
      const q = await fresh();
      await expect(q.ping()).resolves.toBeUndefined();
    });
  });
}
