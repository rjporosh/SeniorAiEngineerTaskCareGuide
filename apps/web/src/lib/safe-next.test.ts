import { describe, expect, it } from 'vitest';
import { safeNext } from './safe-next';

describe('safeNext', () => {
  it('allows same-site paths', () => { expect(safeNext('/documents?page=2')).toBe('/documents?page=2'); expect(safeNext('/')).toBe('/'); });
  it('blocks open redirects', () => {
    for (const bad of ['//evil.com', 'https://evil.com', '/\\evil.com', 'javascript:alert(1)', null, '']) expect(safeNext(bad)).toBe('/');
  });
});
