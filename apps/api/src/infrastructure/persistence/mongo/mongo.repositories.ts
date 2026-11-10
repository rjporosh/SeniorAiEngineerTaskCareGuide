import { randomUUID } from 'node:crypto';
import mongoose, { Schema, type Model } from 'mongoose';
import { normalizeKey } from '../../../domain/normalize.js';
import type {
  AttemptRecord, AuditRecord, ChunkRecord, CorrectionRecord, DocumentRecord, InvoiceData, IssueRecord,
  OutboxRecord, RefreshTokenRecord, ResultRecord, UserRecord,
} from '../../../domain/types.js';
import {
  ConcurrencyError, NotSupportedError, type DocumentFilters, type DocumentListItem, type DocumentRepository,
  type ListQuery, type OutboxRepository, type Page, type PageQuery, type Repositories, type SearchHit, type UserRepository,
} from '../../../application/ports.js';

type Row = Record<string, unknown> & { _id: string };
const out = <T>(r: Row | null): T | null => {
  if (!r) return null;
  const { _id, ...rest } = r;
  return { id: _id, ...rest } as T;
};
const outAll = <T>(rows: Row[]): T[] => rows.map((r) => out<T>(r) as T);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const dec = (v: string) => mongoose.Types.Decimal128.fromString(v);
const isDup = (e: unknown) => typeof e === 'object' && e !== null && (e as { code?: number }).code === 11000;

interface Models {
  User: Model<Row>; Token: Model<Row>; Doc: Model<Row>; Attempt: Model<Row>; Result: Model<Row>;
  Issue: Model<Row>; Chunk: Model<Row>; Correction: Model<Row>; Audit: Model<Row>; Outbox: Model<Row>;
}

function buildModels(conn: mongoose.Connection): Models {
  const mk = (name: string, idx: (s: Schema) => void = () => undefined) => {
    const s = new Schema({ _id: String }, { strict: false, versionKey: false });
    idx(s);
    return conn.model<Row>(name, s);
  };
  return {
    User: mk('User', (s) => s.index({ email: 1 }, { unique: true })),
    Token: mk('RefreshToken', (s) => { s.index({ tokenHash: 1 }, { unique: true }); s.index({ familyId: 1 }); }),
    Doc: mk('Document', (s) => {
      s.index({ ownerId: 1, idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } });
      s.index({ processingStatus: 1, createdAt: -1 }); s.index({ ownerId: 1, createdAt: -1 });
    }),
    Attempt: mk('ProcessingAttempt', (s) => s.index({ documentId: 1, attemptNumber: 1 }, { unique: true })),
    Result: mk('ExtractedResult', (s) => { s.index({ documentId: 1, isCurrent: 1 }); s.index({ invoiceNumberKey: 1, supplierKey: 1 }); s.index({ supplierName: 1 }); }),
    Issue: mk('ValidationIssue', (s) => s.index({ documentId: 1 })),
    Chunk: mk('TextChunk', (s) => { s.index({ documentId: 1, chunkIndex: 1 }); s.index({ content: 'text' }, { default_language: 'none' }); }),
    Correction: mk('Correction', (s) => s.index({ documentId: 1, createdAt: 1 })),
    Audit: mk('AuditEvent', (s) => s.index({ documentId: 1, createdAt: 1 })),
    Outbox: mk('OutboxMessage', (s) => s.index({ status: 1, availableAt: 1 })),
  };
}

const derived = (d: InvoiceData) => ({
  invoiceNumber: d.invoiceNumber, invoiceNumberKey: normalizeKey(d.invoiceNumber), invoiceDate: d.invoiceDate,
  supplierName: d.supplierName, supplierKey: normalizeKey(d.supplierName), customerName: d.customerName,
  currency: d.currency, totalAmountDec: d.totalAmount ? dec(d.totalAmount) : null,
});
const toResult = (r: Row | null): ResultRecord | null => {
  const x = out<ResultRecord & { totalAmountDec?: unknown }>(r);
  if (!x) return null;
  return {
    id: x.id, documentId: x.documentId, attemptId: x.attemptId, isCurrent: x.isCurrent, raw: x.raw, current: x.current,
    extractor: x.extractor, version: x.version, createdAt: x.createdAt, updatedAt: x.updatedAt,
  };
};

