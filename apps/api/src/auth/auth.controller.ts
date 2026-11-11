import { Op, ApiTags, ZodBody } from '../common/openapi.js';
import { Body, Controller, Get, HttpCode, Inject, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { CurrentUser, Public, Roles, type AuthUser } from '../common/decorators.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { AuthService } from './auth.service.js';

const email = z.email().max(254).transform((v) => v.toLowerCase());
const password = z.string().min(12, 'Password must be at least 12 characters').max(128);
const loginSchema = z.object({ email, password: z.string().min(1).max(128) });
const refreshSchema = z.object({ refreshToken: z.string().min(20).max(200) });
const createUserSchema = z.object({ email, password, role: z.enum(['admin', 'reviewer', 'uploader']) });

const LOGIN_LIMIT = Number(process.env['LOGIN_RATE_LIMIT_PER_MINUTE'] ?? 10);

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Op('Sign in', { description: 'Exchanges email and password for a short-lived access token and a rotating refresh token. Rate limited per IP.', auth: false, errors: [400, 401, 429] })
  @ZodBody(loginSchema) @Public() @Post('login') @HttpCode(200) @Throttle({ default: { limit: LOGIN_LIMIT, ttl: 60_000 } })
  login(@Body(new ZodPipe(loginSchema)) b: z.infer<typeof loginSchema>) { return this.auth.login(b.email, b.password); }

  @Op('Refresh the session', { description: 'Rotates the refresh token; reuse of an old token revokes the whole token family.', auth: false, errors: [400, 401, 429] })
  @ZodBody(refreshSchema) @Public() @Post('refresh') @HttpCode(200) @Throttle({ default: { limit: LOGIN_LIMIT, ttl: 60_000 } })
  refresh(@Body(new ZodPipe(refreshSchema)) b: z.infer<typeof refreshSchema>) { return this.auth.refresh(b.refreshToken); }

  @Op('Sign out', { description: 'Revokes the refresh token family.', auth: false, status: 204, ok: 'Signed out', errors: [400] })
  @ZodBody(refreshSchema) @Public() @Post('logout') @HttpCode(204)
  async logout(@Body(new ZodPipe(refreshSchema)) b: z.infer<typeof refreshSchema>): Promise<void> { await this.auth.logout(b.refreshToken); }

  @Get('me') @Op('Current user', { errors: [401] })
  me(@CurrentUser() u: AuthUser) { return this.auth.me(u.id); }

  @Op('Create a user', { description: 'Admin only. Passwords need at least 12 characters and are stored as Argon2id hashes.', status: 201 })
  @ZodBody(createUserSchema) @Roles('admin') @Post('users')
  async create(@Body(new ZodPipe(createUserSchema)) b: z.infer<typeof createUserSchema>) {
    const u = await this.auth.createUser(b.email, b.password, b.role);
    return { id: u.id, email: u.email, role: u.role };
  }
}
