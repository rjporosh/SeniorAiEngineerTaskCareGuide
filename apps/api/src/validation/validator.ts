import { Decimal, minorUnits, parseDecimal, withinTolerance } from '../domain/money.js';
import type { DocumentRecord, InvoiceData, NewIssue, ResultRecord } from '../domain/types.js';
import type { ExtractionNote } from '../extraction/types.js';
import { compareInvoices, type Comparison } from './compare.js';
import { normalizeKey } from '../domain/normalize.js';

export const ISSUE = {
  MISSING_REQUIRED: 'MISSING_REQUIRED', INVALID_DATE: 'INVALID_DATE', DATE_AMBIGUOUS: 'DATE_AMBIGUOUS', DATE_SUSPICIOUS: 'DATE_SUSPICIOUS',
  INVALID_CURRENCY: 'INVALID_CURRENCY', INVALID_AMOUNT: 'INVALID_AMOUNT', NEGATIVE_AMOUNT: 'NEGATIVE_AMOUNT', IMPLAUSIBLE_AMOUNT: 'IMPLAUSIBLE_AMOUNT',
  TOTAL_MISMATCH: 'TOTAL_MISMATCH', LINE_SUM_MISMATCH: 'LINE_SUM_MISMATCH', LINE_ARITHMETIC_MISMATCH: 'LINE_ARITHMETIC_MISMATCH',
  DUPLICATE_INVOICE_CANDIDATE: 'DUPLICATE_INVOICE_CANDIDATE', DUPLICATE_FILE: 'DUPLICATE_FILE', CROSS_DOCUMENT_MISMATCH: 'CROSS_DOCUMENT_MISMATCH',
  CROSS_DOCUMENT_MATCH: 'CROSS_DOCUMENT_MATCH', LOW_CONFIDENCE_FIELD: 'LOW_CONFIDENCE_FIELD', MULTIPLE_RECORDS: 'MULTIPLE_RECORDS', MULTIPLE_INVOICES: 'MULTIPLE_INVOICES', NOT_AN_INVOICE: 'NOT_AN_INVOICE',
} as const;

export const REQUIRED_FIELDS = ['invoiceNumber', 'invoiceDate', 'supplierName', 'totalAmount', 'currency'] as const;
const CRITICAL_FOR_CONFIDENCE = ['invoiceNumber', 'invoiceDate', 'supplierName', 'subtotal', 'taxAmount', 'totalAmount', 'currency'] as const;
const CURRENCIES = new Set(Intl.supportedValuesOf('currency'));
/** Strict YYYY-MM-DD check: rejects rolled-over dates such as 2026-02-30. */
export function isCalendarDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!));
  return d.getUTCFullYear() === +m[1]! && d.getUTCMonth() === +m[2]! - 1 && d.getUTCDate() === +m[3]!;
}
export const isIsoCurrency = (c: string): boolean => CURRENCIES.has(c);

export interface CrossDocumentMatch { documentId: string; filename: string; location: string | null; comparison: Comparison }
export interface ValidationContext {
  notes?: ExtractionNote[];
  duplicates?: { document: DocumentRecord; result: ResultRecord }[];
  sameFile?: DocumentRecord[];
  crossDocuments?: CrossDocumentMatch[];
  now?: Date;
  minConfidence?: number;
}
export interface ValidationOutcome { issues: NewIssue[]; requiresManualReview: boolean }

const issue = (code: string, severity: NewIssue['severity'], message: string, fields: string[] = [], details: Record<string, unknown> = {}): NewIssue =>
  ({ code, severity, message, fields, details });

