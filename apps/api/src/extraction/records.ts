import { columnLetter } from './columns.js';
import { findTables, RulesInvoiceExtractor } from './rules-extractor.js';
import type { InvoiceData } from '../domain/types.js';
import type { Block, ProcessResponse } from '../processing/processor.types.js';

export interface InvoiceRecord { location: string; data: InvoiceData }
const MAX_RECORDS = 500;
const extractor = new RulesInvoiceExtractor();

const response = (blocks: Block[]): ProcessResponse => ({
  file_kind: 'xlsx', blocks, warnings: [], stats: { pages: 0, embedded_pages: 0, ocr_pages: 0, sheets: 1, rows: blocks.length, duration_ms: 0 },
});
const row = (sheet: string, n: number, cells: { ref: string; value: string }[]): Block => ({
  id: `r${n}`, kind: 'row', sheet, range: `${cells[0]!.ref}:${cells.at(-1)!.ref}`, text: cells.map((c) => c.value).join(' | '), source: 'cell', cells,
});

/** One extracted invoice per data row of a tabular sheet that has an invoice-number column. */
export function recordsFromBlocks(blocks: Block[]): InvoiceRecord[] {
  const t = findTables(blocks).invoices;
  if (!t) return [];
  const out: InvoiceRecord[] = [];
  for (const r of t.rows) {
    if (out.length >= MAX_RECORDS) break;
    if (!r.cells?.some((c) => t.headers.has(colIndex(c.ref)))) continue;
    const { data } = extractor.extract(response([t.header, r]));
    if (data.invoiceNumber) out.push({ location: `${t.sheet}!${r.range ?? ''}`, data });
  }
  return out;
}

const colIndex = (ref: string): number => {
  let n = 0;
  for (const ch of /^[A-Z]+/.exec(ref)?.[0] ?? '') n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
};

/** Parses a stored row chunk line (`Sheet!A2:E2 — Header: value | Header: value`) back into an invoice record. */
export function recordFromChunkLine(line: string): InvoiceRecord | null {
  const m = /^(.+?)!([A-Z]+\d+:[A-Z]+\d+) — (.+)$/.exec(line);
  if (!m) return null;
  const [, sheet, range, body] = m;
  const pairs = body!.split(' | ').map((p) => { const i = p.indexOf(': '); return i < 0 ? null : ([p.slice(0, i), p.slice(i + 2)] as const); }).filter((p): p is readonly [string, string] => p !== null);
  if (pairs.length < 2) return null;
  const rowNo = /\d+/.exec(range!.split(':')[0]!)?.[0] ?? '1';
  const header = row(sheet!, 0, pairs.map(([h], i) => ({ ref: `${columnLetter(i + 1)}1`, value: h })));
  const values = row(sheet!, 1, pairs.map(([, v], i) => ({ ref: `${columnLetter(i + 1)}${rowNo}`, value: v })));
  const { data } = extractor.extract(response([header, values]));
  return data.invoiceNumber ? { location: `${sheet}!${range}`, data } : null;
}
