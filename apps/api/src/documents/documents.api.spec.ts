import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN, multipart, pdfBytes, startTestApp, type TestApp } from '../testing/test-app.js';

interface Env<T = unknown> { success: boolean; data: T; errors?: { code: string; field: string | null; message: string }[]; message?: string; traceId: string; timestamp: string; code?: string }

describe('documents API (in-memory providers, real HTTP)', () => {
  let t: TestApp; let admin: string; let alice: string; let bob: string;
  const auth = (tok: string) => ({ authorization: `Bearer ${tok}` });
  const json = async <T>(r: Response) => (await r.json()) as Env<T>;

  beforeAll(async () => {
    t = await startTestApp({ MAX_FILE_SIZE_MB: '1', MAX_FILES_PER_BATCH: '3', MAX_BATCH_SIZE_MB: '2' });
    admin = await t.login(ADMIN.email, ADMIN.password);
    for (const [email, role] of [['alice@example.com', 'uploader'], ['bob@example.com', 'uploader']] as const) {
      const r = await fetch(`${t.base}/auth/users`, { method: 'POST', headers: { ...auth(admin), 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'long-enough-password', role }) });
      expect(r.status).toBe(201);
    }
    alice = await t.login('alice@example.com', 'long-enough-password');
    bob = await t.login('bob@example.com', 'long-enough-password');
  });
  afterAll(async () => { await t.close(); });

  it('rejects unauthenticated calls with the standard error envelope and a trace id', async () => {
    const r = await fetch(`${t.base}/documents`);
    const b = await json(r);
    expect(r.status).toBe(401);
    expect(b).toMatchObject({ success: false, code: 'UNAUTHENTICATED', errors: [] });
    expect(b.traceId).toBe(r.headers.get('x-correlation-id'));
  });

  it('echoes a valid inbound correlation id and ignores malformed ones', async () => {
    expect((await fetch(`${t.base}/health/live`, { headers: { 'x-correlation-id': 'trace-abc-12345' } })).headers.get('x-correlation-id')).toBe('trace-abc-12345');
    expect((await fetch(`${t.base}/health/live`, { headers: { 'x-correlation-id': 'bad id\twith spaces' } })).headers.get('x-correlation-id')).not.toBe('bad id\twith spaces');
  });

  it('returns ALL validation errors for a bad query in one response', async () => {
    const r = await fetch(`${t.base}/documents?page=0&pageSize=500&status=nope&minAmount=abc&sortBy=password`, { headers: auth(alice) });
    const b = await json(r);
    expect(r.status).toBe(422);
    expect(b.errors?.map((e) => e.field).sort()).toEqual(['minAmount', 'page', 'pageSize', 'sortBy', 'status']);
  });

  it('uploads a batch: accepts valid files, reports invalid ones per file, queues via the outbox', async () => {
    const r = await fetch(`${t.base}/documents`, {
      method: 'POST', headers: auth(alice),
      body: multipart([
        { name: 'inv.pdf', data: pdfBytes('one'), type: 'application/pdf' },
        { name: 'evil.pdf', data: Buffer.from('MZ\x90\x00 not a pdf'), type: 'application/pdf' },
        { name: 'notes.exe', data: Buffer.from('x') },
      ]),
    });
    const b = await json<{ documents: { id: string; filename: string; status: string }[]; rejected: { index: number; code: string }[] }>(r);
    expect(r.status).toBe(201);
    expect(b.data.documents).toHaveLength(1);
    expect(b.data.documents[0]).toMatchObject({ filename: 'inv.pdf', status: 'queued' });
    expect(b.data.rejected.map((x) => [x.index, x.code])).toEqual([[1, 'SIGNATURE_MISMATCH'], [2, 'UNSUPPORTED_TYPE']]);
    const claimed = await t.repos.outbox.claimPending(10, new Date(Date.now() + 120_000));
    expect(claimed.length + t.published.length).toBeGreaterThanOrEqual(1);
  });

  it('returns every rejection when nothing is acceptable', async () => {
    const r = await fetch(`${t.base}/documents`, { method: 'POST', headers: auth(alice), body: multipart([{ name: 'a.exe', data: Buffer.from('x') }, { name: 'b.pdf', data: Buffer.from('nope') }]) });
    const b = await json(r);
    expect(r.status).toBe(422);
    expect(b.errors?.map((e) => e.field)).toEqual(['files[0]', 'files[1]']);
  });

  it('enforces per-file size, file count and requires multipart', async () => {
    const big = await fetch(`${t.base}/documents`, { method: 'POST', headers: auth(alice), body: multipart([{ name: 'big.pdf', data: pdfBytes('x'.repeat(1.2 * 1024 * 1024)) }]) });
    expect(big.status).toBe(422);
    expect((await json(big)).errors?.[0]?.message).toMatch(/1 MB limit/);
    const many = await fetch(`${t.base}/documents`, { method: 'POST', headers: auth(alice), body: multipart([1, 2, 3, 4].map((n) => ({ name: `f${n}.pdf`, data: pdfBytes(String(n)) }))) });
    const mb = await json<{ documents: unknown[]; rejected: { code: string }[] }>(many);
    expect(mb.data.documents).toHaveLength(3);
    expect(mb.data.rejected[0]?.code).toBe('TOO_MANY_FILES');
    const notMultipart = await fetch(`${t.base}/documents`, { method: 'POST', headers: { ...auth(alice), 'content-type': 'application/json' }, body: '{}' });
    expect(notMultipart.status).toBe(400);
  });

  it('is idempotent for retried uploads with the same Idempotency-Key', async () => {
    const send = () => fetch(`${t.base}/documents`, { method: 'POST', headers: { ...auth(alice), 'idempotency-key': 'retry-key-0001' }, body: multipart([{ name: 'once.pdf', data: pdfBytes('idem') }]) });
    const first = await json<{ documents: { id: string; replayed: boolean }[] }>(await send());
    const second = await json<{ documents: { id: string; replayed: boolean }[] }>(await send());
    expect(second.data.documents[0]?.id).toBe(first.data.documents[0]?.id);
    expect(second.data.documents[0]?.replayed).toBe(true);
  });

  it('isolates documents between uploaders but lets admins see everything', async () => {
    const up = await json<{ documents: { id: string }[] }>(await fetch(`${t.base}/documents`, { method: 'POST', headers: auth(alice), body: multipart([{ name: 'private.pdf', data: pdfBytes('priv') }]) }));
    const id = up.data.documents[0]!.id;
    expect((await fetch(`${t.base}/documents/${id}`, { headers: auth(alice) })).status).toBe(200);
    expect((await fetch(`${t.base}/documents/${id}`, { headers: auth(bob) })).status).toBe(404);
    expect((await fetch(`${t.base}/documents/${id}/download`, { headers: auth(bob) })).status).toBe(404);
    expect((await fetch(`${t.base}/documents/${id}`, { headers: auth(admin) })).status).toBe(200);
    const bobList = await json<{ items: unknown[]; total: number }>(await fetch(`${t.base}/documents`, { headers: auth(bob) }));
    expect(bobList.data.total).toBe(0);
  });

  it('serves downloads as attachments with hardened headers and never leaks storage keys', async () => {
    const up = await json<{ documents: { id: string }[] }>(await fetch(`${t.base}/documents`, { method: 'POST', headers: auth(alice), body: multipart([{ name: '../../x"y.pdf', data: pdfBytes('dl') }]) }));
    const id = up.data.documents[0]!.id;
    const dl = await fetch(`${t.base}/documents/${id}/download`, { headers: auth(alice) });
    expect(dl.status).toBe(200);
    expect(dl.headers.get('x-content-type-options')).toBe('nosniff');
    expect(dl.headers.get('content-disposition')).toMatch(/^attachment;/);
    expect(Buffer.from(await dl.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-');
    const meta = JSON.stringify(await (await fetch(`${t.base}/documents/${id}`, { headers: auth(alice) })).json());
    expect(meta).not.toMatch(/storageKey|storage_key|\/docint-/);
    expect(meta).toContain('"filename":"x%22y.pdf"');
    expect(dl.headers.get('content-disposition')).toContain("filename*=UTF-8''x%2522y.pdf");
  });

  it('enforces role checks for admin-only routes', async () => {
    const r = await fetch(`${t.base}/auth/users`, { method: 'POST', headers: { ...auth(alice), 'content-type': 'application/json' }, body: JSON.stringify({ email: 'x@example.com', password: 'long-enough-password', role: 'admin' }) });
    expect(r.status).toBe(403);
  });
});
