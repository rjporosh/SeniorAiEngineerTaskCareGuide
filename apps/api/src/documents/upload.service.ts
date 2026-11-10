import { createHash, randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { Inject, Injectable, Logger } from '@nestjs/common';
import busboy from 'busboy';
import type { Request } from 'express';
import { APP_CONFIG } from '../app.tokens.js';
import type { AppConfig } from '../config/env.schema.js';
import type { Repositories } from '../application/ports.js';
import { newStorageKey, type ObjectStoragePort } from '../application/storage.js';
import { REPOSITORIES } from '../persistence.module.js';
import { STORAGE } from '../storage.module.js';
import { detectFile, sanitizeFilename } from '../domain/file-types.js';
import { AppError, badRequest, payloadTooLarge, validationFailed, type FieldError } from '../common/errors.js';
import { currentCorrelationId } from '../common/request-context.js';
import { MeterStream, peek } from './stream-utils.js';

export interface AcceptedFile { id: string; filename: string; status: string; replayed: boolean }
export interface RejectedFile { index: number; filename: string; code: string; message: string }
export interface UploadResult { documents: AcceptedFile[]; rejected: RejectedFile[] }

const HEAD_BYTES = 8192;
const MB = 1024 * 1024;

@Injectable()
export class UploadService {
  private readonly log = new Logger('Upload');
  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    @Inject(REPOSITORIES) private readonly repos: Repositories,
    @Inject(STORAGE) private readonly storage: ObjectStoragePort,
  ) {}

  async handle(req: Request, ownerId: string, idempotencyKey: string | undefined): Promise<UploadResult> {
    const contentType = req.headers['content-type'] ?? '';
    if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
      throw badRequest('Content-Type must be multipart/form-data with one or more "files" parts.', [{ code: 'invalid_content_type', field: 'Content-Type', message: 'Expected multipart/form-data' }]);
    }
    const maxFile = this.cfg.MAX_FILE_SIZE_MB * MB;
    const maxBatch = this.cfg.MAX_BATCH_SIZE_MB * MB;
    const accepted: AcceptedFile[] = [];
    const rejected: RejectedFile[] = [];
    let index = -1;
    let batchBytes = 0;
    const work: Promise<void>[] = [];

    const bb = busboy({ headers: req.headers, defParamCharset: 'utf8', limits: { files: this.cfg.MAX_FILES_PER_BATCH + 20, fileSize: maxFile + 1, fields: 5, parts: this.cfg.MAX_FILES_PER_BATCH + 30, headerPairs: 50 } });

    const reject = (i: number, filename: string, code: string, message: string) => rejected.push({ index: i, filename, code, message });

    bb.on('file', (field, stream: Readable, info) => {
      const i = ++index;
      const filename = sanitizeFilename(info.filename ?? '');
      work.push((async () => {
        if (field !== 'files') { stream.resume(); reject(i, filename, 'UNEXPECTED_FIELD', 'Files must be sent in the "files" field.'); return; }
        if (i >= this.cfg.MAX_FILES_PER_BATCH) { stream.resume(); reject(i, filename, 'TOO_MANY_FILES', `A batch may contain at most ${this.cfg.MAX_FILES_PER_BATCH} files.`); return; }
        const key = idempotencyKey ? createHash('sha256').update(`${idempotencyKey}:${i}`).digest('hex') : null;
        if (key) {
          const existing = await this.repos.documents.findByIdempotencyKey(ownerId, key);
          if (existing) { stream.resume(); accepted.push({ id: existing.id, filename: existing.originalFilename, status: existing.processingStatus, replayed: true }); return; }
        }
        const { head, stream: body } = await peek(stream, HEAD_BYTES);
        const det = detectFile(head, filename, info.mimeType);
        if (!det.ok) { body.resume(); reject(i, filename, det.code, det.message); return; }
        await this.store(body, { ownerId, filename, mime: det.mime, key, i, maxFile, maxBatch, addBatch: (n) => (batchBytes += n) }, accepted, rejected);
      })().catch((e: unknown) => {
        stream.resume();
        this.log.error(`upload of file #${i} failed: ${(e as Error).message}`);
        reject(i, filename, 'UPLOAD_FAILED', 'The file could not be stored. Please retry.');
      }));
    });

    await new Promise<void>((resolve, reject2) => {
      bb.on('close', resolve);
      bb.on('error', (e) => reject2(e instanceof Error ? e : new Error(String(e))));
      req.on('aborted', () => reject2(new Error('client aborted the upload')));
      req.pipe(bb);
    }).catch((e: unknown) => { throw badRequest(`Malformed upload: ${(e as Error).message}`); });
    await Promise.all(work);

    if (index < 0) throw badRequest('No files were provided. Send one or more files in the "files" field.', [{ code: 'required', field: 'files', message: 'At least one file is required' }]);
    if (accepted.length === 0) {
      throw validationFailed(rejected.sort((a, b) => a.index - b.index).map((r): FieldError => ({ code: r.code, field: `files[${r.index}]`, message: `${r.filename}: ${r.message}` })));
    }
    return { documents: accepted, rejected: rejected.sort((a, b) => a.index - b.index) };
  }

  private async store(
    body: Readable,
    o: { ownerId: string; filename: string; mime: string; key: string | null; i: number; maxFile: number; maxBatch: number; addBatch: (n: number) => number },
    accepted: AcceptedFile[], rejected: RejectedFile[],
  ): Promise<void> {
    const id = randomUUID();
    const storageKey = newStorageKey(id);
    let counted = 0;
    const meter = new MeterStream((bytes) => {
      if (bytes > o.maxFile) return payloadTooLarge(`File exceeds the ${this.cfg.MAX_FILE_SIZE_MB} MB limit.`, 'FILE_TOO_LARGE');
      if (o.addBatch(bytes - counted) > o.maxBatch) return payloadTooLarge(`Batch exceeds the ${this.cfg.MAX_BATCH_SIZE_MB} MB limit.`, 'BATCH_TOO_LARGE');
      counted = bytes;
      return null;
    });
    try {
      await Promise.all([this.storage.put(storageKey, meter, { contentType: o.mime }), pipeline(body, meter)]);
    } catch (e) {
      await this.storage.delete(storageKey).catch(() => undefined);
      if (e instanceof AppError) { rejected.push({ index: o.i, filename: o.filename, code: e.code, message: e.message }); return; }
      throw e;
    }
    try {
      const correlationId = currentCorrelationId();
      const doc = await this.repos.documents.createWithOutbox(
        { ownerId: o.ownerId, originalFilename: o.filename, detectedMime: o.mime, byteSize: meter.bytes, sha256: meter.digest(), storageKey, storageProvider: this.storage.provider, idempotencyKey: o.key },
        (documentId, attemptId) => ({ topic: 'document.process', payload: { documentId, attemptId, correlationId } }),
      );
      accepted.push({ id: doc.id, filename: doc.originalFilename, status: doc.processingStatus, replayed: false });
    } catch (e) {
      await this.storage.delete(storageKey).catch(() => undefined);
      throw e;
    }
  }
}
