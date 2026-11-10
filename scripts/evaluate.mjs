#!/usr/bin/env node
/**
 * Reproducible evaluation against a running stack.
 *
 *   node scripts/evaluate.mjs                 # full labelled dataset, writes docs/evaluation-report.md
 *   node scripts/evaluate.mjs --smoke         # 6 representative files, asserts only, writes nothing
 *   node scripts/evaluate.mjs --api http://localhost:4000/api/v1
 *
 * Admin credentials come from SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD (environment or .env).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { cpus, totalmem, platform, release } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const smoke = flag('--smoke');
const API = opt('--api', 'http://localhost:4000/api/v1');
const TIMEOUT_MS = Number(opt('--timeout', 300_000));

function env(name) {
  if (process.env[name]) return process.env[name];
  const f = join(root, '.env');
  if (!existsSync(f)) return undefined;
  const m = new RegExp(`^${name}=(.*)$`, 'm').exec(readFileSync(f, 'utf8'));
  return m?.[1];
}

const dataset = JSON.parse(readFileSync(join(root, 'fixtures/synthetic/labels.json'), 'utf8'));
let docs = dataset.documents;
if (smoke) docs = ['digital-01.pdf', 'scanned-01.pdf', 'image-01.png', 'sheet-01.xlsx', 'export-01.csv', 'corrupt.pdf'].map((f) => docs.find((d) => d.file === f));

const FIELDS = ['invoiceNumber', 'invoiceDate', 'supplierName', 'customerName', 'subtotal', 'taxAmount', 'totalAmount', 'currency'];
const AMOUNTS = new Set(['subtotal', 'taxAmount', 'totalAmount']);
const norm = (f, v) => (v === null || v === undefined ? null : AMOUNTS.has(f) ? Number(v).toFixed(4) : String(v).trim().toLowerCase().replace(/[.,]+$/, ''));
const pct = (n, d) => (d === 0 ? 'n/a' : `${((100 * n) / d).toFixed(1)}%`);
const quantile = (xs, q) => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)]; };
const ms = (v) => (Number.isNaN(v) ? 'n/a' : `${Math.round(v)} ms`);

async function call(path, init = {}, token) {
  const res = await fetch(`${API}${path}`, { ...init, headers: { ...(init.headers ?? {}), ...(token ? { authorization: `Bearer ${token}` } : {}) } });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

const email = env('SEED_ADMIN_EMAIL'); const password = env('SEED_ADMIN_PASSWORD');
if (!email || !password) { console.error('SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD are required (set them in .env).'); process.exit(2); }
const login = await call('/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
if (login.status !== 200) { console.error(`login failed (${login.status})`); process.exit(2); }
const adminToken = login.body.data.accessToken;

// Fresh, isolated uploader account per run: duplicate detection is owner-scoped, so earlier runs cannot pollute this one.
const runId = `eval-${Date.now()}`;
const evalEmail = `${runId}@example.com`; const evalPassword = `${runId}-Pw-${Math.random().toString(36).slice(2)}`;
const created = await call('/auth/users', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: evalEmail, password: evalPassword, role: 'uploader' }) }, adminToken);
if (created.status !== 201) { console.error('could not create the evaluation user', created.status); process.exit(2); }
const evalLogin = await call('/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: evalEmail, password: evalPassword }) });
const token = evalLogin.body.data.accessToken;

// ---- upload in batches of 20 (the default per-request limit) ----
const run = runId;
const idByFile = new Map();
const t0 = Date.now();
for (let i = 0; i < docs.length; i += 20) {
  const batch = docs.slice(i, i + 20);
  const form = new FormData();
  for (const d of batch) form.append('files', new Blob([readFileSync(join(root, 'fixtures/synthetic', d.file))]), d.file);
  const r = await call('/documents', { method: 'POST', body: form, headers: { 'idempotency-key': `${run}-batch-${i}` } }, token);
  if (r.status !== 201) { console.error('upload failed', r.status, JSON.stringify(r.body?.errors ?? r.body)); process.exit(1); }
  for (const a of r.body.data.documents) idByFile.set(a.filename, a.id);
  for (const x of r.body.data.rejected) console.log(`rejected at upload: ${x.filename} (${x.code})`);
}

// ---- wait for terminal states ----
const TERMINAL = new Set(['completed', 'failed', 'rejected', 'cancelled']);
const states = new Map();
const deadline = Date.now() + TIMEOUT_MS;
while (states.size < idByFile.size && Date.now() < deadline) {
  for (const [file, id] of idByFile) {
    if (states.has(file)) continue;
    const d = await call(`/documents/${id}`, {}, token);
    if (d.status === 200 && TERMINAL.has(d.body.data.processingStatus)) states.set(file, d.body.data);
  }
  if (states.size < idByFile.size) await new Promise((r) => setTimeout(r, 1000));
}
const wallMs = Date.now() - t0;

// ---- score ----
const perField = Object.fromEntries(FIELDS.map((f) => [f, { tp: 0, fp: 0, fn: 0, labelled: 0 }]));
const rows = [];
const latencies = []; const e2e = [];
let completed = 0; let strictOk = 0; let criticalOk = 0; let reviewCm = { tp: 0, fp: 0, fn: 0, tn: 0 };
let issueExpected = 0; let issueFound = 0; const failures = [];
for (const d of docs) {
  const st = states.get(d.file);
  const row = { file: d.file, kind: d.kind, status: st?.processingStatus ?? 'timeout' };
  if (d.kind === 'corrupt') { row.ok = st?.processingStatus === 'rejected'; rows.push(row); if (!row.ok) failures.push(`${d.file}: expected rejection, got ${row.status}`); continue; }
  if (!st || st.processingStatus !== 'completed') { failures.push(`${d.file}: ended as ${row.status}${st?.failure ? ` (${st.failure.code})` : ''}`); rows.push(row); continue; }
  completed++;
  const res = (await call(`/documents/${st.id}/result`, {}, token)).body.data;
  const got = res.result?.extraction ?? {};
  const att = st.attempts.at(-1);
  if (att?.finishedAt) { latencies.push(Date.parse(att.finishedAt) - Date.parse(att.startedAt)); e2e.push(Date.parse(att.finishedAt) - Date.parse(st.createdAt)); }
  let allOk = true; let critOk = true; const wrong = [];
  for (const f of FIELDS) {
    const exp = norm(f, d.expected[f]); const act = norm(f, got[f]);
    const c = perField[f];
    if (exp !== null) c.labelled++;
    if (act !== null && exp !== null && act === exp) c.tp++;
    else {
      if (act !== null) c.fp++;
      if (exp !== null) c.fn++;
      if (act !== exp) { allOk = false; wrong.push(`${f}: expected ${exp ?? 'null'} got ${act ?? 'null'}`); if (['invoiceNumber', 'totalAmount', 'currency'].includes(f)) critOk = false; }
    }
  }
  if (allOk) strictOk++; if (critOk) criticalOk++;
  const predictedReview = res.document.reviewStatus === 'pending';
  if (d.expectedReview && predictedReview) reviewCm.tp++; else if (!d.expectedReview && predictedReview) reviewCm.fp++; else if (d.expectedReview) reviewCm.fn++; else reviewCm.tn++;
  const codes = new Set(res.issues.map((i) => i.code));
  for (const c of d.expectedIssueCodes) { issueExpected++; if (codes.has(c)) issueFound++; else wrong.push(`missing issue ${c}`); }
  Object.assign(row, { ok: allOk && (d.expectedIssueCodes.every((c) => codes.has(c))), predictedReview, expectedReview: d.expectedReview, wrong });
  rows.push(row);
}

const scored = docs.filter((d) => d.kind !== 'corrupt').length;
const f1 = (c) => { const p = c.tp / (c.tp + c.fp || 1); const r = c.tp / (c.tp + c.fn || 1); return { p, r, f: p + r === 0 ? 0 : (2 * p * r) / (p + r) }; };
const fieldTable = FIELDS.map((f) => { const c = perField[f]; const m = f1(c); return `| ${f} | ${c.labelled} | ${c.tp} | ${c.fp} | ${c.fn} | ${(100 * m.p).toFixed(1)}% | ${(100 * m.r).toFixed(1)}% | ${(100 * m.f).toFixed(1)}% |`; });
const byKind = {};
for (const r of rows) { const k = (byKind[r.kind] ??= { n: 0, ok: 0 }); k.n++; if (r.ok) k.ok++; }
const kindTable = Object.entries(byKind).map(([k, v]) => `| ${k} | ${v.n} | ${v.ok} | ${pct(v.ok, v.n)} |`);

console.log(`\n${smoke ? 'SMOKE' : 'EVALUATION'}: ${completed}/${scored} completed, strict ${strictOk}/${completed}, critical ${criticalOk}/${completed}, wall ${(wallMs / 1000).toFixed(1)}s`);
for (const r of rows.filter((x) => x.wrong?.length)) console.log(`  - ${r.file}: ${r.wrong.join('; ')}`);
for (const f of failures) console.log(`  ! ${f}`);

if (smoke) {
  const ok = failures.length === 0 && rows.every((r) => r.ok !== false);
  console.log(ok ? 'SMOKE PASSED' : 'SMOKE FAILED');
  process.exit(ok ? 0 : 1);
}

const sh = (cmd, a) => { try { return execFileSync(cmd, a, { cwd: root, encoding: 'utf8', timeout: 20_000 }).trim(); } catch { return 'unavailable'; } };
const report = `# Evaluation Report

> Generated by \`node scripts/evaluate.mjs\` on ${new Date().toISOString()}. Every number below was measured by that run against the Docker Compose stack; nothing is estimated.
> **Preliminary:** the dataset is small, synthetic and generated by the same author as the extractor, so it measures regression safety and pipeline correctness, not real-world accuracy.

## Setup

| Item | Value |
|---|---|
| Commit | \`${sh('git', ['rev-parse', '--short', 'HEAD'])}\`${sh('git', ['status', '--porcelain']) ? ' (+ uncommitted changes)' : ''} |
| Host | ${platform()} ${release()}, ${cpus().length} logical CPUs (${cpus()[0]?.model.trim()}), ${(totalmem() / 2 ** 30).toFixed(0)} GiB RAM |
| Docker | ${sh('docker', ['--version'])} |
| Stack | PostgreSQL 18 + RabbitMQ 4 + MinIO, NestJS worker concurrency ${env('QUEUE_CONCURRENCY') ?? '2'}, processor concurrency 2 |
| Extractor | \`rules\` v1.0.0 (deterministic; **no LLM was used**, so no model/provider/prompt version applies) |
| OCR | ${sh('docker', ['compose', 'exec', '-T', 'processor', 'tesseract', '--version']).split('\n')[0]}, languages \`eng\`, \`--oem 1 --psm 6\`, 200 DPI render, CLAHE + deskew preprocessing |
| Dataset | \`fixtures/synthetic\` seed ${dataset.seed}: ${docs.length} documents (${scored} scored extractions + ${docs.length - scored} corrupt-file rejection test) |
| Time limit per run | ${TIMEOUT_MS / 1000}s |

### Dataset composition

| Kind | Documents | Fully correct | Rate |
|---|---|---|---|
${kindTable.join('\n')}

"Fully correct" means all eight fields equal the ground truth **and** every expected validation issue was raised (corrupt files: rejected).

## Results

**Denominator:** ${scored} labelled documents. **Exclusions:** none (the corrupt file is scored separately as a rejection test).

| Metric | Result |
|---|---|
| Documents that finished \`completed\` | ${completed} / ${scored} (${pct(completed, scored)}) |
| Strict document accuracy (all 8 fields exact) | ${strictOk} / ${completed} (${pct(strictOk, completed)}) |
| Critical-field accuracy (invoice number, total, currency) | ${criticalOk} / ${completed} (${pct(criticalOk, completed)}) |
| Failure rate (not \`completed\`, excluding the expected rejection) | ${pct(failures.filter((f) => !f.startsWith('corrupt')).length, scored)} |
| Expected validation issues raised | ${issueFound} / ${issueExpected} |
| Manual-review precision / recall | ${pct(reviewCm.tp, reviewCm.tp + reviewCm.fp)} / ${pct(reviewCm.tp, reviewCm.tp + reviewCm.fn)} (TP ${reviewCm.tp}, FP ${reviewCm.fp}, FN ${reviewCm.fn}, TN ${reviewCm.tn}) |
| Manual-review rate | ${pct(reviewCm.tp + reviewCm.fp, completed)} of completed documents |

### Per-field (exact match after normalisation)

A wrong non-null value counts as both a false positive and a false negative; a missing value is a false negative; a spurious value where the label is null is a false positive.

| Field | Labelled | TP | FP | FN | Precision | Recall | F1 |
|---|---|---|---|---|---|---|---|
${fieldTable.join('\n')}

### Latency and throughput

| Metric | Value |
|---|---|
| Processing time per document p50 / p95 (attempt start → finish) | ${ms(quantile(latencies, 0.5))} / ${ms(quantile(latencies, 0.95))} |
| Upload → finished p50 / p95 (includes queueing) | ${ms(quantile(e2e, 0.5))} / ${ms(quantile(e2e, 0.95))} |
| Wall time for the whole batch | ${(wallMs / 1000).toFixed(1)} s |
| Throughput | ${(completed / (wallMs / 60000)).toFixed(1)} documents / minute |

${failures.length ? `### Documents that did not end as expected\n\n${failures.map((f) => `- ${f}`).join('\n')}\n` : ''}
${rows.some((r) => r.wrong?.length) ? `### Per-document differences\n\n${rows.filter((r) => r.wrong?.length).map((r) => `- \`${r.file}\`: ${r.wrong.join('; ')}`).join('\n')}\n` : ''}
## Limitations

- Synthetic, template-based documents; real invoices vary far more. Treat figures as a regression baseline.
- English labels only; the rule-based extractor does not understand other languages.
- OCR is evaluated on clean rendered text (some blur/rotation), not on genuine camera scans.
- Latency is for this machine under Docker; it is not a capacity claim. See \`docs/performance.md\` for load tests.
`;
writeFileSync(join(root, 'docs/evaluation-report.md'), report);
writeFileSync(join(root, 'fixtures/synthetic/results.json'), JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2) + '\n');
console.log(`wrote docs/evaluation-report.md (${basename(root)})`);
