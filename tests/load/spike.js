// Sudden surge and recovery: the service must stay correct and recover to normal latency.
import { sleep } from 'k6';
import { loginOnce, userJourney } from './lib.js';

export const options = {
  stages: [{ duration: '15s', target: 5 }, { duration: '5s', target: 150 }, { duration: '30s', target: 150 }, { duration: '5s', target: 5 }, { duration: '30s', target: 5 }],
  thresholds: { http_req_failed: ['rate<0.05'] },
};
export const setup = () => loginOnce();
export default (token) => { userJourney(token); sleep(0.2); };
