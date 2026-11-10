import type { DocumentRecord } from '../domain/types.js';
import type { AuthUser } from '../common/decorators.js';
import { notFound } from '../common/errors.js';

/** admin/reviewer may see every document; uploaders only their own. Foreign documents look non-existent. */
export const canSeeAll = (u: AuthUser): boolean => u.role === 'admin' || u.role === 'reviewer';
export const ownerScope = (u: AuthUser): string | undefined => (canSeeAll(u) ? undefined : u.id);

export function assertCanRead(u: AuthUser, doc: DocumentRecord | null): DocumentRecord {
  if (!doc || (!canSeeAll(u) && doc.ownerId !== u.id)) throw notFound('Document');
  return doc;
}
