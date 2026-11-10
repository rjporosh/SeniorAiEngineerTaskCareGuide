import { describe, expect, it } from 'vitest';
import { redactString } from './redact.js';
import { AppMetrics, Counter, Histogram, MetricsRegistry } from './metrics.js';

describe('Prometheus exposition', () => {
  it('renders counters, histograms with cumulative buckets and escaped labels', async () => {
    const r = new MetricsRegistry();
    const c = r.register(new Counter('hits_total', 'Hits'));
    c.inc({ route: '/a"b' }); c.inc({ route: '/a"b' }, 2);
    const h = r.register(new Histogram('lat_seconds', 'Latency', [0.1, 1]));
    h.observe({ r: 'x' }, 0.05); h.observe({ r: 'x' }, 0.5); h.observe({ r: 'x' }, 5);
    const out = await r.render();
    expect(out).toContain('# TYPE hits_total counter');
    expect(out).toContain('hits_total{route="/a\\"b"} 3');
    expect(out).toContain('lat_seconds_bucket{r="x",le="0.1"} 1');
    expect(out).toContain('lat_seconds_bucket{r="x",le="1"} 2');
    expect(out).toContain('lat_seconds_bucket{r="x",le="+Inf"} 3');
    expect(out).toContain('lat_seconds_count{r="x"} 3');
    expect(out).toMatch(/lat_seconds_sum\{r="x"\} 5\.55/);
  });
  it('keeps scraping when a dependency is down', async () => {
    const m = new AppMetrics({ queue: async () => { throw new Error('broker down'); } });
    const out = await m.registry.render();
    expect(out).toContain('process_uptime_seconds');
    expect(out).not.toContain('broker down');
  });
});

describe('redactString', () => {
  it('removes bearer tokens, connection-string passwords, key=value secrets and JWTs', () => {
    expect(redactString('Authorization: Bearer abc.def.ghi')).toBe('Authorization: Bearer [REDACTED]');
    expect(redactString('connect postgresql://docint:s3cret@db:5432/x failed')).toBe('connect postgresql://docint:[REDACTED]@db:5432/x failed');
    expect(redactString('password=hunter2 user=bob')).toBe('password=[REDACTED] user=bob');
    expect(redactString('token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abcdefghijk')).toContain('[REDACTED_JWT]');
    expect(redactString('plain message')).toBe('plain message');
  });
});