class MongoUsers implements UserRepository {
  constructor(private readonly m: Models) {}
  async create(i: { email: string; passwordHash: string; role: UserRecord['role'] }) {
    const row = { _id: randomUUID(), email: i.email.toLowerCase(), passwordHash: i.passwordHash, role: i.role, createdAt: new Date() };
    await this.m.User.create(row);
    return out<UserRecord>(row)!;
  }
  async findByEmail(email: string) { return out<UserRecord>(await this.m.User.findOne({ email: email.toLowerCase() }).lean<Row>()); }
  async findById(id: string) { return out<UserRecord>(await this.m.User.findById(id).lean<Row>()); }
  async saveRefreshToken(t: Omit<RefreshTokenRecord, 'id' | 'createdAt' | 'revokedAt'>) {
    await this.m.Token.create({ _id: randomUUID(), ...t, revokedAt: null, createdAt: new Date() });
  }
  async findRefreshToken(tokenHash: string) { return out<RefreshTokenRecord>(await this.m.Token.findOne({ tokenHash }).lean<Row>()); }
  async revokeRefreshToken(id: string) { await this.m.Token.updateOne({ _id: id }, { $set: { revokedAt: new Date() } }); }
  async revokeFamily(familyId: string) { await this.m.Token.updateMany({ familyId, revokedAt: null }, { $set: { revokedAt: new Date() } }); }
}

class MongoOutbox implements OutboxRepository {
  constructor(private readonly m: Models) {}
  async claimPending(limit: number, now: Date) {
    const claimed: OutboxRecord[] = [];
    for (let i = 0; i < limit; i++) {
      const row = await this.m.Outbox.findOneAndUpdate(
        { status: 'pending', availableAt: { $lte: now } },
        { $set: { availableAt: new Date(now.getTime() + 60_000) } },
        { sort: { createdAt: 1 }, returnDocument: 'after' },
      ).lean<Row>();
      if (!row) break;
      claimed.push(out<OutboxRecord>(row)!);
    }
    return claimed;
  }
  async markSent(id: string) { await this.m.Outbox.updateOne({ _id: id }, { $set: { status: 'sent', sentAt: new Date() } }); }
  async markFailed(id: string, error: string, retryAt: Date, dead: boolean) {
    await this.m.Outbox.updateOne({ _id: id }, { $inc: { attempts: 1 }, $set: { lastError: error.slice(0, 1000), availableAt: retryAt, status: dead ? 'dead' : 'pending' } });
  }
}

class MongoDocuments implements DocumentRepository {
  readonly capabilities = { semanticSearch: false };
  constructor(private readonly m: Models) {}

  async createWithOutbox(d: Parameters<DocumentRepository['createWithOutbox']>[0], outbox: Parameters<DocumentRepository['createWithOutbox']>[1]) {
    const now = new Date();
    const row = { _id: randomUUID(), ...d, documentType: 'unknown', processingStatus: 'queued', reviewStatus: 'not_required', failureCode: null, failureMessage: null, deletedAt: null, createdAt: now, updatedAt: now };
    try { await this.m.Doc.create(row); } catch (e) { if (isDup(e)) throw new Error('UNIQUE_IDEMPOTENCY'); throw e; }
    try {
      const ob = outbox(row._id);
      await this.m.Outbox.create({ _id: randomUUID(), ...ob, status: 'pending', attempts: 0, availableAt: now, lastError: null, createdAt: now, sentAt: null });
    } catch (e) {
      await this.m.Doc.deleteOne({ _id: row._id }); // compensate: standalone MongoDB has no multi-document transactions
      throw e;
    }
    return out<DocumentRecord>(row)!;
  }
  async findById(id: string) { return out<DocumentRecord>(await this.m.Doc.findOne({ _id: id, deletedAt: null }).lean<Row>()); }
  async findByIdempotencyKey(ownerId: string, key: string) { return out<DocumentRecord>(await this.m.Doc.findOne({ ownerId, idempotencyKey: key }).lean<Row>()); }

