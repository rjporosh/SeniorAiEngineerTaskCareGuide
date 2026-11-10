import { connect, type Channel, type ChannelModel, type ConfirmChannel, type ConsumeMessage } from 'amqplib';
import { Logger } from '@nestjs/common';
import {
  PermanentJobError, computeBackoff, queueMessageSchema, type MessageHandler, type QueueMessage, type QueuePort,
  type QueueStats, type RetryPolicy,
} from '../../application/queue.js';

const ATTEMPT_HEADER = 'x-attempt';

export interface RabbitOptions { url: string; policy: RetryPolicy; namespace?: string; reconnectMs?: number }

/**
 * Topology (per job type `T`, namespace `N`):
 *   exchange N.jobs (direct) -> queue N.T            (durable, dead-letters to N.jobs.dlx)
 *   queue N.T.retry          (per-message TTL, dead-letters back to N.jobs)  = delayed retry
 *   exchange N.jobs.dlx      -> queue N.T.dlq         = final dead-letter queue
 * Messages are persistent and published with confirms; acknowledgement happens only after the
 * handler (and therefore its durable state transition) has finished.
 */
export class RabbitMqQueue implements QueuePort {
  readonly provider = 'rabbitmq' as const;
  private readonly log = new Logger('RabbitMqQueue');
  private readonly ns: string;
  private readonly routingKey = 'document.process';
  private conn: ChannelModel | null = null;
  private pub: ConfirmChannel | null = null;
  private sub: Channel | null = null;
  private consumerTag: string | null = null;
  private handler: MessageHandler | null = null;
  private concurrency = 1;
  private closing = false;
  private inflight = 0;
  private reconnecting: Promise<void> | null = null;

  constructor(private readonly opts: RabbitOptions) { this.ns = opts.namespace ?? 'docint'; }
  private get queue() { return `${this.ns}.${this.routingKey}`; }
  private get retryQueue() { return `${this.queue}.retry`; }
  private get dlq() { return `${this.queue}.dlq`; }
  private get exchange() { return `${this.ns}.jobs`; }
  private get dlx() { return `${this.ns}.jobs.dlx`; }

  private async open(): Promise<void> {
    const conn = await connect(this.opts.url);
    conn.on('error', (e: Error) => this.log.warn(`connection error: ${e.message}`));
    conn.on('close', () => { if (!this.closing) { this.log.error('connection closed unexpectedly; reconnecting'); void this.reconnect(); } });
    const setup = await conn.createChannel();
    await setup.assertExchange(this.exchange, 'direct', { durable: true });
    await setup.assertExchange(this.dlx, 'direct', { durable: true });
    await setup.assertQueue(this.queue, { durable: true, arguments: { 'x-dead-letter-exchange': this.dlx, 'x-dead-letter-routing-key': this.routingKey } });
    await setup.assertQueue(this.retryQueue, { durable: true, arguments: { 'x-dead-letter-exchange': this.exchange, 'x-dead-letter-routing-key': this.routingKey } });
    await setup.assertQueue(this.dlq, { durable: true });
    await setup.bindQueue(this.queue, this.exchange, this.routingKey);
    await setup.bindQueue(this.dlq, this.dlx, this.routingKey);
    await setup.close();
    this.conn = conn;
    this.pub = await conn.createConfirmChannel();
    this.pub.on('error', (e: Error) => this.log.warn(`publish channel error: ${e.message}`));
  }

  private async ensure(): Promise<ConfirmChannel> {
    if (!this.conn || !this.pub) {
      if (this.reconnecting) await this.reconnecting; else await this.open();
    }
    if (!this.pub) throw new Error('RabbitMQ is not connected');
    return this.pub;
  }

  private reconnect(): Promise<void> {
    if (this.reconnecting) return this.reconnecting;
    this.conn = null; this.pub = null; this.sub = null; this.consumerTag = null;
    this.reconnecting = (async () => {
      for (let attempt = 1; !this.closing; attempt++) {
        try {
          await this.open();
          if (this.handler) await this.consume();
          this.log.log(`reconnected after ${attempt} attempt(s)`);
          return;
        } catch (e) {
          const wait = computeBackoff(attempt, { baseDelayMs: this.opts.reconnectMs ?? 1000, maxDelayMs: 30_000 });
          this.log.warn(`reconnect attempt ${attempt} failed (${(e as Error).message}); retrying in ${wait}ms`);
          await new Promise((r) => setTimeout(r, wait));
        }
      }
    })().finally(() => { this.reconnecting = null; });
    return this.reconnecting;
  }

