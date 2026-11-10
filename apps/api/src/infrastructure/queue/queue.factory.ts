import type { QueuePort, RetryPolicy } from '../../application/queue.js';
import type { AppConfig } from '../../config/env.schema.js';

type QueueConfig = Pick<AppConfig, 'QUEUE_PROVIDER' | 'RABBITMQ_URL' | 'REDIS_URL' | 'QUEUE_MAX_ATTEMPTS' | 'QUEUE_RETRY_BASE_MS' | 'QUEUE_RETRY_MAX_MS'>;

export const retryPolicyOf = (c: QueueConfig): RetryPolicy => ({
  maxAttempts: c.QUEUE_MAX_ATTEMPTS, baseDelayMs: c.QUEUE_RETRY_BASE_MS, maxDelayMs: c.QUEUE_RETRY_MAX_MS,
});

/** Selects the broker adapter once, at bootstrap, from validated configuration. */
export async function createQueue(c: QueueConfig): Promise<QueuePort> {
  const policy = retryPolicyOf(c);
  switch (c.QUEUE_PROVIDER) {
    case 'rabbitmq': {
      const { RabbitMqQueue } = await import('./rabbitmq.queue.js');
      return new RabbitMqQueue({ url: need(c.RABBITMQ_URL, 'RABBITMQ_URL'), policy });
    }
    case 'bullmq': {
      const { BullMqQueue } = await import('./bullmq.queue.js');
      return new BullMqQueue({ url: need(c.REDIS_URL, 'REDIS_URL'), policy });
    }
  }
}
const need = (v: string | undefined, n: string): string => { if (!v) throw new Error(`${n} is required`); return v; };