/** Pure, deterministic business validation. Every finding has a stable code, severity, affected fields and safe details. */
export function validateInvoice(data: InvoiceData, ctx: ValidationContext = {}): ValidationOutcome {
  const out: NewIssue[] = [];
  const now = ctx.now ?? new Date();
  const notes = ctx.notes ?? [];
  const isCredit = data.documentType === 'credit_note';

  if (notes.some((n) => n.code === 'MULTIPLE_RECORDS')) {
    const n = notes.find((x) => x.code === 'MULTIPLE_RECORDS');
    out.push(issue(ISSUE.MULTIPLE_RECORDS, 'info', 'This spreadsheet contains several invoice records; they are searchable and used for cross-document checks, but no single invoice was extracted.', [], n?.detail ?? {}));
  } else if (data.documentType === 'unknown' && REQUIRED_FIELDS.every((f) => data[f] === null)) {
    out.push(issue(ISSUE.NOT_AN_INVOICE, 'warning', 'No invoice fields could be identified in this document.'));
  } else {
    for (const f of REQUIRED_FIELDS) {
      if (data[f] === null) out.push(issue(ISSUE.MISSING_REQUIRED, 'error', `Required field "${f}" could not be extracted.`, [f]));
    }
  }
  if (data.customerName === null && data.documentType !== 'unknown') out.push(issue(ISSUE.MISSING_REQUIRED, 'info', 'Customer name was not found.', ['customerName']));

  const multi = notes.find((n) => n.code === 'MULTIPLE_INVOICES');
  if (multi) out.push(issue(ISSUE.MULTIPLE_INVOICES, 'warning', `This file contains ${String(multi.detail?.['count'])} different invoices. Only the first was extracted; split the file to process the others.`, [], multi.detail ?? {}));

  // dates
  for (const n of notes) {
    if (n.code === 'DATE_AMBIGUOUS') out.push(issue(ISSUE.DATE_AMBIGUOUS, 'warning', `The date "${n.raw}" can be read as day/month or month/day. Confirm the correct date.`, ['invoiceDate'], { raw: n.raw }));
    if (n.code === 'DATE_UNPARSEABLE') out.push(issue(ISSUE.INVALID_DATE, 'error', `The date "${n.raw}" is not a valid calendar date.`, ['invoiceDate'], { raw: n.raw }));
    if (n.code === 'AMOUNT_UNPARSEABLE') out.push(issue(ISSUE.INVALID_AMOUNT, 'error', `The amount "${n.raw}" could not be read.`, n.field ? [n.field] : [], { raw: n.raw }));
  }
  if (data.invoiceDate) {
    const d = new Date(`${data.invoiceDate}T00:00:00Z`);
    if (!isCalendarDate(data.invoiceDate)) out.push(issue(ISSUE.INVALID_DATE, 'error', `"${data.invoiceDate}" is not a valid date.`, ['invoiceDate']));
    else if (d.getTime() - now.getTime() > 86_400_000 * 2) out.push(issue(ISSUE.DATE_SUSPICIOUS, 'warning', 'The invoice date is in the future.', ['invoiceDate'], { date: data.invoiceDate }));
    else if (now.getTime() - d.getTime() > 86_400_000 * 366 * 10) out.push(issue(ISSUE.DATE_SUSPICIOUS, 'warning', 'The invoice date is more than ten years old.', ['invoiceDate'], { date: data.invoiceDate }));
  }
  if (data.currency && !isIsoCurrency(data.currency)) out.push(issue(ISSUE.INVALID_CURRENCY, 'error', `"${data.currency}" is not a valid ISO 4217 currency code.`, ['currency']));

  // amounts
  const money = {
    subtotal: parseDecimal(data.subtotal), taxAmount: parseDecimal(data.taxAmount), totalAmount: parseDecimal(data.totalAmount),
  };
  for (const f of ['subtotal', 'taxAmount', 'totalAmount'] as const) {
    if (data[f] !== null && money[f] === null) out.push(issue(ISSUE.INVALID_AMOUNT, 'error', `"${f}" is not a valid number.`, [f]));
    const v = money[f];
    if (!v) continue;
    if (v.isNegative() && !isCredit) out.push(issue(ISSUE.NEGATIVE_AMOUNT, 'error', `"${f}" is negative on a document that is not a credit note.`, [f], { value: data[f] }));
    if (v.abs().gt('1000000000000')) out.push(issue(ISSUE.IMPLAUSIBLE_AMOUNT, 'warning', `"${f}" is implausibly large.`, [f], { value: data[f] }));
  }
  if (money.totalAmount?.isZero() && !isCredit) out.push(issue(ISSUE.IMPLAUSIBLE_AMOUNT, 'warning', 'The total amount is zero.', ['totalAmount']));

  // arithmetic
  const { subtotal, taxAmount, totalAmount } = money;
  if (subtotal && taxAmount && totalAmount) {
    const expected = subtotal.plus(taxAmount);
    if (!withinTolerance(expected, totalAmount, data.currency)) {
      out.push(issue(ISSUE.TOTAL_MISMATCH, 'error', `Subtotal + tax (${expected.toFixed()}) does not equal the total (${totalAmount.toFixed()}).`, ['subtotal', 'taxAmount', 'totalAmount'],
        { expected: expected.toFixed(), found: totalAmount.toFixed(), difference: totalAmount.minus(expected).toFixed() }));
    }
  }
  const lineTotals = data.lineItems.map((l) => parseDecimal(l.lineTotal));
  const known = lineTotals.filter((x): x is Decimal => x !== null);
  if (known.length > 0 && known.length === data.lineItems.length) {
    const sum = known.reduce((a, b) => a.plus(b), new Decimal(0));
    const target = subtotal ?? (totalAmount && taxAmount ? totalAmount.minus(taxAmount) : null);
    const label = subtotal ? 'subtotal' : 'total minus tax';
    // allow one minor unit of rounding per line
    if (target && !withinTolerance(sum, target, data.currency, Math.max(1, data.lineItems.length))) {
      out.push(issue(ISSUE.LINE_SUM_MISMATCH, 'error', `The line items add up to ${sum.toFixed()} but the ${label} is ${target.toFixed()}.`, ['lineItems', subtotal ? 'subtotal' : 'totalAmount'],
        { lineSum: sum.toFixed(), expected: target.toFixed(), difference: sum.minus(target).toFixed() }));
    }
  }
  data.lineItems.forEach((l, i) => {
    const q = parseDecimal(l.quantity); const u = parseDecimal(l.unitPrice); const t = parseDecimal(l.lineTotal);
    if (q && u && t && !withinTolerance(q.mul(u), t, data.currency)) {
      out.push(issue(ISSUE.LINE_ARITHMETIC_MISMATCH, 'warning', `Line ${i + 1}: quantity × unit price (${q.mul(u).toFixed()}) does not equal the line total (${t.toFixed()}).`, [`lineItems.${i}`],
        { line: i + 1, expected: q.mul(u).toFixed(), found: t.toFixed() }));
    }
  });

  // confidence (only where the extractor can report a meaningful value)
  const min = ctx.minConfidence ?? 0.6;
  for (const f of CRITICAL_FOR_CONFIDENCE) {
    const c = data.fieldConfidence[f];
    if (data[f] !== null && typeof c === 'number' && c < min) out.push(issue(ISSUE.LOW_CONFIDENCE_FIELD, 'warning', `Low OCR confidence (${c.toFixed(2)}) for "${f}". Please verify against the source.`, [f], { confidence: c }));
  }

  // duplicates and cross-document comparison
  for (const dup of ctx.duplicates ?? []) out.push(duplicateIssue(data, dup));
  for (const f of ctx.sameFile ?? []) {
    out.push(issue(ISSUE.DUPLICATE_FILE, 'info', `This exact file was already uploaded as "${f.originalFilename}".`, [], { documentId: f.id }));
  }
  out.push(...crossDocumentIssues(ctx.crossDocuments ?? [], data.currency));

  return { issues: out, requiresManualReview: out.some((i) => i.severity !== 'info') };
}

