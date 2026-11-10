import http from 'k6/http';
import { check, fail } from 'k6';

export const API = __ENV.API_URL || 'http://host.docker.internal:4000/api/v1';

/** One login for the whole test (the login endpoint is rate limited by design). */
export function loginOnce() {
  const res = http.post(`${API}/auth/login`, JSON.stringify({ email: __ENV.ADMIN_EMAIL, password: __ENV.ADMIN_PASSWORD }), { headers: { 'content-type': 'application/json' } });
  if (!check(res, { 'login 200': (r) => r.status === 200 })) fail(`login failed: ${res.status} ${res.body}`);
  return res.json('data.accessToken');
}

export const auth = (token) => ({ headers: { authorization: `Bearer ${token}` } });

/** Tiny valid PDF with a unique invoice so duplicate detection does not dominate the run. */
export function pdf(n) {
  return `%PDF-1.4\n1 0 obj<<>>endobj\nINVOICE_LOAD ${n}\n%%EOF`;
}
export const userJourney = (token) => {
  const h = auth(token);
  const list = http.get(`${API}/documents?pageSize=20&sortBy=createdAt&sortDir=desc`, { ...h, tags: { name: 'list' } });
  check(list, { 'list 200': (r) => r.status === 200 });
  const q = http.get(`${API}/search?q=invoice`, { ...h, tags: { name: 'search' } });
  check(q, { 'search 200': (r) => r.status === 200 });
  const stats = http.get(`${API}/documents/stats`, { ...h, tags: { name: 'stats' } });
  check(stats, { 'stats 200': (r) => r.status === 200 });
  const first = list.json('data.items.0.id');
  if (first) {
    const d = http.get(`${API}/documents/${first}/result`, { ...h, tags: { name: 'result' } });
    check(d, { 'result 200': (r) => r.status === 200 });
  }
};
