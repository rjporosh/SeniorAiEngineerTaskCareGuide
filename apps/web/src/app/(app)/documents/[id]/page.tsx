'use client';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiError } from '@/lib/api-client';
import { duration, FIELD_LABEL, formatBytes, formatDate, formatDateTime, formatMoney, isInFlight, STATUS_LABEL } from '@/lib/format';
import { splitEvidence } from '@/lib/evidence';
import { useLoad } from '@/lib/hooks';
import type { Attempt, DocumentDetail, FieldError, History, InvoiceData, Me, ResultView } from '@/lib/types';
import { ErrorNotice, ReviewStamp, SeverityBadge, StatusBadge } from '@/components/ui';
import { useToast } from '@/components/toast';

const SCALAR = ['invoiceNumber', 'invoiceDate', 'supplierName', 'customerName', 'subtotal', 'taxAmount', 'totalAmount', 'currency'] as const;
type Scalar = (typeof SCALAR)[number];
const MONEY = new Set<string>(['subtotal', 'taxAmount', 'totalAmount']);

function show(field: Scalar, d: InvoiceData): string {
  const v = d[field];
  if (v === null) return '';
  return v;
}

function ConfirmReprocess({ open, onClose, onConfirm, busy }: { open: boolean; onClose: () => void; onConfirm: () => void; busy: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = ref.current; if (!d) return; if (open && !d.open) d.showModal(); if (!open && d.open) d.close(); }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} aria-labelledby="rp-h">
      <div className="stack">
        <h2 id="rp-h">Process this document again?</h2>
        <p>A new attempt will run with the current rules. Earlier attempts, results and corrections stay in the history.</p>
        <div className="row"><button className="btn" type="button" disabled={busy} onClick={onConfirm}>{busy ? 'Starting…' : 'Process again'}</button><button className="btn ghost" type="button" onClick={onClose}>Cancel</button></div>
      </div>
    </dialog>
  );
}

