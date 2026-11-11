'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type CSSProperties, type FormEvent } from 'react';
import { BrandMark } from '@/components/icons';
import { safeNext } from '@/lib/safe-next';
import type { FieldError } from '@/lib/types';

function LoginForm() {
  const router = useRouter();
  const next = safeNext(useSearchParams().get('next'));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ message: string; errors: FieldError[] } | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true); setProblem(null);
    try {
      const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'docint' }, body: JSON.stringify({ email: f.get('email'), password: f.get('password') }) });
      const body = (await res.json().catch(() => null)) as { message?: string; errors?: FieldError[] } | null;
      if (res.ok) { router.replace(next); router.refresh(); return; }
      setProblem({ message: res.status === 429 ? 'Too many attempts. Wait a minute and try again.' : (body?.message ?? 'Sign-in failed.'), errors: body?.errors ?? [] });
    } catch { setProblem({ message: 'Cannot reach the server. Check your connection and try again.', errors: [] }); }
    finally { setBusy(false); }
  }
  const fieldMsg = (name: string) => problem?.errors.filter((x) => x.field === name).map((x) => x.message).join(' ');

  return (
    <div className="login-split">
      <aside className="login-art" aria-hidden="true">
        <div className="specimen">
          <div className="co">Dhaka Traders Ltd<small>ঢাকা ট্রেডার্স লিমিটেড</small></div>
          <div>
            <div className="kv"><span>চালান / Invoice</span><span className="hit" data-chip="invoiceNumber · 98%" style={{ '--d': '1.0s' } as CSSProperties}>INV-2026-0042</span></div>
            <div className="kv" style={{ marginTop: 30 }}><span>তারিখ / Date</span><span className="hit" data-chip="invoiceDate · 97%" style={{ '--d': '1.5s' } as CSSProperties}>2026-03-15</span></div>
          </div>
          <div className="ghosts"><i /><i /><i /><i /><i /></div>
          <div className="kv"><span>মোট / Total</span><span className="hit" data-chip="totalAmount · 99%" style={{ '--d': '2.4s' } as CSSProperties}>৳ 118,450.00</span></div>
          <div className="beam" />
        </div>
        <p className="tag">Every value shows where it was read, in English or বাংলা.</p>
      </aside>
      <div className="login-form">
        <form className="stack" onSubmit={submit} noValidate>
          <div className="mark"><BrandMark />DocIntel</div>
          <h1>Sign in</h1>
          <p className="muted">Invoices in, checked numbers out. Sign in to review what was extracted.</p>
          {problem && <div className="notice bad" role="alert">{problem.message}</div>}
          <label className="field">Email
            <input name="email" type="email" autoComplete="username" required aria-invalid={Boolean(fieldMsg('email'))} aria-describedby="email-err" />
            <span id="email-err" className="field-error">{fieldMsg('email')}</span>
          </label>
          <label className="field">Password
            <input name="password" type="password" autoComplete="current-password" required aria-invalid={Boolean(fieldMsg('password'))} aria-describedby="pw-err" />
            <span id="pw-err" className="field-error">{fieldMsg('password')}</span>
          </label>
          <button className="btn" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() { return <Suspense><LoginForm /></Suspense>; }
