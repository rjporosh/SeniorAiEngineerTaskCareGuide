import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { hashEmbedding } from '../domain/embedding.js';
import { ConcurrencyError, NotSupportedError, type ListQuery, type Repositories } from '../application/ports.js';
import { invoiceFixture } from './fixtures.js';

const extractor = { provider: 'rules', version: '1', promptVersion: 'n/a' };
const q = (filters: ListQuery['filters'] = {}): ListQuery => ({ filters, page: 1, pageSize: 10, sortBy: 'createdAt', sortDir: 'desc' });

/** Behavioural contract every persistence adapter must satisfy. */
export function runRepositoryContract(name: string, create: () => Promise<Repositories>): void {
  describe(`repository contract: ${name}`, () => {
    let repos: Repositories;
    let ownerId: string;
    beforeAll(async () => { repos = await create(); });
    afterAll(async () => { await repos.close(); });
    beforeEach(async () => {
      const u = await repos.users.create({ email: `u${Math.random().toString(36).slice(2)}@x.io`, passwordHash: 'h', role: 'uploader' });
      ownerId = u.id;
    });

    const newDoc = (over: Record<string, unknown> = {}) => repos.documents.createWithOutbox(
      { ownerId, originalFilename: 'a.pdf', detectedMime: 'application/pdf', byteSize: 10, sha256: 'abc', storageKey: `k-${Math.random()}`, storageProvider: 'local', idempotencyKey: null, ...over },
      (documentId, attemptId) => ({ topic: 'document.process', payload: { documentId, attemptId } }),
    );

    it('stores users with unique, case-insensitive email and rotating refresh tokens', async () => {
      const email = `Dup${Math.random().toString(36).slice(2)}@x.io`;
      const u = await repos.users.create({ email, passwordHash: 'h', role: 'admin' });
      expect((await repos.users.findByEmail(email.toLowerCase()))?.id).toBe(u.id);
      await expect(repos.users.create({ email: email.toUpperCase(), passwordHash: 'h', role: 'admin' })).rejects.toThrow();
      await repos.users.saveRefreshToken({ userId: u.id, familyId: 'f1', tokenHash: `t-${u.id}`, expiresAt: new Date(Date.now() + 1e5) });
      const t = await repos.users.findRefreshToken(`t-${u.id}`);
      expect(t?.revokedAt).toBeNull();
      await repos.users.revokeFamily('f1');
      expect((await repos.users.findRefreshToken(`t-${u.id}`))?.revokedAt).not.toBeNull();
    });

    it('creates a document with an outbox message atomically and enforces idempotency keys', async () => {
      const key = `idem-${Math.random()}`;
      const d = await newDoc({ idempotencyKey: key });
      expect(d.processingStatus).toBe('queued');
      expect((await repos.documents.findByIdempotencyKey(ownerId, key))?.id).toBe(d.id);
      await expect(newDoc({ idempotencyKey: key })).rejects.toThrow();
      const claimed = await repos.outbox.claimPending(100, new Date());
      expect(claimed.some((m) => (m.payload as { documentId?: string }).documentId === d.id)).toBe(true);
      const mine = claimed.find((m) => (m.payload as { documentId?: string }).documentId === d.id)!;
      expect((await repos.outbox.claimPending(100, new Date())).some((m) => m.id === mine.id)).toBe(false);
      await repos.outbox.markSent(mine.id);
    });

    it('tracks attempts immutably across reprocess', async () => {
      const d = await newDoc();
      const a1 = (await repos.documents.listAttempts(d.id))[0]!;
      expect(a1.attemptNumber).toBe(1);
      await repos.documents.finishAttempt(a1.id, { status: 'failed', errorCode: 'X', errorMessage: 'boom', retryable: false });
      const a2 = await repos.documents.startAttemptWithOutbox(d.id, (a) => ({ topic: 'document.process', payload: { documentId: d.id, attemptId: a.id } }));
      expect([a1.attemptNumber, a2.attemptNumber]).toEqual([1, 2]);
      const list = await repos.documents.listAttempts(d.id);
      expect(list.map((a) => a.status)).toEqual(['failed', 'running']);
      expect(list[0]?.errorCode).toBe('X');
    });

    it('saves results, keeps raw immutable, and applies corrections with optimistic concurrency', async () => {
      const d = await newDoc();
      const att = await repos.documents.startAttempt(d.id);
      const r = await repos.documents.saveResult({ documentId: d.id, attemptId: att.id, data: invoiceFixture(), extractor });
      expect(r.version).toBe(1);
      const next = invoiceFixture({ totalAmount: '120.00' });
      const done = await repos.documents.applyCorrections(r.id, 1, next, [
        { documentId: d.id, resultId: r.id, actorId: ownerId, fieldPath: 'totalAmount', previousValue: '110.00', correctedValue: '120.00', reason: 'typo' },
      ]);
      expect(done.version).toBe(2);
      expect(done.current.totalAmount).toBe('120.00');
      expect(done.raw.totalAmount).toBe('110.00');
      await expect(repos.documents.applyCorrections(r.id, 1, next, [])).rejects.toBeInstanceOf(ConcurrencyError);
      expect(await repos.documents.listCorrections(d.id)).toHaveLength(1);
      const att2 = await repos.documents.startAttempt(d.id);
      await repos.documents.saveResult({ documentId: d.id, attemptId: att2.id, data: invoiceFixture({ invoiceNumber: 'INV-2' }), extractor });
      expect((await repos.documents.findCurrentResult(d.id))?.current.invoiceNumber).toBe('INV-2');
    });

    it('lists with filters, sorting and bounded pagination', async () => {
      const supplier = `Sup${Math.random().toString(36).slice(2, 8)}`;
      const d = await newDoc({ originalFilename: 'filter-me.pdf' });
      const att = await repos.documents.startAttempt(d.id);
      await repos.documents.saveResult({ documentId: d.id, attemptId: att.id, data: invoiceFixture({ supplierName: supplier, totalAmount: '500.00' }), extractor });
      await newDoc();
      const res = await repos.documents.list(q({ ownerId, supplier: supplier.toLowerCase(), minAmount: '400', maxAmount: '600', currency: 'USD' }));
      expect(res.total).toBe(1);
      expect(res.items[0]?.invoice?.supplierName).toBe(supplier);
      const all = await repos.documents.list({ ...q({ ownerId }), pageSize: 1 });
      expect(all.items).toHaveLength(1);
      expect(all.total).toBeGreaterThanOrEqual(2);
      expect((await repos.documents.list(q({ ownerId, text: 'filter-me' }))).total).toBe(1);
    });

    it('replaces issues and resolves them', async () => {
      const d = await newDoc();
      await repos.documents.replaceIssues(d.id, [{ code: 'A', severity: 'error', message: 'm', fields: ['x'], details: { a: 1 } }]);
      const issues = await repos.documents.replaceIssues(d.id, [{ code: 'B', severity: 'warning', message: 'm', fields: [], details: {} }]);
      expect((await repos.documents.listIssues(d.id)).map((i) => i.code)).toEqual(['B']);
      await repos.documents.resolveIssue(issues[0]!.id, 'waived');
      expect((await repos.documents.listIssues(d.id))[0]?.resolution).toBe('waived');
    });

    it('appends issues without touching existing ones and finds exact file duplicates by hash', async () => {
      const sha = `sha-${Math.random()}`;
      const a = await newDoc({ sha256: sha }); const b = await newDoc({ sha256: sha });
      await repos.documents.replaceIssues(a.id, [{ code: 'A', severity: 'info', message: 'm', fields: [], details: {} }]);
      await repos.documents.appendIssues(a.id, [{ code: 'B', severity: 'warning', message: 'm', fields: [], details: {} }]);
      expect((await repos.documents.listIssues(a.id)).map((i) => i.code).sort()).toEqual(['A', 'B']);
      expect((await repos.documents.findBySha256(ownerId, sha, a.id)).map((d) => d.id)).toEqual([b.id]);
      expect(await repos.documents.findBySha256('00000000-0000-4000-8000-000000000000', sha, a.id)).toEqual([]);
    });

    it('finds duplicate candidates by normalised supplier and invoice number', async () => {
      const mk = async (inv: string) => {
        const d = await newDoc();
        const att = await repos.documents.startAttempt(d.id);
        await repos.documents.saveResult({ documentId: d.id, attemptId: att.id, data: invoiceFixture({ invoiceNumber: inv, supplierName: 'Dup Supplier Co.' }), extractor });
        return d;
      };
      const tag = Math.random().toString(36).slice(2, 8).toUpperCase();
      const a = await mk(`IN-${tag}/1`); const b = await mk(`in ${tag} 1`);
      const found = await repos.documents.findDuplicateCandidates({ documentId: b.id, ownerId, supplierKey: 'dupsupplierco', invoiceNumberKey: `in${tag.toLowerCase()}1` });
      expect(found.map((f) => f.document.id)).toContain(a.id);
      expect(found.map((f) => f.document.id)).not.toContain(b.id);
      const stranger = await repos.users.create({ email: `s${Math.random().toString(36).slice(2)}@x.io`, passwordHash: 'h', role: 'uploader' });
      expect(await repos.documents.findDuplicateCandidates({ documentId: b.id, ownerId: stranger.id, supplierKey: 'dupsupplierco', invoiceNumberKey: `in${tag.toLowerCase()}1` })).toEqual([]);
    });

    it('keyword and semantic search return evidence coordinates and honour owner filters', async () => {
      const d = await newDoc();
      const word = `zebrafish${Math.random().toString(36).slice(2, 8)}`;
      const content = `Invoice for ${word} consulting services total due`;
      await repos.documents.replaceChunks(d.id, [
        { chunkIndex: 0, page: 3, sheet: null, range: null, content, embedding: repos.documents.capabilities.semanticSearch ? hashEmbedding(content) : null },
        { chunkIndex: 1, page: null, sheet: 'Sheet1', range: 'A1:C9', content: 'unrelated cells', embedding: repos.documents.capabilities.semanticSearch ? hashEmbedding('unrelated cells') : null },
      ]);
      expect(await repos.documents.countChunks(d.id)).toBe(2);
      const kw = await repos.documents.searchKeyword(word, { ownerId }, { page: 1, pageSize: 5 });
      expect(kw.items[0]?.documentId).toBe(d.id);
      expect(kw.items[0]?.page).toBe(3);
      const other = await repos.documents.searchKeyword(word, { ownerId: '00000000-0000-4000-8000-000000000000' }, { page: 1, pageSize: 5 });
      expect(other.total).toBe(0);
      if (repos.documents.capabilities.semanticSearch) {
        const sem = await repos.documents.searchSemantic(hashEmbedding(`${word} consulting`), { ownerId }, { page: 1, pageSize: 5 });
        expect(sem.items[0]?.documentId).toBe(d.id);
      } else {
        await expect(repos.documents.searchSemantic([0], {}, { page: 1, pageSize: 1 })).rejects.toBeInstanceOf(NotSupportedError);
      }
    });

    it('records audit events and stats', async () => {
      const d = await newDoc();
      await repos.documents.updateStatus(d.id, 'failed', { failureCode: 'E', failureMessage: 'bad', reviewStatus: 'pending' });
      await repos.documents.addAudit({ documentId: d.id, actorId: ownerId, eventType: 'document.reprocess', metadata: { by: 'test' } });
      expect((await repos.documents.listAudit(d.id))[0]?.eventType).toBe('document.reprocess');
      const s = await repos.documents.stats(ownerId);
      expect(s.failed).toBeGreaterThanOrEqual(1);
      expect(s.requiresReview).toBeGreaterThanOrEqual(1);
      expect((await repos.documents.findById(d.id))?.failureCode).toBe('E');
    });

    it('retries failed outbox messages and dead-letters after exhaustion', async () => {
      const d = await newDoc();
      const msg = (await repos.outbox.claimPending(1000, new Date())).find((m) => (m.payload as { documentId?: string }).documentId === d.id)!;
      await repos.outbox.markFailed(msg.id, 'broker down', new Date(Date.now() - 1000), false);
      const again = (await repos.outbox.claimPending(1000, new Date())).find((m) => m.id === msg.id);
      expect(again?.attempts).toBe(1);
      await repos.outbox.markFailed(msg.id, 'still down', new Date(), true);
      expect((await repos.outbox.claimPending(1000, new Date(Date.now() + 1e7))).some((m) => m.id === msg.id)).toBe(false);
    });
  });
}
