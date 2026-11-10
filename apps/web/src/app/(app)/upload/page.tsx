'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { api } from '@/lib/api-client';
import { formatBytes, isInFlight, STATUS_LABEL } from '@/lib/format';
import { validateClientSide, MAX_FILE_BYTES, BATCH_SIZE } from '@/lib/upload-rules';
import type { DocumentSummary, ProcessingStatus } from '@/lib/types';

type Phase = 'ready' | 'uploading' | 'rejected' | 'processing' | 'done' | 'failed';
interface Item { key: string; file: File; phase: Phase; progress: number; message?: string; documentId?: string; status?: ProcessingStatus }

interface UploadBody {
  data?: { documents: { id: string; filename: string }[]; rejected: { index: number; code: string; message: string }[] };
  message?: string;
  errors?: { field: string | null; message: string }[];
}

/** XMLHttpRequest (not fetch) so the progress bar reflects real bytes sent. */
function xhrUpload(files: File[], key: string, onProgress: (p: number) => void): Promise<{ status: number; body: UploadBody }> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    files.forEach((f) => form.append('files', f, f.name));
    const x = new XMLHttpRequest();
    x.open('POST', '/api/proxy/documents');
    x.setRequestHeader('x-requested-with', 'docint');
    x.setRequestHeader('idempotency-key', key);
    x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    x.onerror = () => reject(new Error('network'));
    x.onload = () => { try { resolve({ status: x.status, body: JSON.parse(x.responseText) as UploadBody }); } catch { reject(new Error('bad response')); } };
    x.send(form);
  });
}

