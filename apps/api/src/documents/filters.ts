import type { DocumentFilters } from '../application/ports.js';
import type { ListQueryDto } from './documents.schemas.js';

type FilterInput = Omit<ListQueryDto, 'page' | 'pageSize' | 'sortBy' | 'sortDir'>;

/** Query DTO -> repository filters, always scoped to the caller's visibility. */
export function toFilters(q: FilterInput, ownerId: string | undefined): DocumentFilters {
  const f: DocumentFilters = {};
  if (ownerId) f.ownerId = ownerId;
  if (q.status) f.status = q.status;
  if (q.reviewStatus) f.reviewStatus = q.reviewStatus;
  if (q.documentType) f.documentType = q.documentType;
  if (q.supplier) f.supplier = q.supplier;
  if (q.currency) f.currency = q.currency;
  if (q.invoiceDateFrom) f.invoiceDateFrom = q.invoiceDateFrom;
  if (q.invoiceDateTo) f.invoiceDateTo = q.invoiceDateTo;
  if (q.minAmount) f.minAmount = q.minAmount;
  if (q.maxAmount) f.maxAmount = q.maxAmount;
  if (q.createdFrom) f.createdFrom = new Date(q.createdFrom);
  if (q.createdTo) f.createdTo = new Date(q.createdTo);
  if (q.text) f.text = q.text;
  return f;
}
