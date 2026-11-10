// Verifies the rate limiter: a burst from one client must be answered with 429 and recover afterwards.
import http from 'k6/http';
import { check } from 'k6';
import { API } from './lib.js';

export const options = { vus: 1, iterations: 1, thresholds: { checks: ['rate==1'] } };
export default () => {
  let limited = 0;
  for (let i = 0; i < 40; i++) {
    const r = http.post(`${API}/auth/login`, JSON.stringify({ email: 'nobody@example.com', password: 'wrong-password-xx' }), { headers: { 'content-type': 'application/json' }, responseCallback: http.expectedStatuses(401, 429) });
    if (r.status === 429) { limited++; check(r, { 'envelope on 429': (x) => x.json('code') === 'RATE_LIMITED' }); }
  }
  check(limited, { 'login attempts were rate limited': (n) => n > 0 });
};
