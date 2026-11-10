import { NextResponse } from 'next/server';
import { assertSameOrigin } from '@/lib/csrf';
import { API_URL } from '@/lib/server-config';
import { accessToken } from '@/lib/session';

export const dynamic = 'force-dynamic';

const ALLOWED = /^(documents|jobs|search|capabilities|auth\/me)(\/|$)/;
const PASS_HEADERS = ['content-type', 'idempotency-key', 'accept'];

async function forward(req: Request, ctx: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const { path } = await ctx.params;
  const target = path.join('/');
  if (!ALLOWED.test(target) || path.some((p) => p === '..' || p === '.')) return NextResponse.json({ success: false, message: 'Not found', code: 'NOT_FOUND', errors: [] }, { status: 404 });
  const blocked = assertSameOrigin(req);
  if (blocked) return blocked;
  const token = await accessToken();
  if (!token) return NextResponse.json({ success: false, message: 'Your session has expired. Sign in again.', code: 'UNAUTHENTICATED', errors: [] }, { status: 401 });

  const headers = new Headers({ authorization: `Bearer ${token}` });
  for (const h of PASS_HEADERS) { const v = req.headers.get(h); if (v) headers.set(h, v); }
  const cid = req.headers.get('x-correlation-id'); if (cid) headers.set('x-correlation-id', cid);
  const hasBody = !['GET', 'HEAD'].includes(req.method);
  const url = `${API_URL}/${target}${new URL(req.url).search}`;
  const upstream = await fetch(url, { method: req.method, headers, body: hasBody ? req.body : undefined, ...(hasBody && { duplex: 'half' }), redirect: 'manual', cache: 'no-store' } as RequestInit).catch(() => null);
  if (!upstream) return NextResponse.json({ success: false, message: 'The service is temporarily unavailable. Try again in a moment.', code: 'UPSTREAM_UNAVAILABLE', errors: [] }, { status: 502 });

  const out = new Headers();
  for (const h of ['content-type', 'content-length', 'content-disposition', 'x-correlation-id', 'x-content-type-options', 'content-security-policy']) { const v = upstream.headers.get(h); if (v) out.set(h, v); }
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

export { forward as GET, forward as POST, forward as PATCH, forward as DELETE };
