import { Logger } from '@nestjs/common';
import type { Repositories } from '../application/ports.js';
import { PermanentJobError, type DeliveryContext, type QueueMessage } from '../application/queue.js';
import type { ObjectStoragePort } from '../application/storage.js';
import { hashEmbedding } from '../domain/embedding.js';
import type { AttemptRecord, DocumentRecord, InvoiceData, NewIssue, ProcessingStatus } from '../domain/types.js';
import type { InvoiceExtractorPort } from '../extraction/types.js';
import { runWithContext } from '../common/request-context.js';
import { chunkBlocks, summaryChunk } from './chunker.js';
import { DocumentValidator } from './document-validator.js';
import { failureMessage, REJECTION_CODES } from './failure-messages.js';
import { ProcessorError, type DocumentProcessorPort } from './processor.client.js';
import type { ProcessResponse } from './processor.types.js';

export interface Logger2 { log(m: string): void; warn(m: string): void; error(m: string): void }

/**
 * Queue handler for `document.process`. Idempotent per attempt: a redelivered message for a finished attempt is a no-op,
 * and the message is acknowledged only after durable state (result, issues, chunks, status) has been written.
 */
export class DocumentProcessingService {
  constructor(
    private readonly repos: Repositories,
    private readonly storage: ObjectStoragePort,
    private readonly processor: DocumentProcessorPort,
    private readonly extractor: InvoiceExtractorPort,
    private readonly log: Logger2 = new Logger('Processing'),
    private readonly validator: DocumentValidator = new DocumentValidator(repos),
  ) {}

  handle = async (msg: QueueMessage, ctx: DeliveryContext): Promise<void> => runWithContext({ correlationId: msg.correlationId }, async () => {
    const attempt = await this.repos.documents.findAttempt(msg.attemptId);
    if (!attempt || attempt.status !== 'running') { this.log.log(`skip ${msg.messageId}: attempt already finished or unknown`); return; }
    const doc = await this.repos.documents.findById(msg.documentId);
    if (!doc) {
      await this.repos.documents.finishAttempt(attempt.id, { status: 'failed', errorCode: 'DOCUMENT_NOT_FOUND', errorMessage: 'Document no longer exists.', retryable: false });
      throw new PermanentJobError('document not found', 'DOCUMENT_NOT_FOUND');
    }
    try {
      await this.run(doc, attempt, msg.correlationId);
    } catch (e) {
      await this.fail(e, doc, attempt, ctx);
    }
  });

  private async stage(doc: DocumentRecord, attempt: AttemptRecord, status: ProcessingStatus): Promise<void> {
    await this.repos.documents.updateAttemptStage(attempt.id, status);
    await this.repos.documents.updateStatus(doc.id, status);
  }

  private async run(doc: DocumentRecord, attempt: AttemptRecord, correlationId: string): Promise<void> {
    const started = Date.now();
    await this.stage(doc, attempt, 'validating');
    const body = await this.storage.get(doc.storageKey);
    await this.stage(doc, attempt, doc.detectedMime.startsWith('image/') ? 'ocr' : 'extracting');
    const processed = await this.processor.process(body, { requestId: correlationId });

    await this.stage(doc, attempt, 'structuring');
    const { data, notes } = this.extractor.extract(processed);

    await this.stage(doc, attempt, 'validating_result');
    const { outcome, peers } = await this.validator.validate(doc, data, notes, processed.blocks);
    data.requiresManualReview = outcome.requiresManualReview;

    const result = await this.repos.documents.saveResult({ documentId: doc.id, attemptId: attempt.id, data, extractor: this.extractor.info });
    await this.repos.documents.replaceIssues(doc.id, outcome.issues);
    await this.indexChunks(doc.id, processed, data);
    await this.notifyPeers(doc.id, peers);

    await this.repos.documents.updateStatus(doc.id, 'indexed');
    await this.repos.documents.updateAttemptStage(attempt.id, 'indexed');
    await this.repos.documents.updateStatus(doc.id, 'completed', {
      failureCode: null, failureMessage: null, documentType: data.documentType, reviewStatus: outcome.requiresManualReview ? 'pending' : 'not_required',
    });
    await this.validator.reconcileDuplicates(doc, data);
    await this.repos.documents.finishAttempt(attempt.id, { status: 'succeeded' });
    await this.repos.documents.addAudit({ documentId: doc.id, actorId: null, eventType: 'document.processed', metadata: { attempt: attempt.attemptNumber, resultId: result.id, issues: outcome.issues.length, ms: Date.now() - started, kind: processed.file_kind } });
    this.log.log(`document ${doc.id} completed in ${Date.now() - started}ms (${outcome.issues.length} issue(s), review=${outcome.requiresManualReview})`);
  }

  private async indexChunks(documentId: string, processed: ProcessResponse, data: InvoiceData): Promise<void> {
    const semantic = this.repos.documents.capabilities.semanticSearch;
    const chunks = chunkBlocks(processed.blocks).map((c) => ({ ...c, embedding: semantic ? hashEmbedding(c.content) : null }));
    const summary = summaryChunk(data, chunks.length);
    if (summary) chunks.push({ ...summary, embedding: semantic ? summary.embedding : null });
    await this.repos.documents.replaceChunks(documentId, chunks);
  }

  private async notifyPeers(sourceId: string, peers: { documentId: string; issues: NewIssue[] }[]): Promise<void> {
    for (const p of peers) {
      const existing = await this.repos.documents.listIssues(p.documentId);
      const fresh = p.issues.filter((i) => !existing.some((e) => e.code === i.code && e.details['documentId'] === sourceId && e.details['location'] === i.details['location']));
      if (fresh.length === 0) continue;
      await this.repos.documents.appendIssues(p.documentId, fresh);
      const peer = await this.repos.documents.findById(p.documentId);
      if (peer && fresh.some((i) => i.severity !== 'info')) await this.repos.documents.updateStatus(peer.id, peer.processingStatus, { reviewStatus: 'pending' });
    }
  }

  private async fail(e: unknown, doc: DocumentRecord, attempt: AttemptRecord, ctx: DeliveryContext): Promise<void> {
    const err = e instanceof ProcessorError ? e : null;
    const code = err?.code ?? 'INTERNAL_ERROR';
    const retryable = err ? err.retryable : true;
    this.log.warn(`document ${doc.id} attempt ${ctx.attempt}/${ctx.maxAttempts} failed: ${code}${e instanceof Error ? ` (${e.message})` : ''}`);
    if (retryable && !ctx.isFinalAttempt) throw e; // broker retries with backoff; attempt stays "running"
    const status: ProcessingStatus = REJECTION_CODES.has(code) ? 'rejected' : 'failed';
    const message = failureMessage(code);
    await this.repos.documents.finishAttempt(attempt.id, { status: 'failed', errorCode: code, errorMessage: message, retryable });
    await this.repos.documents.updateStatus(doc.id, status, { failureCode: code, failureMessage: message, reviewStatus: 'not_required' });
    await this.repos.documents.addAudit({ documentId: doc.id, actorId: null, eventType: 'document.failed', metadata: { code, retryable, attempt: attempt.attemptNumber } });
    if (retryable) throw e; // exhausted retries: let the broker dead-letter the message as well
  }
}
