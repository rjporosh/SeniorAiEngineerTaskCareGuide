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

@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Public() @Post('login') @HttpCode(200) @Throttle({ default: { limit: LOGIN_LIMIT, ttl: 60_000 } })
  login(@Body(new ZodPipe(loginSchema)) b: z.infer<typeof loginSchema>) { return this.auth.login(b.email, b.password); }

  @Public() @Post('refresh') @HttpCode(200) @Throttle({ default: { limit: LOGIN_LIMIT, ttl: 60_000 } })
  refresh(@Body(new ZodPipe(refreshSchema)) b: z.infer<typeof refreshSchema>) { return this.auth.refresh(b.refreshToken); }

  @Public() @Post('logout') @HttpCode(204)
  async logout(@Body(new ZodPipe(refreshSchema)) b: z.infer<typeof refreshSchema>): Promise<void> { await this.auth.logout(b.refreshToken); }

  @Get('me')
  me(@CurrentUser() u: AuthUser) { return this.auth.me(u.id); }

  @Roles('admin') @Post('users')
  async create(@Body(new ZodPipe(createUserSchema)) b: z.infer<typeof createUserSchema>) {
    const u = await this.auth.createUser(b.email, b.password, b.role);
    return { id: u.id, email: u.email, role: u.role };
  }
}
