import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN, invoicePdf, multipart, pdfBytes, startTestApp, type TestApp } from '../testing/test-app.js';

type Body<T = any> = { success: boolean; data: T; errors?: { code: string; field: string | null; message: string }[]; code?: string };
const INVOICE = (n: string, total = '1100.00') => `ACME SUPPLIES LTD\nInvoice No: ${n}\nInvoice Date: 2026-03-15\nBill To: Globex\nSubtotal: 1000.00\nVAT: 100.00\nTotal Due: USD ${total}`;

describe('review, search and reprocess API', () => {
  let t: TestApp; let admin: string; let alice: string; let bob: string; let reviewer: string;
  const h = (tok: string, extra: Record<string, string> = {}) => ({ authorization: `Bearer ${tok}`, ...extra });
  const j = async (r: Response) => (await r.json()) as Body;
  const upload = async (tok: string, files: { name: string; data: Buffer }[], extra: Record<string, string> = {}) => {
    const r = await fetch(`${t.base}/documents`, { method: 'POST', headers: h(tok, extra), body: multipart(files) });
    const b = await j(r);
    await t.drain();
    return b.data.documents.map((d: { id: string }) => d.id) as string[];
  };
  const result = async (tok: string, id: string) => j(await fetch(`${t.base}/documents/${id}/result`, { headers: h(tok) }));
  const mkUser = async (email: string, role: string) => fetch(`${t.base}/auth/users`, { method: 'POST', headers: { ...h(admin), 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'long-enough-password', role }) });

  beforeAll(async () => {
    t = await startTestApp();
    admin = await t.login(ADMIN.email, ADMIN.password);
    await mkUser('alice@example.com', 'uploader'); await mkUser('bob@example.com', 'uploader'); await mkUser('rita@example.com', 'reviewer');
    alice = await t.login('alice@example.com', 'long-enough-password'); bob = await t.login('bob@example.com', 'long-enough-password'); reviewer = await t.login('rita@example.com', 'long-enough-password');
  });
  afterAll(async () => { await t.close(); });

  it('processes an upload through the worker and exposes extraction, evidence and the lifecycle', async () => {
    const [id] = await upload(alice, [{ name: 'a.pdf', data: invoicePdf(INVOICE('INV-A-1')) }]);
    const b = await result(alice, id!);
    expect(b.data.document).toMatchObject({ processingStatus: 'completed', reviewStatus: 'not_required' });
    expect(b.data.result.extraction).toMatchObject({ schemaVersion: '1.0', invoiceNumber: 'INV-A-1', totalAmount: '1100', currency: 'USD', requiresManualReview: false });
    expect(b.data.result.extraction.fieldEvidence.invoiceNumber.text).toBe('Invoice No: INV-A-1');
    expect(b.data.result.extractor.provider).toBe('rules');
    const job = await j(await fetch(`${t.base}/jobs/${(await j(await fetch(`${t.base}/documents/${id}`, { headers: h(alice) }))).data.attempts[0].id}`, { headers: h(alice) }));
    expect(job.data).toMatchObject({ status: 'succeeded', stage: 'indexed' });
  });

  it('searches by keyword and semantics with filters, evidence location and owner isolation', async () => {
    const [id] = await upload(alice, [{ name: 'zeb.pdf', data: invoicePdf(`${INVOICE('INV-ZEB-7')}\nSpecial zebrafish aquarium consulting`) }]);
    const kw = await j(await fetch(`${t.base}/search?q=zebrafish`, { headers: h(alice) }));
    expect(kw.data.items[0]).toMatchObject({ documentId: id, location: { page: 1 } });
    expect(kw.data.items[0].snippet).toContain('zebrafish');
    expect((await j(await fetch(`${t.base}/search?q=INV-ZEB-7`, { headers: h(alice) }))).data.total).toBeGreaterThan(0);
    expect((await j(await fetch(`${t.base}/search?q=acme&supplier=acme&currency=USD&minAmount=1000&maxAmount=2000`, { headers: h(alice) }))).data.total).toBeGreaterThan(0);
    expect((await j(await fetch(`${t.base}/search?q=zebrafish&supplier=nomatch`, { headers: h(alice) }))).data.total).toBe(0);
    const sem = await j(await fetch(`${t.base}/search?q=zebrafish%20aquarium&mode=semantic`, { headers: h(alice) }));
    expect(sem.data.items[0].documentId).toBe(id);
    expect((await j(await fetch(`${t.base}/search?q=zebrafish`, { headers: h(bob) }))).data.total).toBe(0);
    expect((await j(await fetch(`${t.base}/search?q=zebrafish`, { headers: h(reviewer) }))).data.total).toBeGreaterThan(0);
    expect((await j(await fetch(`${t.base}/capabilities`, { headers: h(alice) }))).data).toEqual({ keywordSearch: true, semanticSearch: true, databaseProvider: 'memory' });
  });

  it('validates search input completely and never returns HTML snippets', async () => {
    const r = await fetch(`${t.base}/search?q=a&mode=fuzzy&pageSize=999&minAmount=x`, { headers: h(alice) });
    expect(r.status).toBe(422);
    expect((await j(r)).errors?.map((e) => e.field).sort()).toEqual(['minAmount', 'mode', 'pageSize', 'q']);
    await upload(alice, [{ name: 'xss.pdf', data: invoicePdf('Invoice No: XSS-1001\n<script>alert(1)</script> payload') }]);
    const s = await j(await fetch(`${t.base}/search?q=payload`, { headers: h(alice) }));
    expect(s.data.items[0].snippet).toContain('<script>');   // returned as inert text; the UI renders text nodes only
    expect(JSON.stringify(s)).not.toContain('<b>');
  });

  it('lets reviewers correct fields with versioning, audit trail and re-validation', async () => {
    const [id] = await upload(alice, [{ name: 'wrong.pdf', data: invoicePdf(INVOICE('INV-C-1', '1500.00')) }]);
    let b = await result(reviewer, id!);
    expect(b.data.document.reviewStatus).toBe('pending');
    expect(b.data.issues.map((i: { code: string }) => i.code)).toContain('TOTAL_MISMATCH');
    const v = b.data.result.version;
    const fix = await fetch(`${t.base}/documents/${id}/corrections`, { method: 'PATCH', headers: h(reviewer, { 'content-type': 'application/json' }), body: JSON.stringify({ expectedVersion: v, reason: 'typo in total', changes: { totalAmount: '1100.00' } }) });
    expect(fix.status).toBe(200);
    b = await j(fix);
    expect(b.data.result.extraction.totalAmount).toBe('1100');
    expect(b.data.result.original.totalAmount).toBe('1500');
    expect(b.data.result.version).toBe(v + 1);
    expect(b.data.document.reviewStatus).toBe('reviewed');
    expect(b.data.issues.map((i: { code: string }) => i.code)).not.toContain('TOTAL_MISMATCH');
    const hist = (await j(await fetch(`${t.base}/documents/${id}/history`, { headers: h(reviewer) }))).data;
    expect(hist.corrections).toMatchObject([{ field: 'totalAmount', previousValue: '1500', correctedValue: '1100', reason: 'typo in total' }]);
    expect(hist.audit.map((a: { event: string }) => a.event)).toEqual(expect.arrayContaining(['document.processed', 'document.corrected']));
    const stale = await fetch(`${t.base}/documents/${id}/corrections`, { method: 'PATCH', headers: h(reviewer, { 'content-type': 'application/json' }), body: JSON.stringify({ expectedVersion: v, changes: { customerName: 'X' } }) });
    expect(stale.status).toBe(409);
    expect((await j(stale)).code).toBe('CONCURRENT_MODIFICATION');
  });

  it('reports every invalid correction field at once and enforces roles', async () => {
    const [id] = await upload(alice, [{ name: 'c.pdf', data: invoicePdf(INVOICE('INV-C-2')) }]);
    const bad = await fetch(`${t.base}/documents/${id}/corrections`, { method: 'PATCH', headers: h(reviewer, { 'content-type': 'application/json' }), body: JSON.stringify({ expectedVersion: 1, changes: { totalAmount: 'abc', currency: 'usd', invoiceDate: '2026-02-30', invoiceNumber: '', bogus: 1 } }) });
    expect(bad.status).toBe(422);
    const fields = (await j(bad)).errors!.map((e) => e.field ?? '');
    expect(fields.join(' ')).toMatch(/totalAmount/); expect(fields.join(' ')).toMatch(/currency/); expect(fields.join(' ')).toMatch(/invoiceDate/); expect(fields.join(' ')).toMatch(/invoiceNumber/);
    expect(fields.length).toBeGreaterThanOrEqual(5);
    const same = await fetch(`${t.base}/documents/${id}/corrections`, { method: 'PATCH', headers: h(reviewer, { 'content-type': 'application/json' }), body: JSON.stringify({ expectedVersion: 1, changes: { currency: 'USD' } }) });
    expect(same.status).toBe(422);
    const denied = await fetch(`${t.base}/documents/${id}/corrections`, { method: 'PATCH', headers: h(alice, { 'content-type': 'application/json' }), body: JSON.stringify({ expectedVersion: 1, changes: { currency: 'EUR' } }) });
    expect(denied.status).toBe(403);
  });

  it('waives an issue explicitly and flips the review state', async () => {
    const [id] = await upload(alice, [{ name: 'd.pdf', data: invoicePdf(INVOICE('INV-D-1').replace('Bill To: Globex\n', '')) }]);
    // customer missing is info-only; force a warning-level issue by duplicate upload of the same invoice
    const [dup] = await upload(alice, [{ name: 'd2.pdf', data: invoicePdf(INVOICE('INV-D-1').replace('Bill To: Globex\n', '')) }]);
    const b = await result(reviewer, dup!);
    const issue = b.data.issues.find((i: { code: string }) => i.code === 'DUPLICATE_INVOICE_CANDIDATE');
    expect(issue.details.documentId).toBe(id);
    expect(b.data.document.reviewStatus).toBe('pending');
    const r = await j(await fetch(`${t.base}/documents/${dup}/issues/${issue.id}`, { method: 'PATCH', headers: h(reviewer, { 'content-type': 'application/json' }), body: JSON.stringify({ resolution: 'waived', reason: 'legit re-issue' }) }));
    expect(r.data.issues.find((i: { id: string }) => i.id === issue.id).resolution).toBe('waived');
    expect(r.data.document.reviewStatus).toBe('reviewed');
  });

  it('reprocesses failed documents without losing history, idempotently', async () => {
    const [id] = await upload(alice, [{ name: 'f.pdf', data: pdfBytes('FAIL:CORRUPT_FILE') }]);
    const doc = await j(await fetch(`${t.base}/documents/${id}`, { headers: h(alice) }));
    expect(doc.data).toMatchObject({ processingStatus: 'rejected', failure: { code: 'CORRUPT_FILE' } });
    const key = { 'idempotency-key': 'reprocess-key-0001' };
    const r1 = await fetch(`${t.base}/documents/${id}/reprocess`, { method: 'POST', headers: h(alice, key) });
    expect(r1.status).toBe(202);
    const a1 = (await j(r1)).data;
    expect(a1).toMatchObject({ attemptNumber: 2, status: 'queued', replayed: false });
    const r2 = await j(await fetch(`${t.base}/documents/${id}/reprocess`, { method: 'POST', headers: h(alice, key) }));
    expect(r2.data).toMatchObject({ attemptId: a1.attemptId, replayed: true });
    const busy = await fetch(`${t.base}/documents/${id}/reprocess`, { method: 'POST', headers: h(alice) });
    expect(busy.status).toBe(409);
    await t.drain();
    const hist = (await j(await fetch(`${t.base}/documents/${id}/history`, { headers: h(alice) }))).data;
    expect(hist.attempts.map((a: { attemptNumber: number; status: string }) => [a.attemptNumber, a.status])).toEqual([[1, 'failed'], [2, 'failed']]);
    expect(hist.audit.map((a: { event: string }) => a.event)).toContain('document.reprocess');
  });

  it('restricts reprocessing of healthy documents to reviewers and hides foreign documents', async () => {
    const [id] = await upload(alice, [{ name: 'ok.pdf', data: invoicePdf(INVOICE('INV-R-1')) }]);
    expect((await fetch(`${t.base}/documents/${id}/reprocess`, { method: 'POST', headers: h(alice) })).status).toBe(403);
    expect((await fetch(`${t.base}/documents/${id}/reprocess`, { method: 'POST', headers: h(bob) })).status).toBe(404);
    expect((await fetch(`${t.base}/documents/${id}/reprocess`, { method: 'POST', headers: h(reviewer) })).status).toBe(202);
  });

  it('lists with filters, sorting and review/status counts', async () => {
    const list = await j(await fetch(`${t.base}/documents?status=completed&reviewStatus=pending&sortBy=createdAt&sortDir=asc&pageSize=5`, { headers: h(reviewer) }));
    expect(list.data.items.every((d: { reviewStatus: string }) => d.reviewStatus === 'pending')).toBe(true);
    expect(list.data.pageSize).toBe(5);
    const stats = (await j(await fetch(`${t.base}/documents/stats`, { headers: h(reviewer) }))).data;
    expect(stats.total).toBeGreaterThan(5);
    expect(stats.byStatus.completed).toBeGreaterThan(0);
  });
});
