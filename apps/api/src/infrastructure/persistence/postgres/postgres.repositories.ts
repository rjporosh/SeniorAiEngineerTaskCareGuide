import { PrismaPg } from '@prisma/adapter-pg';
import { normalizeKey } from '../../../domain/normalize.js';
import type {
  AttemptRecord, AuditRecord, CorrectionRecord, DocumentRecord, InvoiceData, IssueRecord,
  OutboxRecord, ProcessingStatus, RefreshTokenRecord, ResultRecord, UserRecord,
} from '../../../domain/types.js';
import {
  ConcurrencyError, type DocumentFilters, type DocumentListItem, type DocumentRepository, type ListQuery,
  type OutboxRepository, type Page, type PageQuery, type Repositories, type SearchHit, type UserRepository,
} from '../../../application/ports.js';
import { Prisma, PrismaClient } from '../../../generated/prisma/client.js';
import type { ExtractedResult, Document as PgDocument, ProcessingAttempt, User } from '../../../generated/prisma/client.js';

const json = (v: unknown) => v as Prisma.InputJsonValue;
const SORT_COLUMNS = { createdAt: 'd.created_at', updatedAt: 'd.updated_at', originalFilename: 'd.original_filename', processingStatus: 'd.processing_status' } as const;

const toUser = (u: User): UserRecord => ({ id: u.id, email: u.email, passwordHash: u.passwordHash, role: u.role as UserRecord['role'], createdAt: u.createdAt });
const toDoc = (d: PgDocument): DocumentRecord => ({
  id: d.id, ownerId: d.ownerId, originalFilename: d.originalFilename, detectedMime: d.detectedMime, byteSize: Number(d.byteSize),
  sha256: d.sha256, storageKey: d.storageKey, storageProvider: d.storageProvider, documentType: d.documentType as DocumentRecord['documentType'],
  processingStatus: d.processingStatus as ProcessingStatus, reviewStatus: d.reviewStatus as DocumentRecord['reviewStatus'],
  failureCode: d.failureCode, failureMessage: d.failureMessage, idempotencyKey: d.idempotencyKey, createdAt: d.createdAt, updatedAt: d.updatedAt,
});
const toAttempt = (a: ProcessingAttempt): AttemptRecord => ({
  id: a.id, documentId: a.documentId, attemptNumber: a.attemptNumber, stage: a.stage as ProcessingStatus, status: a.status as AttemptRecord['status'],
  errorCode: a.errorCode, errorMessage: a.errorMessage, retryable: a.retryable, startedAt: a.startedAt, finishedAt: a.finishedAt,
});
const toResult = (r: ExtractedResult): ResultRecord => ({
  id: r.id, documentId: r.documentId, attemptId: r.attemptId, isCurrent: r.isCurrent, raw: r.raw as unknown as InvoiceData,
  current: r.current as unknown as InvoiceData, extractor: r.extractor as unknown as ResultRecord['extractor'],
  version: r.version, createdAt: r.createdAt, updatedAt: r.updatedAt,
});
const derived = (d: InvoiceData) => ({
  invoiceNumber: d.invoiceNumber, invoiceNumberKey: normalizeKey(d.invoiceNumber), invoiceDate: d.invoiceDate,
  supplierName: d.supplierName, supplierKey: normalizeKey(d.supplierName), customerName: d.customerName,
  totalAmount: d.totalAmount, currency: d.currency,
});
const isUnique = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
const vec = (v: number[]) => `[${v.join(',')}]`;

