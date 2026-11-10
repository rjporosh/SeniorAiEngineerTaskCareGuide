import type { ProcessingStatus, ReviewStatus, Severity } from './types';

export const STATUS_LABEL: Record<ProcessingStatus, string> = {
  uploaded: 'Uploaded', queued: 'Waiting in queue', validating: 'Checking file', extracting: 'Reading text', ocr: 'Recognising text', structuring: 'Finding invoice fields',
  validating_result: 'Checking numbers', indexed: 'Indexing', completed: 'Ready', rejected: 'Rejected', failed: 'Failed', cancelled: 'Cancelled',
};
export const IN_FLIGHT = new Set<ProcessingStatus>(['uploaded', 'queued', 'validating', 'extracting', 'ocr', 'structuring', 'validating_result', 'indexed']);
export const isInFlight = (s: ProcessingStatus): boolean => IN_FLIGHT.has(s);

export const REVIEW_LABEL: Record<ReviewStatus, string> = { not_required: 'Clear', pending: 'Needs review', reviewed: 'Reviewed' };
export const SEVERITY_LABEL: Record<Severity, string> = { error: 'Must fix', warning: 'Check', info: 'Note' };

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = n / 1024; let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

export function formatMoney(amount: string | null | undefined, currency: string | null | undefined): string {
  if (amount === null || amount === undefined) return '—';
  const n = Number(amount);
  if (!Number.isFinite(n)) return amount;
  try {
    return currency ? new Intl.NumberFormat('en', { style: 'currency', currency, currencyDisplay: 'code', minimumFractionDigits: 2 }).format(n) : n.toLocaleString('en', { minimumFractionDigits: 2 });
  } catch { return `${n.toLocaleString('en', { minimumFractionDigits: 2 })} ${currency ?? ''}`.trim(); }
}

const dtf = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' });
export const formatDateTime = (iso: string | null | undefined): string => (iso ? dtf.format(new Date(iso)) : '—');
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00Z` : iso);
  return Number.isNaN(d.getTime()) ? iso : new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' }).format(d);
}
export function relativeTime(iso: string, now = Date.now()): string {
  const s = Math.round((now - Date.parse(iso)) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
export const duration = (a: string, b: string | null): string => {
  if (!b) return 'running';
  const ms = Date.parse(b) - Date.parse(a);
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
};

export const FIELD_LABEL: Record<string, string> = {
  invoiceNumber: 'Invoice number', invoiceDate: 'Invoice date', supplierName: 'Supplier', customerName: 'Customer', subtotal: 'Subtotal',
  taxAmount: 'Tax', totalAmount: 'Total', currency: 'Currency', documentType: 'Document type', lineItems: 'Line items',
};
