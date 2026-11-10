const PATTERNS: [RegExp, string][] = [
  [/\b(Bearer|Basic)(\s+)[A-Za-z0-9._~+/=-]+/gi, '$1$2[REDACTED]'],
  [/(:\/\/[^:@/\s]+:)[^@/\s]+@/g, '$1[REDACTED]@'],
  [/((?:password|passwd|secret|token|api[_-]?key)["']?\s*[:=]\s*["']?)[^"'\s,;&]+/gi, '$1[REDACTED]'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[REDACTED_JWT]'],
];
/** Scrubs credentials from free text before it reaches any log sink. */
export const redactString = (s: string): string => PATTERNS.reduce((acc, [re, to]) => acc.replace(re, to), s);

export const REDACT_PATHS = [
  'req.headers.authorization', 'req.headers.cookie', '*.password', '*.passwordHash', '*.token', '*.accessToken', '*.refreshToken', '*.secret', '*.authorization',
];
