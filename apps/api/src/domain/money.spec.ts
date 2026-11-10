import { describe, expect, it } from 'vitest';
import { Decimal, minorUnits, parseDecimal, withinTolerance } from './money.js';

describe('money', () => {
  it('avoids binary floating point errors', () => {
    expect(new Decimal('0.1').plus('0.2').equals('0.3')).toBe(true);
  });
  it('parses only well-formed decimals', () => {
    expect(parseDecimal('1234.50')?.toString()).toBe('1234.5');
    expect(parseDecimal('1,234.50')).toBeNull();
    expect(parseDecimal('NaN')).toBeNull();
    expect(parseDecimal('1e9')).toBeNull();
    expect(parseDecimal(null)).toBeNull();
  });
  it('knows minor units', () => {
    expect(minorUnits('USD')).toBe(2);
    expect(minorUnits('JPY')).toBe(0);
    expect(minorUnits('KWD')).toBe(3);
  });
  it('applies a currency-aware tolerance', () => {
    expect(withinTolerance(new Decimal('10.00'), new Decimal('10.004'), 'USD')).toBe(true);
    expect(withinTolerance(new Decimal('10.00'), new Decimal('10.02'), 'USD')).toBe(false);
    expect(withinTolerance(new Decimal('100'), new Decimal('100.4'), 'JPY')).toBe(true);
  });
});
