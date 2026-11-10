import type {
  AttemptRecord, AuditRecord, ChunkRecord, CorrectionRecord, DocumentRecord, DocumentType,
  InvoiceData, IssueRecord, NewChunk, NewIssue, OutboxRecord, ProcessingStatus,
  RefreshTokenRecord, ResultRecord, ReviewStatus, Role, UserRecord, ExtractorInfo,
} from '../domain/types.js';

export interface PageQuery { page: number; pageSize: number }
export interface Page<T> { items: T[]; total: number; page: number; pageSize: number }

export interface DocumentFilters {
  ownerId?: string;
  status?: ProcessingStatus;
  reviewStatus?: ReviewStatus;
  documentType?: DocumentType;
  supplier?: string;
  currency?: string;
  invoiceDateFrom?: string; invoiceDateTo?: string;
  minAmount?: string; maxAmount?: string;
  createdFrom?: Date; createdTo?: Date;
  text?: string; // filename / invoice number contains
}
export const DOCUMENT_SORT_FIELDS = ['createdAt', 'updatedAt', 'originalFilename', 'processingStatus'] as const;
export interface ListQuery extends PageQuery {
  filters: DocumentFilters;
  sortBy: (typeof DOCUMENT_SORT_FIELDS)[number];
  sortDir: 'asc' | 'desc';
}
export interface InvoiceSummary {
  invoiceNumber: string | null; invoiceDate: string | null; supplierName: string | null;
  totalAmount: string | null; currency: string | null; requiresManualReview: boolean;
}
export interface DocumentListItem { document: DocumentRecord; invoice: InvoiceSummary | null }

export interface NewDocument {
  ownerId: string; originalFilename: string; detectedMime: string; byteSize: number; sha256: string;
  storageKey: string; storageProvider: string; idempotencyKey: string | null;
}
export interface NewOutbox { topic: string; payload: Record<string, unknown> }

export interface SaveResultInput {
  documentId: string; attemptId: string; data: InvoiceData; extractor: ExtractorInfo;
}
export interface DuplicateQuery {
  documentId: string; ownerId: string; supplierKey: string | null; invoiceNumberKey: string | null;
}
export interface SearchHit {
  documentId: string; chunkId: string; score: number; snippet: string; content: string;
  page: number | null; sheet: string | null; range: string | null;
}
export type SearchFilters = DocumentFilters;

export interface StatsSummary {
  total: number; byStatus: Record<string, number>; requiresReview: number; failed: number;
}

/** Thrown when an adapter cannot provide a capability (e.g. vectors on MongoDB). */
export class NotSupportedError extends Error {
  constructor(public readonly capability: string) {
    super(`Capability not supported by the selected database provider: ${capability}`);
    this.name = 'NotSupportedError';
  }
}
/** Thrown on optimistic-concurrency violations. */
export class ConcurrencyError extends Error {
  constructor(message = 'The record was modified by someone else') {
    super(message);
    this.name = 'ConcurrencyError';
  }
}

export interface UserRepository {
  create(input: { email: string; passwordHash: string; role: Role }): Promise<UserRecord>;
  findByEmail(email: string): Promise<UserRecord | null>;
  findById(id: string): Promise<UserRecord | null>;
  saveRefreshToken(t: Omit<RefreshTokenRecord, 'id' | 'createdAt' | 'revokedAt'>): Promise<void>;
  findRefreshToken(tokenHash: string): Promise<RefreshTokenRecord | null>;
  revokeRefreshToken(id: string): Promise<void>;
  revokeFamily(familyId: string): Promise<void>;
}

export interface DocumentRepository {
  readonly capabilities: { semanticSearch: boolean };
  /** Creates the document, its first attempt and the outbox message atomically. */
  createWithOutbox(doc: NewDocument, outbox: (documentId: string, attemptId: string) => NewOutbox): Promise<DocumentRecord>;
  findById(id: string): Promise<DocumentRecord | null>;
  findByIdempotencyKey(ownerId: string, key: string): Promise<DocumentRecord | null>;
  list(query: ListQuery): Promise<Page<DocumentListItem>>;
  updateStatus(id: string, status: ProcessingStatus, patch?: { failureCode?: string | null; failureMessage?: string | null; reviewStatus?: ReviewStatus; documentType?: DocumentType }): Promise<void>;

  /** Starts a new attempt and enqueues its message atomically (used by reprocess). */
  startAttemptWithOutbox(documentId: string, outbox: (attempt: AttemptRecord) => NewOutbox): Promise<AttemptRecord>;
  /** Starts a new attempt without outbox (worker consuming a message for an attempt-less upload). */
  startAttempt(documentId: string): Promise<AttemptRecord>;
  updateAttemptStage(attemptId: string, stage: ProcessingStatus): Promise<void>;
  finishAttempt(attemptId: string, outcome: { status: 'succeeded' | 'failed'; errorCode?: string; errorMessage?: string; retryable?: boolean }): Promise<void>;
  listAttempts(documentId: string): Promise<AttemptRecord[]>;
  findAttempt(attemptId: string): Promise<AttemptRecord | null>;

  saveResult(input: SaveResultInput): Promise<ResultRecord>;
  findCurrentResult(documentId: string): Promise<ResultRecord | null>;
  /** Applies corrected values with optimistic concurrency; throws ConcurrencyError on version mismatch. */
  applyCorrections(resultId: string, expectedVersion: number, next: InvoiceData, corrections: Omit<CorrectionRecord, 'id' | 'createdAt'>[]): Promise<ResultRecord>;
  listCorrections(documentId: string): Promise<CorrectionRecord[]>;

  replaceIssues(documentId: string, issues: NewIssue[]): Promise<IssueRecord[]>;
  appendIssues(documentId: string, issues: NewIssue[]): Promise<IssueRecord[]>;
  listIssues(documentId: string): Promise<IssueRecord[]>;
  resolveIssue(issueId: string, resolution: 'resolved' | 'waived'): Promise<void>;

  replaceChunks(documentId: string, chunks: NewChunk[]): Promise<void>;
  countChunks(documentId: string): Promise<number>;

  /** Documents of the same owner with identical file content (exact byte duplicates). */
  findBySha256(ownerId: string, sha256: string, excludeId: string): Promise<DocumentRecord[]>;
  findDuplicateCandidates(q: DuplicateQuery): Promise<{ document: DocumentRecord; result: ResultRecord }[]>;
  searchKeyword(q: string, filters: SearchFilters, page: PageQuery): Promise<Page<SearchHit>>;
  /** Throws NotSupportedError when `capabilities.semanticSearch` is false. */
  searchSemantic(vector: number[], filters: SearchFilters, page: PageQuery): Promise<Page<SearchHit>>;

  addAudit(a: Omit<AuditRecord, 'id' | 'createdAt'>): Promise<void>;
  listAudit(documentId: string): Promise<AuditRecord[]>;
  stats(ownerId?: string): Promise<StatsSummary>;
}

export interface OutboxRepository {
  claimPending(limit: number, now: Date): Promise<OutboxRecord[]>;
  markSent(id: string): Promise<void>;
  markFailed(id: string, error: string, retryAt: Date, dead: boolean): Promise<void>;
}

export interface Repositories {
  readonly provider: 'postgres' | 'mongodb' | 'memory';
  users: UserRepository;
  documents: DocumentRepository;
  outbox: OutboxRepository;
  ping(): Promise<void>;
  close(): Promise<void>;
}

export type { ChunkRecord };
