export const PROCESSING_STATUSES = [
  'uploaded', 'queued', 'validating', 'extracting', 'ocr', 'structuring',
  'validating_result', 'indexed', 'completed', 'rejected', 'failed', 'cancelled',
] as const;
export type ProcessingStatus = (typeof PROCESSING_STATUSES)[number];
export const TERMINAL_STATUSES: readonly ProcessingStatus[] = ['completed', 'rejected', 'failed', 'cancelled'];

export const REVIEW_STATUSES = ['not_required', 'pending', 'reviewed'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const DOCUMENT_TYPES = ['invoice', 'credit_note', 'unknown'] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export type Role = 'admin' | 'reviewer' | 'uploader';
export type Severity = 'info' | 'warning' | 'error';
export type IssueResolution = 'open' | 'resolved' | 'waived';

export interface UserRecord {
  id: string; email: string; passwordHash: string; role: Role; createdAt: Date;
}
export interface RefreshTokenRecord {
  id: string; userId: string; familyId: string; tokenHash: string;
  expiresAt: Date; revokedAt: Date | null; createdAt: Date;
}

export interface DocumentRecord {
  id: string; ownerId: string; originalFilename: string; detectedMime: string;
  byteSize: number; sha256: string; storageKey: string; storageProvider: string;
  documentType: DocumentType; processingStatus: ProcessingStatus; reviewStatus: ReviewStatus;
  failureCode: string | null; failureMessage: string | null; idempotencyKey: string | null;
  createdAt: Date; updatedAt: Date;
}

export interface AttemptRecord {
  id: string; documentId: string; attemptNumber: number; stage: ProcessingStatus;
  status: 'running' | 'succeeded' | 'failed';
  errorCode: string | null; errorMessage: string | null; retryable: boolean;
  startedAt: Date; finishedAt: Date | null;
}

export interface Evidence { sourcePage: number | null; sourceSheet: string | null; sourceCell: string | null; text: string | null }
export interface LineItem {
  description: string | null; quantity: string | null; unitPrice: string | null;
  taxAmount: string | null; lineTotal: string | null;
}
export const INVOICE_FIELDS = [
  'invoiceNumber', 'invoiceDate', 'supplierName', 'customerName',
  'subtotal', 'taxAmount', 'totalAmount', 'currency',
] as const;
export type InvoiceField = (typeof INVOICE_FIELDS)[number];

export interface InvoiceData {
  schemaVersion: '1.0';
  documentType: DocumentType;
  invoiceNumber: string | null; invoiceDate: string | null;
  supplierName: string | null; customerName: string | null;
  subtotal: string | null; taxAmount: string | null; totalAmount: string | null;
  currency: string | null;
  lineItems: LineItem[];
  fieldEvidence: Partial<Record<InvoiceField, Evidence>>;
  fieldConfidence: Partial<Record<InvoiceField, number | null>>;
  requiresManualReview: boolean;
}

export interface ExtractorInfo { provider: string; version: string; promptVersion: string }

export interface ResultRecord {
  id: string; documentId: string; attemptId: string; isCurrent: boolean;
  /** Immutable extraction output. */
  raw: InvoiceData;
  /** Current values: raw plus human corrections. */
  current: InvoiceData;
  extractor: ExtractorInfo;
  version: number; // optimistic concurrency
  createdAt: Date; updatedAt: Date;
}

export interface IssueRecord {
  id: string; documentId: string; code: string; severity: Severity; message: string;
  fields: string[]; details: Record<string, unknown>; resolution: IssueResolution; createdAt: Date;
}
export type NewIssue = Omit<IssueRecord, 'id' | 'documentId' | 'createdAt' | 'resolution'>;

export interface ChunkRecord {
  id: string; documentId: string; chunkIndex: number; page: number | null;
  sheet: string | null; range: string | null; content: string; embedding: number[] | null;
}
export type NewChunk = Omit<ChunkRecord, 'id' | 'documentId'>;

export interface CorrectionRecord {
  id: string; documentId: string; resultId: string; actorId: string; fieldPath: string;
  previousValue: unknown; correctedValue: unknown; reason: string | null; createdAt: Date;
}
export interface AuditRecord {
  id: string; documentId: string | null; actorId: string | null; eventType: string;
  metadata: Record<string, unknown>; createdAt: Date;
}
export interface OutboxRecord {
  id: string; topic: string; payload: Record<string, unknown>;
  status: 'pending' | 'sent' | 'dead'; attempts: number;
  availableAt: Date; lastError: string | null; createdAt: Date; sentAt: Date | null;
}
