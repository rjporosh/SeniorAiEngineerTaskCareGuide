import { randomUUID } from 'node:crypto';
import { Decimal } from '../../../domain/money.js';
import { cosine } from '../../../domain/embedding.js';
import { normalizeKey, tokenize } from '../../../domain/normalize.js';
import type {
  AttemptRecord, AuditRecord, ChunkRecord, CorrectionRecord, DocumentRecord, IssueRecord,
  OutboxRecord, RefreshTokenRecord, ResultRecord, UserRecord,
} from '../../../domain/types.js';
import {
  ConcurrencyError, type DocumentFilters, type DocumentRepository, type DocumentListItem, type OutboxRepository,
  type Page, type PageQuery, type Repositories, type SearchHit, type UserRepository, type ListQuery,
} from '../../../application/ports.js';

const paginate = <T>(all: T[], { page, pageSize }: PageQuery): Page<T> => ({
  items: all.slice((page - 1) * pageSize, page * pageSize), total: all.length, page, pageSize,
});

class MemoryUsers implements UserRepository {
  users = new Map<string, UserRecord>();
  tokens = new Map<string, RefreshTokenRecord>();
  async create(i: { email: string; passwordHash: string; role: UserRecord['role'] }) {
    const email = i.email.toLowerCase();
    if ([...this.users.values()].some((u) => u.email === email)) throw new Error('UNIQUE_EMAIL');
    const u: UserRecord = { id: randomUUID(), email, passwordHash: i.passwordHash, role: i.role, createdAt: new Date() };
    this.users.set(u.id, u);
    return u;
  }
  async findByEmail(email: string) { return [...this.users.values()].find((u) => u.email === email.toLowerCase()) ?? null; }
  async findById(id: string) { return this.users.get(id) ?? null; }
  async saveRefreshToken(t: Omit<RefreshTokenRecord, 'id' | 'createdAt' | 'revokedAt'>) {
    const r: RefreshTokenRecord = { ...t, id: randomUUID(), createdAt: new Date(), revokedAt: null };
    this.tokens.set(r.id, r);
  }
  async findRefreshToken(hash: string) { return [...this.tokens.values()].find((t) => t.tokenHash === hash) ?? null; }
  async revokeRefreshToken(id: string) { const t = this.tokens.get(id); if (t) t.revokedAt = new Date(); }
  async revokeFamily(familyId: string) {
    for (const t of this.tokens.values()) if (t.familyId === familyId && !t.revokedAt) t.revokedAt = new Date();
  }
}

class MemoryOutbox implements OutboxRepository {
  rows = new Map<string, OutboxRecord>();
  async claimPending(limit: number, now: Date) {
    const due = [...this.rows.values()]
      .filter((r) => r.status === 'pending' && r.availableAt <= now)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).slice(0, limit);
    // claiming pushes availability forward so concurrent relays do not double-send
    due.forEach((r) => { r.availableAt = new Date(now.getTime() + 60_000); });
    return due.map((r) => ({ ...r }));
  }
  async markSent(id: string) { const r = this.rows.get(id); if (r) { r.status = 'sent'; r.sentAt = new Date(); } }
  async markFailed(id: string, error: string, retryAt: Date, dead: boolean) {
    const r = this.rows.get(id);
    if (!r) return;
    r.attempts += 1; r.lastError = error; r.availableAt = retryAt; r.status = dead ? 'dead' : 'pending';
  }
}

class MemoryDocuments implements DocumentRepository {
  readonly capabilities = { semanticSearch: true };
  docs = new Map<string, DocumentRecord>();
  attempts = new Map<string, AttemptRecord>();
  results = new Map<string, ResultRecord>();
  issues = new Map<string, IssueRecord>();
  chunks = new Map<string, ChunkRecord>();
  corrections: CorrectionRecord[] = [];
  audits: AuditRecord[] = [];
  constructor(private readonly outbox: MemoryOutbox) {}

