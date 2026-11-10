type Labels = Record<string, string>;
const key = (labels: Labels) => Object.keys(labels).sort().map((k) => `${k}="${(labels[k] ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`).join(',');
const line = (name: string, k: string, v: number, extra = '') => `${name}${k || extra ? `{${[k, extra].filter(Boolean).join(',')}}` : ''} ${Number.isFinite(v) ? v : 0}`;

abstract class Metric {
  constructor(readonly name: string, readonly help: string, readonly type: 'counter' | 'gauge' | 'histogram') {}
  abstract samples(): Promise<string[]> | string[];
  async render(): Promise<string> {
    return [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} ${this.type}`, ...(await this.samples())].join('\n');
  }
}

export class Counter extends Metric {
  private readonly values = new Map<string, number>();
  constructor(name: string, help: string) { super(name, help, 'counter'); }
  inc(labels: Labels = {}, by = 1): void { const k = key(labels); this.values.set(k, (this.values.get(k) ?? 0) + by); }
  samples(): string[] { return [...this.values].map(([k, v]) => line(this.name, k, v)); }
}

export class Gauge extends Metric {
  private readonly values = new Map<string, number>();
  constructor(name: string, help: string, private readonly collect?: () => Promise<{ labels: Labels; value: number }[]>) { super(name, help, 'gauge'); }
  set(labels: Labels, value: number): void { this.values.set(key(labels), value); }
  async samples(): Promise<string[]> {
    if (this.collect) {
      try { for (const s of await this.collect()) this.set(s.labels, s.value); } catch { /* an unavailable dependency must not break scraping */ }
    }
    return [...this.values].map(([k, v]) => line(this.name, k, v));
  }
}

export class Histogram extends Metric {
  private readonly series = new Map<string, { counts: number[]; sum: number; count: number }>();
  constructor(name: string, help: string, private readonly buckets: number[]) { super(name, help, 'histogram'); }
  observe(labels: Labels, value: number): void {
    const k = key(labels);
    const s = this.series.get(k) ?? { counts: new Array<number>(this.buckets.length).fill(0), sum: 0, count: 0 };
    this.buckets.forEach((b, i) => { if (value <= b) s.counts[i] = (s.counts[i] ?? 0) + 1; });
    s.sum += value; s.count++;
    this.series.set(k, s);
  }
  samples(): string[] {
    const out: string[] = [];
    for (const [k, s] of this.series) {
      this.buckets.forEach((b, i) => out.push(line(`${this.name}_bucket`, k, s.counts[i] ?? 0, `le="${b}"`)));
      out.push(line(`${this.name}_bucket`, k, s.count, 'le="+Inf"'), line(`${this.name}_sum`, k, s.sum), line(`${this.name}_count`, k, s.count));
    }
    return out;
  }
}

/** Minimal Prometheus text-format registry (no third-party client: the common one is deprecated). */
export class MetricsRegistry {
  private readonly metrics: Metric[] = [];
  register<T extends Metric>(m: T): T { this.metrics.push(m); return m; }
  async render(): Promise<string> { return `${(await Promise.all(this.metrics.map((m) => m.render()))).join('\n')}\n`; }
}

const LATENCY = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
const PROCESSING = [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300, 900];

export class AppMetrics {
  readonly registry = new MetricsRegistry();
  readonly httpRequests = this.registry.register(new Counter('http_requests_total', 'HTTP requests by method, route and status class'));
  readonly httpDuration = this.registry.register(new Histogram('http_request_duration_seconds', 'HTTP request latency', LATENCY));
  readonly documentsProcessed = this.registry.register(new Counter('documents_processed_total', 'Documents that reached a terminal state, by outcome'));
  readonly processingDuration = this.registry.register(new Histogram('document_processing_duration_seconds', 'Worker time per processing attempt', PROCESSING));
  readonly queueDepth: Gauge;
  readonly outboxBacklog: Gauge;

  constructor(collectors: { queue?: () => Promise<{ ready: number; deadLettered: number }> } = {}) {
    const start = Date.now();
    this.registry.register(new Gauge('process_uptime_seconds', 'Process uptime', async () => [{ labels: {}, value: (Date.now() - start) / 1000 }]));
    this.registry.register(new Gauge('process_resident_memory_bytes', 'Resident set size', async () => [{ labels: {}, value: process.memoryUsage().rss }]));
    this.registry.register(new Gauge('nodejs_heap_used_bytes', 'V8 heap in use', async () => [{ labels: {}, value: process.memoryUsage().heapUsed }]));
    this.queueDepth = this.registry.register(new Gauge('queue_messages', 'Messages waiting (ready) or dead-lettered', async () => {
      if (!collectors.queue) return [];
      const s = await collectors.queue();
      return [{ labels: { state: 'ready' }, value: s.ready }, { labels: { state: 'dead_lettered' }, value: s.deadLettered }];
    }));
    this.outboxBacklog = this.registry.register(new Gauge('outbox_published_total_last_tick', 'Rows published by the last outbox relay tick'));
  }
}