export default function UploadPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const patch = useCallback((keys: string[], p: Partial<Item>) => setItems((xs) => xs.map((x) => (keys.includes(x.key) ? { ...x, ...p } : x))), []);

  const add = (list: FileList | File[]) => {
    const next: Item[] = Array.from(list).map((file) => {
      const problem = validateClientSide(file);
      return { key: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 7)}`, file, phase: problem ? 'rejected' : 'ready', progress: 0, ...(problem && { message: problem }) };
    });
    setItems((xs) => [...xs, ...next]);
  };
  const onDrop = (e: DragEvent) => { e.preventDefault(); setOver(false); if (e.dataTransfer.files.length) add(e.dataTransfer.files); };

  async function send() {
    const ready = items.filter((i) => i.phase === 'ready');
    for (let i = 0; i < ready.length; i += BATCH_SIZE) {
      const batch = ready.slice(i, i + BATCH_SIZE);
      const keys = batch.map((b) => b.key);
      patch(keys, { phase: 'uploading', progress: 0 });
      try {
        const { status, body } = await xhrUpload(batch.map((b) => b.file), `${crypto.randomUUID()}-${i}`, (p) => patch(keys, { progress: p }));
        const rejected = new Map((body.data?.rejected ?? []).map((r) => [r.index, r]));
        const accepted = body.data?.documents ?? [];
        if (status >= 400 && accepted.length === 0) {
          const all = body.errors ?? [];
          batch.forEach((b, idx) => patch([b.key], { phase: 'failed', message: all.find((e) => e.field === `files[${idx}]`)?.message ?? body.message ?? 'Upload failed.' }));
          continue;
        }
        let a = 0;
        batch.forEach((b, idx) => {
          const r = rejected.get(idx);
          if (r) patch([b.key], { phase: 'rejected', message: r.message });
          else { const doc = accepted[a++]; if (doc) patch([b.key], { phase: 'processing', progress: 1, documentId: doc.id, status: 'queued' }); }
        });
      } catch { patch(keys, { phase: 'failed', message: 'The connection dropped during upload. Try again.' }); }
    }
  }

  // Real status polling for accepted documents; stops when none are in flight.
  const processing = items.filter((i) => i.phase === 'processing').map((i) => i.documentId).join(',');
  useEffect(() => {
    if (!processing) return;
    let stop = false; let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      for (const id of processing.split(',')) {
        try {
          const d = await api<DocumentSummary>(`documents/${id}`);
          setItems((xs) => xs.map((x) => (x.documentId === id ? { ...x, status: d.processingStatus, phase: isInFlight(d.processingStatus) ? 'processing' : d.processingStatus === 'completed' ? 'done' : 'failed', ...(d.failure && { message: d.failure.message ?? d.failure.code }) } : x)));
        } catch { /* transient: the next tick retries */ }
      }
      if (!stop) timer = setTimeout(() => void tick(), 1500);
    };
    timer = setTimeout(() => void tick(), 800);
    return () => { stop = true; clearTimeout(timer); };
  }, [processing]);

  const ready = items.filter((i) => i.phase === 'ready').length;
  const uploading = items.some((i) => i.phase === 'uploading');

  return (
    <>
      <header className="page-head">
        <div><h1>Upload documents</h1><p className="muted">PDF, JPG, PNG, TIFF, XLSX, XLS or CSV, up to {formatBytes(MAX_FILE_BYTES)} each. Add as many as you like.</p></div>
      </header>
      <section className="sheet plain" aria-label="Add files">
        <div
          className="dropzone" data-over={over} role="button" tabIndex={0}
          onClick={() => input.current?.click()} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.current?.click(); } }}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}
        >
          <strong>Drop files here or choose from your computer</strong>
          <span className="muted">Scanned pages are read with text recognition. Spreadsheets keep sheet and cell references.</span>
          <input ref={input} type="file" multiple hidden aria-label="Choose files" accept=".pdf,.jpg,.jpeg,.png,.tif,.tiff,.xlsx,.xls,.csv" onChange={(e) => { if (e.target.files) add(e.target.files); e.target.value = ''; }} />
        </div>
      </section>

      {items.length > 0 && (
        <section className="sheet" aria-labelledby="q-h">
          <div className="page-head"><h2 id="q-h">{items.length} {items.length === 1 ? 'file' : 'files'}</h2>
            <span className="row">
              <button className="btn ghost small" type="button" disabled={uploading} onClick={() => setItems((xs) => xs.filter((x) => x.phase === 'processing' || x.phase === 'uploading'))}>Clear finished</button>
              <button className="btn" type="button" disabled={ready === 0 || uploading} onClick={() => void send()}>{uploading ? 'Uploading…' : `Upload ${ready} ${ready === 1 ? 'file' : 'files'}`}</button>
            </span>
          </div>
          <ul className="queue">
            {items.map((i) => (
              <li key={i.key}>
                <div>
                  <strong>{i.file.name}</strong> <span className="muted">{formatBytes(i.file.size)}</span>
                  {i.message && <div className={i.phase === 'done' ? 'muted' : 'field-error'}>{i.message}</div>}
                </div>
                <span>
                  {i.phase === 'ready' && <span className="badge">Ready to upload</span>}
                  {i.phase === 'uploading' && <span className="badge busy">Uploading {Math.round(i.progress * 100)}%</span>}
                  {i.phase === 'rejected' && <span className="badge bad">Not accepted</span>}
                  {i.phase === 'failed' && <span className="badge bad">{i.status ? STATUS_LABEL[i.status] : 'Failed'}</span>}
                  {i.phase === 'processing' && <span className="badge busy">{i.status ? STATUS_LABEL[i.status] : 'Processing'}</span>}
                  {i.phase === 'done' && <Link className="btn ghost small" href={`/documents/${i.documentId}`}>Open result</Link>}
                </span>
                {i.phase === 'uploading' && <progress value={i.progress} max={1} aria-label={`Upload progress for ${i.file.name}`} />}
                {i.phase === 'processing' && <div className="indeterminate" role="progressbar" aria-label={`Processing ${i.file.name}`} style={{ gridColumn: '1 / -1' }} />}
              </li>
            ))}
          </ul>
          {items.some((i) => i.phase === 'failed') && <p className="notice warn">Some files could not be processed. Open the document to see why, then reprocess it.</p>}
        </section>
      )}
    </>
  );
}
