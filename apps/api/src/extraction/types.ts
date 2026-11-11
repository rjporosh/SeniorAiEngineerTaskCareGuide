import type { ExtractorInfo, InvoiceData } from '../domain/types.js';
import type { ProcessResponse } from '../processing/processor.types.js';

export type NoteCode = 'DATE_AMBIGUOUS' | 'DATE_UNPARSEABLE' | 'AMOUNT_UNPARSEABLE' | 'MULTIPLE_RECORDS' | 'MULTIPLE_INVOICES' | 'LOW_CONFIDENCE';
/** Observations made while extracting that the validator turns into issues. */
export interface ExtractionNote { code: NoteCode; field?: string; raw?: string; detail?: Record<string, unknown> }
/** `extractor` is set when the producer differs from the configured one (e.g. an LLM call fell back to the rules). */
export interface ExtractionResult { data: InvoiceData; notes: ExtractionNote[]; extractor?: ExtractorInfo }

export interface InvoiceExtractorPort {
  readonly info: ExtractorInfo;
  extract(input: ProcessResponse): ExtractionResult | Promise<ExtractionResult>;
}

/** Raised when a model-backed extractor cannot produce a result and no fallback is configured. Retryable by the queue. */
export class ExtractionUnavailableError extends Error {
  readonly code = 'EXTRACTOR_UNAVAILABLE';
  readonly retryable = true;
  constructor(message: string, options?: { cause?: unknown }) { super(message, options); this.name = 'ExtractionUnavailableError'; }
}
