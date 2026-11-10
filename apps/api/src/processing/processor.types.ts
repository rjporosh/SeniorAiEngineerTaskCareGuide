import { z } from 'zod';

/** Contract of the internal document-processor (validated at the boundary; the service is not trusted blindly). */
export const blockSchema = z.object({
  id: z.string(), kind: z.enum(['text', 'row']), page: z.number().int().nullable().optional(),
  sheet: z.string().nullable().optional(), range: z.string().nullable().optional(), text: z.string(),
  source: z.enum(['embedded', 'ocr', 'cell']), confidence: z.number().min(0).max(1).nullable().optional(),
  cells: z.array(z.object({ ref: z.string(), value: z.string() })).nullable().optional(),
});
export const processResponseSchema = z.object({
  file_kind: z.enum(['pdf', 'jpeg', 'png', 'tiff', 'xlsx', 'xls', 'csv']),
  blocks: z.array(blockSchema),
  warnings: z.array(z.object({ code: z.string(), message: z.string(), page: z.number().nullable().optional() })),
  stats: z.object({
    pages: z.number(), embedded_pages: z.number(), ocr_pages: z.number(), sheets: z.number(), rows: z.number(), duration_ms: z.number(),
  }),
});
export type Block = z.infer<typeof blockSchema>;
export type ProcessResponse = z.infer<typeof processResponseSchema>;
