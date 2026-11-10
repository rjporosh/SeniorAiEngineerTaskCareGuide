import { NextResponse } from 'next/server';
import { API_URL } from '@/lib/server-config';
import { writeSession, type Session } from '@/lib/session';
import { assertSameOrigin } from '@/lib/csrf';

export async function POST(req: Request) {
  const blocked = assertSameOrigin(req);
  if (blocked) return blocked;
  const res = await fetch(`${API_URL}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': req.headers.get('x-forwarded-for') ?? '' }, body: await req.text(), cache: 'no-store' });
  const body = (await res.json().catch(() => null)) as { data?: Session & { user: unknown } } & Record<string, unknown> | null;
  if (!res.ok || !body?.data) return NextResponse.json(body ?? { success: false, message: 'Sign-in failed', errors: [] }, { status: res.status || 502 });
  await writeSession(body.data);
  return NextResponse.json({ success: true, data: { user: body.data.user } });
}
