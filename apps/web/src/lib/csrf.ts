import { NextResponse } from 'next/server';

/**
 * CSRF defence for cookie-authenticated mutations: the request must come from this origin AND carry a custom header
 * that cross-site forms cannot set (SameSite=Lax cookies are the first layer).
 */
export function assertSameOrigin(req: Request): NextResponse | null {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return null;
  const origin = req.headers.get('origin');
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  const sameOrigin = origin !== null && host !== null && new URL(origin).host === host;
  if (!sameOrigin || req.headers.get('x-requested-with') !== 'docint') {
    return NextResponse.json({ success: false, message: 'Cross-site request blocked', code: 'CSRF_BLOCKED', errors: [] }, { status: 403 });
  }
  return null;
}
