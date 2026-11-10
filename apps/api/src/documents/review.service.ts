import { Inject, Injectable } from '@nestjs/common';
import { Decimal } from '../domain/money.js';
import type { Repositories } from '../application/ports.js';
import { currentCorrelationId } from '../common/request-context.js';
import type { AuthUser } from '../common/decorators.js';
import { conflict, forbidden, notFound, validationFailed } from '../common/errors.js';
import type { DocumentRecord, InvoiceData, IssueRecord, NewIssue } from '../domain/types.js';
import type { DocumentValidator } from '../processing/document-validator.js';
import { DOCUMENT_VALIDATOR } from '../processing/processing.module.js';
import { REPOSITORIES } from '../persistence.module.js';
import { assertCanRead } from './access.js';
import type { CorrectionDto, ResolveIssueDto } from './review.schemas.js';
import { DocumentsService } from './documents.service.js';

const MONEY_FIELDS = new Set(['subtotal', 'taxAmount', 'totalAmount']);
const canonical = (field: string, v: unknown): unknown => (MONEY_FIELDS.has(field) && typeof v === 'string' ? new Decimal(v).toFixed() : v);
const fingerprint = (i: Pick<NewIssue, 'code' | 'fields' | 'details'>) => `${i.code}|${[...i.fields].sort().join(',')}|${String(i.details['documentId'] ?? '')}|${String(i.details['location'] ?? '')}`;

@Injectable()
export class ReviewService {
  constructor(
    @Inject(REPOSITORIES) private readonly repos: Repositories,
    @Inject(DOCUMENT_VALIDATOR) private readonly validator: DocumentValidator,
    @Inject(DocumentsService) private readonly docs: DocumentsService,
  ) {}

  async correct(user: AuthUser, id: string, dto: CorrectionDto) {
    const doc = assertCanRead(user, await this.repos.documents.findById(id));
    if (doc.processingStatus !== 'completed') throw conflict('Only fully processed documents can be corrected.', 'NOT_CORRECTABLE');
    const result = await this.repos.documents.findCurrentResult(id);
    if (!result) throw conflict('This document has no extraction result to correct.', 'NO_RESULT');

    const next: InvoiceData = structuredClone(result.current);
    const corrections: Parameters<typeof this.repos.documents.applyCorrections>[3] = [];
    for (const [field, raw] of Object.entries(dto.changes)) {
      const value = canonical(field, raw);
      const previous = (result.current as unknown as Record<string, unknown>)[field];
      if (JSON.stringify(previous) === JSON.stringify(value)) continue;
      (next as unknown as Record<string, unknown>)[field] = value;
      corrections.push({ documentId: id, resultId: result.id, actorId: user.id, fieldPath: field, previousValue: previous ?? null, correctedValue: value ?? null, reason: dto.reason ?? null });
    }
    if (corrections.length === 0) throw validationFailed([{ code: 'no_changes', field: 'changes', message: 'The submitted values are identical to the current values.' }]);

    const { outcome } = await this.validator.validate(doc, next);
    const previousIssues = await this.repos.documents.listIssues(id);
    const waived = new Set(previousIssues.filter((i) => i.resolution === 'waived').map(fingerprint));
    const open = outcome.issues.filter((i) => i.severity !== 'info' && !waived.has(fingerprint(i)));
    next.requiresManualReview = open.length > 0;

    const saved = await this.repos.documents.applyCorrections(result.id, dto.expectedVersion, next, corrections);
    const created = await this.repos.documents.replaceIssues(id, outcome.issues);
    await Promise.all(created.filter((i) => waived.has(fingerprint(i))).map((i) => this.repos.documents.resolveIssue(i.id, 'waived')));
    await this.repos.documents.updateStatus(id, doc.processingStatus, { reviewStatus: next.requiresManualReview ? 'pending' : 'reviewed', documentType: next.documentType });
    await this.repos.documents.addAudit({ documentId: id, actorId: user.id, eventType: 'document.corrected', metadata: { fields: corrections.map((c) => c.fieldPath), version: saved.version, reason: dto.reason ?? null } });
    return this.docs.result(user, id);
  }

  async resolveIssue(user: AuthUser, documentId: string, issueId: string, dto: ResolveIssueDto) {
    const doc = assertCanRead(user, await this.repos.documents.findById(documentId));
    const issues = await this.repos.documents.listIssues(documentId);
    const issue = issues.find((i) => i.id === issueId);
    if (!issue) throw notFound('Issue');
    await this.repos.documents.resolveIssue(issueId, dto.resolution);
    await this.repos.documents.addAudit({ documentId, actorId: user.id, eventType: 'issue.resolved', metadata: { issueId, code: issue.code, resolution: dto.resolution, reason: dto.reason ?? null } });
    await this.refreshReviewStatus(doc, issues.map((i): IssueRecord => (i.id === issueId ? { ...i, resolution: dto.resolution } : i)));
    return this.docs.result(user, documentId);
  }

  private async refreshReviewStatus(doc: DocumentRecord, issues: IssueRecord[]): Promise<void> {
    const stillOpen = issues.some((i) => i.severity !== 'info' && i.resolution === 'open');
    await this.repos.documents.updateStatus(doc.id, doc.processingStatus, { reviewStatus: stillOpen ? 'pending' : 'reviewed' });
  }

  /** Starts a brand-new attempt. History (attempts, results, corrections) is never erased. */
  async reprocess(user: AuthUser, id: string, idempotencyKey: string | undefined) {
    const doc = assertCanRead(user, await this.repos.documents.findById(id));
    if (idempotencyKey) {
      const prior = (await this.repos.documents.listAudit(id)).find((a) => a.eventType === 'document.reprocess' && a.metadata['idempotencyKey'] === idempotencyKey);
      if (prior) return { documentId: id, attemptId: String(prior.metadata['attemptId']), status: 'queued', replayed: true };
    }
    if (!['completed', 'failed', 'rejected', 'cancelled'].includes(doc.processingStatus)) throw conflict('The document is already being processed.', 'ALREADY_PROCESSING');
    const privileged = user.role === 'admin' || user.role === 'reviewer';
    if (!privileged && !['failed', 'rejected'].includes(doc.processingStatus)) throw forbidden('Only reviewers can reprocess a document that has not failed.');
    const correlationId = currentCorrelationId();
    const attempt = await this.repos.documents.startAttemptWithOutbox(id, (a) => ({ topic: 'document.process', payload: { documentId: id, attemptId: a.id, correlationId } }));
    await this.repos.documents.addAudit({ documentId: id, actorId: user.id, eventType: 'document.reprocess', metadata: { attemptId: attempt.id, attemptNumber: attempt.attemptNumber, idempotencyKey: idempotencyKey ?? null } });
    return { documentId: id, attemptId: attempt.id, attemptNumber: attempt.attemptNumber, status: 'queued', replayed: false };
  }
}
