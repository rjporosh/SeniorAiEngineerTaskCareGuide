import { describe, expect, it } from 'vitest';
import { splitEvidence } from './evidence';

describe('splitEvidence', () => {
  it('highlights an exact, case-insensitive match', () => {
    expect(splitEvidence('Invoice No: INV-2026-0042', 'inv-2026-0042')).toEqual({ before: 'Invoice No: ', match: 'INV-2026-0042', after: '' });
  });
  it('matches formatted amounts to their canonical value', () => {
    expect(splitEvidence('Total Due: USD 1,100.00', '1100')?.match).toBe('1,100.00');
    expect(splitEvidence('Total: 1.190,00 €', '1190')?.match).toBe('1.190,00');
    expect(splitEvidence('Subtotal: 90.50', '90.5')?.match).toBe('90.50');
  });
  it('returns null when there is nothing to highlight', () => {
    expect(splitEvidence('Date: 03/04/2026', null)).toBeNull();
    expect(splitEvidence('no digits here', '55')).toBeNull();
  });
});
