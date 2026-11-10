/** Label dictionaries shared by the free-text extractor, the table extractor and the cross-document comparer. */
export const LABELS = {
  invoiceNumber: /^(?:tax\s+)?(?:invoice|inv|bill|document|credit\s+note)\s*(?:no\.?|number|num|#|id|ref)\b/i,
  invoiceDate: /^(?:invoice\s+date|date\s+of\s+issue|issue\s+date|date\s+issued|billing\s+date|date)$/i,
  supplier: /^(?:from|supplier|vendor|seller|issued\s+by|sold\s+by|company)$/i,
  customer: /^(?:bill(?:ed)?\s+to|customer|client|sold\s+to|buyer|ship\s+to|billed\s+to)$/i,
  subtotal: /^(?:sub[\s-]?total|net\s+(?:amount|total)|total\s+(?:excl\w*|before)\b.*)$/i,
  tax: /^(?:tax|vat|gst|sales\s+tax|igst|cgst|sgst|tax\s+amount|vat\s+amount)(?:\s*\(?\s*\d+(?:\.\d+)?\s*%\)?)?$/i,
  total: /^(?:grand\s+total|total\s+due|amount\s+due|balance\s+due|total\s+payable|invoice\s+total|total\s+amount|total)$/i,
  currency: /^(?:currency|ccy)$/i,
  description: /^(?:description|item|product|details|particulars)$/i,
  quantity: /^(?:qty|quantity|units)$/i,
  unitPrice: /^(?:unit\s+price|price|rate|unit\s+cost)$/i,
  lineTax: /^(?:tax|vat|gst)(?:\s+amount)?$/i,
  lineTotal: /^(?:amount|line\s+total|total|net)$/i,
} as const;

export const TOTAL_PRIORITY: { re: RegExp; rank: number }[] = [
  { re: /\bgrand\s+total\b/i, rank: 4 },
  { re: /\b(?:total\s+due|amount\s+due|balance\s+due|total\s+payable|invoice\s+total|total\s+amount)\b/i, rank: 3 },
  { re: /^\s*total\b(?!\s*(?:tax|vat|gst|excl|before|\())/i, rank: 2 },
];
export const SUBTOTAL_RE = /\b(?:sub[\s-]?total|net\s+(?:amount|total)|total\s+(?:excl\w*|before)\s*(?:tax|vat|gst)?)\b/i;
export const TAX_RE = /^\s*(?:sales\s+)?(?:tax|vat|gst|igst|cgst|sgst)\b(?!\s*(?:invoice|id|no\b|number|reg|registration))(?:\s*\(?\s*\d+(?:\.\d+)?\s*%\)?)?/i;
export const DUE_DATE_RE = /\bdue\b/i;
export const COMPANY_SUFFIX_RE = /\b(?:ltd\.?|limited|llc|inc\.?|incorporated|gmbh|corp\.?|corporation|co\.|plc|pty|s\.?a\.?|ag|b\.?v\.?|pvt|s\.?r\.?l\.?|oy|ab)\b/i;
