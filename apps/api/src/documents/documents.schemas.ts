import { z } from 'zod';
import { DOCUMENT_TYPES, PROCESSING_STATUSES, REVIEW_STATUSES } from '../domain/types.js';
import { DOCUMENT_SORT_FIELDS } from '../application/ports.js';

export const MAX_PAGE_SIZE = 100;
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD').refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'Not a valid calendar date');
const amount = z.string().regex(/^-?\d{1,15}(\.\d{1,4})?$/, 'Expected a decimal number');
const currency = z.string().regex(/^[A-Z]{3}$/, 'Expected a 3-letter ISO 4217 code');

export const pageQuery = {
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(20),
};

export const filtersShape = {
  status: z.enum(PROCESSING_STATUSES).optional(),
  reviewStatus: z.enum(REVIEW_STATUSES).optional(),
  documentType: z.enum(DOCUMENT_TYPES).optional(),
  supplier: z.string().trim().min(1).max(100).optional(),
  currency: currency.optional(),
  invoiceDateFrom: isoDate.optional(), invoiceDateTo: isoDate.optional(),
  minAmount: amount.optional(), maxAmount: amount.optional(),
  createdFrom: z.iso.datetime().optional(), createdTo: z.iso.datetime().optional(),
};

/** Cross-field checks shared by every filterable endpoint. */
export const rangeChecks = <S extends z.ZodObject>(schema: S) =>
  schema.superRefine((value, ctx) => {
    const v = value as Record<string, unknown>;
    const pairs: [string, string][] = [['invoiceDateFrom', 'invoiceDateTo'], ['createdFrom', 'createdTo']];
    for (const [a, b] of pairs) {
      if (typeof v[a] === 'string' && typeof v[b] === 'string' && v[a] > v[b]) ctx.addIssue({ code: 'custom', path: [a], message: `${a} must not be after ${b}` });
    }
    if (typeof v['minAmount'] === 'string' && typeof v['maxAmount'] === 'string' && Number(v['minAmount']) > Number(v['maxAmount'])) {
      ctx.addIssue({ code: 'custom', path: ['minAmount'], message: 'minAmount must not exceed maxAmount' });
    }
  });

export const listQuerySchema = rangeChecks(z.object({
  ...pageQuery, ...filtersShape,
  text: z.string().trim().min(1).max(100).optional(),
  sortBy: z.enum(DOCUMENT_SORT_FIELDS).default('createdAt'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
}));
export type ListQueryDto = z.infer<typeof listQuerySchema>;
