'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { api, qs } from '@/lib/api-client';
import { useLoad } from '@/lib/hooks';
import { formatMoney } from '@/lib/format';
import type { Capabilities, Page, SearchHit } from '@/lib/types';
import { EmptyState, ErrorNotice, Pager, ReviewStamp } from '@/components/ui';

type Result = Page<SearchHit> & { mode: string };

const place = (l: SearchHit['location']) => (l.sheet ? `Sheet ${l.sheet}${l.range ? `, ${l.range}` : ''}` : l.page ? `Page ${l.page}` : 'Invoice summary');

function SearchView() {
  const router = useRouter();
  const params = useSearchParams();
  const q = params.get('q') ?? '';
  const mode = params.get('mode') === 'semantic' ? 'semantic' : 'keyword';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const [draft, setDraft] = useState(q);

  const caps = useLoad(() => api<Capabilities>('capabilities'), []);
  const semantic = caps.data?.semanticSearch ?? false;
  const res = useLoad<Result | null>(() => (q.trim().length >= 2 ? api<Result>(`search${qs({ q, mode, page, pageSize: 10 })}`) : Promise.resolve(null)), [q, mode, page]);

  const go = (next: { q?: string; mode?: string; page?: number }) => {
    const u = new URLSearchParams({ q: next.q ?? q, mode: next.mode ?? mode, page: String(next.page ?? 1) });
    router.push(`/search?${u}`);
  };
  const submit = (e: FormEvent) => { e.preventDefault(); go({ q: draft.trim() }); };

  return (
    <>
      <header className="page-head"><div><h1>Search</h1><p className="muted">Find invoices by number, supplier, or any text that was read from your documents.</p></div></header>
      <form className="sheet plain stack" onSubmit={submit} role="search">
        <div className="row" style={{ alignItems: 'end' }}>
          <label className="field" style={{ flex: 1, minWidth: 220 }}>What are you looking for?
            <input type="search" value={draft} onChange={(e) => setDraft(e.target.value)} minLength={2} maxLength={200} required />
          </label>
          <button className="btn" type="submit">Search</button>
        </div>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="sr-only">Search method</legend>
          <div className="row">
            <label className="row"><input type="radio" name="mode" checked={mode === 'keyword'} onChange={() => go({ mode: 'keyword' })} /> Exact words</label>
            <label className="row" title={semantic ? undefined : 'Not available with the current database setting'}>
              <input type="radio" name="mode" checked={mode === 'semantic'} disabled={!semantic} onChange={() => go({ mode: 'semantic' })} /> Similar meaning
            </label>
          </div>
          {caps.data && !semantic && <p className="muted">Search by similar meaning is unavailable with the {caps.data.databaseProvider} database setting. Exact-word search works.</p>}
        </fieldset>
      </form>

      {res.error && <ErrorNotice error={res.error} onRetry={() => void res.reload()} />}
      {res.loading && q && <div className="indeterminate" role="progressbar" aria-label="Searching" />}
      {!q && <EmptyState title="Type at least two characters to search" />}
      {res.data && res.data.items.length === 0 && <EmptyState title={`Nothing found for “${q}”`}>Check the spelling, try fewer words, or switch the search method.</EmptyState>}
      {res.data && res.data.items.length > 0 && (
        <>
          <ol className="sheet stack" style={{ listStyle: 'none', margin: 0 }} aria-label="Results">
            {res.data.items.map((h) => (
              <li key={`${h.documentId}-${h.location.page}-${h.location.range}-${h.score}`} className="issue">
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <Link href={`/documents/${h.documentId}`}><strong>{h.document.invoice?.invoiceNumber ?? h.document.filename}</strong></Link>
                  <ReviewStamp status={h.document.reviewStatus} />
                </div>
                <div className="muted">{h.document.filename} · {place(h.location)}{h.document.invoice?.totalAmount ? ` · ${formatMoney(h.document.invoice.totalAmount, h.document.invoice.currency)}` : ''}</div>
                {/* Snippets are plain text from user documents: always rendered as text nodes, never as HTML. */}
                <p className="mono" style={{ fontSize: '0.88rem', whiteSpace: 'pre-wrap' }}>{h.snippet}</p>
              </li>
            ))}
          </ol>
          <Pager page={res.data.page} pageSize={res.data.pageSize} total={res.data.total} onPage={(p) => go({ page: p })} />
        </>
      )}
    </>
  );
}

export default function SearchPage() { return <Suspense><SearchView /></Suspense>; }
