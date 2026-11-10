'use client';
import Link from 'next/link';
import { api, qs } from '@/lib/api-client';
import { formatMoney, relativeTime, STATUS_LABEL } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import type { DocumentSummary, Page, ProcessingStatus, Stats } from '@/lib/types';
import { EmptyState, ErrorNotice, ReviewStamp, StatusBadge } from '@/components/ui';

const TONE: Partial<Record<ProcessingStatus, string>> = { completed: 'var(--ok)', failed: 'var(--stamp)', rejected: 'var(--stamp)', queued: 'var(--cobalt)', cancelled: 'var(--ink-2)' };

export default function Desk() {
  const stats = useLoad(() => api<Stats>('documents/stats'), [], { pollMs: 5000 });
  const waiting = useLoad(() => api<Page<DocumentSummary>>(`documents${qs({ reviewStatus: 'pending', pageSize: 8, sortBy: 'updatedAt', sortDir: 'desc' })}`), [], { pollMs: 8000 });
  const s = stats.data;
  const inFlight = s ? s.total - (s.byStatus['completed'] ?? 0) - (s.byStatus['failed'] ?? 0) - (s.byStatus['rejected'] ?? 0) - (s.byStatus['cancelled'] ?? 0) : 0;

  return (
    <>
      <header className="page-head">
        <div>
          <h1>{s ? (s.requiresReview > 0 ? `${s.requiresReview} ${s.requiresReview === 1 ? 'document is' : 'documents are'} waiting for you` : s.total === 0 ? 'Your desk is empty' : 'Nothing is waiting for review') : 'Your desk'}</h1>
          <p className="muted">{s && s.total > 0 ? `${s.total} documents in total${inFlight > 0 ? `, ${inFlight} still being read` : ''}${s.failed > 0 ? `, ${s.failed} could not be processed` : ''}.` : 'Upload invoices, PDFs, scans or spreadsheets to get started.'}</p>
        </div>
        <Link className="btn" href="/upload">Upload documents</Link>
      </header>

      {stats.error && <ErrorNotice error={stats.error} onRetry={() => void stats.reload()} />}

      <div className="grid-2">
        <section className="sheet" aria-labelledby="queue-h">
          <h2 id="queue-h">Waiting for review</h2>
          {waiting.loading && !waiting.data ? <div className="indeterminate" role="progressbar" aria-label="Loading" /> :
            waiting.data && waiting.data.items.length > 0 ? (
              <ul className="queue">
                {waiting.data.items.map((d) => (
                  <li key={d.id}>
                    <div>
                      <Link className="row-link" href={`/documents/${d.id}`}><strong>{d.invoice?.invoiceNumber ?? d.filename}</strong></Link>
                      <div className="muted">{d.invoice?.supplierName ?? d.filename} · {formatMoney(d.invoice?.totalAmount, d.invoice?.currency)} · {relativeTime(d.updatedAt)}</div>
                    </div>
                    <ReviewStamp status={d.reviewStatus} />
                  </li>
                ))}
              </ul>
            ) : <EmptyState title="All caught up">Documents that need a person to look at them will show up here.</EmptyState>}
          {waiting.data && waiting.data.total > waiting.data.items.length && <p><Link href="/documents?reviewStatus=pending">See all {waiting.data.total}</Link></p>}
        </section>

        <section className="sheet plain" aria-labelledby="tape-h">
          <h2 id="tape-h">Where everything stands</h2>
          {s && s.total > 0 ? (
            <>
              <div className="tape" role="img" aria-label={Object.entries(s.byStatus).map(([k, v]) => `${STATUS_LABEL[k as ProcessingStatus] ?? k}: ${v}`).join(', ')}>
                {Object.entries(s.byStatus).map(([k, v]) => <span key={k} style={{ flex: v, background: TONE[k as ProcessingStatus] ?? 'var(--ink-2)', opacity: TONE[k as ProcessingStatus] ? 1 : 0.55 }} />)}
              </div>
              <ul className="legend" style={{ listStyle: 'none', padding: 0 }}>
                {Object.entries(s.byStatus).map(([k, v]) => <li key={k}><i style={{ background: TONE[k as ProcessingStatus] ?? 'var(--ink-2)', opacity: TONE[k as ProcessingStatus] ? 1 : 0.55 }} />{STATUS_LABEL[k as ProcessingStatus] ?? k} <strong className="num">{v}</strong></li>)}
              </ul>
            </>
          ) : <p className="muted">Counts appear here after your first upload.</p>}
          {s && s.failed > 0 && <p style={{ marginTop: 14 }}><Link href="/documents?status=failed">Review {s.failed} failed {s.failed === 1 ? 'document' : 'documents'}</Link></p>}
        </section>
      </div>
      {waiting.data?.items.length === 0 && stats.data?.total ? <p className="muted"><StatusBadge status="completed" /> Every processed document has been checked.</p> : null}
    </>
  );
}
