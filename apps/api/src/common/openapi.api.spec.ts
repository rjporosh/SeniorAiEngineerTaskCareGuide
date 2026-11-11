import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type TestApp } from '../testing/test-app.js';

type Operation = { summary?: string; description?: string; tags?: string[]; security?: unknown[]; responses?: Record<string, unknown> };
interface OpenApi { info: { title: string; description: string; version: string }; tags: { name: string }[]; paths: Record<string, Record<string, Operation>>; components: { securitySchemes: Record<string, unknown> } }

describe('API documentation (Scalar + OpenAPI)', () => {
  let t: TestApp; let origin: string; let spec: OpenApi;
  beforeAll(async () => {
    t = await startTestApp({ API_DOCS_ENABLED: 'true' });
    origin = new URL(t.base).origin;
    const raw = (await (await fetch(`${origin}/api/docs/openapi.json`)).json()) as OpenApi;
    // Paths are published with the versioned prefix (/api/v1/...); strip it for readable assertions.
    spec = { ...raw, paths: Object.fromEntries(Object.entries(raw.paths).map(([k, v]) => [k.replace(/^\/api\/v1/, ''), v])) };
  });
  afterAll(async () => { await t.close(); });

  it('serves the Scalar reference with a proper title and a self-hosted script', async () => {
    const res = await fetch(`${origin}/api/docs`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<title>Document Intelligence API · Reference</title>');
    expect(html).toContain('data-url="/api/docs/openapi.json"');
    expect(html).not.toMatch(/https?:\/\/cdn\./);
    expect(res.headers.get('content-security-policy')).toContain("connect-src 'self'");
    const js = await fetch(`${origin}/api/docs/scalar.js`);
    expect(js.status).toBe(200);
    expect(js.headers.get('content-type')).toContain('javascript');
    await js.arrayBuffer();
  });

  it('keeps Swagger UI available', async () => {
    const res = await fetch(`${origin}/api/swagger`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Document Intelligence API · Swagger UI');
  });

  it('has a titled, described, versioned OpenAPI document with bearer auth', () => {
    expect(spec.info).toMatchObject({ title: 'Document Intelligence API', version: '1.0.0' });
    expect(spec.info.description).toContain('Idempotency');
    expect(spec.tags.map((x) => x.name)).toEqual(expect.arrayContaining(['Auth', 'Documents', 'Search', 'Health']));
    expect(spec.components.securitySchemes).toHaveProperty('bearer');
  });

  it('documents every operation with a summary, a tag and error responses', () => {
    const ops = Object.entries(spec.paths).flatMap(([path, methods]) => Object.entries(methods).map(([method, op]) => ({ id: `${method.toUpperCase()} ${path}`, op })));
    expect(ops.length).toBeGreaterThanOrEqual(15);
    const undocumented = ops.filter(({ op }) => !op.summary || !op.tags?.length).map((o) => o.id);
    expect(undocumented).toEqual([]);
    const secured = ops.filter(({ id }) => !/health|metrics|auth\/(login|refresh|logout)/.test(id));
    expect(secured.filter(({ op }) => !op.security?.length).map((o) => o.id)).toEqual([]);
  });

  it('derives request docs from the validation schemas', () => {
    const upload = spec.paths['/documents']!['post'] as Operation & { requestBody?: { content: Record<string, unknown> } };
    expect(Object.keys(upload.requestBody!.content)).toContain('multipart/form-data');
    const correction = spec.paths['/documents/{id}/corrections']!['patch'] as Operation & { requestBody?: { content: { 'application/json': { schema: { properties: Record<string, unknown> } } } } };
    expect(Object.keys(correction.requestBody!.content['application/json'].schema.properties)).toEqual(expect.arrayContaining(['expectedVersion', 'changes']));
    const list = spec.paths['/documents']!['get'] as Operation & { parameters?: { name: string }[] };
    expect(list.parameters!.map((p) => p.name)).toEqual(expect.arrayContaining(['page', 'pageSize', 'status', 'supplier', 'sortBy']));
  });
});

describe('API documentation switch', () => {
  it('is not exposed when disabled', async () => {
    const t = await startTestApp({ API_DOCS_ENABLED: 'false' });
    const res = await fetch(`${new URL(t.base).origin}/api/docs`);
    await res.arrayBuffer();
    expect(res.status).toBe(404);
    await t.close();
  });
});
