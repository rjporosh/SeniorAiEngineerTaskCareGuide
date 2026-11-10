/** Codes that mean "the file itself is unusable": the document is rejected, not retried. */
export const REJECTION_CODES = new Set([
  'UNSUPPORTED_FILE', 'CORRUPT_FILE', 'PDF_ENCRYPTED', 'EMPTY_FILE', 'UNSAFE_ARCHIVE', 'FILE_TOO_LARGE', 'IMAGE_TOO_LARGE',
  'PAGE_LIMIT_EXCEEDED', 'SPREADSHEET_LIMIT_EXCEEDED', 'TEXT_LIMIT_EXCEEDED',
]);

const MESSAGES: Record<string, string> = {
  UNSUPPORTED_FILE: 'This file type is not supported.',
  CORRUPT_FILE: 'The file appears to be corrupt and could not be read. Please re-export it and upload again.',
  PDF_ENCRYPTED: 'The PDF is password-protected. Remove the password and upload it again.',
  EMPTY_FILE: 'The file is empty.',
  UNSAFE_ARCHIVE: 'The workbook was rejected because its internal structure is unsafe.',
  FILE_TOO_LARGE: 'The file exceeds the maximum allowed size.',
  IMAGE_TOO_LARGE: 'The image resolution is too high to process safely.',
  PAGE_LIMIT_EXCEEDED: 'The document has more pages than the configured limit.',
  SPREADSHEET_LIMIT_EXCEEDED: 'The spreadsheet is larger than the configured row, cell or sheet limit.',
  TEXT_LIMIT_EXCEEDED: 'The document contains more text than the configured limit.',
  PROCESSING_TIMEOUT: 'Processing took too long and was stopped. Try a smaller file or reprocess later.',
  OCR_TIMEOUT: 'Text recognition took too long on a page.',
  OCR_FAILED: 'Text recognition failed on a page.',
  PROCESSOR_UNAVAILABLE: 'The document processor was unavailable. The document can be reprocessed.',
  PROCESSOR_TIMEOUT: 'The document processor timed out. The document can be reprocessed.',
  BUSY: 'The processor was busy. The document can be reprocessed.',
};
export const failureMessage = (code: string): string => MESSAGES[code] ?? 'Processing failed. The document can be reprocessed.';
