'use client';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { api, qs } from '@/lib/api-client';
import { formatBytes, formatDate, formatMoney, relativeTime, STATUS_LABEL } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import type { DocumentSummary, Page } from '@/lib/types';
import { EmptyState, ErrorNotice, Pager, ReviewStamp, StatusBadge } from '@/components/ui';

const FILTER_KEYS = ['text', 'status', 'reviewStatus', 'supplier', 'currency', 'minAmount', 'maxAmount', 'invoiceDateFrom', 'invoiceDateTo'] as const;
const SORTS = [['createdAt', 'Newest uploaded'], ['updatedAt', 'Recently changed'], ['originalFilename', 'File name'], ['processingStatus', 'Status']] as const;

function DocumentsView() {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const get = (k: string) => params.get(k) ?? '';
  const page = Math.max(1, Number(get('page')) || 1);
  const sortBy = get('sortBy') || 'createdAt';
  const sortDir = get('sortDir') || 'desc';
  const query = Object.fromEntries([...FILTER_KEYS.map((k) => [k, get(k)]), ['page', page], ['pageSize', 15], ['sortBy', sortBy], ['sortDir', sortDir]]);
  const key = JSON.stringify(query);

  const list = useLoad(() => api<Page<DocumentSummary>>(`documents${qs(query)}`), [key], { pollMs: 4000, keepPolling: (d) => d.items.some((i) => ['queued', 'validating', 'extracting', 'ocr', 'structuring', 'validating_result', 'indexed', 'uploaded'].includes(i.processingStatus)) });

  const [draft, setDraft] = useState<Record<string, string>>({});
  useEffect(() => { setDraft(Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) ?? '']))); }, [params]);

  const push = (next: Record<string, string | number>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) if (String(v) !== '') u.set(k, String(v));
    router.push(`${path}${u.size ? `?${u}` : ''}`);
  };
  const apply = (e: FormEvent) => { e.preventDefault(); push({ ...draft, sortBy, sortDir, page: 1 }); };
  const activeFilters = FILTER_KEYS.filter((k) => get(k));

  return (
    <>
      <header className="page-head">
        <div><h1>Documents</h1><p className="muted">Everything you have uploaded, with what was found in it.</p></div>
        <Link className="btn" href="/upload">Upload documents</Link>
      </header>

      <form className="sheet plain stack" onSubmit={apply} aria-label="Filter documents">
        <div className="filters">
          <label className="field">Search file or invoice number<input type="search" value={draft['text'] ?? ''} onChange={(e) => setDraft({ ...draft, text: e.target.value })} /></label>
          <label className="field">Status
            <select value={draft['status'] ?? ''} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>
              <option value="">Any</option>{Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="field">Review
            <select value={draft['reviewStatus'] ?? ''} onChange={(e) => setDraft({ ...draft, reviewStatus: e.target.value })}>
              <option value="">Any</option><option value="pending">Needs review</option><option value="reviewed">Reviewed</option><option value="not_required">Clear</option>
            </select>
          </label>
          <label className="field">Supplier<input type="text" value={draft['supplier'] ?? ''} onChange={(e) => setDraft({ ...draft, supplier: e.target.value })} /></label>
          <label className="field">Currency<input type="text" maxLength={3} placeholder="USD" value={draft['currency'] ?? ''} onChange={(e) => setDraft({ ...draft, currency: e.target.value.toUpperCase() })} /></label>
          <label className="field">Total from<input type="number" step="0.01" value={draft['minAmount'] ?? ''} onChange={(e) => setDraft({ ...draft, minAmount: e.target.value })} /></label>
          <label className="field">Total to<input type="number" step="0.01" value={draft['maxAmount'] ?? ''} onChange={(e) => setDraft({ ...draft, maxAmount: e.target.value })} /></label>
          <label className="field">Invoice date from<input type="date" value={draft['invoiceDateFrom'] ?? ''} onChange={(e) => setDraft({ ...draft, invoiceDateFrom: e.target.value })} /></label>
          <label className="field">Invoice date to<input type="date" value={draft['invoiceDateTo'] ?? ''} onChange={(e) => setDraft({ ...draft, invoiceDateTo: e.target.value })} /></label>
          <label className="field">Sort by
            <select value={`${sortBy}:${sortDir}`} onChange={(e) => { const [b, d] = e.target.value.split(':'); push({ ...draft, sortBy: b ?? 'createdAt', sortDir: d ?? 'desc', page: 1 }); }}>
              {SORTS.flatMap(([v, l]) => [<option key={`${v}d`} value={`${v}:desc`}>{l}</option>, <option key={`${v}a`} value={`${v}:asc`}>{l} (reverse)</option>])}
            </select>
          </label>
        </div>
        <div className="row">
          <button className="btn" type="submit">Apply filters</button>
          {activeFilters.length > 0 && <button className="btn ghost" type="button" onClick={() => push({})}>Clear filters</button>}
        </div>
      </form>

      {list.error && <ErrorNotice error={list.error} onRetry={() => void list.reload()} />}
      {list.loading && !list.data && <div className="indeterminate" role="progressbar" aria-label="Loading documents" />}
      {list.data && list.data.items.length === 0 && (
        activeFilters.length > 0
          ? <EmptyState title="No documents match these filters">Try removing a filter or widening the amount range.</EmptyState>
          : <EmptyState title="No documents yet" action={{ href: '/upload', label: 'Upload your first documents' }}>Invoices, scans and spreadsheets you upload will be listed here.</EmptyState>
      )}
      {list.data && list.data.items.length > 0 && (
        <>
          <div className="table-wrap">
            <table>
              <caption className="sr-only">Documents</caption>
              <thead><tr><th scope="col">File</th><th scope="col">Invoice</th><th scope="col">Supplier</th><th scope="col">Date</th><th scope="col" className="num">Total</th><th scope="col">Status</th><th scope="col">Review</th></tr></thead>
              <tbody>
                {list.data.items.map((d) => (
                  <tr key={d.id}>
                    <td><Link className="row-link" href={`/documents/${d.id}`}>{d.filename}</Link><div className="muted">{formatBytes(d.sizeBytes)} · {relativeTime(d.createdAt)}</div></td>
                    <td className="mono">{d.invoice?.invoiceNumber ?? '—'}</td>
                    <td>{d.invoice?.supplierName ?? '—'}</td>
                    <td>{formatDate(d.invoice?.invoiceDate)}</td>
                    <td className="num mono">{formatMoney(d.invoice?.totalAmount, d.invoice?.currency)}</td>
                    <td><StatusBadge status={d.processingStatus} /></td>
                    <td><ReviewStamp status={d.reviewStatus} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={(p) => push({ ...Object.fromEntries(FILTER_KEYS.map((k) => [k, get(k)])), sortBy, sortDir, page: p })} />
        </>
      )}
    </>
  );
}

export default function DocumentsPage() { return <Suspense><DocumentsView /></Suspense>; }