  async createWithOutbox(d: Parameters<DocumentRepository['createWithOutbox']>[0], outbox: Parameters<DocumentRepository['createWithOutbox']>[1]) {
    if (d.idempotencyKey && (await this.findByIdempotencyKey(d.ownerId, d.idempotencyKey))) throw new Error('UNIQUE_IDEMPOTENCY');
    const now = new Date();
    const rec: DocumentRecord = {
      id: randomUUID(), ...d, documentType: 'unknown', processingStatus: 'queued', reviewStatus: 'not_required',
      failureCode: null, failureMessage: null, createdAt: now, updatedAt: now,
    };
    this.docs.set(rec.id, rec);
    const attempt = await this.startAttempt(rec.id);
    const ob = outbox(rec.id, attempt.id);
    const row: OutboxRecord = { id: randomUUID(), ...ob, status: 'pending', attempts: 0, availableAt: now, lastError: null, createdAt: now, sentAt: null };
    this.outbox.rows.set(row.id, row);
    return { ...rec };
  }
  async findById(id: string) { const d = this.docs.get(id); return d ? { ...d } : null; }
  async findByIdempotencyKey(ownerId: string, key: string) {
    return [...this.docs.values()].find((d) => d.ownerId === ownerId && d.idempotencyKey === key) ?? null;
  }

