import { describe, expect, it } from 'vitest';
import type { DocumentRecord, InvoiceData, ResultRecord } from '../domain/types.js';
import { invoiceFixture } from '../testing/fixtures.js';
import { compareInvoices } from './compare.js';
import { ISSUE, validateInvoice } from './validator.js';

const codes = (d: InvoiceData, ctx = {}) => validateInvoice(d, { now: new Date('2026-06-01T00:00:00Z'), ...ctx }).issues.map((i) => i.code);
const good = invoiceFixture({ lineItems: [{ description: 'W', quantity: '2', unitPrice: '50.00', taxAmount: null, lineTotal: '100.00' }] });

describe('validateInvoice', () => {
  it('passes a clean invoice with no review needed', () => {
    const r = validateInvoice(good, { now: new Date('2026-06-01T00:00:00Z') });
    expect(r.issues.filter((i) => i.severity !== 'info')).toEqual([]);
    expect(r.requiresManualReview).toBe(false);
  });

  it('reports every missing required field at once', () => {
    const r = validateInvoice(invoiceFixture({ invoiceNumber: null, invoiceDate: null, supplierName: null, totalAmount: null, currency: null, subtotal: null, taxAmount: null, lineItems: [] }));
    const missing = r.issues.filter((i) => i.code === ISSUE.MISSING_REQUIRED && i.severity === 'error').flatMap((i) => i.fields);
    expect(missing.sort()).toEqual(['currency', 'invoiceDate', 'invoiceNumber', 'supplierName', 'totalAmount']);
    expect(r.requiresManualReview).toBe(true);
  });

  it('checks subtotal + tax = total with currency-aware tolerance', () => {
    expect(codes(invoiceFixture({ subtotal: '100.00', taxAmount: '10.00', totalAmount: '110.00' }))).not.toContain(ISSUE.TOTAL_MISMATCH);
    expect(codes(invoiceFixture({ subtotal: '100.00', taxAmount: '10.00', totalAmount: '111.00' }))).toContain(ISSUE.TOTAL_MISMATCH);
    expect(codes(invoiceFixture({ currency: 'JPY', subtotal: '100', taxAmount: '10', totalAmount: '111' }))).toContain(ISSUE.TOTAL_MISMATCH);
    expect(codes(invoiceFixture({ currency: 'USD', subtotal: '100.00', taxAmount: '10.00', totalAmount: '110.004' }))).not.toContain(ISSUE.TOTAL_MISMATCH);
  });

  it('is exact with decimals (0.1 + 0.2 = 0.3)', () => {
    expect(codes(invoiceFixture({ subtotal: '0.1', taxAmount: '0.2', totalAmount: '0.3', lineItems: [] }))).not.toContain(ISSUE.TOTAL_MISMATCH);
  });

  it('compares line items with subtotal and with quantity × price', () => {
    const bad = invoiceFixture({ lineItems: [{ description: 'W', quantity: '2', unitPrice: '50.00', taxAmount: null, lineTotal: '90.00' }] });
    const c = codes(bad);
    expect(c).toContain(ISSUE.LINE_SUM_MISMATCH);
    expect(c).toContain(ISSUE.LINE_ARITHMETIC_MISMATCH);
  });

  it('falls back to total - tax when no subtotal is present', () => {
    expect(codes(invoiceFixture({ subtotal: null, lineItems: [{ description: 'W', quantity: null, unitPrice: null, taxAmount: null, lineTotal: '99.00' }] }))).toContain(ISSUE.LINE_SUM_MISMATCH);
  });

  it('allows negatives only on credit notes', () => {
    const neg = { subtotal: '-100.00', taxAmount: '-10.00', totalAmount: '-110.00', lineItems: [] };
    expect(codes(invoiceFixture({ ...neg, documentType: 'invoice' }))).toContain(ISSUE.NEGATIVE_AMOUNT);
    expect(codes(invoiceFixture({ ...neg, documentType: 'credit_note' }))).not.toContain(ISSUE.NEGATIVE_AMOUNT);
  });

  it('flags invalid currency, malformed numbers and suspicious dates', () => {
    expect(codes(invoiceFixture({ currency: 'ZZZ' }))).toContain(ISSUE.INVALID_CURRENCY);
    expect(codes(invoiceFixture({ totalAmount: '12,5x' }))).toContain(ISSUE.INVALID_AMOUNT);
    expect(codes(invoiceFixture({ invoiceDate: '2030-01-01' }))).toContain(ISSUE.DATE_SUSPICIOUS);
    expect(codes(invoiceFixture({ invoiceDate: '2026-02-30' }))).toContain(ISSUE.INVALID_DATE);
  });

  it('turns extraction notes into issues that require review', () => {
    const r = validateInvoice(invoiceFixture({ invoiceDate: null }), { notes: [{ code: 'DATE_AMBIGUOUS', field: 'invoiceDate', raw: '03/04/2026' }] });
    expect(r.issues.map((i) => i.code)).toContain(ISSUE.DATE_AMBIGUOUS);
    expect(r.requiresManualReview).toBe(true);
  });

  it('flags low-confidence critical fields only when a confidence exists', () => {
    expect(codes(invoiceFixture({ fieldConfidence: { totalAmount: 0.4 } }))).toContain(ISSUE.LOW_CONFIDENCE_FIELD);
    expect(codes(invoiceFixture({ fieldConfidence: { totalAmount: null } }))).not.toContain(ISSUE.LOW_CONFIDENCE_FIELD);
  });

  it('reports duplicate candidates with reasons and never auto-decides', () => {
    const other = invoiceFixture();
    const dup = { document: { id: 'd1', originalFilename: 'old.pdf' } as DocumentRecord, result: { current: other } as ResultRecord };
    const r = validateInvoice(good, { duplicates: [dup], now: new Date('2026-06-01T00:00:00Z') });
    const d = r.issues.find((i) => i.code === ISSUE.DUPLICATE_INVOICE_CANDIDATE)!;
    expect(d.details['reasons']).toEqual(['same invoice number', 'same supplier', 'same invoice date', 'same total']);
    expect(r.requiresManualReview).toBe(true);
  });

  it('reports cross-document mismatches with field-level differences, and matches as info', () => {
    const mismatch = compareInvoices(good, invoiceFixture({ totalAmount: '115.00' }));
    const r = validateInvoice(good, { crossDocuments: [{ documentId: 'x', filename: 'ledger.xlsx', location: 'Invoices!A2:E2', comparison: mismatch }], now: new Date('2026-06-01T00:00:00Z') });
    const m = r.issues.find((i) => i.code === ISSUE.CROSS_DOCUMENT_MISMATCH)!;
    expect(m.fields).toEqual(['totalAmount']);
    expect(r.requiresManualReview).toBe(true);
    const ok = validateInvoice(good, { crossDocuments: [{ documentId: 'x', filename: 'ledger.xlsx', location: null, comparison: compareInvoices(good, good) }], now: new Date('2026-06-01T00:00:00Z') });
    expect(ok.issues.find((i) => i.code === ISSUE.CROSS_DOCUMENT_MATCH)?.severity).toBe('info');
    expect(ok.requiresManualReview).toBe(false);
  });

  it('treats multi-record spreadsheets as informational, not as a failed invoice', () => {
    const r = validateInvoice(invoiceFixture({ documentType: 'unknown', invoiceNumber: null, invoiceDate: null, supplierName: null, totalAmount: null, currency: null, subtotal: null, taxAmount: null, lineItems: [] }), { notes: [{ code: 'MULTIPLE_RECORDS', detail: { count: 3 } }] });
    expect(r.issues.map((i) => i.code)).toEqual([ISSUE.MULTIPLE_RECORDS]);
    expect(r.requiresManualReview).toBe(false);
  });
});

describe('compareInvoices', () => {
  it('ignores fields missing on either side and tolerates formatting in names', () => {
    const c = compareInvoices(invoiceFixture({ customerName: null }), invoiceFixture({ supplierName: 'ACME SUPPLIES LTD.' }));
    expect(c.differences).toEqual([]);
    expect(c.compared).not.toContain('customerName');
  });
});
