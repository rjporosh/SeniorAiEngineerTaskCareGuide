import type { Repositories } from '../application/ports.js';
import { normalizeKey } from '../domain/normalize.js';
import type { DocumentRecord, InvoiceData, NewIssue, ResultRecord } from '../domain/types.js';
import type { ExtractionNote } from '../extraction/types.js';
import { duplicateIssue, validateInvoice, type ValidationOutcome } from '../validation/validator.js';
import { CrossDocumentService, isTabular, type PeerUpdate } from './cross-document.js';
import type { Block } from './processor.types.js';

export interface DocumentValidation { outcome: ValidationOutcome; peers: PeerUpdate[] }

/** The single place that gathers context (duplicates, same-file, cross-document) and runs the pure validator. */
export class DocumentValidator {
  private readonly cross: CrossDocumentService;
  constructor(private readonly repos: Repositories) { this.cross = new CrossDocumentService(repos); }

  async validate(doc: DocumentRecord, data: InvoiceData, notes: ExtractionNote[] = [], blocks?: Block[]): Promise<DocumentValidation> {
    const invoiceNumberKey = normalizeKey(data.invoiceNumber);
    const [duplicates, sameFile] = await Promise.all([
      invoiceNumberKey ? this.repos.documents.findDuplicateCandidates({ documentId: doc.id, ownerId: doc.ownerId, supplierKey: normalizeKey(data.supplierName), invoiceNumberKey }) : [],
      this.repos.documents.findBySha256(doc.ownerId, doc.sha256, doc.id),
    ]);
    let crossDocuments;
    let peers: PeerUpdate[] = [];
    if (isTabular(doc)) {
      if (blocks) { const r = await this.cross.forSpreadsheet(doc, blocks); crossDocuments = r.own; peers = r.peers; }
    } else crossDocuments = await this.cross.forDocumentInvoice(doc, data);
    const outcome = validateInvoice(data, { notes, duplicates, sameFile, ...(crossDocuments && { crossDocuments }) });
    return { outcome, peers };
  }

  /**
   * Closes the race between documents processed at the same time: each validated before the other was saved.
   * Called after the result is durable; flags both sides (once) when a duplicate is now visible.
   */
  async reconcileDuplicates(doc: DocumentRecord, data: InvoiceData): Promise<void> {
    const invoiceNumberKey = normalizeKey(data.invoiceNumber);
    if (!invoiceNumberKey) return;
    const dups = await this.repos.documents.findDuplicateCandidates({ documentId: doc.id, ownerId: doc.ownerId, supplierKey: normalizeKey(data.supplierName), invoiceNumberKey });
    for (const dup of dups) {
      await this.flag(doc, dup.document.id, duplicateIssue(data, dup));
      await this.flag(dup.document, doc.id, duplicateIssue(dup.result.current, { document: doc, result: { current: data } as ResultRecord }));
    }
  }

  private async flag(target: DocumentRecord, otherId: string, issue: NewIssue): Promise<void> {
    const existing = await this.repos.documents.listIssues(target.id);
    if (existing.some((i) => i.code === issue.code && i.details['documentId'] === otherId)) return;
    await this.repos.documents.appendIssues(target.id, [issue]);
    const fresh = await this.repos.documents.findById(target.id);
    if (fresh) await this.repos.documents.updateStatus(fresh.id, fresh.processingStatus, { reviewStatus: 'pending' });
  }
}
