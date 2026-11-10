import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { Role } from '../domain/types.js';

export interface AuthUser { id: string; email: string; role: Role }
export type AuthedRequest = Request & { user?: AuthUser };

export const IS_PUBLIC = 'isPublic';
export const IS_RAW = 'isRawResponse';
export const ROLES = 'roles';

/** Route needs no authentication. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Response is not wrapped in the envelope (probes, file streams, metrics). */
export const RawResponse = () => SetMetadata(IS_RAW, true);
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

export const CurrentUser = createParamDecorator((_d: unknown, ctx: ExecutionContext): AuthUser => {
  const user = ctx.switchToHttp().getRequest<AuthedRequest>().user;
  if (!user) throw new Error('CurrentUser used on a public route');
  return user;
});
