import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN, invoicePdf, multipart, startTestApp, type TestApp } from '../testing/test-app.js';

const TOKEN = 'metrics-token-0123456789';

describe('observability endpoints', () => {
  let t: TestApp;
  beforeAll(async () => { t = await startTestApp({ METRICS_TOKEN: TOKEN }); });
  afterAll(async () => { await t.close(); });

  it('protects /metrics and exposes HTTP and business metrics', async () => {
    expect((await fetch(`${t.base}/metrics`)).status).toBe(401);
    expect((await fetch(`${t.base}/metrics`, { headers: { authorization: 'Bearer wrong-token-wrong-token' } })).status).toBe(401);
    const admin = await t.login(ADMIN.email, ADMIN.password);
    await fetch(`${t.base}/documents`, { method: 'POST', headers: { authorization: `Bearer ${admin}` }, body: multipart([{ name: 'm.pdf', data: invoicePdf('Invoice No: MET-100\nTotal: 5.00') }]) });
    await t.drain();
    const res = await fetch(`${t.base}/metrics`, { headers: { authorization: `Bearer ${TOKEN}` } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    const body = await res.text();
    expect(body).toMatch(/http_requests_total\{method="POST",route="\/api\/v1\/documents",status="2xx"\} 1/);
    expect(body).toContain('http_request_duration_seconds_bucket');
    expect(body).toMatch(/documents_processed_total\{kind="pdf",outcome="completed"\} 1/);
    expect(body).toContain('queue_messages{state="ready"}');
    expect(body).not.toContain(TOKEN);
  });

  it('is disabled (404) when no token is configured', async () => {
    delete process.env['METRICS_TOKEN'];
    const off = await startTestApp();
    expect((await fetch(`${off.base}/metrics`)).status).toBe(404);
    await off.close();
  });
});
