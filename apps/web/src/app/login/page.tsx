'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
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
    <div className="login-wrap">
      <form className="sheet stack" onSubmit={submit} noValidate>
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
  );
}

export default function LoginPage() { return <Suspense><LoginForm /></Suspense>; }
