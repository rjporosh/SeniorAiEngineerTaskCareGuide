/** Canonical key for duplicate matching: lowercase alphanumerics only. */
export const normalizeKey = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const k = value.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '');
  return k.length > 0 ? k : null;
};

export const tokenize = (text: string): string[] =>
  text.toLowerCase().normalize('NFKD').split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 1);