function Fields({ view, canEdit, onSaved }: { view: ResultView; canEdit: boolean; onSaved: () => void }) {
  const toast = useToast();
  const r = view.result!;
  const d = r.extraction;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<{ message: string; errors: FieldError[] } | null>(null);

  const begin = () => { setDraft({ ...Object.fromEntries(SCALAR.map((f) => [f, show(f, d)])), documentType: d.documentType }); setReason(''); setProblem(null); setEditing(true); };
  const err = (f: string) => problem?.errors.filter((e) => e.field === `changes.${f}` || e.field === f).map((e) => e.message).join(' ');

  async function save(e: FormEvent) {
    e.preventDefault();
    const changes: Record<string, string | null> = {};
    for (const f of [...SCALAR, 'documentType'] as const) {
      const current = f === 'documentType' ? d.documentType : d[f];
      const next = (draft[f] ?? '').trim();
      if ((next === '' ? null : next) !== current) changes[f] = next === '' ? null : f === 'currency' ? next.toUpperCase() : next;
    }
    if (Object.keys(changes).length === 0) { setProblem({ message: 'Nothing was changed.', errors: [] }); return; }
    setSaving(true); setProblem(null);
    try {
      await api(`documents/${view.document.id}/corrections`, { method: 'PATCH', json: { expectedVersion: r.version, ...(reason.trim() && { reason: reason.trim() }), changes } });
      toast('Corrections saved. The numbers were checked again.');
      setEditing(false); onSaved();
    } catch (x) {
      const a = x instanceof ApiError ? x : null;
      setProblem({ message: a?.code === 'CONCURRENT_MODIFICATION' ? 'Someone else changed this document. Reload to see their changes, then correct again.' : (a?.message ?? 'Could not save.'), errors: a?.errors ?? [] });
    } finally { setSaving(false); }
  }

  const original = r.original;
  return (
    <section className="sheet" aria-labelledby="f-h">
      <div className="page-head"><h2 id="f-h">What was found</h2>
        {canEdit && !editing && <button className="btn ghost small" type="button" onClick={begin}>Correct values</button>}
      </div>
      {editing ? (
        <form className="stack" onSubmit={save} noValidate aria-label="Correct extracted values">
          {problem && <div className="notice bad" role="alert"><strong>{problem.message}</strong>{problem.errors.length > 0 && <ul>{problem.errors.map((x, i) => <li key={i}>{(x.field ?? '').replace('changes.', '')}: {x.message}</li>)}</ul>}</div>}
          <div className="filters">
            {SCALAR.map((f) => (
              <label className="field" key={f}>{FIELD_LABEL[f]}
                <input type={f === 'invoiceDate' ? 'date' : 'text'} inputMode={MONEY.has(f) ? 'decimal' : undefined} value={draft[f] ?? ''} aria-invalid={Boolean(err(f))} aria-describedby={`${f}-e`}
                  onChange={(e) => setDraft({ ...draft, [f]: e.target.value })} maxLength={f === 'currency' ? 3 : 200} />
                <span id={`${f}-e`} className="field-error">{err(f)}</span>
              </label>
            ))}
            <label className="field">{FIELD_LABEL['documentType']}
              <select value={draft['documentType'] ?? ''} onChange={(e) => setDraft({ ...draft, documentType: e.target.value })}>
                <option value="invoice">Invoice</option><option value="credit_note">Credit note</option><option value="unknown">Unknown</option>
              </select>
            </label>
          </div>
          <label className="field">Why are you changing this? (optional)<input type="text" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} /></label>
          <div className="row"><button className="btn" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save corrections'}</button><button className="btn ghost" type="button" onClick={() => setEditing(false)}>Cancel</button></div>
        </form>
      ) : (
        <dl className="fields">
          {SCALAR.map((f) => {
            const v = d[f]; const ev = d.fieldEvidence[f]; const changed = original[f] !== v;
            const sp = ev?.text ? splitEvidence(ev.text, original[f] ?? v) : null;
            const where = ev ? [ev.sourcePage ? `page ${ev.sourcePage}` : null, ev.sourceSheet ? `sheet ${ev.sourceSheet}` : null, ev.sourceCell ? `cell ${ev.sourceCell}` : null].filter(Boolean).join(', ') : '';
            const conf = d.fieldConfidence[f];
            return (
              <div className={`f ${changed ? 'changed' : ''}`} key={f}>
                <dt>{FIELD_LABEL[f]}</dt>
                <dd className={MONEY.has(f) || f === 'invoiceNumber' ? 'mono' : undefined}>
                  {v === null ? <span className="null">{ev?.text ? 'Not confirmed — see source' : 'Not found'}</span> : MONEY.has(f) ? formatMoney(v, d.currency) : f === 'invoiceDate' ? formatDate(v) : v}
                  {changed && <span className="muted"> (was {original[f] ?? 'empty'})</span>}
                </dd>
                {ev?.text ? <button className="btn ghost small" type="button" aria-expanded={open === f} onClick={() => setOpen(open === f ? null : f)}>{open === f ? 'Hide source' : 'Show source'}</button> : <span />}
                {open === f && ev?.text && (
                  <div className="evidence-quote">
                    {sp ? <>{sp.before}<mark className="evidence">{sp.match}</mark>{sp.after}</> : ev.text}
                    <div>{where || 'location unknown'}{typeof conf === 'number' ? ` · text recognition confidence ${Math.round(conf * 100)}%` : ''}</div>
                  </div>
                )}
              </div>
            );
          })}
        </dl>
      )}
      {d.lineItems.length > 0 && (
        <div style={{ marginTop: 22 }}>
          <h3>Line items</h3>
          <div className="table-wrap" style={{ marginTop: 8 }}>
            <table>
              <caption className="sr-only">Line items</caption>
              <thead><tr><th scope="col">Description</th><th scope="col" className="num">Qty</th><th scope="col" className="num">Unit price</th><th scope="col" className="num">Line total</th></tr></thead>
              <tbody>{d.lineItems.map((l, i) => <tr key={i}><td>{l.description ?? '—'}</td><td className="num mono">{l.quantity ?? '—'}</td><td className="num mono">{formatMoney(l.unitPrice, d.currency)}</td><td className="num mono">{formatMoney(l.lineTotal, d.currency)}</td></tr>)}</tbody>
            </table>
          </div>
        </div>
      )}
      <p className="muted" style={{ marginTop: 16 }}>Read by <span className="mono">{r.extractor.provider} v{r.extractor.version}</span> · version {r.version}</p>
    </section>
  );
}

