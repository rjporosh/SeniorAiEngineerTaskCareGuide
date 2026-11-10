import { createHash } from 'node:crypto';
import { tokenize } from './normalize.js';

export const EMBEDDING_DIM = 256;

/**
 * Deterministic feature-hashing embedding (signed bag of unigrams and bigrams, L2-normalised).
 * It is a lexical-semantic approximation with no network or model dependency; it can be replaced
 * by a model-backed adapter behind EmbeddingPort without touching storage (dimension is configurable).
 */
export function hashEmbedding(text: string, dim = EMBEDDING_DIM): number[] {
  const v = new Array<number>(dim).fill(0);
  const tokens = tokenize(text);
  const add = (feature: string, weight: number) => {
    const h = createHash('sha1').update(feature).digest();
    const idx = h.readUInt32BE(0) % dim;
    v[idx] = (v[idx] ?? 0) + ((h[4] ?? 0) & 1 ? weight : -weight);
  };
  tokens.forEach((t, i) => {
    add(t, 1);
    const next = tokens[i + 1];
    if (next) add(`${t} ${next}`, 0.5);
  });
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return norm === 0 ? v : v.map((x) => x / norm);
}

export const cosine = (a: number[], b: number[]): number => {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += (a[i] ?? 0) * (b[i] ?? 0);
  return dot;
};
