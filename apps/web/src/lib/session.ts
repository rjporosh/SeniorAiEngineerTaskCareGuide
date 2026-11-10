import 'server-only';
import { cookies } from 'next/headers';
import { ACCESS_COOKIE, API_URL, REFRESH_COOKIE, SECURE_COOKIES } from './server-config';

export interface Session { accessToken: string; refreshToken: string; expiresIn: number }
const base = { httpOnly: true, sameSite: 'lax' as const, secure: SECURE_COOKIES, path: '/' };

export async function writeSession(s: Session, jar?: Awaited<ReturnType<typeof cookies>>): Promise<void> {
  const store = jar ?? (await cookies());
  store.set(ACCESS_COOKIE, s.accessToken, { ...base, maxAge: Math.max(1, s.expiresIn - 5) });
  store.set(REFRESH_COOKIE, s.refreshToken, { ...base, path: '/api', maxAge: 7 * 24 * 3600 });
}
export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.delete(ACCESS_COOKIE);
  store.delete({ name: REFRESH_COOKIE, path: '/api' });
}

/** Returns a valid access token, refreshing it with the rotating refresh token when the cookie has expired. */
export async function accessToken(): Promise<string | null> {
  const store = await cookies();
  const at = store.get(ACCESS_COOKIE)?.value;
  if (at) return at;
  const rt = store.get(REFRESH_COOKIE)?.value;
  if (!rt) return null;
  const res = await fetch(`${API_URL}/auth/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken: rt }), cache: 'no-store' });
  if (!res.ok) { await clearSession().catch(() => undefined); return null; }
  const body = (await res.json()) as { data: Session };
  await writeSession(body.data, store);
  return body.data.accessToken;
}
