#!/usr/bin/env node
/**
 * Verifies a running deployment end to end through the public web address:
 *   node scripts/check-deployment.mjs --web https://your-web --email demo@docint.example --password '…' [--wait 120]
 * Checks: sign-in page, sign-in through the BFF (HttpOnly cookies), an upload, processing to a terminal state, the extraction result.
 * Exit code 0 only if every step passed.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const WEB = (opt('--web', 'http://localhost:4001')).replace(/\/$/, '');
const EMAIL = opt('--email', process.env.DEMO_EMAIL); const PASSWORD = opt('--password', process.env.DEMO_PASSWORD);
const WAIT_S = Number(opt('--wait', 120));
if (!EMAIL || !PASSWORD) { console.error('Provide --email and --password (or DEMO_EMAIL / DEMO_PASSWORD).'); process.exit(2); }

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const jar = new Map();
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
function remember(res) { for (const c of res.headers.getSetCookie?.() ?? []) { const [pair] = c.split(';'); const i = pair.indexOf('='); if (/max-age=0|expires=thu, 01 jan 1970/i.test(c)) jar.delete(pair.slice(0, i)); else jar.set(pair.slice(0, i), pair.slice(i + 1)); } }
async function call(path, init = {}) {
  const res = await fetch(`${WEB}${path}`, { ...init, redirect: 'manual', headers: { origin: WEB, 'x-requested-with': 'docint', cookie: cookieHeader(), ...(init.headers ?? {}) } });
  remember(res);
  return res;
}
let failed = false;
const step = (ok, label, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? `  (${extra})` : ''}`); if (!ok) failed = true; return ok; };

// 1. web is up (a sleeping free instance can take a minute to wake)
let up = false; const t0 = Date.now();
while (Date.now() - t0 < WAIT_S * 1000 && !up) { try { up = (await fetch(`${WEB}/login`)).ok; } catch { /* waking up */ } if (!up) await new Promise((r) => setTimeout(r, 3000)); }
if (!step(up, 'web sign-in page responds', `${Math.round((Date.now() - t0) / 1000)}s`)) process.exit(1);

// 2. sign in through the BFF
const login = await call('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) });
if (!step(login.status === 200 && jar.has('docint_at'), 'sign-in sets HttpOnly session cookies', `HTTP ${login.status}`)) process.exit(1);
const me = await (await call('/api/proxy/auth/me')).json();
step(me.success === true, 'session is accepted by the API', me.data?.role);

// 3. upload a synthetic invoice (unique invoice number so duplicate detection stays quiet)
const pdf = readFileSync(join(root, 'fixtures/synthetic/digital-01.pdf'));
const form = new FormData(); form.append('files', new Blob([pdf]), `deploy-check-${Date.now()}.pdf`);
const up1 = await call('/api/proxy/documents', { method: 'POST', body: form, headers: { 'idempotency-key': `deploy-check-${Date.now()}-${Math.random().toString(36).slice(2)}` } });
const upBody = await up1.json();
const id = upBody.data?.documents?.[0]?.id;
if (!step(up1.status === 201 && id, 'upload accepted', `HTTP ${up1.status}`)) process.exit(1);

// 4. wait for processing
let doc; const t1 = Date.now();
while (Date.now() - t1 < WAIT_S * 1000) {
  doc = (await (await call(`/api/proxy/documents/${id}`)).json()).data;
  if (['completed', 'failed', 'rejected'].includes(doc?.processingStatus)) break;
  await new Promise((r) => setTimeout(r, 2000));
}
step(doc?.processingStatus === 'completed', 'document processed', `${doc?.processingStatus}, ${Math.round((Date.now() - t1) / 1000)}s${doc?.failure ? `, ${doc.failure.code}` : ''}`);

// 5. result has the expected invoice number
const result = (await (await call(`/api/proxy/documents/${id}/result`)).json()).data;
const inv = result?.result?.extraction;
step(Boolean(inv?.invoiceNumber) && Boolean(inv?.totalAmount), 'extraction result is present', inv ? `${inv.invoiceNumber}, ${inv.currency ?? '?'} ${inv.totalAmount}` : 'none');

// 6. search finds it
const found = await (await call(`/api/proxy/search?q=${encodeURIComponent(inv?.invoiceNumber ?? 'invoice')}`)).json();
step((found.data?.total ?? 0) > 0, 'search finds the document', `${found.data?.total ?? 0} hit(s)`);

console.log(failed ? '\nDEPLOYMENT CHECK FAILED' : '\nDEPLOYMENT CHECK PASSED');
process.exit(failed ? 1 : 0);
