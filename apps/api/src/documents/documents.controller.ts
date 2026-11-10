import { Controller, Get, Headers, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { CurrentUser, RawResponse, Roles, type AuthUser } from '../common/decorators.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { DocumentsService } from './documents.service.js';
import { listQuerySchema, type ListQueryDto } from './documents.schemas.js';
import { UploadService } from './upload.service.js';

const IDEMPOTENCY = /^[A-Za-z0-9._:-]{8,128}$/;

@Controller()
export class DocumentsController {
  constructor(
    @Inject(DocumentsService) private readonly docs: DocumentsService,
    @Inject(UploadService) private readonly upload: UploadService,
  ) {}

  @Post('documents') @HttpCode(201)
  async create(@Req() req: Request, @CurrentUser() user: AuthUser, @Headers('idempotency-key') key?: string) {
    return this.upload.handle(req, user.id, key && IDEMPOTENCY.test(key) ? key : undefined);
  }

  @Get('documents')
  list(@CurrentUser() u: AuthUser, @Query(new ZodPipe(listQuerySchema)) q: ListQueryDto) { return this.docs.list(u, q); }

  @Get('documents/stats') stats(@CurrentUser() u: AuthUser) { return this.docs.stats(u); }

  @Get('documents/:id')
  get(@CurrentUser() u: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) { return this.docs.get(u, id); }

  @Get('documents/:id/result')
  result(@CurrentUser() u: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) { return this.docs.result(u, id); }

  @Get('documents/:id/history')
  history(@CurrentUser() u: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) { return this.docs.history(u, id); }

  @Get('jobs/:id')
  job(@CurrentUser() u: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) { return this.docs.job(u, id); }

  @Get('documents/:id/download') @RawResponse() @Roles('admin', 'reviewer', 'uploader')
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
