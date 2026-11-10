import { randomUUID } from 'node:crypto';
import { runQueueContract } from '../../testing/queue.contract.js';
import { BullMqQueue } from './bullmq.queue.js';

const url = process.env.TEST_REDIS_URL;
if (!url) throw new Error('TEST_REDIS_URL is required for integration tests');

runQueueContract('bullmq', async () => new BullMqQueue({
  url, namespace: `t${randomUUID().slice(0, 8)}`, policy: { maxAttempts: 3, baseDelayMs: 30, maxDelayMs: 120 },
}));
