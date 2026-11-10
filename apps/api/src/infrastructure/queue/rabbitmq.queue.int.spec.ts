import { randomUUID } from 'node:crypto';
import { runQueueContract } from '../../testing/queue.contract.js';
import { RabbitMqQueue } from './rabbitmq.queue.js';

const url = process.env.TEST_RABBITMQ_URL;
if (!url) throw new Error('TEST_RABBITMQ_URL is required for integration tests');

runQueueContract('rabbitmq', async () => new RabbitMqQueue({
  url, namespace: `t${randomUUID().slice(0, 8)}`, policy: { maxAttempts: 3, baseDelayMs: 30, maxDelayMs: 120 },
}));
