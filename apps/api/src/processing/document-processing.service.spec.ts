import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Repositories } from '../application/ports.js';
import type { DeliveryContext, QueueMessage } from '../application/queue.js';
import { newStorageKey } from '../application/storage.js';
import { RulesInvoiceExtractor } from '../extraction/rules-extractor.js';
import { LocalObjectStorage } from '../infrastructure/storage/local.storage.js';
import { createMemoryRepositories } from '../infrastructure/persistence/memory/memory.repositories.js';
import { response, rowBlock, textPage } from '../testing/blocks.js';
import { DocumentProcessingService } from './document-processing.service.js';
import { ProcessorError, type DocumentProcessorPort } from './processor.client.js';
import type { ProcessResponse } from './processor.types.js';

const SILENT = { log: () => undefined, warn: () => undefined, error: () => undefined };
const INVOICE = `ACME SUPPLIES LTD\nInvoice No: INV-2026-0042\nInvoice Date: 2026-03-15\nBill To: Globex\nSubtotal: 1000.00\nVAT: 100.00\nTotal Due: USD 1100.00`;
const ctx = (attempt = 1, max = 3): DeliveryContext => ({ attempt, maxAttempts: max, isFinalAttempt: attempt >= max });

describe('DocumentProcessingService', () => {
  let repos: Repositories; let storage: LocalObjectStorage; let ownerId: string;
  let script: ((content: string) => ProcessResponse | Error)[]; let calls: number;
  const processor: DocumentProcessorPort = {
    ping: async () => undefined,
    process: async (body) => {
      calls++;
      const chunks: Buffer[] = [];
      for await (const c of body) chunks.push(Buffer.from(c));
      const out = script.shift()?.(Buffer.concat(chunks).toString());
      if (!out) throw new Error('no scripted response');
      if (out instanceof Error) throw out;
      return out;
    },
  };
  let svc: DocumentProcessingService;

  beforeEach(async () => {
    repos = createMemoryRepositories(); calls = 0; script = [];
    storage = new LocalObjectStorage(mkdtempSync(join(tmpdir(), 'docint-proc-')));
    svc = new DocumentProcessingService(repos, storage, processor, new RulesInvoiceExtractor(), SILENT);
    ownerId = (await repos.users.create({ email: `o${Math.random()}@x.io`, passwordHash: 'h', role: 'uploader' })).id;
  });

  async function upload(name: string, mime: string, content = name, sha: string = randomUUID()) {
    const key = newStorageKey(randomUUID());
    await storage.put(key, Readable.from(Buffer.from(content)));
    let msg!: QueueMessage;
    const doc = await repos.documents.createWithOutbox(
      { ownerId, originalFilename: name, detectedMime: mime, byteSize: content.length, sha256: sha, storageKey: key, storageProvider: 'local', idempotencyKey: null },
      (documentId, attemptId) => { msg = { messageId: randomUUID(), jobType: 'document.process', schemaVersion: 1, documentId, attemptId, correlationId: 'corr-test-001', idempotencyKey: `${documentId}:${attemptId}`, createdAt: new Date().toISOString(), payload: {} }; return { topic: 'document.process', payload: { documentId, attemptId } }; },
    );
    return { doc, msg };
  }
  const PDF = 'application/pdf'; const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  it('processes an invoice end to end: result, validation, chunks, status', async () => {
    const { doc, msg } = await upload('inv.pdf', PDF);
    script.push(() => response([textPage(1, INVOICE)]));
    await svc.handle(msg, ctx());
    const d = (await repos.documents.findById(doc.id))!;
    expect(d).toMatchObject({ processingStatus: 'completed', documentType: 'invoice', reviewStatus: 'not_required', failureCode: null });
    const r = (await repos.documents.findCurrentResult(doc.id))!;
    expect(r.current).toMatchObject({ invoiceNumber: 'INV-2026-0042', totalAmount: '1100', currency: 'USD', requiresManualReview: false });
    expect(r.extractor.provider).toBe('rules');
    expect((await repos.documents.listIssues(doc.id)).filter((i) => i.severity !== 'info')).toEqual([]);
    expect(await repos.documents.countChunks(doc.id)).toBeGreaterThanOrEqual(2);
    const attempts = await repos.documents.listAttempts(doc.id);
    expect(attempts[0]).toMatchObject({ status: 'succeeded', stage: 'indexed' });
    expect((await repos.documents.listAudit(doc.id)).map((a) => a.eventType)).toContain('document.processed');
    expect((await repos.documents.searchKeyword('INV-2026-0042', { ownerId }, { page: 1, pageSize: 5 })).items[0]?.documentId).toBe(doc.id);
  });

  it('flags arithmetic problems and requires review', async () => {
    const { doc, msg } = await upload('bad.pdf', PDF);
    script.push(() => response([textPage(1, INVOICE.replace('Total Due: USD 1100.00', 'Total Due: USD 1500.00'))]));
    await svc.handle(msg, ctx());
    const d = (await repos.documents.findById(doc.id))!;
    expect(d.reviewStatus).toBe('pending');
    expect((await repos.documents.listIssues(doc.id)).map((i) => i.code)).toContain('TOTAL_MISMATCH');
    expect((await repos.documents.findCurrentResult(doc.id))!.current.requiresManualReview).toBe(true);
  });

  it('rejects unusable files without retrying and acknowledges the message', async () => {
    const { doc, msg } = await upload('broken.pdf', PDF);
    script.push(() => new ProcessorError('CORRUPT_FILE', 'corrupt', false));
    await expect(svc.handle(msg, ctx())).resolves.toBeUndefined();
    expect(await repos.documents.findById(doc.id)).toMatchObject({ processingStatus: 'rejected', failureCode: 'CORRUPT_FILE' });
    expect((await repos.documents.listAttempts(doc.id))[0]).toMatchObject({ status: 'failed', retryable: false, errorCode: 'CORRUPT_FILE' });
  });

  it('retries transient failures, then fails terminally and dead-letters on the last attempt', async () => {
    const { doc, msg } = await upload('slow.pdf', PDF);
    script.push(() => new ProcessorError('PROCESSOR_UNAVAILABLE', 'down', true));
    await expect(svc.handle(msg, ctx(1))).rejects.toBeInstanceOf(ProcessorError);
    expect((await repos.documents.findById(doc.id))?.processingStatus).not.toBe('failed');
    expect((await repos.documents.listAttempts(doc.id))[0]?.status).toBe('running');
    script.push(() => new ProcessorError('PROCESSOR_UNAVAILABLE', 'down', true));
    await expect(svc.handle(msg, ctx(3))).rejects.toBeInstanceOf(ProcessorError);
    expect(await repos.documents.findById(doc.id)).toMatchObject({ processingStatus: 'failed', failureCode: 'PROCESSOR_UNAVAILABLE' });
    expect((await repos.documents.listAttempts(doc.id))[0]).toMatchObject({ status: 'failed', retryable: true });
  });

  it('is idempotent for redelivered messages', async () => {
    const { msg } = await upload('inv.pdf', PDF);
    script.push(() => response([textPage(1, INVOICE)]));
    await svc.handle(msg, ctx());
    await svc.handle(msg, ctx());
    expect(calls).toBe(1);
  });

  it('reprocessing keeps history: new attempt, new current result, old attempt intact', async () => {
    const { doc, msg } = await upload('inv.pdf', PDF);
    script.push(() => response([textPage(1, INVOICE)]));
    await svc.handle(msg, ctx());
    let msg2!: QueueMessage;
    await repos.documents.startAttemptWithOutbox(doc.id, (a) => { msg2 = { ...msg, messageId: randomUUID(), attemptId: a.id }; return { topic: 'document.process', payload: {} }; });
    script.push(() => response([textPage(1, INVOICE.replace('INV-2026-0042', 'INV-2026-0043'))]));
    await svc.handle(msg2, ctx());
    const attempts = await repos.documents.listAttempts(doc.id);
    expect(attempts.map((a) => [a.attemptNumber, a.status])).toEqual([[1, 'succeeded'], [2, 'succeeded']]);
    expect((await repos.documents.findCurrentResult(doc.id))!.current.invoiceNumber).toBe('INV-2026-0043');
  });

  it('reports duplicate invoice candidates and exact file duplicates without merging anything', async () => {
    const first = await upload('a.pdf', PDF, 'same', 'sha-same'); script.push(() => response([textPage(1, INVOICE)])); await svc.handle(first.msg, ctx());
    const second = await upload('b.pdf', PDF, 'same', 'sha-same'); script.push(() => response([textPage(1, INVOICE)])); await svc.handle(second.msg, ctx());
    const codes = (await repos.documents.listIssues(second.doc.id)).map((i) => i.code);
    expect(codes).toContain('DUPLICATE_INVOICE_CANDIDATE');
    expect(codes).toContain('DUPLICATE_FILE');
    expect((await repos.documents.findById(first.doc.id))?.processingStatus).toBe('completed');
    expect((await repos.documents.findById(second.doc.id))?.reviewStatus).toBe('pending');
  });

  it('cross-checks a PDF against a spreadsheet row, in either processing order', async () => {
    const ledger = response([
      rowBlock('Invoices', 1, ['Invoice No', 'Supplier', 'Total', 'Currency']), rowBlock('Invoices', 2, ['INV-2026-0042', 'Acme Supplies Ltd', '1150.00', 'USD']), rowBlock('Invoices', 3, ['INV-9', 'Other', '5', 'USD']),
    ], 'xlsx');
    // PDF first, spreadsheet second: the spreadsheet run flags the PDF as well (peer update)
    const pdf = await upload('inv.pdf', PDF); script.push(() => response([textPage(1, INVOICE)])); await svc.handle(pdf.msg, ctx());
    const sheet = await upload('ledger.xlsx', XLSX); script.push(() => ledger); await svc.handle(sheet.msg, ctx());
    const sheetIssues = await repos.documents.listIssues(sheet.doc.id);
    const mismatch = sheetIssues.find((i) => i.code === 'CROSS_DOCUMENT_MISMATCH')!;
    expect(mismatch.fields).toEqual(['totalAmount']);
    expect(mismatch.details['location']).toBe('Invoices!A2:D2');
    const pdfIssues = await repos.documents.listIssues(pdf.doc.id);
    expect(pdfIssues.find((i) => i.code === 'CROSS_DOCUMENT_MISMATCH')?.details['documentId']).toBe(sheet.doc.id);
    expect((await repos.documents.findById(pdf.doc.id))?.reviewStatus).toBe('pending');
    // reprocessing the spreadsheet must not duplicate the finding on the PDF
    let again!: QueueMessage;
    await repos.documents.startAttemptWithOutbox(sheet.doc.id, (a) => { again = { ...sheet.msg, messageId: randomUUID(), attemptId: a.id }; return { topic: 'document.process', payload: {} }; });
    script.push(() => ledger); await svc.handle(again, ctx());
    expect((await repos.documents.listIssues(pdf.doc.id)).filter((i) => i.code === 'CROSS_DOCUMENT_MISMATCH')).toHaveLength(1);

    // Spreadsheet first, PDF second (new PDF with same invoice number) finds the row via search
    const pdf2 = await upload('inv2.pdf', PDF); script.push(() => response([textPage(1, INVOICE)])); await svc.handle(pdf2.msg, ctx());
    const found = (await repos.documents.listIssues(pdf2.doc.id)).find((i) => i.code === 'CROSS_DOCUMENT_MISMATCH' && i.details['documentId'] === sheet.doc.id);
    expect(found?.fields).toEqual(['totalAmount']);
  });

  it('does not compare across owners', async () => {
    const other = (await repos.users.create({ email: `p${Math.random()}@x.io`, passwordHash: 'h', role: 'uploader' })).id;
    const mine = await upload('mine.pdf', PDF); script.push(() => response([textPage(1, INVOICE)])); await svc.handle(mine.msg, ctx());
    const saved = ownerId; ownerId = other;
    const theirs = await upload('theirs.pdf', PDF); script.push(() => response([textPage(1, INVOICE)])); await svc.handle(theirs.msg, ctx());
    ownerId = saved;
    expect((await repos.documents.listIssues(theirs.doc.id)).map((i) => i.code)).not.toContain('DUPLICATE_INVOICE_CANDIDATE');
  });
});
