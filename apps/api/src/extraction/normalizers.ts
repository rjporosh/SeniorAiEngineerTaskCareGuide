import { Decimal } from '../domain/money.js';

export const ISO_CURRENCIES = new Set([
  'USD', 'EUR', 'GBP', 'JPY', 'CNY', 'INR', 'BDT', 'CAD', 'AUD', 'NZD', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'RON',
  'TRY', 'RUB', 'UAH', 'ZAR', 'BRL', 'MXN', 'ARS', 'CLP', 'COP', 'PEN', 'SGD', 'HKD', 'KRW', 'THB', 'MYR', 'IDR', 'PHP', 'VND',
  'PKR', 'LKR', 'NPR', 'AED', 'SAR', 'QAR', 'KWD', 'BHD', 'OMR', 'JOD', 'ILS', 'EGP', 'NGN', 'KES', 'GHS', 'MAD', 'TND',
]);
const SYMBOLS: Record<string, string> = { '€': 'EUR', '£': 'GBP', '৳': 'BDT', '₹': 'INR', '₩': 'KRW', '₫': 'VND', '₪': 'ILS', '฿': 'THB', '₺': 'TRY', '₽': 'RUB', '₴': 'UAH' };

/** ISO 4217 code from an explicit code or an unambiguous symbol. "$" and "¥" are ambiguous and yield null. */
export function detectCurrency(text: string): string | null {
  for (const m of text.toUpperCase().matchAll(/\b[A-Z]{3}\b/g)) if (ISO_CURRENCIES.has(m[0])) return m[0];
  for (const [sym, iso] of Object.entries(SYMBOLS)) if (text.includes(sym)) return iso;
  return null;
}

/**
 * Parses a printed amount into a canonical decimal string (no grouping, '.' decimal separator).
 * Handles 1,234.56 / 1.234,56 / 1 234,56 / (12.00) / -12.00 / currency symbols. Returns null when unsure.
 */
export function parseAmount(raw: string): string | null {
  let s = raw.trim();
  if (s === '') return null;
  const parenNeg = /^\(.*\)$/.test(s);
  s = s.replace(/^\(|\)$/g, '').replace(/\b[A-Za-z]{3}\b/g, (t) => (ISO_CURRENCIES.has(t.toUpperCase()) ? '' : t));
  s = s.replace(/[$€£¥₹৳₩₫₪฿₺₽₴\s\u00a0]/g, '');
  let neg = parenNeg;
  if (s.startsWith('-') || s.startsWith('−')) { neg = true; s = s.slice(1); }
  if (s.endsWith('-')) { neg = true; s = s.slice(0, -1); }
  if (!/^[\d.,']+$/.test(s) || !/\d/.test(s)) return null;
  s = s.replace(/'/g, '');
  const lastDot = s.lastIndexOf('.'); const lastComma = s.lastIndexOf(',');
  let normalized: string;
  if (lastDot >= 0 && lastComma >= 0) {
    const decimalSep = lastDot > lastComma ? '.' : ',';
    const group = decimalSep === '.' ? ',' : '.';
    normalized = s.split(group).join('').replace(decimalSep, '.');
  } else if (lastComma >= 0 || lastDot >= 0) {
    const sep = lastComma >= 0 ? ',' : '.';
    const parts = s.split(sep);
    if (parts.length > 2) normalized = parts.join('');                       // 1,234,567
    else if ((parts[1]?.length ?? 0) === 3 && (parts[0]?.length ?? 0) <= 3 && sep === ',') normalized = parts.join(''); // 1,234 -> thousands
    else normalized = `${parts[0]}.${parts[1]}`;
  } else normalized = s;
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  const d = new Decimal(normalized);
  return (neg && !d.isZero() ? d.neg() : d).toFixed();
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
export type DateParse =
  | { kind: 'iso'; value: string }
  | { kind: 'ambiguous'; raw: string }
  | { kind: 'invalid'; raw: string };

const pad = (n: number) => String(n).padStart(2, '0');
function valid(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || y < 1900 || y > 2200) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Normalises to YYYY-MM-DD only when the reading is unambiguous; numeric d/m vs m/d with both <= 12 is ambiguous. */
export function parseDate(raw: string): DateParse {
  const s = raw.trim().replace(/(\d)(st|nd|rd|th)\b/gi, '$1').replace(/,/g, ' ').replace(/\s+/g, ' ');
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (m) return valid(+m[1]!, +m[2]!, +m[3]!) ? { kind: 'iso', value: `${m[1]}-${pad(+m[2]!)}-${pad(+m[3]!)}` } : { kind: 'invalid', raw };
  m = /^(\d{1,2})[ -/.]([A-Za-z]{3,9})[ -/.](\d{4})$/.exec(s);
  if (m) { const mi = MONTHS.indexOf(m[2]!.slice(0, 3).toLowerCase()); return mi >= 0 && valid(+m[3]!, mi + 1, +m[1]!) ? { kind: 'iso', value: `${m[3]}-${pad(mi + 1)}-${pad(+m[1]!)}` } : { kind: 'invalid', raw }; }
  m = /^([A-Za-z]{3,9})[ -/.](\d{1,2})[ -/.](\d{4})$/.exec(s);
  if (m) { const mi = MONTHS.indexOf(m[1]!.slice(0, 3).toLowerCase()); return mi >= 0 && valid(+m[3]!, mi + 1, +m[2]!) ? { kind: 'iso', value: `${m[3]}-${pad(mi + 1)}-${pad(+m[2]!)}` } : { kind: 'invalid', raw }; }
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s);
  if (m) {
    const a = +m[1]!; const b = +m[2]!; const y = +m[3]!;
    if (a > 12 && valid(y, b, a)) return { kind: 'iso', value: `${y}-${pad(b)}-${pad(a)}` };
    if (b > 12 && valid(y, a, b)) return { kind: 'iso', value: `${y}-${pad(a)}-${pad(b)}` };
    if (a === b && valid(y, a, b)) return { kind: 'iso', value: `${y}-${pad(a)}-${pad(b)}` };
    return valid(y, a, b) || valid(y, b, a) ? { kind: 'ambiguous', raw } : { kind: 'invalid', raw };
  }
  return { kind: 'invalid', raw };
}
