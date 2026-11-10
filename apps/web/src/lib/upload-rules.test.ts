import { describe, expect, it } from 'vitest';
import { validateClientSide } from './upload-rules';

describe('validateClientSide', () => {
  it('accepts supported types case-insensitively', () => {
    for (const n of ['a.pdf', 'B.PNG', 'c.TiFf', 'd.xlsx', 'e.csv', 'f.jpeg']) expect(validateClientSide({ name: n, size: 10 })).toBeNull();
  });
  it('explains why a file is not accepted', () => {
    expect(validateClientSide({ name: 'run.exe', size: 10 })).toMatch(/\.exe.*not supported/);
    expect(validateClientSide({ name: 'noext', size: 10 })).toMatch(/without an extension/);
    expect(validateClientSide({ name: 'a.pdf', size: 0 })).toMatch(/empty/);
    expect(validateClientSide({ name: 'a.pdf', size: 60 * 1024 * 1024 })).toMatch(/60 MB.*limit is 50 MB/);
  });
});