/** WHERE fragment over documents `d`; result-level filters use an EXISTS on the current result. */
function filterSql(f: DocumentFilters): Prisma.Sql {
  const c: Prisma.Sql[] = [Prisma.sql`d.deleted_at IS NULL`];
  if (f.ownerId) c.push(Prisma.sql`d.owner_id = ${f.ownerId}::uuid`);
  if (f.status) c.push(Prisma.sql`d.processing_status = ${f.status}`);
  if (f.reviewStatus) c.push(Prisma.sql`d.review_status = ${f.reviewStatus}`);
  if (f.documentType) c.push(Prisma.sql`d.document_type = ${f.documentType}`);
  if (f.createdFrom) c.push(Prisma.sql`d.created_at >= ${f.createdFrom}`);
  if (f.createdTo) c.push(Prisma.sql`d.created_at <= ${f.createdTo}`);
  const r: Prisma.Sql[] = [];
  if (f.supplier) r.push(Prisma.sql`r.supplier_name ILIKE ${'%' + f.supplier.replace(/[\\%_]/g, '\\$&') + '%'}`);
  if (f.currency) r.push(Prisma.sql`r.currency = ${f.currency}`);
  if (f.invoiceDateFrom) r.push(Prisma.sql`r.invoice_date >= ${f.invoiceDateFrom}`);
  if (f.invoiceDateTo) r.push(Prisma.sql`r.invoice_date <= ${f.invoiceDateTo}`);
  if (f.minAmount) r.push(Prisma.sql`r.total_amount >= ${f.minAmount}::numeric`);
  if (f.maxAmount) r.push(Prisma.sql`r.total_amount <= ${f.maxAmount}::numeric`);
  if (r.length > 0) c.push(Prisma.sql`EXISTS (SELECT 1 FROM extracted_results r WHERE r.document_id = d.id AND r.is_current AND ${Prisma.join(r, ' AND ')})`);
  if (f.text) {
    const like = '%' + f.text.replace(/[\\%_]/g, '\\$&') + '%';
    c.push(Prisma.sql`(d.original_filename ILIKE ${like} OR EXISTS (SELECT 1 FROM extracted_results r2 WHERE r2.document_id = d.id AND r2.is_current AND r2.invoice_number ILIKE ${like}))`);
  }
  return Prisma.join(c, ' AND ');
}

class PgUsers implements UserRepository {
  constructor(private readonly db: PrismaClient) {}
  async create(i: { email: string; passwordHash: string; role: UserRecord['role'] }) {
    return toUser(await this.db.user.create({ data: { email: i.email.toLowerCase(), passwordHash: i.passwordHash, role: i.role } }));
  }
  async findByEmail(email: string) { const u = await this.db.user.findUnique({ where: { email: email.toLowerCase() } }); return u ? toUser(u) : null; }
  async findById(id: string) { const u = await this.db.user.findUnique({ where: { id } }); return u ? toUser(u) : null; }
  async saveRefreshToken(t: Omit<RefreshTokenRecord, 'id' | 'createdAt' | 'revokedAt'>) { await this.db.refreshToken.create({ data: t }); }
  async findRefreshToken(tokenHash: string) { return this.db.refreshToken.findUnique({ where: { tokenHash } }); }
  async revokeRefreshToken(id: string) { await this.db.refreshToken.update({ where: { id }, data: { revokedAt: new Date() } }); }
  async revokeFamily(familyId: string) { await this.db.refreshToken.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: new Date() } }); }
}

interface OutboxRow {
  id: string; topic: string; payload: Record<string, unknown>; status: OutboxRecord['status']; attempts: number;
  available_at: Date; last_error: string | null; created_at: Date; sent_at: Date | null;
}
class PgOutbox implements OutboxRepository {
  constructor(private readonly db: PrismaClient) {}
  async claimPending(limit: number, now: Date) {
    const rows = await this.db.$queryRaw<OutboxRow[]>`
      UPDATE outbox_messages SET available_at = ${new Date(now.getTime() + 60_000)}
      WHERE id IN (SELECT id FROM outbox_messages WHERE status = 'pending' AND available_at <= ${now}
                   ORDER BY created_at LIMIT ${limit} FOR UPDATE SKIP LOCKED)
      RETURNING *`;
    return rows.map((r): OutboxRecord => ({
      id: r.id, topic: r.topic, payload: r.payload, status: r.status, attempts: r.attempts,
      availableAt: r.available_at, lastError: r.last_error, createdAt: r.created_at, sentAt: r.sent_at,
    }));
  }
  async markSent(id: string) { await this.db.outboxMessage.update({ where: { id }, data: { status: 'sent', sentAt: new Date() } }); }
  async markFailed(id: string, error: string, retryAt: Date, dead: boolean) {
    await this.db.outboxMessage.update({
      where: { id }, data: { attempts: { increment: 1 }, lastError: error.slice(0, 1000), availableAt: retryAt, status: dead ? 'dead' : 'pending' },
    });
  }
}

