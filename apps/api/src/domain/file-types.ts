export const FILE_KINDS = ['pdf', 'jpeg', 'png', 'tiff', 'xlsx', 'xls', 'csv'] as const;
export type FileKind = (typeof FILE_KINDS)[number];

interface KindSpec { extensions: string[]; mime: string; acceptedMimes: string[] }
const GENERIC = ['application/octet-stream'];
export const KIND_SPECS: Record<FileKind, KindSpec> = {
  pdf: { extensions: ['.pdf'], mime: 'application/pdf', acceptedMimes: ['application/pdf', ...GENERIC] },
  jpeg: { extensions: ['.jpg', '.jpeg'], mime: 'image/jpeg', acceptedMimes: ['image/jpeg', ...GENERIC] },
  png: { extensions: ['.png'], mime: 'image/png', acceptedMimes: ['image/png', ...GENERIC] },
  tiff: { extensions: ['.tif', '.tiff'], mime: 'image/tiff', acceptedMimes: ['image/tiff', ...GENERIC] },
  xlsx: { extensions: ['.xlsx'], mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', acceptedMimes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ...GENERIC] },
  xls: { extensions: ['.xls'], mime: 'application/vnd.ms-excel', acceptedMimes: ['application/vnd.ms-excel', ...GENERIC] },
  csv: { extensions: ['.csv'], mime: 'text/csv', acceptedMimes: ['text/csv', 'text/plain', 'application/csv', 'application/vnd.ms-excel', ...GENERIC] },
};

export type Detection =
  | { ok: true; kind: FileKind; mime: string }
  | { ok: false; code: 'UNSUPPORTED_TYPE' | 'SIGNATURE_MISMATCH' | 'MIME_MISMATCH' | 'EMPTY_FILE'; message: string };

const startsWith = (b: Buffer, sig: number[]): boolean => sig.every((x, i) => b[i] === x);
const SIGNATURES: Record<Exclude<FileKind, 'csv'>, (b: Buffer) => boolean> = {
  pdf: (b) => b.subarray(0, 1024).includes(Buffer.from('%PDF-')),
  jpeg: (b) => startsWith(b, [0xff, 0xd8, 0xff]),
  png: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  tiff: (b) => startsWith(b, [0x49, 0x49, 0x2a, 0x00]) || startsWith(b, [0x4d, 0x4d, 0x00, 0x2a]),
  xlsx: (b) => startsWith(b, [0x50, 0x4b, 0x03, 0x04]),
  xls: (b) => startsWith(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
};

/** CSV has no magic number: require valid UTF-8 text with no NUL/control bytes. */
function looksLikeCsv(head: Buffer): boolean {
  const body = startsWith(head, [0xef, 0xbb, 0xbf]) ? head.subarray(3) : head;
  if (body.includes(0)) return false;
  // a multibyte character may be cut at the end of the head window
  const text = new TextDecoder('utf-8', { fatal: false }).decode(body.subarray(0, body.length - 3));
  if (text.includes('\uFFFD')) return false;
  return !/[\u0001-\u0008\u000e-\u001f]/.test(text);
}

export const extensionOf = (filename: string): string => {
  const i = filename.lastIndexOf('.');
  return i < 0 ? '' : filename.slice(i).toLowerCase();
};

/** Combines extension allow-list, declared MIME and magic-byte sniffing. All three must agree. */
export function detectFile(head: Buffer, filename: string, declaredMime: string | undefined): Detection {
  if (head.length === 0) return { ok: false, code: 'EMPTY_FILE', message: 'The file is empty.' };
  const ext = extensionOf(filename);
  const kind = FILE_KINDS.find((k) => KIND_SPECS[k].extensions.includes(ext));
  if (!kind) return { ok: false, code: 'UNSUPPORTED_TYPE', message: `Unsupported file type "${ext || 'none'}". Allowed: PDF, JPG, PNG, TIFF, XLSX, XLS, CSV.` };
  const signatureOk = kind === 'csv' ? looksLikeCsv(head) : SIGNATURES[kind](head);
  if (!signatureOk) return { ok: false, code: 'SIGNATURE_MISMATCH', message: `The file content does not match its "${ext}" extension.` };
  const mime = declaredMime?.split(';')[0]?.trim().toLowerCase();
  if (mime && !KIND_SPECS[kind].acceptedMimes.includes(mime)) return { ok: false, code: 'MIME_MISMATCH', message: `Declared content type "${mime}" does not match the "${ext}" extension.` };
  return { ok: true, kind, mime: KIND_SPECS[kind].mime };
}

/** Display-safe filename: basename only, control characters and path separators removed, bounded length. */
export function sanitizeFilename(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? '';
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '').replace(/^\.+/, '').trim().slice(0, 200);
  return cleaned.length > 0 ? cleaned : 'unnamed';
}