  private publishRaw(ch: ConfirmChannel, exchange: string, key: string, body: QueueMessage, headers: Record<string, unknown>, expirationMs?: number): Promise<void> {
    return new Promise((resolve, reject) => {
      ch.publish(exchange, key, Buffer.from(JSON.stringify(body)), {
        persistent: true, contentType: 'application/json', messageId: body.messageId, correlationId: body.correlationId,
        timestamp: Date.now(), headers, ...(expirationMs !== undefined && { expiration: String(expirationMs) }),
      }, (err) => (err ? reject(err instanceof Error ? err : new Error(String(err))) : resolve()));
    });
  }

  async publish(message: QueueMessage): Promise<void> {
    const ch = await this.ensure();
    await this.publishRaw(ch, this.exchange, message.jobType, message, { [ATTEMPT_HEADER]: 1 });
  }

  async startConsumer(handler: MessageHandler, options: { concurrency: number }): Promise<void> {
    this.handler = handler; this.concurrency = options.concurrency;
    await this.ensure();
    await this.consume();
  }

  private async consume(): Promise<void> {
    if (!this.conn || !this.handler) return;
    const ch = await this.conn.createChannel();
    ch.on('error', (e: Error) => this.log.warn(`consumer channel error: ${e.message}`));
    await ch.prefetch(this.concurrency);
    this.sub = ch;
    const { consumerTag } = await ch.consume(this.queue, (m) => { if (m) void this.onDelivery(ch, m); }, { noAck: false });
    this.consumerTag = consumerTag;
  }

  private async onDelivery(ch: Channel, m: ConsumeMessage): Promise<void> {
    this.inflight++;
    try {
      let msg: QueueMessage;
      try { msg = queueMessageSchema.parse(JSON.parse(m.content.toString('utf8'))); }
      catch { this.log.error('poison message dead-lettered (invalid envelope)'); ch.nack(m, false, false); return; }
      const attempt = Number(m.properties.headers?.[ATTEMPT_HEADER] ?? 1);
      const { maxAttempts } = this.opts.policy;
      try {
        await this.handler?.(msg, { attempt, maxAttempts, isFinalAttempt: attempt >= maxAttempts });
        ch.ack(m);
      } catch (e) {
        if (e instanceof PermanentJobError || attempt >= maxAttempts) { ch.nack(m, false, false); return; }
        const delay = computeBackoff(attempt, this.opts.policy);
        const pub = await this.ensure();
        await this.publishRaw(pub, '', this.retryQueue, msg, { [ATTEMPT_HEADER]: attempt + 1 }, delay);
        ch.ack(m);
      }
    } catch (e) {
      this.log.error(`delivery handling failed: ${(e as Error).message}`);
      try { ch.nack(m, false, true); } catch { /* channel already closed; broker will redeliver */ }
    } finally { this.inflight--; }
  }

  async stats(): Promise<QueueStats> {
    await this.ensure();
    const ch = await this.conn!.createChannel();
    try {
      const [q, d] = await Promise.all([ch.checkQueue(this.queue), ch.checkQueue(this.dlq)]);
      return { ready: q.messageCount, deadLettered: d.messageCount };
    } finally { await ch.close(); }
  }

  async ping(): Promise<void> {
    await this.ensure();
    const ch = await this.conn!.createChannel();
    await ch.close();
  }

  async close(): Promise<void> {
    this.closing = true;
    if (this.sub && this.consumerTag) await this.sub.cancel(this.consumerTag).catch(() => undefined);
    const deadline = Date.now() + 30_000;
    while (this.inflight > 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    await this.sub?.close().catch(() => undefined);
    await this.pub?.close().catch(() => undefined);
    await this.conn?.close().catch(() => undefined);
  }
}
