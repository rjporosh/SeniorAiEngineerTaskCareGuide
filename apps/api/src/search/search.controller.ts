import { Controller, Get, Inject, Query } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../common/decorators.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { SearchService, searchQuerySchema, type SearchQueryDto } from './search.service.js';

@Controller()
export class SearchController {
  constructor(@Inject(SearchService) private readonly search: SearchService) {}

  @Get('search')
  run(@CurrentUser() u: AuthUser, @Query(new ZodPipe(searchQuerySchema)) q: SearchQueryDto) { return this.search.search(u, q); }

  @Get('capabilities')
  capabilities() { return this.search.capabilities(); }
}
