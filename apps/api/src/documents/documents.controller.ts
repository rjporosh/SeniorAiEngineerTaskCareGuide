import { MultipartFiles, Op, ApiTags, ZodBody, ZodQuery } from '../common/openapi.js';
import { Body, Controller, Get, Headers, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { CurrentUser, RawResponse, Roles, type AuthUser } from '../common/decorators.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { DocumentsService } from './documents.service.js';
import { listQuerySchema, type ListQueryDto } from './documents.schemas.js';
import { correctionSchema, resolveIssueSchema, type CorrectionDto, type ResolveIssueDto } from './review.schemas.js';
import { ReviewService } from './review.service.js';
import { UploadService } from './upload.service.js';

const IDEMPOTENCY = /^[A-Za-z0-9._:-]{8,128}$/;

@ApiTags('Documents')
@Controller()
export class DocumentsController {
  constructor(
    @Inject(DocumentsService) private readonly docs: DocumentsService,
    @Inject(UploadService) private readonly upload: UploadService,
    @Inject(ReviewService) private readonly review: ReviewService,
  ) {}

  @Post('documents') @HttpCode(201) @MultipartFiles()
  @Op('Upload one or more documents', { description: 'Streams a multipart request. Each file is validated by extension, MIME sniffing and signature, stored under a generated key and queued for background processing. Supply `Idempotency-Key` to make retries safe.', status: 201, ok: 'Per-file results (accepted or rejected with a reason) plus batch totals', errors: [400, 401, 403, 429] })
  async create(@Req() req: Request, @CurrentUser() user: AuthUser, @Headers('idempotency-key') key?: string) {
    return this.upload.handle(req, user.id, key && IDEMPOTENCY.test(key) ? key : undefined);
  }

  @Get('documents') @ZodQuery(listQuerySchema)
  @Op('List and filter documents', { description: 'Paginated, sortable list with filters for status, review state, supplier, currency, amount and date ranges, plus free-text search.', errors: [400, 401, 429] })
  list(@CurrentUser() u: AuthUser, @Query(new ZodPipe(listQuerySchema)) q: ListQueryDto) { return this.docs.list(u, q); }

  @Get('documents/stats') @Op('Dashboard counters', { description: 'Totals by processing status and the number of documents waiting for review.', errors: [401, 429] })
  stats(@CurrentUser() u: AuthUser) { return this.docs.stats(u); }

  @Get('documents/:id') @Op('Get a document', { description: 'Metadata, processing status, failure reason (if any), validation issues and the current extraction summary.', errors: [400, 401, 404, 429] })
  get(@CurrentUser() u: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) { return this.docs.get(u, id); }

  @Get('documents/:id/result') @Op('Get the extracted result', { description: 'Structured invoice data with per-field evidence (page, sheet, cell, quoted text) and confidence, the raw extraction, the extractor/model used and the optimistic-concurrency `version`.', errors: [400, 401, 404, 429] })
  result(@CurrentUser() u: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) { return this.docs.result(u, id); }

  @Get('documents/:id/history') @Op('Processing and audit history', { description: 'Every processing attempt, correction and audit event for the document, newest first.', errors: [400, 401, 404, 429] })
  history(@CurrentUser() u: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) { return this.docs.history(u, id); }

  @Patch('documents/:id/corrections') @Roles('admin', 'reviewer') @ZodBody(correctionSchema)
  @Op('Correct extracted values', { description: 'Applies reviewer corrections on top of the immutable raw extraction and re-runs validation. `expectedVersion` must match the current result version (409 on conflict). Requires role admin or reviewer.' })
  correct(@CurrentUser() u: AuthUser, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(correctionSchema)) dto: CorrectionDto) { return this.review.correct(u, id, dto); }

  @Patch('documents/:id/issues/:issueId') @Roles('admin', 'reviewer') @ZodBody(resolveIssueSchema)
  @Op('Resolve or waive a validation issue', { description: 'Marks an issue resolved or waived with an optional reason; the action is audited. Requires role admin or reviewer.' })
  resolve(@CurrentUser() u: AuthUser, @Param('id', new ParseUUIDPipe()) id: string, @Param('issueId', new ParseUUIDPipe()) issueId: string, @Body(new ZodPipe(resolveIssueSchema)) dto: ResolveIssueDto) {
    return this.review.resolveIssue(u, id, issueId, dto);
  }

  @Post('documents/:id/reprocess') @HttpCode(202)
  @Op('Reprocess a failed document', { description: 'Queues a new processing attempt for a failed or rejected-retryable document. Idempotent with `Idempotency-Key`.', status: 202, ok: 'Accepted — a new attempt was queued' })
  reprocess(@CurrentUser() u: AuthUser, @Param('id', new ParseUUIDPipe()) id: string, @Headers('idempotency-key') key?: string) {
    return this.review.reprocess(u, id, key && IDEMPOTENCY.test(key) ? key : undefined);
  }


  @Get('jobs/:id') @Op('Get a processing job', { description: 'Status of one processing attempt (stage, error code, retryability, timings).', errors: [400, 401, 404, 429] })
  job(@CurrentUser() u: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) { return this.docs.job(u, id); }

  @Get('documents/:id/download') @RawResponse() @Roles('admin', 'reviewer', 'uploader')
  @Op('Download the original file', { description: 'Streams the stored original as an attachment with `nosniff` and a locked-down CSP.', ok: 'The original file bytes' })
  async download(@CurrentUser() u: AuthUser, @Param('id', new ParseUUIDPipe()) id: string, @Res() res: Response): Promise<void> {
    const { stream, doc } = await this.docs.download(u, id);
    res.setHeader('Content-Type', doc.detectedMime);
    res.setHeader('Content-Length', String(doc.byteSize));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Content-Disposition', `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(doc.originalFilename)}`);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  }
}
