import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { hashEmbedding } from '../domain/embedding.js';
import { tokenize } from '../domain/normalize.js';
import type { Repositories, SearchHit } from '../application/ports.js';
import type { AuthUser } from '../common/decorators.js';
import { canSeeAll } from '../documents/access.js';
import { filtersShape, rangeChecks } from '../documents/documents.schemas.js';
import { toFilters } from '../documents/filters.js';
import { toDocumentView } from '../documents/documents.service.js';
import { REPOSITORIES } from '../persistence.module.js';

export const searchQuerySchema = rangeChecks(z.object({
  q: z.string().trim().min(2, 'Enter at least 2 characters').max(200),
  mode: z.enum(['keyword', 'semantic']).default('keyword'),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
  ...filtersShape,
}));
export type SearchQueryDto = z.infer<typeof searchQuerySchema>;

/** Plain-text snippet around the first matching term. Never HTML: clients must render it as text. */
export function makeSnippet(content: string, query: string, max = 220): string {
  const flat = content.replace(/\s+/g, ' ').trim();
  const lower = flat.toLowerCase();
  const at = tokenize(query).map((t) => lower.indexOf(t)).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, at - 60);
  const piece = flat.slice(start, start + max);
  return `${start > 0 ? '…' : ''}${piece}${start + max < flat.length ? '…' : ''}`;
}

@Injectable()
export class SearchService {
  constructor(@Inject(REPOSITORIES) private readonly repos: Repositories) {}

  capabilities() {
    return { keywordSearch: true, semanticSearch: this.repos.documents.capabilities.semanticSearch, databaseProvider: this.repos.provider };
  }

  async search(user: AuthUser, q: SearchQueryDto) {
    const { q: query, mode, page, pageSize, ...rest } = q;
    const filters = toFilters(rest, canSeeAll(user) ? undefined : user.id);
    const res = mode === 'semantic'
      ? await this.repos.documents.searchSemantic(hashEmbedding(query), filters, { page, pageSize })
      : await this.repos.documents.searchKeyword(query, filters, { page, pageSize });
    const docs = new Map<string, Awaited<ReturnType<Repositories['documents']['findById']>>>();
    for (const id of new Set(res.items.map((h) => h.documentId))) docs.set(id, await this.repos.documents.findById(id));
    return {
      mode, total: res.total, page: res.page, pageSize: res.pageSize,
      items: res.items.flatMap((h: SearchHit) => {
        const d = docs.get(h.documentId);
        return d ? [{ documentId: h.documentId, document: toDocumentView(d), score: Number(h.score.toFixed(4)), snippet: makeSnippet(h.content, query), location: { page: h.page, sheet: h.sheet, range: h.range } }] : [];
      }),
    };
  }
}
