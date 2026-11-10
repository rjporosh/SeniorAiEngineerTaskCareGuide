import { hashEmbedding } from '../domain/embedding.js';
import type { InvoiceData, NewChunk } from '../domain/types.js';
import type { Block } from './processor.types.js';

const WINDOW = 1200; const OVERLAP = 150; const MAX_ROWS_PER_CHUNK = 25;

/** Splits text into overlapping windows, preferring line boundaries. */
export function windows(text: string, size = WINDOW, overlap = OVERLAP): string[] {
  const t = text.trim();
  if (t.length <= size) return t ? [t] : [];
  const out: string[] = [];
  let start = 0;
  while (start < t.length) {
    let end = Math.min(t.length, start + size);
    if (end < t.length) { const nl = t.lastIndexOf('\n', end); if (nl > start + size / 2) end = nl; }
    out.push(t.slice(start, end).trim());
    if (end >= t.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return out.filter(Boolean);
}

const isHeaderRow = (b: Block) => (b.cells?.length ?? 0) >= 2 && b.cells!.every((c) => !/^-?[\d.,]+$/.test(c.value.trim()));

/** Row line: `Sheet!A2:E2 — Header: value | Header: value`. Parsed back by recordFromChunkLine(). */
function rowLine(b: Block, headers: string[] | undefined): string {
  const body = (b.cells ?? []).map((c, i) => (headers?.[i] ? `${headers[i]}: ${c.value}` : c.value)).join(' | ');
  return `${b.sheet ?? ''}!${b.range ?? ''} — ${body}`;
}

/** Page text becomes overlapping windows; spreadsheet rows are grouped (with their header labels) and keep sheet/range coordinates. */
export function chunkBlocks(blocks: Block[]): Omit<NewChunk, 'embedding'>[] {
  const chunks: Omit<NewChunk, 'embedding'>[] = [];
  const push = (c: Omit<NewChunk, 'chunkIndex' | 'embedding'>) => chunks.push({ ...c, chunkIndex: chunks.length });
  const headers = new Map<string, string[]>();
  let group: { sheet: string; lines: string[]; first: string; last: string } | null = null;
  const flush = () => {
    if (group) push({ page: null, sheet: group.sheet, range: `${group.first}:${group.last}`, content: group.lines.join('\n') });
    group = null;
  };
  for (const b of blocks) {
    if (b.kind === 'text') {
      flush();
      for (const w of windows(b.text)) push({ page: b.page ?? null, sheet: null, range: null, content: w });
      continue;
    }
    const sheet = b.sheet ?? '';
    if (!headers.has(sheet) && isHeaderRow(b)) { headers.set(sheet, (b.cells ?? []).map((c) => c.value.trim())); continue; }
    const line = rowLine(b, headers.get(sheet));
    const [first = '', last = ''] = (b.range ?? '').split(':');
    if (group && (group.sheet !== sheet || group.lines.length >= MAX_ROWS_PER_CHUNK || group.lines.join('\n').length + line.length > WINDOW * 2)) flush();
    group ??= { sheet, lines: [], first, last };
    group.lines.push(line);
    group.last = last || first;
  }
  flush();
  return chunks;
}

/** First-class searchable summary of the extracted header fields (supplier, number, totals). */
export function summaryChunk(d: InvoiceData, index: number): NewChunk | null {
  const parts = [
    d.invoiceNumber && `Invoice ${d.invoiceNumber}`, d.supplierName && `Supplier ${d.supplierName}`, d.customerName && `Customer ${d.customerName}`,
    d.invoiceDate && `Date ${d.invoiceDate}`, d.totalAmount && `Total ${d.totalAmount}${d.currency ? ` ${d.currency}` : ''}`,
  ].filter((p): p is string => Boolean(p));
  if (parts.length === 0) return null;
  const content = parts.join(' | ');
  return { chunkIndex: index, page: null, sheet: null, range: 'summary', content, embedding: hashEmbedding(content) };
}
