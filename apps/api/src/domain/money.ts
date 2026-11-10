import { Decimal } from 'decimal.js';

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });

export { Decimal };

/** ISO 4217 minor-unit exponents for currencies that are not 2. */
const MINOR_UNITS: Record<string, number> = { JPY: 0, KRW: 0, VND: 0, CLP: 0, BHD: 3, KWD: 3, OMR: 3, JOD: 3, TND: 3 };
export const minorUnits = (currency: string | null): number => MINOR_UNITS[currency ?? ''] ?? 2;

/** Parse a monetary string; returns null for anything non-finite or malformed. */
export function parseDecimal(value: string | null | undefined): Decimal | null {
  if (value === null || value === undefined) return null;
  const s = value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return new Decimal(s);
}

/** Allowed absolute difference: half of one minor unit multiplied by `factor`. */
export function tolerance(currency: string | null, factor = 1): Decimal {
  return new Decimal(10).pow(-minorUnits(currency)).mul(factor).div(2);
}

export const withinTolerance = (a: Decimal, b: Decimal, currency: string | null, factor = 1): boolean =>
  a.minus(b).abs().lte(tolerance(currency, factor));
