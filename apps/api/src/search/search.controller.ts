import { Op, ApiTags, ZodQuery } from '../common/openapi.js';
import { Controller, Get, Inject, Query } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../common/decorators.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { SearchService, searchQuerySchema, type SearchQueryDto } from './search.service.js';

@ApiTags('Search')
@Controller()
export class SearchController {
  constructor(@Inject(SearchService) private readonly search: SearchService) {}

  @Get('search') @ZodQuery(searchQuerySchema)
  @Op('Search documents', { description: '`mode=keyword` uses full-text search; `mode=semantic` ranks by meaning (vector similarity) and is only available when the database provider supports it (see /capabilities). Returns plain-text snippets — render them as text, never HTML.', errors: [400, 401, 429] })
  run(@CurrentUser() u: AuthUser, @Query(new ZodPipe(searchQuerySchema)) q: SearchQueryDto) { return this.search.search(u, q); }

  @Get('capabilities') @Op('Search capabilities', { description: 'Tells clients whether semantic search is available with the configured database provider.', errors: [401] })
  capabilities() { return this.search.capabilities(); }
}
