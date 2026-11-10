import type { Block, ProcessResponse } from '../processing/processor.types.js';

export const textPage = (page: number, text: string, confidence: number | null = null, source: 'embedded' | 'ocr' = 'embedded'): Block =>
  ({ id: `p${page}`, kind: 'text', page, text, source, confidence });

export const rowBlock = (sheet: string, rowNo: number, values: string[], startCol = 1): Block => {
  const col = (n: number) => String.fromCharCode(64 + n);
  const cells = values.map((value, i) => ({ ref: `${col(startCol + i)}${rowNo}`, value }));
  return { id: `r${sheet}${rowNo}`, kind: 'row', sheet, range: `${cells[0]!.ref}:${cells.at(-1)!.ref}`, text: values.join(' | '), source: 'cell', cells };
};

export const response = (blocks: Block[], kind: ProcessResponse['file_kind'] = 'pdf'): ProcessResponse => ({
  file_kind: kind, blocks, warnings: [], stats: { pages: 1, embedded_pages: 1, ocr_pages: 0, sheets: 0, rows: 0, duration_ms: 1 },
});
