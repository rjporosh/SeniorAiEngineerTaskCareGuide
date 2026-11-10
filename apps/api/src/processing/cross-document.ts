import type { Repositories } from '../application/ports.js';
import type { DocumentRecord, InvoiceData, NewIssue } from '../domain/types.js';
import { normalizeKey } from '../domain/normalize.js';
import { recordFromChunkLine, recordsFromBlocks } from '../extraction/records.js';
import { compareInvoices } from '../validation/compare.js';
import { crossDocumentIssues, type CrossDocumentMatch } from '../validation/validator.js';
import type { Block } from './processor.types.js';

const TABULAR_MIMES = new Set(['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel', 'text/csv']);
export const isTabular = (doc: Pick<DocumentRecord, 'detectedMime'>): boolean => TABULAR_MIMES.has(doc.detectedMime);

export interface PeerUpdate { documentId: string; issues: NewIssue[] }

/** Compares a document with the same invoice found in other documents of the same owner (PDF/image <-> spreadsheet row). */
export class CrossDocumentService {
  constructor(private readonly repos: Repositories) {}

  /** Direction A: a PDF/image invoice looks for matching spreadsheet rows. */
  async forDocumentInvoice(doc: DocumentRecord, data: InvoiceData): Promise<CrossDocumentMatch[]> {
    const key = normalizeKey(data.invoiceNumber);
    if (!data.invoiceNumber || !key) return [];
    const hits = await this.repos.documents.searchKeyword(data.invoiceNumber, { ownerId: doc.ownerId }, { page: 1, pageSize: 20 });
    const out: CrossDocumentMatch[] = [];
    const seen = new Set<string>();
    for (const hit of hits.items) {
      if (hit.documentId === doc.id) continue;
      const other = await this.repos.documents.findById(hit.documentId);
      if (!other || !isTabular(other)) continue;
      for (const line of hit.content.split('\n')) {
        const rec = recordFromChunkLine(line);
        if (!rec || normalizeKey(rec.data.invoiceNumber) !== key) continue;
        const id = `${other.id}:${rec.location}`;
        if (seen.has(id)) continue;
        seen.add(id);
        out.push({ documentId: other.id, filename: other.originalFilename, location: rec.location, comparison: compareInvoices(data, rec.data) });
      }
    }
    return out;
  }

  /** Direction B: a spreadsheet's invoice rows look for matching PDF/image invoices; peers also get the finding. */
  async forSpreadsheet(doc: DocumentRecord, blocks: Block[]): Promise<{ own: CrossDocumentMatch[]; peers: PeerUpdate[] }> {
    const own: CrossDocumentMatch[] = []; const peers = new Map<string, NewIssue[]>();
    for (const rec of recordsFromBlocks(blocks)) {
      const candidates = await this.repos.documents.findDuplicateCandidates({ documentId: doc.id, ownerId: doc.ownerId, supplierKey: null, invoiceNumberKey: normalizeKey(rec.data.invoiceNumber) });
      for (const c of candidates) {
        if (isTabular(c.document)) continue;
        own.push({ documentId: c.document.id, filename: c.document.originalFilename, location: rec.location, comparison: compareInvoices(c.result.current, rec.data) });
        const issues = crossDocumentIssues([{ documentId: doc.id, filename: doc.originalFilename, location: rec.location, comparison: compareInvoices(c.result.current, rec.data) }], c.result.current.currency);
        peers.set(c.document.id, [...(peers.get(c.document.id) ?? []), ...issues]);
      }
    }
    return { own, peers: [...peers].map(([documentId, issues]) => ({ documentId, issues })) };
  }
}
