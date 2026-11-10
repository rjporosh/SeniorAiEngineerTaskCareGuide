import 'server-only';

/** Server-side only: where the BFF reaches the API on the private network. */
export const API_URL = (process.env.API_INTERNAL_URL ?? 'http://localhost:4000/api/v1').replace(/\/$/, '');
export const SECURE_COOKIES = process.env.COOKIE_SECURE === 'true';
export const ACCESS_COOKIE = 'docint_at';
export const REFRESH_COOKIE = 'docint_rt';
