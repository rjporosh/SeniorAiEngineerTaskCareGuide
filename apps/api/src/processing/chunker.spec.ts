import { describe, expect, it } from 'vitest';
import { recordFromChunkLine, recordsFromBlocks } from '../extraction/records.js';
import { invoiceFixture } from '../testing/fixtures.js';
import { rowBlock, textPage } from '../testing/blocks.js';
import { chunkBlocks, summaryChunk, windows } from './chunker.js';

describe('windows', () => {
  it('returns one chunk for short text and overlapping chunks for long text', () => {
    expect(windows('short')).toEqual(['short']);
    const long = Array.from({ length: 200 }, (_, i) => `line ${i} with some words in it`).join('\n');
    const w = windows(long, 500, 100);
    expect(w.length).toBeGreaterThan(5);
    expect(w.every((c) => c.length <= 500)).toBe(true);
    expect(w[0]!.slice(-20)).not.toBe('');
    const joined = w.join('\n');
    for (let i = 0; i < 200; i += 17) expect(joined).toContain(`line ${i} with`);
  });
  it('terminates on text without newlines', () => {
    expect(windows('x'.repeat(5000), 1200, 150).length).toBeGreaterThan(3);
  });
});

describe('chunkBlocks', () => {
  it('keeps page coordinates for text blocks', () => {
    const c = chunkBlocks([textPage(1, 'first page text'), textPage(2, 'second page text')]);
    expect(c.map((x) => [x.page, x.chunkIndex])).toEqual([[1, 0], [2, 1]]);
  });
  it('groups spreadsheet rows with header labels and keeps sheet/range coordinates', () => {
    const c = chunkBlocks([rowBlock('Invoices', 1, ['Invoice No', 'Supplier', 'Total']), rowBlock('Invoices', 2, ['INV-1', 'Acme', '100.5']), rowBlock('Invoices', 3, ['INV-2', 'Beta', '9'])]);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ sheet: 'Invoices', range: 'A2:C3', page: null });
    expect(c[0]!.content.split('\n')[0]).toBe('Invoices!A2:C2 — Invoice No: INV-1 | Supplier: Acme | Total: 100.5');
  });
});

describe('row records', () => {
  it('round-trips a row chunk line into an invoice record', () => {
    const rec = recordFromChunkLine('Invoices!A2:C2 — Invoice No: INV-1 | Supplier: Acme | Total: 100.5')!;
    expect(rec.location).toBe('Invoices!A2:C2');
    expect(rec.data).toMatchObject({ invoiceNumber: 'INV-1', supplierName: 'Acme', totalAmount: '100.5' });
    expect(recordFromChunkLine('not a row line')).toBeNull();
  });
  it('lists one record per invoice row', () => {
    const recs = recordsFromBlocks([rowBlock('L', 1, ['Invoice No', 'Total']), rowBlock('L', 2, ['A-1', '1']), rowBlock('L', 3, ['A-2', '2'])]);
    expect(recs.map((r) => r.data.invoiceNumber)).toEqual(['A-1', 'A-2']);
  });
});

describe('summaryChunk', () => {
  it('summarises header fields and skips empty extractions', () => {
    expect(summaryChunk(invoiceFixture(), 9)?.content).toBe('Invoice INV-1001 | Supplier Acme Supplies Ltd | Customer Globex | Date 2026-03-15 | Total 110.00 USD');
    expect(summaryChunk(invoiceFixture({ invoiceNumber: null, supplierName: null, customerName: null, invoiceDate: null, totalAmount: null }), 0)).toBeNull();
  });
});
