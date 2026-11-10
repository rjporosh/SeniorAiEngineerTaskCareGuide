import { describe, expect, it } from 'vitest';
import { detectCurrency, parseAmount, parseDate } from './normalizers.js';

describe('parseAmount', () => {
  it.each([
    ['1,234.56', '1234.56'], ['1.234,56', '1234.56'], ['$ 1,100.00', '1100'], ['USD 99.5', '99.5'], ['1 234,50', '1234.5'],
    ['(100.00)', '-100'], ['-12.30', '-12.3'], ['12.30-', '-12.3'], ['1,234', '1234'], ['1,234,567.89', '1234567.89'],
    ['0.00', '0'], ['৳ 5,000', '5000'], ['12,5', '12.5'], ["1'234.50", '1234.5'],
  ])('%s -> %s', (raw, out) => expect(parseAmount(raw)).toBe(out));
  it.each(['', 'abc', 'N/A', '1.2.3.x', '--', '12e3'])('rejects %j', (raw) => expect(parseAmount(raw)).toBeNull());
  it('is exact (no float drift)', () => expect(parseAmount('0.1')).toBe('0.1'));
});

describe('parseDate', () => {
  it.each([
    ['2026-03-15', '2026-03-15'], ['2026/3/5', '2026-03-05'], ['15 March 2026', '2026-03-15'], ['March 15, 2026', '2026-03-15'],
    ['15-Mar-2026', '2026-03-15'], ['25/12/2025', '2025-12-25'], ['12/25/2025', '2025-12-25'], ['1st Jan 2026', '2026-01-01'], ['03/03/2026', '2026-03-03'],
  ])('%s -> %s', (raw, iso) => expect(parseDate(raw)).toEqual({ kind: 'iso', value: iso }));
  it('flags ambiguous numeric dates instead of guessing', () => {
    expect(parseDate('03/04/2026')).toEqual({ kind: 'ambiguous', raw: '03/04/2026' });
  });
  it('flags impossible dates', () => {
    expect(parseDate('2026-02-30').kind).toBe('invalid');
    expect(parseDate('31/04/2026').kind).toBe('invalid');
    expect(parseDate('not a date').kind).toBe('invalid');
  });
});

describe('detectCurrency', () => {
  it('uses explicit ISO codes and unambiguous symbols only', () => {
    expect(detectCurrency('Total: 10.00 EUR')).toBe('EUR');
    expect(detectCurrency('£ 10')).toBe('GBP');
    expect(detectCurrency('$ 10')).toBeNull();
    expect(detectCurrency('¥ 10')).toBeNull();
    expect(detectCurrency('Invoice for services')).toBeNull();
  });
});