class PgDocuments implements DocumentRepository {
  readonly capabilities = { semanticSearch: true };
  constructor(private readonly db: PrismaClient) {}

  async createWithOutbox(d: Parameters<DocumentRepository['createWithOutbox']>[0], outbox: Parameters<DocumentRepository['createWithOutbox']>[1]) {
    try {
      return await this.db.$transaction(async (tx) => {
        const doc = await tx.document.create({ data: { ...d, byteSize: BigInt(d.byteSize), processingStatus: 'queued' } });
        const attempt = await this.nextAttempt(tx, doc.id);
        const ob = outbox(doc.id, attempt.id);
        await tx.outboxMessage.create({ data: { topic: ob.topic, payload: json(ob.payload) } });
        return toDoc(doc);
      });
    } catch (e) {
      if (isUnique(e)) throw new Error('UNIQUE_IDEMPOTENCY', { cause: e });
      throw e;
    }
  }
  async findById(id: string) { const d = await this.db.document.findFirst({ where: { id, deletedAt: null } }); return d ? toDoc(d) : null; }
  async findByIdempotencyKey(ownerId: string, key: string) {
    const d = await this.db.document.findUnique({ where: { ownerId_idempotencyKey: { ownerId, idempotencyKey: key } } });
    return d ? toDoc(d) : null;
  }

