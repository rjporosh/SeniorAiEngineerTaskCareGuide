import type { InvoiceData } from '../domain/types.js';

export type NoteCode = 'DATE_AMBIGUOUS' | 'DATE_UNPARSEABLE' | 'AMOUNT_UNPARSEABLE' | 'MULTIPLE_RECORDS' | 'LOW_CONFIDENCE';
/** Observations made while extracting that the validator turns into issues. */
export interface ExtractionNote { code: NoteCode; field?: string; raw?: string; detail?: Record<string, unknown> }
export interface ExtractionResult { data: InvoiceData; notes: ExtractionNote[] }

export interface InvoiceExtractorPort {
  readonly info: { provider: string; version: string; promptVersion: string };
  extract(input: import('../processing/processor.types.js').ProcessResponse): ExtractionResult;
}