/** Issues describing how this document compares with the same invoice found elsewhere (e.g. PDF vs spreadsheet row). */
export function crossDocumentIssues(matches: CrossDocumentMatch[], currency: string | null): NewIssue[] {
  const out: NewIssue[] = [];
  for (const x of matches) {
    const c = x.comparison;
    if (c.differences.length > 0) {
      out.push(issue(ISSUE.CROSS_DOCUMENT_MISMATCH, 'warning', `Values differ from "${x.filename}" (${c.differences.map((d) => d.field).join(', ')}).`, c.differences.map((d) => d.field),
        { documentId: x.documentId, filename: x.filename, location: x.location, matched: c.matched, differences: c.differences, toleranceMinorUnits: minorUnits(currency) }));
    } else if (c.compared.length >= 2) {
      out.push(issue(ISSUE.CROSS_DOCUMENT_MATCH, 'info', `Matches "${x.filename}" on ${c.matched.join(', ')}.`, c.matched, { documentId: x.documentId, filename: x.filename, location: x.location }));
    }
  }
  return out;
}

/** A possible duplicate of `dup`. Never merges or deletes anything; lists why the two look alike and how they differ. */
export function duplicateIssue(data: InvoiceData, dup: { document: DocumentRecord; result: ResultRecord }): NewIssue {
  const other = dup.result.current;
  const reasons = ['same invoice number'];
  if (normalizeKey(data.supplierName) && normalizeKey(data.supplierName) === normalizeKey(other.supplierName)) reasons.push('same supplier');
  if (data.invoiceDate && data.invoiceDate === other.invoiceDate) reasons.push('same invoice date');
  const a = parseDecimal(data.totalAmount); const b = parseDecimal(other.totalAmount);
  if (a && b && withinTolerance(a, b, data.currency)) reasons.push('same total');
  return issue(ISSUE.DUPLICATE_INVOICE_CANDIDATE, 'warning', `Possible duplicate of "${dup.document.originalFilename}" (${reasons.join(', ')}). Nothing was merged or deleted.`, ['invoiceNumber'],
    { documentId: dup.document.id, filename: dup.document.originalFilename, reasons, differences: compareInvoices(data, other).differences });
}
