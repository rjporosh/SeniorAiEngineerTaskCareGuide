import { z } from 'zod';
import { DOCUMENT_TYPES } from '../domain/types.js';
import { isCalendarDate } from '../validation/validator.js';

const money = z.string().regex(/^-?\d{1,15}(\.\d{1,4})?$/, 'Expected a decimal number such as 1234.50').nullable();
const text = (max: number) => z.string().trim().min(1, 'Must not be empty (use null to clear)').max(max).nullable();
const lineItem = z.object({
  description: text(500), quantity: money, unitPrice: money, taxAmount: money, lineTotal: money,
}).strict();

export const changesSchema = z.object({
  documentType: z.enum(DOCUMENT_TYPES),
  invoiceNumber: text(64),
  invoiceDate: z.string().refine(isCalendarDate, 'Expected a real calendar date as YYYY-MM-DD').nullable(),
  supplierName: text(200), customerName: text(200),
  subtotal: money, taxAmount: money, totalAmount: money,
  currency: z.string().regex(/^[A-Z]{3}$/, 'Expected a 3-letter ISO 4217 code').nullable(),
  lineItems: z.array(lineItem).max(500),
}).partial().strict();

export const correctionSchema = z.object({
  expectedVersion: z.number().int().min(1),
  reason: z.string().trim().max(500).optional(),
  changes: changesSchema.refine((c) => Object.keys(c).length > 0, 'At least one field must be changed'),
}).strict();
export type CorrectionDto = z.infer<typeof correctionSchema>;

export const resolveIssueSchema = z.object({
  resolution: z.enum(['resolved', 'waived']),
  reason: z.string().trim().max(500).optional(),
}).strict();
export type ResolveIssueDto = z.infer<typeof resolveIssueSchema>;