  /** Translates provider-neutral filters into a documents query (resolving result-level filters first). */
  private async docQuery(f: DocumentFilters): Promise<Record<string, unknown>> {
    const q: Record<string, unknown> = { deletedAt: null };
    if (f.ownerId) q.ownerId = f.ownerId;
    if (f.status) q.processingStatus = f.status;
    if (f.reviewStatus) q.reviewStatus = f.reviewStatus;
    if (f.documentType) q.documentType = f.documentType;
    if (f.createdFrom || f.createdTo) q.createdAt = { ...(f.createdFrom && { $gte: f.createdFrom }), ...(f.createdTo && { $lte: f.createdTo }) };
    const r: Record<string, unknown> = { isCurrent: true };
    let hasResult = false;
    if (f.supplier) { r.supplierName = { $regex: esc(f.supplier), $options: 'i' }; hasResult = true; }
    if (f.currency) { r.currency = f.currency; hasResult = true; }
    if (f.invoiceDateFrom || f.invoiceDateTo) { r.invoiceDate = { ...(f.invoiceDateFrom && { $gte: f.invoiceDateFrom }), ...(f.invoiceDateTo && { $lte: f.invoiceDateTo }) }; hasResult = true; }
    if (f.minAmount || f.maxAmount) { r.totalAmountDec = { ...(f.minAmount && { $gte: dec(f.minAmount) }), ...(f.maxAmount && { $lte: dec(f.maxAmount) }) }; hasResult = true; }
    if (f.text) {
      const rx = { $regex: esc(f.text), $options: 'i' };
      const byNumber = await this.m.Result.distinct('documentId', { isCurrent: true, invoiceNumber: rx });
      q.$or = [{ originalFilename: rx }, { _id: { $in: byNumber } }];
    }
    if (hasResult) q._id = { $in: await this.m.Result.distinct('documentId', r) };
    return q;
  }

  async list(q: ListQuery): Promise<Page<DocumentListItem>> {
    const query = await this.docQuery(q.filters);
    const [rows, total] = await Promise.all([
      this.m.Doc.find(query).sort({ [q.sortBy]: q.sortDir === 'asc' ? 1 : -1, _id: 1 }).skip((q.page - 1) * q.pageSize).limit(q.pageSize).lean<Row[]>(),
      this.m.Doc.countDocuments(query),
    ]);
    const results = await this.m.Result.find({ documentId: { $in: rows.map((r) => r._id) }, isCurrent: true }).lean<Row[]>();
    const byDoc = new Map(results.map((r) => [r['documentId'] as string, r['current'] as InvoiceData]));
    return {
      total, page: q.page, pageSize: q.pageSize,
      items: rows.map((r) => {
        const c = byDoc.get(r._id);
        return {
          document: out<DocumentRecord>(r)!,
          invoice: c ? { invoiceNumber: c.invoiceNumber, invoiceDate: c.invoiceDate, supplierName: c.supplierName, totalAmount: c.totalAmount, currency: c.currency, requiresManualReview: c.requiresManualReview } : null,
        };
      }),
    };
  }
  async updateStatus(id: string, status: DocumentRecord['processingStatus'], patch: Parameters<DocumentRepository['updateStatus']>[2] = {}) {
    await this.m.Doc.updateOne({ _id: id }, { $set: {
      processingStatus: status, updatedAt: new Date(),
      ...(patch.failureCode !== undefined && { failureCode: patch.failureCode }),
      ...(patch.failureMessage !== undefined && { failureMessage: patch.failureMessage }),
      ...(patch.reviewStatus && { reviewStatus: patch.reviewStatus }),
      ...(patch.documentType && { documentType: patch.documentType }),
    } });
  }

