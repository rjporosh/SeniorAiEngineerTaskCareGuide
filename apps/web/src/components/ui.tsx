import Link from 'next/link';
import type { ReactNode } from 'react';
import { IN_FLIGHT, REVIEW_LABEL, SEVERITY_LABEL, STATUS_LABEL } from '@/lib/format';
import type { ProcessingStatus, ReviewStatus, Severity } from '@/lib/types';

export function StatusBadge({ status }: { status: ProcessingStatus }) {
  const tone = status === 'completed' ? 'ok' : status === 'failed' || status === 'rejected' ? 'bad' : IN_FLIGHT.has(status) ? 'busy' : '';
  return <span className={`badge ${tone}`}>{STATUS_LABEL[status]}</span>;
}

export function ReviewStamp({ status }: { status: ReviewStatus }) {
  if (status === 'not_required') return <span className="badge ok">{REVIEW_LABEL.not_required}</span>;
  return <span className={`stamp ${status === 'pending' ? 'review' : 'reviewed'}`}>{REVIEW_LABEL[status]}</span>;
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  return <span className={`badge ${severity === 'error' ? 'bad' : severity === 'warning' ? 'warn' : ''}`}>{SEVERITY_LABEL[severity]}</span>;
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: { href: string; label: string } }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action && <Link className="btn" href={action.href}>{action.label}</Link>}
    </div>
  );
}

export function ErrorNotice({ error, onRetry }: { error: { message: string; errors?: { field: string | null; message: string }[]; traceId?: string }; onRetry?: () => void }) {
  return (
    <div className="notice bad" role="alert">
      <strong>{error.message}</strong>
      {error.errors && error.errors.length > 0 && <ul>{error.errors.map((e, i) => <li key={i}>{e.field ? `${e.field}: ` : ''}{e.message}</li>)}</ul>}
      {error.traceId && <p className="muted">Reference: <span className="mono">{error.traceId}</span></p>}
      {onRetry && <p><button className="btn ghost small" type="button" onClick={onRetry}>Try again</button></p>}
    </div>
  );
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <nav className="pager" aria-label="Pagination">
      <span className="muted">{total === 0 ? 'No results' : `${(page - 1) * pageSize + 1}–${Math.min(total, page * pageSize)} of ${total}`}</span>
      <span className="row">
        <button className="btn ghost small" type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
        <span aria-live="polite">Page {page} of {pages}</span>
        <button className="btn ghost small" type="button" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
      </span>
    </nav>
  );
}
