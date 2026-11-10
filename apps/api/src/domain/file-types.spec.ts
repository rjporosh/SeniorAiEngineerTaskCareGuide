import { describe, expect, it } from 'vitest';
import { detectFile, sanitizeFilename } from './file-types.js';

const pdf = Buffer.from('%PDF-1.7\n1 0 obj');
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0]);

describe('detectFile', () => {
  it('accepts matching extension, mime and signature', () => {
    expect(detectFile(pdf, 'Invoice.PDF', 'application/pdf')).toEqual({ ok: true, kind: 'pdf', mime: 'application/pdf' });
    expect(detectFile(png, 'a.png', undefined)).toMatchObject({ ok: true, kind: 'png' });
    expect(detectFile(zip, 'book.xlsx', 'application/octet-stream')).toMatchObject({ ok: true, kind: 'xlsx' });
    expect(detectFile(Buffer.from('a,b\n1,2\n'), 'x.csv', 'text/csv')).toMatchObject({ ok: true, kind: 'csv' });
    expect(detectFile(Buffer.from('\uFEFFnom,prix\nété,1\n'), 'x.csv', 'application/vnd.ms-excel')).toMatchObject({ ok: true });
  });
  it('rejects disguised executables and signature mismatches', () => {
    expect(detectFile(Buffer.from('MZ\x90\x00'), 'invoice.pdf', 'application/pdf')).toMatchObject({ ok: false, code: 'SIGNATURE_MISMATCH' });
    expect(detectFile(png, 'a.pdf', 'application/pdf')).toMatchObject({ ok: false, code: 'SIGNATURE_MISMATCH' });
    expect(detectFile(Buffer.from([0, 1, 2, 3]), 'x.csv', 'text/csv')).toMatchObject({ ok: false, code: 'SIGNATURE_MISMATCH' });
  });
  it('rejects unsupported extensions and mime mismatches', () => {
    expect(detectFile(pdf, 'a.exe', undefined)).toMatchObject({ ok: false, code: 'UNSUPPORTED_TYPE' });
    expect(detectFile(pdf, 'a.pdf', 'text/html')).toMatchObject({ ok: false, code: 'MIME_MISMATCH' });
    expect(detectFile(pdf, 'noext', undefined)).toMatchObject({ ok: false, code: 'UNSUPPORTED_TYPE' });
  });
  it('rejects empty files', () => {
    expect(detectFile(Buffer.alloc(0), 'a.pdf', undefined)).toMatchObject({ ok: false, code: 'EMPTY_FILE' });
  });
});

describe('sanitizeFilename', () => {
  it('strips paths and control characters', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFilename('C:\\tmp\\inv\u0000oice.pdf')).toBe('invoice.pdf');
    expect(sanitizeFilename('...')).toBe('unnamed');
    expect(sanitizeFilename('a'.repeat(500)).length).toBe(200);
  });
});