  async list(q: ListQuery): Promise<Page<DocumentListItem>> {
    const where = filterSql(q.filters);
    const order = Prisma.raw(`${SORT_COLUMNS[q.sortBy]} ${q.sortDir === 'asc' ? 'ASC' : 'DESC'}, d.id`);
    const rows = await this.db.$queryRaw<{ id: string; total: bigint }[]>`
      SELECT d.id, count(*) OVER() AS total FROM documents d WHERE ${where}
      ORDER BY ${order} LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`;
    let total = rows[0] ? Number(rows[0].total) : 0;
    if (rows.length === 0 && q.page > 1) {
      const c = await this.db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM documents d WHERE ${where}`;
      total = Number(c[0]?.n ?? 0);
    }
    const ids = rows.map((r) => r.id);
    const docs = await this.db.document.findMany({ where: { id: { in: ids } }, include: { results: { where: { isCurrent: true }, take: 1 } } });
    const byId = new Map(docs.map((d) => [d.id, d]));
    const items = ids.flatMap((id) => {
      const d = byId.get(id);
      if (!d) return [];
      const c = d.results[0]?.current as unknown as InvoiceData | undefined;
      return [{
        document: toDoc(d),
        invoice: c ? { invoiceNumber: c.invoiceNumber, invoiceDate: c.invoiceDate, supplierName: c.supplierName, totalAmount: c.totalAmount, currency: c.currency, requiresManualReview: c.requiresManualReview } : null,
      }];
    });
    return { items, total, page: q.page, pageSize: q.pageSize };
  }

  async updateStatus(id: string, status: ProcessingStatus, patch: Parameters<DocumentRepository['updateStatus']>[2] = {}) {
    await this.db.document.update({
      where: { id },
      data: {
        processingStatus: status,
        ...(patch.failureCode !== undefined && { failureCode: patch.failureCode }),
        ...(patch.failureMessage !== undefined && { failureMessage: patch.failureMessage }),
        ...(patch.reviewStatus && { reviewStatus: patch.reviewStatus }),
        ...(patch.documentType && { documentType: patch.documentType }),
      },
    });
  }

  private async nextAttempt(tx: Prisma.TransactionClient, documentId: string): Promise<AttemptRecord> {
    for (let i = 0; i < 5; i++) {
      const max = await tx.processingAttempt.aggregate({ where: { documentId }, _max: { attemptNumber: true } });
      try {
        return toAttempt(await tx.processingAttempt.create({
          data: { documentId, attemptNumber: (max._max.attemptNumber ?? 0) + 1, stage: 'queued', status: 'running' },
        }));
      } catch (e) { if (!isUnique(e)) throw e; }
    }
    throw new Error('ATTEMPT_NUMBER_CONFLICT');
  }
  async startAttempt(documentId: string) { return this.db.$transaction((tx) => this.nextAttempt(tx, documentId)); }
  async startAttemptWithOutbox(documentId: string, outbox: Parameters<DocumentRepository['startAttemptWithOutbox']>[1]) {
    return this.db.$transaction(async (tx) => {
      const a = await this.nextAttempt(tx, documentId);
      const ob = outbox(a);
      await tx.outboxMessage.create({ data: { topic: ob.topic, payload: json(ob.payload) } });
      await tx.document.update({ where: { id: documentId }, data: { processingStatus: 'queued', failureCode: null, failureMessage: null } });
      return a;
    });
  }
  async updateAttemptStage(id: string, stage: ProcessingStatus) { await this.db.processingAttempt.update({ where: { id }, data: { stage } }); }
  async finishAttempt(id: string, o: Parameters<DocumentRepository['finishAttempt']>[1]) {
    await this.db.processingAttempt.update({
      where: { id },
      data: { status: o.status, errorCode: o.errorCode ?? null, errorMessage: o.errorMessage?.slice(0, 2000) ?? null, retryable: o.retryable ?? false, finishedAt: new Date() },
    });
  }
  async listAttempts(documentId: string) {
    return (await this.db.processingAttempt.findMany({ where: { documentId }, orderBy: { attemptNumber: 'asc' } })).map(toAttempt);
  }
  async findAttempt(id: string) { const a = await this.db.processingAttempt.findUnique({ where: { id } }); return a ? toAttempt(a) : null; }

  async saveResult(i: Parameters<DocumentRepository['saveResult']>[0]) {
    return this.db.$transaction(async (tx) => {
      await tx.extractedResult.updateMany({ where: { documentId: i.documentId, isCurrent: true }, data: { isCurrent: false } });
      const r = await tx.extractedResult.create({
        data: {
          documentId: i.documentId, attemptId: i.attemptId, isCurrent: true, schemaVersion: i.data.schemaVersion,
          ...derived(i.data), raw: json(i.data), current: json(i.data), extractor: json(i.extractor),
        },
      });
      return toResult(r);
    });
  }
  async findCurrentResult(documentId: string) {
    const r = await this.db.extractedResult.findFirst({ where: { documentId, isCurrent: true } });
    return r ? toResult(r) : null;
  }
  async applyCorrections(resultId: string, expectedVersion: number, next: InvoiceData, corrections: Omit<CorrectionRecord, 'id' | 'createdAt'>[]) {
    return this.db.$transaction(async (tx) => {
      const upd = await tx.extractedResult.updateMany({
        where: { id: resultId, version: expectedVersion },
        data: { ...derived(next), current: json(next), version: { increment: 1 } },
      });
      if (upd.count === 0) {
        if (!(await tx.extractedResult.findUnique({ where: { id: resultId } }))) throw new Error('RESULT_NOT_FOUND');
        throw new ConcurrencyError();
      }
      if (corrections.length > 0) {
        await tx.correction.createMany({
          data: corrections.map((c) => ({ ...c, previousValue: json(c.previousValue ?? null), correctedValue: json(c.correctedValue ?? null) })),
        });
      }
      return toResult(await tx.extractedResult.findUniqueOrThrow({ where: { id: resultId } }));
    });
  }
  async listCorrections(documentId: string): Promise<CorrectionRecord[]> {
    return (await this.db.correction.findMany({ where: { documentId }, orderBy: { createdAt: 'asc' } })).map((c) => ({
      id: c.id, documentId: c.documentId, resultId: c.resultId, actorId: c.actorId, fieldPath: c.fieldPath,
      previousValue: c.previousValue, correctedValue: c.correctedValue, reason: c.reason, createdAt: c.createdAt,
    }));
  }

  async replaceIssues(documentId: string, issues: Parameters<DocumentRepository['replaceIssues']>[1]) {
    return this.db.$transaction(async (tx) => {
      await tx.validationIssue.deleteMany({ where: { documentId } });
      const out: IssueRecord[] = [];
      for (const i of issues) {
        const r = await tx.validationIssue.create({ data: { documentId, code: i.code, severity: i.severity, message: i.message, fields: i.fields, details: json(i.details) } });
        out.push(this.toIssue(r));
      }
      return out;
    });
  }
  private toIssue(r: { id: string; documentId: string; code: string; severity: string; message: string; fields: string[]; details: unknown; resolution: string; createdAt: Date }): IssueRecord {
    return { id: r.id, documentId: r.documentId, code: r.code, severity: r.severity as IssueRecord['severity'], message: r.message, fields: r.fields, details: r.details as Record<string, unknown>, resolution: r.resolution as IssueRecord['resolution'], createdAt: r.createdAt };
  }
  async appendIssues(documentId: string, issues: Parameters<DocumentRepository['appendIssues']>[1]) {
    return this.db.$transaction(async (tx) => {
      const out: IssueRecord[] = [];
      for (const i of issues) {
        const r = await tx.validationIssue.create({ data: { documentId, code: i.code, severity: i.severity, message: i.message, fields: i.fields, details: json(i.details) } });
        out.push(this.toIssue(r));
      }
      return out;
    });
  }
  async findBySha256(ownerId: string, sha256: string, excludeId: string) {
    return (await this.db.document.findMany({ where: { ownerId, sha256, id: { not: excludeId }, deletedAt: null }, take: 20 })).map(toDoc);
  }
  async listIssues(documentId: string) {
    return (await this.db.validationIssue.findMany({ where: { documentId }, orderBy: { createdAt: 'asc' } })).map((r) => this.toIssue(r));
  }
  async resolveIssue(id: string, resolution: 'resolved' | 'waived') { await this.db.validationIssue.update({ where: { id }, data: { resolution } }); }

  async replaceChunks(documentId: string, chunks: Parameters<DocumentRepository['replaceChunks']>[1]) {
    await this.db.$transaction(async (tx) => {
      await tx.textChunk.deleteMany({ where: { documentId } });
      for (let i = 0; i < chunks.length; i += 500) {
        const b = chunks.slice(i, i + 500);
        await tx.$executeRaw`
          INSERT INTO text_chunks (id, document_id, chunk_index, page, sheet, range, content, embedding)
          SELECT gen_random_uuid(), ${documentId}::uuid, t.idx, t.pg, t.sh, t.rg, t.ct, t.emb::vector
          FROM unnest(${b.map((c) => c.chunkIndex)}::int[], ${b.map((c) => c.page)}::int[], ${b.map((c) => c.sheet)}::text[],
                      ${b.map((c) => c.range)}::text[], ${b.map((c) => c.content)}::text[],
                      ${b.map((c) => (c.embedding ? vec(c.embedding) : null))}::text[]) AS t(idx, pg, sh, rg, ct, emb)`;
      }
    }, { timeout: 120_000 });
  }
  async countChunks(documentId: string) { return this.db.textChunk.count({ where: { documentId } }); }

  async findDuplicateCandidates(q: Parameters<DocumentRepository['findDuplicateCandidates']>[0]) {
    if (!q.invoiceNumberKey) return [];
    const rows = await this.db.extractedResult.findMany({
      where: { isCurrent: true, documentId: { not: q.documentId }, invoiceNumberKey: q.invoiceNumberKey, ...(q.supplierKey && { supplierKey: q.supplierKey }), document: { deletedAt: null, ownerId: q.ownerId } },
      include: { document: true }, take: 50,
    });
    return rows.map((r) => ({ document: toDoc(r.document), result: toResult(r) }));
  }

  private toHits(rows: { id: string; document_id: string; page: number | null; sheet: string | null; range: string | null; snippet: string; content: string; score: number; total: bigint }[], page: PageQuery): Page<SearchHit> {
    return {
      items: rows.map((r) => ({ documentId: r.document_id, chunkId: r.id, score: Number(r.score), snippet: r.snippet, content: r.content, page: r.page, sheet: r.sheet, range: r.range })),
      total: rows[0] ? Number(rows[0].total) : 0, page: page.page, pageSize: page.pageSize,
    };
  }
  async searchKeyword(q: string, f: DocumentFilters, page: PageQuery) {
    const rows = await this.db.$queryRaw<Parameters<PgDocuments['toHits']>[0]>`
      SELECT c.id, c.document_id, c.page, c.sheet, c.range, c.content,
             left(c.content, 240) AS snippet,
             ts_rank(c.tsv, tq.q)::float8 AS score, count(*) OVER() AS total
      FROM text_chunks c JOIN documents d ON d.id = c.document_id,
           LATERAL (SELECT plainto_tsquery('simple', ${q}) AS q) tq
      WHERE c.tsv @@ tq.q AND ${filterSql(f)}
      ORDER BY score DESC, c.id LIMIT ${page.pageSize} OFFSET ${(page.page - 1) * page.pageSize}`;
    return this.toHits(rows, page);
  }
  async searchSemantic(vector: number[], f: DocumentFilters, page: PageQuery) {
    const v = vec(vector);
    const rows = await this.db.$queryRaw<Parameters<PgDocuments['toHits']>[0]>`
      SELECT c.id, c.document_id, c.page, c.sheet, c.range, c.content, left(c.content, 240) AS snippet,
             (1 - (c.embedding <=> ${v}::vector))::float8 AS score, count(*) OVER() AS total
      FROM text_chunks c JOIN documents d ON d.id = c.document_id
      WHERE c.embedding IS NOT NULL AND (1 - (c.embedding <=> ${v}::vector)) > 0.05 AND ${filterSql(f)}
      ORDER BY c.embedding <=> ${v}::vector, c.id LIMIT ${page.pageSize} OFFSET ${(page.page - 1) * page.pageSize}`;
    return this.toHits(rows, page);
  }

  async addAudit(a: Omit<AuditRecord, 'id' | 'createdAt'>) {
    await this.db.auditEvent.create({ data: { documentId: a.documentId, actorId: a.actorId, eventType: a.eventType, metadata: json(a.metadata) } });
  }
  async listAudit(documentId: string): Promise<AuditRecord[]> {
    return (await this.db.auditEvent.findMany({ where: { documentId }, orderBy: { createdAt: 'asc' } })).map((a) => ({
      id: a.id, documentId: a.documentId, actorId: a.actorId, eventType: a.eventType, metadata: a.metadata as Record<string, unknown>, createdAt: a.createdAt,
    }));
  }
  async stats(ownerId?: string) {
    const where = { deletedAt: null, ...(ownerId && { ownerId }) };
    const groups = await this.db.document.groupBy({ by: ['processingStatus'], where, _count: { _all: true } });
    const byStatus: Record<string, number> = {};
    groups.forEach((g) => { byStatus[g.processingStatus] = g._count._all; });
    return {
      total: groups.reduce((s, g) => s + g._count._all, 0), byStatus,
      requiresReview: await this.db.document.count({ where: { ...where, reviewStatus: 'pending' } }),
      failed: byStatus['failed'] ?? 0,
    };
  }
}

export function createPostgresRepositories(connectionString: string): Repositories {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  return {
    provider: 'postgres', users: new PgUsers(db), documents: new PgDocuments(db), outbox: new PgOutbox(db),
    ping: async () => { await db.$queryRaw`SELECT 1`; },
    close: async () => { await db.$disconnect(); },
  };
}