  private matches(d: DocumentRecord, f: DocumentFilters): boolean {
    const r = this.currentOf(d.id)?.current;
    if (f.ownerId && d.ownerId !== f.ownerId) return false;
    if (f.status && d.processingStatus !== f.status) return false;
    if (f.reviewStatus && d.reviewStatus !== f.reviewStatus) return false;
    if (f.documentType && d.documentType !== f.documentType) return false;
    if (f.createdFrom && d.createdAt < f.createdFrom) return false;
    if (f.createdTo && d.createdAt > f.createdTo) return false;
    if (f.supplier && !(r?.supplierName ?? '').toLowerCase().includes(f.supplier.toLowerCase())) return false;
    if (f.currency && r?.currency !== f.currency) return false;
    if (f.invoiceDateFrom && !(r?.invoiceDate && r.invoiceDate >= f.invoiceDateFrom)) return false;
    if (f.invoiceDateTo && !(r?.invoiceDate && r.invoiceDate <= f.invoiceDateTo)) return false;
    if (f.minAmount && !(r?.totalAmount && new Decimal(r.totalAmount).gte(f.minAmount))) return false;
    if (f.maxAmount && !(r?.totalAmount && new Decimal(r.totalAmount).lte(f.maxAmount))) return false;
    if (f.text) {
      const t = f.text.toLowerCase();
      if (!d.originalFilename.toLowerCase().includes(t) && !(r?.invoiceNumber ?? '').toLowerCase().includes(t)) return false;
    }
    return true;
  }
  private currentOf(documentId: string) {
    return [...this.results.values()].find((r) => r.documentId === documentId && r.isCurrent) ?? null;
  }
  async list(q: ListQuery): Promise<Page<DocumentListItem>> {
    const rows = [...this.docs.values()].filter((d) => this.matches(d, q.filters));
    const dir = q.sortDir === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      const x = a[q.sortBy]; const y = b[q.sortBy];
      return (x < y ? -1 : x > y ? 1 : 0) * dir;
    });
    const page = paginate(rows, q);
    return {
      ...page,
      items: page.items.map((document) => {
        const c = this.currentOf(document.id)?.current;
        return {
          document: { ...document },
          invoice: c ? {
            invoiceNumber: c.invoiceNumber, invoiceDate: c.invoiceDate, supplierName: c.supplierName,
            totalAmount: c.totalAmount, currency: c.currency, requiresManualReview: c.requiresManualReview,
          } : null,
        };
      }),
    };
  }
  async updateStatus(id: string, status: DocumentRecord['processingStatus'], patch: Parameters<DocumentRepository['updateStatus']>[2] = {}) {
    const d = this.docs.get(id);
    if (!d) return;
    d.processingStatus = status; d.updatedAt = new Date();
    if (patch.failureCode !== undefined) d.failureCode = patch.failureCode;
    if (patch.failureMessage !== undefined) d.failureMessage = patch.failureMessage;
    if (patch.reviewStatus) d.reviewStatus = patch.reviewStatus;
    if (patch.documentType) d.documentType = patch.documentType;
  }

  async startAttempt(documentId: string) {
    const n = [...this.attempts.values()].filter((a) => a.documentId === documentId).length + 1;
    const a: AttemptRecord = {
      id: randomUUID(), documentId, attemptNumber: n, stage: 'queued', status: 'running',
      errorCode: null, errorMessage: null, retryable: false, startedAt: new Date(), finishedAt: null,
    };
    this.attempts.set(a.id, a);
    return { ...a };
  }
  async startAttemptWithOutbox(documentId: string, outbox: Parameters<DocumentRepository['startAttemptWithOutbox']>[1]) {
    const a = await this.startAttempt(documentId);
    await this.updateStatus(documentId, 'queued', { failureCode: null, failureMessage: null });
    const ob = outbox(a);
    const now = new Date();
    this.outbox.rows.set(randomUUID(), { id: randomUUID(), ...ob, status: 'pending', attempts: 0, availableAt: now, lastError: null, createdAt: now, sentAt: null });
    return a;
  }
  async updateAttemptStage(id: string, stage: AttemptRecord['stage']) { const a = this.attempts.get(id); if (a) a.stage = stage; }
  async finishAttempt(id: string, o: Parameters<DocumentRepository['finishAttempt']>[1]) {
    const a = this.attempts.get(id);
    if (!a) return;
    a.status = o.status; a.errorCode = o.errorCode ?? null; a.errorMessage = o.errorMessage ?? null;
    a.retryable = o.retryable ?? false; a.finishedAt = new Date();
  }
  async listAttempts(documentId: string) {
    return [...this.attempts.values()].filter((a) => a.documentId === documentId).sort((a, b) => a.attemptNumber - b.attemptNumber).map((a) => ({ ...a }));
  }
  async findAttempt(id: string) { const a = this.attempts.get(id); return a ? { ...a } : null; }

  async saveResult(i: Parameters<DocumentRepository['saveResult']>[0]) {
    for (const r of this.results.values()) if (r.documentId === i.documentId) r.isCurrent = false;
    const now = new Date();
    const rec: ResultRecord = {
      id: randomUUID(), documentId: i.documentId, attemptId: i.attemptId, isCurrent: true,
      raw: structuredClone(i.data), current: structuredClone(i.data), extractor: i.extractor, version: 1, createdAt: now, updatedAt: now,
    };
    this.results.set(rec.id, rec);
    return structuredClone(rec);
  }
  async findCurrentResult(documentId: string) { const r = this.currentOf(documentId); return r ? structuredClone(r) : null; }
  async applyCorrections(resultId: string, expectedVersion: number, next: ResultRecord['current'], corrections: Omit<CorrectionRecord, 'id' | 'createdAt'>[]) {
    const r = this.results.get(resultId);
    if (!r) throw new Error('RESULT_NOT_FOUND');
    if (r.version !== expectedVersion) throw new ConcurrencyError();
    r.current = structuredClone(next); r.version += 1; r.updatedAt = new Date();
    corrections.forEach((c) => this.corrections.push({ ...c, id: randomUUID(), createdAt: new Date() }));
    return structuredClone(r);
  }
  async listCorrections(documentId: string) { return this.corrections.filter((c) => c.documentId === documentId); }

  async replaceIssues(documentId: string, issues: Parameters<DocumentRepository['replaceIssues']>[1]) {
    for (const [id, i] of this.issues) if (i.documentId === documentId) this.issues.delete(id);
    const created = issues.map((i): IssueRecord => ({ ...i, id: randomUUID(), documentId, resolution: 'open', createdAt: new Date() }));
    created.forEach((i) => this.issues.set(i.id, i));
    return created;
  }
  async listIssues(documentId: string) { return [...this.issues.values()].filter((i) => i.documentId === documentId); }
  async resolveIssue(id: string, resolution: 'resolved' | 'waived') { const i = this.issues.get(id); if (i) i.resolution = resolution; }

  async replaceChunks(documentId: string, chunks: Parameters<DocumentRepository['replaceChunks']>[1]) {
    for (const [id, c] of this.chunks) if (c.documentId === documentId) this.chunks.delete(id);
    chunks.forEach((c) => { const rec: ChunkRecord = { ...c, id: randomUUID(), documentId }; this.chunks.set(rec.id, rec); });
  }
  async countChunks(documentId: string) { return [...this.chunks.values()].filter((c) => c.documentId === documentId).length; }

  async findDuplicateCandidates(q: Parameters<DocumentRepository['findDuplicateCandidates']>[0]) {
    if (!q.invoiceNumberKey) return [];
    const out: { document: DocumentRecord; result: ResultRecord }[] = [];
    for (const r of this.results.values()) {
      if (!r.isCurrent || r.documentId === q.documentId) continue;
      if (normalizeKey(r.current.invoiceNumber) !== q.invoiceNumberKey) continue;
      if (q.supplierKey && normalizeKey(r.current.supplierName) !== q.supplierKey) continue;
      const document = this.docs.get(r.documentId);
      if (document) out.push({ document: { ...document }, result: structuredClone(r) });
    }
    return out;
  }

  private allowedIds(f: DocumentFilters) {
    return new Set([...this.docs.values()].filter((d) => this.matches(d, f)).map((d) => d.id));
  }
  private hit(c: ChunkRecord, score: number, snippet: string): SearchHit {
    return { documentId: c.documentId, chunkId: c.id, score, snippet, page: c.page, sheet: c.sheet, range: c.range };
  }
  async searchKeyword(q: string, f: DocumentFilters, page: PageQuery) {
    const terms = tokenize(q);
    const ok = this.allowedIds(f);
    const hits = [...this.chunks.values()].filter((c) => ok.has(c.documentId)).map((c) => {
      const words = tokenize(c.content);
      const score = terms.reduce((s, t) => s + (words.includes(t) ? 1 : 0), 0);
      return { c, score };
    }).filter((x) => terms.length > 0 && x.score === terms.length).sort((a, b) => b.score - a.score)
      .map((x) => this.hit(x.c, x.score, x.c.content.slice(0, 240)));
    return paginate(hits, page);
  }
  async searchSemantic(vector: number[], f: DocumentFilters, page: PageQuery) {
    const ok = this.allowedIds(f);
    const hits = [...this.chunks.values()].filter((c) => ok.has(c.documentId) && c.embedding)
      .map((c) => ({ c, s: cosine(vector, c.embedding ?? []) })).filter((x) => x.s > 0.05).sort((a, b) => b.s - a.s)
      .map((x) => this.hit(x.c, x.s, x.c.content.slice(0, 240)));
    return paginate(hits, page);
  }

  async addAudit(a: Omit<AuditRecord, 'id' | 'createdAt'>) { this.audits.push({ ...a, id: randomUUID(), createdAt: new Date() }); }
  async listAudit(documentId: string) { return this.audits.filter((a) => a.documentId === documentId); }
  async stats(ownerId?: string) {
    const docs = [...this.docs.values()].filter((d) => !ownerId || d.ownerId === ownerId);
    const byStatus: Record<string, number> = {};
    docs.forEach((d) => { byStatus[d.processingStatus] = (byStatus[d.processingStatus] ?? 0) + 1; });
    return {
      total: docs.length, byStatus,
      requiresReview: docs.filter((d) => d.reviewStatus === 'pending').length,
      failed: docs.filter((d) => d.processingStatus === 'failed').length,
    };
  }
}

export function createMemoryRepositories(): Repositories {
  const outbox = new MemoryOutbox();
  return {
    provider: 'memory', users: new MemoryUsers(), documents: new MemoryDocuments(outbox), outbox,
    ping: async () => undefined, close: async () => undefined,
  };
}