function Issues({ view, canResolve, onChanged }: { view: ResultView; canResolve: boolean; onChanged: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  async function resolve(id: string, resolution: 'resolved' | 'waived') {
    setBusy(id);
    try { await api(`documents/${view.document.id}/issues/${id}`, { method: 'PATCH', json: { resolution } }); toast(resolution === 'waived' ? 'Marked as accepted.' : 'Marked as resolved.'); onChanged(); }
    catch (x) { toast(x instanceof ApiError ? x.message : 'Could not update the issue.', 'bad'); }
    finally { setBusy(null); }
  }
  const sorted = [...view.issues].sort((a, b) => ({ error: 0, warning: 1, info: 2 })[a.severity] - ({ error: 0, warning: 1, info: 2 })[b.severity]);
  return (
    <section className="sheet plain" aria-labelledby="i-h">
      <h2 id="i-h">Margin notes</h2>
      {sorted.length === 0 ? <p className="muted">Nothing to check. All required fields were found and the numbers add up.</p> : sorted.map((i) => (
        <div className="issue" key={i.id}>
          <div className="row"><SeverityBadge severity={i.severity} />{i.resolution !== 'open' && <span className="badge ok">{i.resolution === 'waived' ? 'Accepted' : 'Resolved'}</span>}</div>
          <p>{i.message}</p>
          {i.fields.length > 0 && <p className="muted">Affects: {i.fields.map((f) => FIELD_LABEL[f.split('.')[0] ?? f] ?? f).join(', ')}</p>}
          {typeof i.details['documentId'] === 'string' && <p><a href={`/documents/${i.details['documentId']}`}>Open the other document</a>{typeof i.details['location'] === 'string' ? <span className="muted"> · {i.details['location']}</span> : null}</p>}
          {canResolve && i.severity !== 'info' && i.resolution === 'open' && (
            <div className="row"><button className="btn ghost small" disabled={busy === i.id} onClick={() => void resolve(i.id, 'waived')}>Accept as is</button><button className="btn ghost small" disabled={busy === i.id} onClick={() => void resolve(i.id, 'resolved')}>Mark resolved</button></div>
          )}
        </div>
      ))}
    </section>
  );
}

function Timeline({ attempts }: { attempts: Attempt[] }) {
  return (
    <section className="sheet plain" aria-labelledby="t-h">
      <h2 id="t-h">Processing</h2>
      <ol className="timeline">
        {[...attempts].reverse().map((a) => (
          <li key={a.id} className={a.status === 'succeeded' ? 'ok' : a.status === 'failed' ? 'bad' : 'busy'}>
            <strong>Attempt {a.attemptNumber}</strong> · {a.status === 'running' ? (STATUS_LABEL[a.stage as keyof typeof STATUS_LABEL] ?? a.stage) : a.status === 'succeeded' ? 'Finished' : 'Stopped'}
            <div className="muted">{formatDateTime(a.startedAt)} · {duration(a.startedAt, a.finishedAt)}</div>
            {a.error && <div className="field-error">{a.error.message ?? a.error.code}{a.error.retryable ? ' You can process it again.' : ''}</div>}
          </li>
        ))}
      </ol>
    </section>
  );
}

export default function DocumentPage() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const me = useLoad(() => api<Me>('auth/me'), []);
  const doc = useLoad(() => api<DocumentDetail>(`documents/${id}`), [id], { pollMs: 1500, keepPolling: (d) => isInFlight(d.processingStatus) });
  const status = doc.data?.processingStatus;
  const result = useLoad(() => api<ResultView>(`documents/${id}/result`), [id, status], {});
  const history = useLoad(() => api<History>(`documents/${id}/history`), [id, status, result.data?.result?.version], {});
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const privileged = me.data?.role === 'admin' || me.data?.role === 'reviewer';
  async function reprocess() {
    setBusy(true);
    try { await api(`documents/${id}/reprocess`, { method: 'POST', headers: { 'idempotency-key': crypto.randomUUID() } }); toast('Processing started again.'); setConfirm(false); await doc.reload(); }
    catch (x) { toast(x instanceof ApiError ? x.message : 'Could not start processing.', 'bad'); setConfirm(false); }
    finally { setBusy(false); }
  }

  if (doc.error) return <ErrorNotice error={doc.error} onRetry={() => void doc.reload()} />;
  if (!doc.data) return <div className="indeterminate" role="progressbar" aria-label="Loading document" />;
  const d = doc.data;
  const canReprocess = !isInFlight(d.processingStatus) && (privileged || d.processingStatus === 'failed' || d.processingStatus === 'rejected');

  return (
    <>
      <header className="page-head">
        <div>
          <h1>{result.data?.result?.extraction.invoiceNumber ?? d.filename}</h1>
          <p className="muted">{d.filename} · {formatBytes(d.sizeBytes)} · uploaded {formatDateTime(d.createdAt)}</p>
        </div>
        <div className="row">
          <StatusBadge status={d.processingStatus} />
          {d.processingStatus === 'completed' && <ReviewStamp status={d.reviewStatus} />}
          <a className="btn ghost small" href={`/api/proxy/documents/${d.id}/download`}>Download original</a>
          {canReprocess && <button className="btn ghost small" type="button" onClick={() => setConfirm(true)}>Process again</button>}
        </div>
      </header>

      {isInFlight(d.processingStatus) && <div className="notice" role="status"><strong>{STATUS_LABEL[d.processingStatus]}…</strong><div className="indeterminate" style={{ marginTop: 8 }} /></div>}
      {d.failure && (
        <div className="notice bad" role="alert"><strong>{d.processingStatus === 'rejected' ? 'This file was rejected' : 'Processing failed'}</strong><p>{d.failure.message ?? d.failure.code}</p>
          {canReprocess && d.processingStatus === 'failed' && <p className="muted">Failures like this are usually temporary. Use “Process again” when the cause is fixed.</p>}
        </div>
      )}

      <div className="grid-2">
        <div className="stack">
          {result.data?.result ? <Fields view={result.data} canEdit={privileged && d.processingStatus === 'completed'} onSaved={() => { void result.reload(); void doc.reload(); void history.reload(); }} />
            : result.error && result.error.status !== 404 ? <ErrorNotice error={result.error} onRetry={() => void result.reload()} />
            : d.processingStatus === 'completed' ? <section className="sheet"><h2>What was found</h2><p className="muted">No invoice fields were found in this document.</p></section> : null}
          {history.data && (history.data.corrections.length > 0 || history.data.audit.some((a) => a.event !== 'document.processed')) && (
            <section className="sheet plain" aria-labelledby="h-h">
              <h2 id="h-h">History</h2>
              <ul className="queue">
                {history.data.corrections.map((c) => <li key={c.id}><div><strong>{FIELD_LABEL[c.field] ?? c.field}</strong> changed from <span className="mono">{String(c.previousValue ?? 'empty')}</span> to <span className="mono">{String(c.correctedValue ?? 'empty')}</span>{c.reason && <div className="muted">“{c.reason}”</div>}</div><span className="muted">{formatDateTime(c.createdAt)}</span></li>)}
                {history.data.audit.filter((a) => a.event !== 'document.processed').map((a) => <li key={a.id}><span>{a.event.replace('document.', '').replace('issue.', 'issue ').replace('.', ' ')}</span><span className="muted">{formatDateTime(a.createdAt)}</span></li>)}
              </ul>
            </section>
          )}
        </div>
        <div className="stack">
          {result.data && <Issues view={result.data} canResolve={privileged && d.processingStatus === 'completed'} onChanged={() => { void result.reload(); void doc.reload(); void history.reload(); }} />}
          <Timeline attempts={d.attempts} />
        </div>
      </div>
      <ConfirmReprocess open={confirm} onClose={() => setConfirm(false)} onConfirm={() => void reprocess()} busy={busy} />
    </>
  );
}
