export type Split = { before: string; match: string; after: string };

const digits = (s: string) => s.replace(/\D/g, '').replace(/^0+/, '');

/** Finds where an extracted value appears in its evidence text so it can be highlighted (exact text first, then numeric look-alikes). */
export function splitEvidence(text: string, value: string | null): Split | null {
  if (!text || !value) return null;
  const numeric = /^-?\d+(\.\d+)?$/.test(value);
  const i = numeric ? -1 : text.toLowerCase().indexOf(value.toLowerCase());
  if (i >= 0) return { before: text.slice(0, i), match: text.slice(i, i + value.length), after: text.slice(i + value.length) };
  const want = digits(value.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, ''));
  if (!want) return null;
  for (const m of text.matchAll(/\d[\d.,' ]*\d|\d/g)) {
    const got = digits(m[0]);
    if (got === want || got.replace(/0+$/, '') === want.replace(/0+$/, '')) {
      const at = m.index ?? 0;
      return { before: text.slice(0, at), match: m[0], after: text.slice(at + m[0].length) };
    }
  }
  const j = text.toLowerCase().indexOf(value.toLowerCase());
  return j >= 0 ? { before: text.slice(0, j), match: text.slice(j, j + value.length), after: text.slice(j + value.length) } : null;
}