  async startAttempt(documentId: string) {
    for (let i = 0; i < 5; i++) {
      const n = (await this.m.Attempt.countDocuments({ documentId })) + 1 + i;
      const row = { _id: randomUUID(), documentId, attemptNumber: n, stage: 'queued', status: 'running', errorCode: null, errorMessage: null, retryable: false, startedAt: new Date(), finishedAt: null };
      try { await this.m.Attempt.create(row); return out<AttemptRecord>(row)!; } catch (e) { if (!isDup(e)) throw e; }
    }
    throw new Error('ATTEMPT_NUMBER_CONFLICT');
  }
  async startAttemptWithOutbox(documentId: string, outbox: Parameters<DocumentRepository['startAttemptWithOutbox']>[1]) {
    const a = await this.startAttempt(documentId);
    const ob = outbox(a);
    const now = new Date();
    await this.m.Outbox.create({ _id: randomUUID(), ...ob, status: 'pending', attempts: 0, availableAt: now, lastError: null, createdAt: now, sentAt: null });
    await this.updateStatus(documentId, 'queued', { failureCode: null, failureMessage: null });
    return a;
  }
  async updateAttemptStage(id: string, stage: AttemptRecord['stage']) { await this.m.Attempt.updateOne({ _id: id }, { $set: { stage } }); }
  async finishAttempt(id: string, o: Parameters<DocumentRepository['finishAttempt']>[1]) {
    await this.m.Attempt.updateOne({ _id: id }, { $set: { status: o.status, errorCode: o.errorCode ?? null, errorMessage: o.errorMessage?.slice(0, 2000) ?? null, retryable: o.retryable ?? false, finishedAt: new Date() } });
  }
  async listAttempts(documentId: string) { return outAll<AttemptRecord>(await this.m.Attempt.find({ documentId }).sort({ attemptNumber: 1 }).lean<Row[]>()); }
  async findAttempt(id: string) { return out<AttemptRecord>(await this.m.Attempt.findById(id).lean<Row>()); }

  async saveResult(i: Parameters<DocumentRepository['saveResult']>[0]) {
    await this.m.Result.updateMany({ documentId: i.documentId, isCurrent: true }, { $set: { isCurrent: false } });
    const now = new Date();
    const row = { _id: randomUUID(), documentId: i.documentId, attemptId: i.attemptId, isCurrent: true, schemaVersion: i.data.schemaVersion, ...derived(i.data), raw: i.data, current: i.data, extractor: i.extractor, version: 1, createdAt: now, updatedAt: now };
    await this.m.Result.create(row);
    return toResult(row)!;
  }
  async findCurrentResult(documentId: string) { return toResult(await this.m.Result.findOne({ documentId, isCurrent: true }).lean<Row>()); }
  async applyCorrections(resultId: string, expectedVersion: number, next: InvoiceData, corrections: Omit<CorrectionRecord, 'id' | 'createdAt'>[]) {
    const updated = await this.m.Result.findOneAndUpdate(
      { _id: resultId, version: expectedVersion },
      { $set: { ...derived(next), current: next, updatedAt: new Date() }, $inc: { version: 1 } },
      { returnDocument: 'after' },
    ).lean<Row>();
    if (!updated) {
      if (!(await this.m.Result.exists({ _id: resultId }))) throw new Error('RESULT_NOT_FOUND');
      throw new ConcurrencyError();
    }
    if (corrections.length > 0) await this.m.Correction.insertMany(corrections.map((c) => ({ _id: randomUUID(), ...c, createdAt: new Date() })));
    return toResult(updated)!;
  }
  async listCorrections(documentId: string) { return outAll<CorrectionRecord>(await this.m.Correction.find({ documentId }).sort({ createdAt: 1 }).lean<Row[]>()); }

  async replaceIssues(documentId: string, issues: Parameters<DocumentRepository['replaceIssues']>[1]) {
    await this.m.Issue.deleteMany({ documentId });
    const rows = issues.map((i) => ({ _id: randomUUID(), documentId, ...i, resolution: 'open', createdAt: new Date() }));
    if (rows.length > 0) await this.m.Issue.insertMany(rows);
    return outAll<IssueRecord>(rows);
  }
  async listIssues(documentId: string) { return outAll<IssueRecord>(await this.m.Issue.find({ documentId }).sort({ createdAt: 1 }).lean<Row[]>()); }
  async resolveIssue(id: string, resolution: 'resolved' | 'waived') { await this.m.Issue.updateOne({ _id: id }, { $set: { resolution } }); }

