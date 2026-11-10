export type ProcessingStatus = 'uploaded' | 'queued' | 'validating' | 'extracting' | 'ocr' | 'structuring' | 'validating_result' | 'indexed' | 'completed' | 'rejected' | 'failed' | 'cancelled';
export type ReviewStatus = 'not_required' | 'pending' | 'reviewed';
export type Severity = 'info' | 'warning' | 'error';

export interface FieldError { code: string; field: string | null; message: string }
export interface Page<T> { items: T[]; total: number; page: number; pageSize: number }
export interface Invoice { invoiceNumber: string | null; invoiceDate: string | null; supplierName: string | null; totalAmount: string | null; currency: string | null; requiresManualReview: boolean }
export interface DocumentSummary {
  id: string; filename: string; mimeType: string; sizeBytes: number; sha256: string; documentType: string;
  processingStatus: ProcessingStatus; reviewStatus: ReviewStatus; failure: { code: string; message: string | null } | null;
  createdAt: string; updatedAt: string; invoice?: Invoice | null;
}
export interface Attempt {
  id: string; attemptNumber: number; stage: string; status: 'running' | 'succeeded' | 'failed';
  error: { code: string; message: string | null; retryable: boolean } | null; startedAt: string; finishedAt: string | null;
}
export interface DocumentDetail extends DocumentSummary { attempts: Attempt[] }
export interface Evidence { sourcePage: number | null; sourceSheet: string | null; sourceCell: string | null; text: string | null }
export interface LineItem { description: string | null; quantity: string | null; unitPrice: string | null; taxAmount: string | null; lineTotal: string | null }
export interface InvoiceData {
  schemaVersion: string; documentType: string; invoiceNumber: string | null; invoiceDate: string | null; supplierName: string | null; customerName: string | null;
  subtotal: string | null; taxAmount: string | null; totalAmount: string | null; currency: string | null; lineItems: LineItem[];
  fieldEvidence: Record<string, Evidence | undefined>; fieldConfidence: Record<string, number | null | undefined>; requiresManualReview: boolean;
}
export interface Issue { id: string; code: string; severity: Severity; message: string; fields: string[]; details: Record<string, unknown>; resolution: 'open' | 'resolved' | 'waived' }
export interface ResultView {
  document: DocumentSummary;
  result: { id: string; version: number; extraction: InvoiceData; original: InvoiceData; extractor: { provider: string; version: string }; updatedAt: string } | null;
  issues: Issue[];
}
export interface History {
  attempts: Attempt[];
  corrections: { id: string; actorId: string; field: string; previousValue: unknown; correctedValue: unknown; reason: string | null; createdAt: string }[];
  audit: { id: string; actorId: string | null; event: string; metadata: Record<string, unknown>; createdAt: string }[];
}
export interface Stats { total: number; byStatus: Record<string, number>; requiresReview: number; failed: number }
export interface SearchHit { documentId: string; document: DocumentSummary; score: number; snippet: string; location: { page: number | null; sheet: string | null; range: string | null } }
export interface Me { id: string; email: string; role: 'admin' | 'reviewer' | 'uploader' }
export interface Capabilities { keywordSearch: boolean; semanticSearch: boolean; databaseProvider: string }
