import { detectCurrency, parseAmount, parseDate } from './normalizers.js';
import { COMPANY_SUFFIX_RE, DUE_DATE_RE, LABELLED_LINE_RE, LABELS, SUBTOTAL_RE, TAX_RE, TOTAL_PRIORITY } from './labels.js';
import { normalizeKey } from '../domain/normalize.js';
import type { Evidence, InvoiceData, InvoiceField, LineItem } from '../domain/types.js';
import type { Block, ProcessResponse } from '../processing/processor.types.js';
import type { ExtractionNote, ExtractionResult, InvoiceExtractorPort } from './types.js';

interface Line { text: string; page: number | null; sheet: string | null; ref: string | null; confidence: number | null }
const AMOUNT_RE = /[-(−]?\s*(?:[A-Za-z]{3}\s*)?[$€£¥₹৳]?\s*\d{1,3}(?:[ ,.']\d{3})+(?:[.,]\d{1,2})?\)?-?|[-(−]?\s*[$€£¥₹৳]?\s*\d+(?:[.,]\d{1,2})?\)?-?/;
const DATE_RE = /\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}(?:st|nd|rd|th)?[-/. ][A-Za-z]{3,9}[-/. ,]+\d{4}|[A-Za-z]{3,9}\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}|\d{1,2}[-/.]\d{1,2}[-/.]\d{4}/;
const INVOICE_NO_LINE_RE = /\b(?:tax\s+)?(?:invoice|inv|bill|credit\s+note)\s*(?:no\.?|number|num|#|id|ref)?\s*[:#.\-]*\s*([A-Z0-9][A-Z0-9\-/_.]{2,40})/i;
const NUMBER_RE = /\b([A-Z0-9][A-Z0-9\-/_.]{1,40})\b/i;

const clip = (s: string, n = 200) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function toLines(blocks: Block[]): Line[] {
  const out: Line[] = [];
  for (const b of blocks) {
    if (b.kind === 'text') {
      for (const raw of b.text.split(/\r?\n/)) {
        const text = raw.replace(/\s+/g, ' ').trim();
        if (text) out.push({ text, page: b.page ?? null, sheet: null, ref: null, confidence: b.confidence ?? null });
      }
    } else if (b.cells && b.cells.length >= 2) {
      const [label, ...rest] = b.cells;
      out.push({ text: `${label!.value}: ${rest.map((c) => c.value).join(' ')}`, page: null, sheet: b.sheet ?? null, ref: rest[0]!.ref, confidence: null });
    }
  }
  return out;
}

const evidence = (l: Line): Evidence => ({ sourcePage: l.page, sourceSheet: l.sheet, sourceCell: l.ref, text: clip(l.text) });

/** Text after the first `:` / `-` / `#` separator, or after a label match. */
function remainder(line: string, label: RegExp): string | null {
  const m = label.exec(line);
  if (!m) return null;
  return line.slice(m.index + m[0].length).replace(/^[\s:#\-–.]+/, '').trim();
}

function valueAfterLabel(lines: Line[], i: number, label: RegExp): { value: string; line: Line } | null {
  const line = lines[i]!;
  const rest = remainder(line.text, label);
  if (rest === null) return null;
  if (rest.length > 0) return { value: rest, line };
  const next = lines[i + 1];
  return next && next.page === line.page ? { value: next.text, line: next } : null;
}

export type Tabular = { headers: Map<number, string>; header: Block; rows: Block[]; sheet: string };

function colOf(ref: string): number {
  let n = 0;
  for (const ch of /^[A-Z]+/.exec(ref)?.[0] ?? '') n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

/** Finds a header row (invoice-number column, or description+quantity columns) and the rows below it. */
export function findTables(blocks: Block[]): { invoices: Tabular | null; lines: Tabular | null } {
  let invoices: Tabular | null = null; let lines: Tabular | null = null;
  const rows = blocks.filter((b) => b.kind === 'row' && b.cells);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    const labels = r.cells!.map((c) => c.value.trim());
    const sheet = r.sheet ?? '';
    const below = () => rows.slice(i + 1).filter((x) => x.sheet === r.sheet);
    if (!invoices && labels.some((l) => LABELS.invoiceNumber.test(l)) && labels.length >= 2 && !labels.some((l) => /:$/.test(l))) {
      invoices = { headers: new Map(r.cells!.map((c) => [colOf(c.ref), c.value.trim()])), header: r, rows: below(), sheet };
    } else if (!lines && labels.some((l) => LABELS.description.test(l)) && labels.some((l) => LABELS.quantity.test(l))) {
      lines = { headers: new Map(r.cells!.map((c) => [colOf(c.ref), c.value.trim()])), header: r, rows: below(), sheet };
    }
  }
  return { invoices, lines };
}

const cellsByHeader = (t: Tabular, row: Block): { header: string; cell: { ref: string; value: string } }[] =>
  (row.cells ?? []).flatMap((cell) => { const header = t.headers.get(colOf(cell.ref)); return header ? [{ header, cell }] : []; });

function emptyData(): InvoiceData {
  return {
    schemaVersion: '1.0', documentType: 'unknown', invoiceNumber: null, invoiceDate: null, supplierName: null, customerName: null,
    subtotal: null, taxAmount: null, totalAmount: null, currency: null, lineItems: [], fieldEvidence: {}, fieldConfidence: {}, requiresManualReview: true,
  };
}

export class RulesInvoiceExtractor implements InvoiceExtractorPort {
  readonly info = { provider: 'rules', version: '1.0.0', promptVersion: 'n/a' };

  extract(input: ProcessResponse): ExtractionResult {
    const data = emptyData();
    const notes: ExtractionNote[] = [];
    const all = toLines(input.blocks);
    const lines = this.firstInvoiceOnly(all, notes);
    const tables = findTables(input.blocks);

    const set = (field: InvoiceField, value: string, line: Line) => {
      (data as unknown as Record<string, unknown>)[field] = value;
      data.fieldEvidence[field] = evidence(line);
      data.fieldConfidence[field] = line.confidence;
    };

    this.documentType(data, lines);
    if (tables.invoices) this.fromInvoiceTable(tables.invoices, data, notes, set);
    this.fromLines(lines, data, notes, set);
    data.lineItems = tables.lines ? this.tableLineItems(tables.lines) : this.textLineItems(lines);
    this.currency(lines, data, set);
    return { data, notes };
  }

  /**
   * A file may hold several invoices (e.g. a multi-frame TIFF). Extract from the first one only and report the rest,
   * instead of letting a later invoice silently overwrite totals.
   */
  private firstInvoiceOnly(lines: Line[], notes: ExtractionNote[]): Line[] {
    const seen: { key: string; index: number }[] = [];
    lines.forEach((l, index) => {
      if (l.page === null) return;
      const m = INVOICE_NO_LINE_RE.exec(l.text);
      const key = m && /\d/.test(m[1]!) && !/^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$/.test(m[1]!) ? normalizeKey(m[1]) : null;
      if (key && !seen.some((s) => s.key === key)) seen.push({ key, index });
    });
    if (seen.length < 2) return lines;
    const second = seen[1]!;
    const firstPage = lines[seen[0]!.index]!.page;
    const secondPage = lines[second.index]!.page;
    const cut = secondPage !== firstPage ? lines.findIndex((l) => l.page === secondPage) : second.index;
    notes.push({ code: 'MULTIPLE_INVOICES', detail: { count: seen.length } });
    return lines.slice(0, cut);
  }

  private documentType(data: InvoiceData, lines: Line[]): void {
    const head = lines.slice(0, 15).map((l) => l.text).join('\n');
    if (/credit\s+(?:note|memo)/i.test(head)) data.documentType = 'credit_note';
    else if (/\binvoice\b/i.test(head) || lines.some((l) => LABELS.invoiceNumber.test(l.text))) data.documentType = 'invoice';
  }

  private fromInvoiceTable(t: Tabular, data: InvoiceData, notes: ExtractionNote[], set: (f: InvoiceField, v: string, l: Line) => void): void {
    const records = t.rows.filter((r) => cellsByHeader(t, r).length > 0);
    if (records.length > 1) { notes.push({ code: 'MULTIPLE_RECORDS', detail: { count: records.length, sheet: t.sheet } }); data.documentType = 'unknown'; return; }
    const row = records[0];
    if (!row) return;
    for (const { header, cell } of cellsByHeader(t, row)) {
      const line: Line = { text: `${header}: ${cell.value}`, page: null, sheet: row.sheet ?? null, ref: cell.ref, confidence: null };
      this.assign(header, cell.value, line, data, notes, set);
    }
  }

  /** Assigns a labelled value to the right field, applying normalisation and recording notes. */
  private assign(label: string, value: string, line: Line, data: InvoiceData, notes: ExtractionNote[], set: (f: InvoiceField, v: string, l: Line) => void): boolean {
    const v = value.trim();
    if (!v) return false;
    if (LABELS.invoiceNumber.test(label) && !data.invoiceNumber) {
      const m = NUMBER_RE.exec(v);
      if (m && /\d/.test(m[1]!)) { set('invoiceNumber', m[1]!, line); return true; }
    } else if (LABELS.invoiceDate.test(label) && !DUE_DATE_RE.test(label) && !data.invoiceDate) {
      return this.date(v, line, data, notes, set);
    } else if (LABELS.supplier.test(label) && !data.supplierName) { set('supplierName', v, line); return true; }
    else if (LABELS.customer.test(label) && !data.customerName) { set('customerName', v, line); return true; }
    else if (LABELS.currency.test(label) && !data.currency) {
      const c = detectCurrency(v);
      if (c) { set('currency', c, line); return true; }
    } else if (LABELS.subtotal.test(label)) return this.money('subtotal', v, line, data, notes, set);
    else if (LABELS.tax.test(label)) return this.money('taxAmount', v, line, data, notes, set);
    else if (LABELS.total.test(label)) return this.money('totalAmount', v, line, data, notes, set);
    return false;
  }

  private date(v: string, line: Line, data: InvoiceData, notes: ExtractionNote[], set: (f: InvoiceField, v: string, l: Line) => void): boolean {
    const raw = DATE_RE.exec(v)?.[0];
    if (!raw) return false;
    const p = parseDate(raw);
    if (p.kind === 'iso') { set('invoiceDate', p.value, line); return true; }
    data.fieldEvidence.invoiceDate = evidence(line);
    data.fieldConfidence.invoiceDate = null;
    notes.push({ code: p.kind === 'ambiguous' ? 'DATE_AMBIGUOUS' : 'DATE_UNPARSEABLE', field: 'invoiceDate', raw });
    return true;
  }

  private money(field: 'subtotal' | 'taxAmount' | 'totalAmount', v: string, line: Line, data: InvoiceData, notes: ExtractionNote[], set: (f: InvoiceField, v: string, l: Line) => void): boolean {
    if (data[field] !== null) return false;
    const token = AMOUNT_RE.exec(v)?.[0];
    const amount = token ? parseAmount(token) : null;
    if (amount === null) { if (/\d/.test(v)) notes.push({ code: 'AMOUNT_UNPARSEABLE', field, raw: clipRaw(v) }); return false; }
    set(field, amount, line);
    return true;
  }

  private fromLines(lines: Line[], data: InvoiceData, notes: ExtractionNote[], set: (f: InvoiceField, v: string, l: Line) => void): void {
    let bestTotal: { rank: number; amount: string; line: Line } | null = null;
    lines.forEach((line, i) => {
      const text = line.text;
      if (!data.invoiceNumber) {
        const m = INVOICE_NO_LINE_RE.exec(text);
        if (m && /\d/.test(m[1]!) && !/^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$/.test(m[1]!)) set('invoiceNumber', m[1]!.replace(/[.\-/_]+$/, ''), line);
      }
      if (!data.invoiceDate) {
        const m = /^(invoice\s+date|date\s+of\s+issue|issue\s+date|date\s+issued|billing\s+date|date)\b/i.exec(text);
        if (m && !DUE_DATE_RE.test(m[0])) this.date(text.slice(m[0].length), line, data, notes, set);
      }
      if (!data.supplierName) {
        const m = /^(from|supplier|vendor|seller|issued\s+by|sold\s+by)\b\s*[:\-]/i.exec(text);
        const v = m ? valueAfterLabel(lines, i, /^(?:from|supplier|vendor|seller|issued\s+by|sold\s+by)\b\s*[:\-]?/i) : null;
        if (v?.value) set('supplierName', v.value, v.line);
      }
      if (!data.customerName) {
        const m = /^(bill(?:ed)?\s+to|customer|client|sold\s+to|buyer)\b\s*[:\-]?/i.exec(text);
        const v = m ? valueAfterLabel(lines, i, /^(?:bill(?:ed)?\s+to|customer|client|sold\s+to|buyer)\b\s*[:\-]?/i) : null;
        if (v?.value && !/^\d/.test(v.value)) set('customerName', v.value, v.line);
      }
      if (data.subtotal === null && SUBTOTAL_RE.test(text)) this.money('subtotal', text.replace(SUBTOTAL_RE, ''), line, data, notes, set);
      else if (data.taxAmount === null && TAX_RE.test(text)) this.money('taxAmount', text.replace(TAX_RE, '').replace(/^\s*[:\-]?\s*/, ''), line, data, notes, set);
      for (const { re, rank } of TOTAL_PRIORITY) {
        const m = re.exec(text);
        if (!m || SUBTOTAL_RE.test(text)) continue;
        const token = AMOUNT_RE.exec(text.slice(m.index + m[0].length).replace(/^[\s:\-]+/, ''))?.[0];
        const amount = token ? parseAmount(token) : null;
        if (amount !== null && (!bestTotal || rank >= bestTotal.rank)) bestTotal = { rank, amount, line };
        break;
      }
    });
    if (bestTotal && data.totalAmount === null) set('totalAmount', (bestTotal as { amount: string }).amount, (bestTotal as { line: Line }).line);
    if (!data.supplierName) {
      const first = lines.slice(0, 8).find((l) => l.page !== null && COMPANY_SUFFIX_RE.test(l.text) && !LABELLED_LINE_RE.test(l.text) && !/\d{3,}/.test(l.text) && l.text.length <= 80 && !/\binvoice\b/i.test(l.text));
      if (first) set('supplierName', first.text, first);
    }
  }

  private currency(lines: Line[], data: InvoiceData, set: (f: InvoiceField, v: string, l: Line) => void): void {
    if (data.currency) return;
    const totalLine = data.fieldEvidence.totalAmount?.text;
    const near = lines.find((l) => l.text === totalLine || (totalLine && l.text.startsWith(totalLine.slice(0, 60))));
    const code = (near && detectCurrency(near.text)) ?? null;
    if (code && near) { set('currency', code, near); return; }
    const counts = new Map<string, { n: number; line: Line }>();
    for (const l of lines) { const c = detectCurrency(l.text); if (c) counts.set(c, { n: (counts.get(c)?.n ?? 0) + 1, line: counts.get(c)?.line ?? l }); }
    const top = [...counts.entries()].sort((a, b) => b[1].n - a[1].n);
    if (top.length === 1 || (top.length > 1 && top[0]![1].n > top[1]![1].n)) set('currency', top[0]![0], top[0]![1].line);
  }

  private tableLineItems(t: Tabular): LineItem[] {
    const items: LineItem[] = [];
    for (const row of t.rows) {
      const item: LineItem = { description: null, quantity: null, unitPrice: null, taxAmount: null, lineTotal: null };
      for (const { header, cell } of cellsByHeader(t, row)) {
        if (LABELS.description.test(header)) item.description = cell.value;
        else if (LABELS.quantity.test(header)) item.quantity = parseAmount(cell.value);
        else if (LABELS.unitPrice.test(header)) item.unitPrice = parseAmount(cell.value);
        else if (LABELS.lineTax.test(header)) item.taxAmount = parseAmount(cell.value);
        else if (LABELS.lineTotal.test(header)) item.lineTotal = parseAmount(cell.value);
      }
      if (item.description && (item.quantity || item.unitPrice || item.lineTotal)) items.push(item);
      else if (items.length > 0 && /total/i.test(row.text)) break;
    }
    return items;
  }

  private textLineItems(lines: Line[]): LineItem[] {
    const header = lines.findIndex((l) => /description/i.test(l.text) && /\b(?:qty|quantity)\b/i.test(l.text));
    if (header < 0) return [];
    const items: LineItem[] = [];
    for (const l of lines.slice(header + 1)) {
      if (SUBTOTAL_RE.test(l.text) || TOTAL_PRIORITY.some((p) => p.re.test(l.text)) || TAX_RE.test(l.text)) break;
      const m = /^(.+?)\s+(\d+(?:[.,]\d+)?)\s+([\d.,]+)\s+([\d.,]+)$/.exec(l.text);
      if (!m) continue;
      const [, description, qty, unit, total] = m;
      items.push({ description: description!, quantity: parseAmount(qty!), unitPrice: parseAmount(unit!), taxAmount: null, lineTotal: parseAmount(total!) });
    }
    return items;
  }
}

const clipRaw = (s: string) => (s.length > 60 ? s.slice(0, 60) : s);
