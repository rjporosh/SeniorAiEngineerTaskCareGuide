// Steps load upward to find where latency or errors break. Thresholds are deliberately loose: the output is the finding.
import { sleep } from 'k6';
import { loginOnce, userJourney } from './lib.js';

export const options = {
  stages: [{ duration: '30s', target: 25 }, { duration: '30s', target: 50 }, { duration: '30s', target: 100 }, { duration: '30s', target: 200 }, { duration: '20s', target: 0 }],
  thresholds: { http_req_failed: ['rate<0.05'], http_req_duration: ['p(99)<5000'] },
};
export const setup = () => loginOnce();
export default (token) => { userJourney(token); sleep(0.2); };
