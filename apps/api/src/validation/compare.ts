import { Decimal, parseDecimal, withinTolerance } from '../domain/money.js';
import { normalizeKey } from '../domain/normalize.js';
import type { InvoiceData } from '../domain/types.js';

export type ComparedField = 'invoiceDate' | 'supplierName' | 'customerName' | 'subtotal' | 'taxAmount' | 'totalAmount' | 'currency';
export interface FieldDifference { field: ComparedField; left: string | null; right: string | null; delta?: string }
export interface Comparison { compared: ComparedField[]; differences: FieldDifference[]; matched: ComparedField[] }

const MONEY: ComparedField[] = ['subtotal', 'taxAmount', 'totalAmount'];
const TEXT: ComparedField[] = ['invoiceDate', 'currency'];
const NAMES: ComparedField[] = ['supplierName', 'customerName'];

/** Field-by-field comparison of two extractions of (supposedly) the same invoice. Only fields present on both sides count. */
export function compareInvoices(left: InvoiceData, right: InvoiceData): Comparison {
  const compared: ComparedField[] = []; const differences: FieldDifference[] = []; const matched: ComparedField[] = [];
  const currency = left.currency ?? right.currency;
  const record = (field: ComparedField, same: boolean, l: string | null, r: string | null, delta?: Decimal) => {
    compared.push(field);
    if (same) matched.push(field);
    else differences.push({ field, left: l, right: r, ...(delta && { delta: delta.toFixed() }) });
  };
  for (const f of MONEY) {
    const l = parseDecimal(left[f]); const r = parseDecimal(right[f]);
    if (l && r) record(f, withinTolerance(l, r, currency), left[f], right[f], l.minus(r));
  }
  for (const f of TEXT) if (left[f] && right[f]) record(f, left[f] === right[f], left[f], right[f]);
  for (const f of NAMES) {
    const l = normalizeKey(left[f]); const r = normalizeKey(right[f]);
    if (l && r) record(f, l === r || l.includes(r) || r.includes(l), left[f], right[f]);
  }
  return { compared, differences, matched };
}
