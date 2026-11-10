import { formatBytes } from './format';

export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const BATCH_SIZE = 20;
const ALLOWED = ['pdf', 'jpg', 'jpeg', 'png', 'tif', 'tiff', 'xlsx', 'xls', 'csv'];

/** Fast client-side feedback only; the server re-validates extension, MIME and file signature. */
export function validateClientSide(f: { name: string; size: number }): string | null {
  const ext = f.name.includes('.') ? (f.name.split('.').pop() ?? '').toLowerCase() : '';
  if (!ALLOWED.includes(ext)) return `${ext ? `".${ext}" files are` : 'Files without an extension are'} not supported. Use PDF, JPG, PNG, TIFF, XLSX, XLS or CSV.`;
  if (f.size === 0) return 'This file is empty.';
  if (f.size > MAX_FILE_BYTES) return `This file is ${formatBytes(f.size)}; the limit is ${formatBytes(MAX_FILE_BYTES)}.`;
  return null;
}
