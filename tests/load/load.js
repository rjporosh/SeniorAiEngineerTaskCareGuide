// Steady, realistic read traffic. Fails the run if p95 latency or the error rate regress.
import { sleep } from 'k6';
import { loginOnce, userJourney } from './lib.js';

export const options = {
  stages: [{ duration: '20s', target: 20 }, { duration: '60s', target: 20 }, { duration: '10s', target: 0 }],
  thresholds: { http_req_failed: ['rate<0.01'], 'http_req_duration{name:list}': ['p(95)<500'], 'http_req_duration{name:search}': ['p(95)<800'], 'http_req_duration{name:result}': ['p(95)<500'], checks: ['rate>0.99'] },
};
export const setup = () => loginOnce();
export default (token) => { userJourney(token); sleep(0.5); };
