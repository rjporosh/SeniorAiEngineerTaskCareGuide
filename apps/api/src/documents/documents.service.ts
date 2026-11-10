import type { Readable } from 'node:stream';
import { Inject, Injectable } from '@nestjs/common';
import type { Repositories } from '../application/ports.js';
import type { ObjectStoragePort } from '../application/storage.js';
import { REPOSITORIES } from '../persistence.module.js';
import { STORAGE } from '../storage.module.js';
import type { AuthUser } from '../common/decorators.js';
import { notFound } from '../common/errors.js';
import type { DocumentRecord } from '../domain/types.js';
import { assertCanRead, ownerScope } from './access.js';
import { toFilters } from './filters.js';
import type { ListQueryDto } from './documents.schemas.js';

/** Never leak the internal storage key / provider to clients. */
export const toDocumentView = (d: DocumentRecord) => ({
  id: d.id, filename: d.originalFilename, mimeType: d.detectedMime, sizeBytes: d.byteSize, sha256: d.sha256,
  documentType: d.documentType, processingStatus: d.processingStatus, reviewStatus: d.reviewStatus,
  failure: d.failureCode ? { code: d.failureCode, message: d.failureMessage } : null,
  createdAt: d.createdAt.toISOString(), updatedAt: d.updatedAt.toISOString(),
});

@Injectable()
export class DocumentsService {
  constructor(
    @Inject(REPOSITORIES) private readonly repos: Repositories,
    @Inject(STORAGE) private readonly storage: ObjectStoragePort,
  ) {}

  async list(user: AuthUser, q: ListQueryDto) {
    const res = await this.repos.documents.list({
      page: q.page, pageSize: q.pageSize, sortBy: q.sortBy, sortDir: q.sortDir,
      filters: toFilters(q, ownerScope(user)),
    });
    return { ...res, items: res.items.map((i) => ({ ...toDocumentView(i.document), invoice: i.invoice })) };
  }

  async get(user: AuthUser, id: string) {
    const doc = assertCanRead(user, await this.repos.documents.findById(id));
    const attempts = await this.repos.documents.listAttempts(id);
    return { ...toDocumentView(doc), attempts: attempts.map((a) => this.attemptView(a)) };
  }

  async result(user: AuthUser, id: string) {
    const doc = assertCanRead(user, await this.repos.documents.findById(id));
    const [result, issues] = await Promise.all([this.repos.documents.findCurrentResult(id), this.repos.documents.listIssues(id)]);
    return {
      document: toDocumentView(doc),
      result: result && { id: result.id, version: result.version, extraction: result.current, original: result.raw, extractor: result.extractor, updatedAt: result.updatedAt.toISOString() },
      issues: issues.map((i) => ({ id: i.id, code: i.code, severity: i.severity, message: i.message, fields: i.fields, details: i.details, resolution: i.resolution })),
    };
  }

  async history(user: AuthUser, id: string) {
    assertCanRead(user, await this.repos.documents.findById(id));
    const [attempts, corrections, audit] = await Promise.all([
      this.repos.documents.listAttempts(id), this.repos.documents.listCorrections(id), this.repos.documents.listAudit(id),
    ]);
    return {
      attempts: attempts.map((a) => this.attemptView(a)),
      corrections: corrections.map((c) => ({ id: c.id, actorId: c.actorId, field: c.fieldPath, previousValue: c.previousValue, correctedValue: c.correctedValue, reason: c.reason, createdAt: c.createdAt.toISOString() })),
      audit: audit.map((a) => ({ id: a.id, actorId: a.actorId, event: a.eventType, metadata: a.metadata, createdAt: a.createdAt.toISOString() })),
    };
  }

  async job(user: AuthUser, attemptId: string) {
    const attempt = await this.repos.documents.findAttempt(attemptId);
    if (!attempt) throw notFound('Job');
    assertCanRead(user, await this.repos.documents.findById(attempt.documentId));
    return { documentId: attempt.documentId, ...this.attemptView(attempt) };
  }

  async download(user: AuthUser, id: string): Promise<{ stream: Readable; doc: DocumentRecord }> {
    const doc = assertCanRead(user, await this.repos.documents.findById(id));
    await this.repos.documents.addAudit({ documentId: id, actorId: user.id, eventType: 'document.download', metadata: {} });
    return { stream: await this.storage.get(doc.storageKey), doc };
  }

  stats(user: AuthUser) { return this.repos.documents.stats(ownerScope(user)); }

  private attemptView(a: { id: string; attemptNumber: number; stage: string; status: string; errorCode: string | null; errorMessage: string | null; retryable: boolean; startedAt: Date; finishedAt: Date | null }) {
    return {
      id: a.id, attemptNumber: a.attemptNumber, stage: a.stage, status: a.status,
      error: a.errorCode ? { code: a.errorCode, message: a.errorMessage, retryable: a.retryable } : null,
      startedAt: a.startedAt.toISOString(), finishedAt: a.finishedAt?.toISOString() ?? null,
    };
  }
}
