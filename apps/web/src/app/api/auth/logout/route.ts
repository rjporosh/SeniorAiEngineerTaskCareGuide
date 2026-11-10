import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { API_URL, REFRESH_COOKIE } from '@/lib/server-config';
import { clearSession } from '@/lib/session';
import { assertSameOrigin } from '@/lib/csrf';

export async function POST(req: Request) {
  const blocked = assertSameOrigin(req);
  if (blocked) return blocked;
  const rt = (await cookies()).get(REFRESH_COOKIE)?.value;
  if (rt) await fetch(`${API_URL}/auth/logout`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken: rt }), cache: 'no-store' }).catch(() => undefined);
  await clearSession();
  return NextResponse.json({ success: true, data: null });
}