  async replaceChunks(documentId: string, chunks: Parameters<DocumentRepository['replaceChunks']>[1]) {
    await this.m.Chunk.deleteMany({ documentId });
    for (let i = 0; i < chunks.length; i += 1000) {
      await this.m.Chunk.insertMany(chunks.slice(i, i + 1000).map((c) => ({ _id: randomUUID(), documentId, ...c, embedding: null })));
    }
  }
  async countChunks(documentId: string) { return this.m.Chunk.countDocuments({ documentId }); }

  async findDuplicateCandidates(q: Parameters<DocumentRepository['findDuplicateCandidates']>[0]) {
    if (!q.invoiceNumberKey) return [];
    const rows = await this.m.Result.find({ isCurrent: true, documentId: { $ne: q.documentId }, invoiceNumberKey: q.invoiceNumberKey, ...(q.supplierKey && { supplierKey: q.supplierKey }) }).limit(50).lean<Row[]>();
    const docs = await this.m.Doc.find({ _id: { $in: rows.map((r) => r['documentId'] as string) }, deletedAt: null }).lean<Row[]>();
    const byId = new Map(docs.map((d) => [d._id, out<DocumentRecord>(d)!]));
    return rows.flatMap((r) => {
      const document = byId.get(r['documentId'] as string);
      return document ? [{ document, result: toResult(r)! }] : [];
    });
  }

  async searchKeyword(q: string, f: DocumentFilters, page: PageQuery): Promise<Page<SearchHit>> {
    const allowed = await this.m.Doc.distinct('_id', await this.docQuery(f));
    const query = { $text: { $search: q, $language: 'none' }, documentId: { $in: allowed as string[] } };
    const [rows, total] = await Promise.all([
      this.m.Chunk.find(query, { score: { $meta: 'textScore' } }).sort({ score: { $meta: 'textScore' } }).skip((page.page - 1) * page.pageSize).limit(page.pageSize).lean<Row[]>(),
      this.m.Chunk.countDocuments(query),
    ]);
    return {
      total, page: page.page, pageSize: page.pageSize,
      items: rows.map((r) => ({
        documentId: r['documentId'] as string, chunkId: r._id, score: Number(r['score'] ?? 0), snippet: String(r['content']).slice(0, 240),
        page: (r['page'] as number | null) ?? null, sheet: (r['sheet'] as string | null) ?? null, range: (r['range'] as string | null) ?? null,
      })),
    };
  }
  async searchSemantic(): Promise<Page<SearchHit>> { throw new NotSupportedError('semanticSearch'); }

  async addAudit(a: Omit<AuditRecord, 'id' | 'createdAt'>) { await this.m.Audit.create({ _id: randomUUID(), ...a, createdAt: new Date() }); }
  async listAudit(documentId: string) { return outAll<AuditRecord>(await this.m.Audit.find({ documentId }).sort({ createdAt: 1 }).lean<Row[]>()); }
  async stats(ownerId?: string) {
    const match = { deletedAt: null, ...(ownerId && { ownerId }) };
    const groups = await this.m.Doc.aggregate<{ _id: string; n: number }>([{ $match: match }, { $group: { _id: '$processingStatus', n: { $sum: 1 } } }]);
    const byStatus: Record<string, number> = {};
    groups.forEach((g) => { byStatus[g._id] = g.n; });
    return {
      total: groups.reduce((s, g) => s + g.n, 0), byStatus,
      requiresReview: await this.m.Doc.countDocuments({ ...match, reviewStatus: 'pending' }), failed: byStatus['failed'] ?? 0,
    };
  }
}

export async function createMongoRepositories(uri: string): Promise<Repositories> {
  const conn = await mongoose.createConnection(uri, { serverSelectionTimeoutMS: 5000 }).asPromise();
  const m = buildModels(conn);
  await Promise.all(Object.values(m).map((model) => model.init()));
  return {
    provider: 'mongodb', users: new MongoUsers(m), documents: new MongoDocuments(m), outbox: new MongoOutbox(m),
    ping: async () => { await conn.db?.admin().ping(); },
    close: async () => { await conn.close(); },
  };
}
export type { ChunkRecord };
