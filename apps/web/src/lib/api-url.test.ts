import { describe, expect, it } from 'vitest';
import { normalizeApiUrl } from './api-url';

describe('normalizeApiUrl', () => {
  it('keeps a complete URL and trims slashes', () => {
    expect(normalizeApiUrl('https://api.example.com/api/v1/')).toBe('https://api.example.com/api/v1');
    expect(normalizeApiUrl('http://api:3001/api/v1')).toBe('http://api:3001/api/v1');
  });
  it('completes scheme and path for platform-provided host:port values', () => {
    expect(normalizeApiUrl('docint-api:10000')).toBe('http://docint-api:10000/api/v1');
    expect(normalizeApiUrl('https://docint-api.onrender.com')).toBe('https://docint-api.onrender.com/api/v1');
  });
});
