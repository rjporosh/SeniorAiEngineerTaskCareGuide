// Concurrent uploads: measures acceptance latency and, in teardown, how long the worker takes to drain the backlog.
import http from 'k6/http';
import { check, sleep } from 'k6';
import { API, auth, loginOnce, pdf } from './lib.js';

export const options = {
  teardownTimeout: '300s',
  scenarios: { uploads: { executor: 'constant-arrival-rate', rate: 5, timeUnit: '1s', duration: '40s', preAllocatedVUs: 20, maxVUs: 60 } },
  thresholds: { http_req_failed: ['rate<0.01'], 'http_req_duration{name:upload}': ['p(95)<1500'] },
};
const PENDING = ['queued', 'validating', 'extracting', 'ocr', 'structuring', 'validating_result', 'indexed', 'uploaded'];
const pendingCount = (token) => { const s = http.get(`${API}/documents/stats`, auth(token)).json('data'); return PENDING.reduce((n, k) => n + (s.byStatus[k] || 0), 0); };

export function setup() {
  const token = loginOnce();
  // Pre-existing in-flight documents (if any) must not be mistaken for this run's backlog.
  return { token, baseline: pendingCount(token) };
}
export default ({ token }) => {
  const file = http.file(pdf(`${__VU}-${__ITER}-${Date.now()}`), `load-${__VU}-${__ITER}.pdf`, 'application/pdf');
  const res = http.post(`${API}/documents`, { files: file }, { ...auth(token), tags: { name: 'upload' } });
  check(res, { 'upload 201': (r) => r.status === 201 });
  sleep(0.1);
};
export function teardown({ token, baseline }) {
  const started = Date.now();
  for (let i = 0; i < 280; i++) {
    if (pendingCount(token) <= baseline) { console.log(`backlog drained ${Math.round((Date.now() - started) / 1000)}s after the last upload (200 documents uploaded)`); return; }
    sleep(1);
  }
  console.log('backlog was not fully drained within 280s');
}
