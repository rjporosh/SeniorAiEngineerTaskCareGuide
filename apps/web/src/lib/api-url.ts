/**
 * Accepts `https://api.example.com/api/v1`, `http://api:3001`, or a bare `api:10000` (as hosting platforms provide for
 * private networking) and returns a base URL ending in /api/v1 without a trailing slash.
 */
export function normalizeApiUrl(raw: string): string {
  let url = raw.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//.test(url)) url = `http://${url}`;
  return /\/api\/v\d+$/.test(url) ? url : `${url}/api/v1`;
}
