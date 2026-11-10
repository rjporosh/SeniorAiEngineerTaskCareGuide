import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC, ROLES, type AuthedRequest } from '../common/decorators.js';
import { forbidden, unauthorized } from '../common/errors.js';
import { currentContext } from '../common/request-context.js';
import type { Role } from '../domain/types.js';
import { TokenService } from './token.service.js';

/** Global guard: every route requires a valid bearer token unless marked @Public(); @Roles() adds RBAC. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector, @Inject(TokenService) private readonly tokens: TokenService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization;
    const [scheme, token] = header?.split(' ') ?? [];
    if (scheme?.toLowerCase() !== 'bearer' || !token) throw unauthorized();
    const claims = await this.tokens.verifyAccess(token);
    req.user = { id: claims.sub, email: claims.email, role: claims.role };
    const store = currentContext();
    if (store) store.userId = claims.sub;
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES, targets);
    if (roles && !roles.includes(claims.role)) throw forbidden();
    return true;
  }
}
