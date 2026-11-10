import { describe, expect, it } from 'vitest';
import { duration, formatBytes, formatDate, formatMoney, relativeTime } from './format';

describe('format', () => {
  it('formats sizes', () => { expect(formatBytes(512)).toBe('512 B'); expect(formatBytes(1536)).toBe('1.5 KB'); expect(formatBytes(50 * 1024 * 1024)).toBe('50 MB'); });
  it('formats money with ISO codes and tolerates unknown currency', () => {
    expect(formatMoney('1100', 'USD').replace(/\u00a0/g, ' ')).toBe('USD 1,100.00');
    expect(formatMoney('-5.5', 'EUR')).toContain('5.50');
    expect(formatMoney(null, 'USD')).toBe('—');
    expect(formatMoney('12', null)).toBe('12.00');
  });
  it('formats ISO dates without timezone drift', () => { expect(formatDate('2026-03-15')).toBe('Mar 15, 2026'); expect(formatDate(null)).toBe('—'); });
  it('describes relative time and durations', () => {
    const now = Date.parse('2026-01-01T12:00:00Z');
    expect(relativeTime('2026-01-01T11:59:50Z', now)).toBe('just now');
    expect(relativeTime('2026-01-01T11:00:00Z', now)).toBe('1 h ago');
    expect(duration('2026-01-01T00:00:00Z', '2026-01-01T00:00:02.5Z')).toBe('2.5 s');
    expect(duration('2026-01-01T00:00:00Z', null)).toBe('running');
  });
});
