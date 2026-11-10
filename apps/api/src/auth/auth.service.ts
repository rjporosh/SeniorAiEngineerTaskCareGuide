import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { APP_CONFIG } from '../app.tokens.js';
import type { AppConfig } from '../config/env.schema.js';
import type { Repositories } from '../application/ports.js';
import { REPOSITORIES } from '../persistence.module.js';
import type { Role, UserRecord } from '../domain/types.js';
import { conflict, unauthorized } from '../common/errors.js';
import { PasswordService } from './password.service.js';
import { TokenService } from './token.service.js';

export interface Session {
  accessToken: string; refreshToken: string; tokenType: 'Bearer'; expiresIn: number;
  user: { id: string; email: string; role: Role };
}
const publicUser = (u: UserRecord) => ({ id: u.id, email: u.email, role: u.role });

@Injectable()
export class AuthService implements OnApplicationBootstrap {
  private readonly log = new Logger('Auth');
  constructor(
    @Inject(REPOSITORIES) private readonly repos: Repositories,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(TokenService) private readonly tokens: TokenService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  /** Creates the configured bootstrap accounts once. A demo account is a reviewer: it can upload, review and correct but cannot manage users. */
  async onApplicationBootstrap(): Promise<void> {
    await this.seed(this.cfg.SEED_ADMIN_EMAIL, this.cfg.SEED_ADMIN_PASSWORD, 'admin');
    await this.seed(this.cfg.SEED_DEMO_EMAIL, this.cfg.SEED_DEMO_PASSWORD, 'reviewer');
  }

  private async seed(email: string | undefined, password: string | undefined, role: Role): Promise<void> {
    if (!email || !password || (await this.repos.users.findByEmail(email))) return;
    await this.createUser(email, password, role);
    this.log.log(`bootstrap ${role} account ${email} created`);
  }

  async createUser(email: string, password: string, role: Role): Promise<UserRecord> {
    if (await this.repos.users.findByEmail(email)) throw conflict('A user with this email already exists', 'EMAIL_TAKEN');
    try {
      return await this.repos.users.create({ email, passwordHash: await this.passwords.hash(password), role });
    } catch {
      throw conflict('A user with this email already exists', 'EMAIL_TAKEN'); // unique-constraint race
    }
  }

  async login(email: string, password: string): Promise<Session> {
    const user = await this.repos.users.findByEmail(email);
    if (!user) { await this.passwords.verifyAgainstDummy(password); throw unauthorized('Invalid email or password', 'INVALID_CREDENTIALS'); }
    if (!(await this.passwords.verify(user.passwordHash, password))) throw unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');
    return this.issue(user, randomUUID());
  }

  /** Rotates the refresh token; presenting an already-used token revokes the whole family (theft detection). */
  async refresh(refreshToken: string): Promise<Session> {
    const rec = await this.repos.users.findRefreshToken(this.tokens.hashRefresh(refreshToken));
    if (!rec) throw unauthorized('Invalid refresh token', 'INVALID_TOKEN');
    if (rec.revokedAt) { await this.repos.users.revokeFamily(rec.familyId); throw unauthorized('Refresh token was already used', 'TOKEN_REUSED'); }
    if (rec.expiresAt.getTime() <= Date.now()) throw unauthorized('Refresh token expired', 'TOKEN_EXPIRED');
    const user = await this.repos.users.findById(rec.userId);
    if (!user) throw unauthorized('Invalid refresh token', 'INVALID_TOKEN');
    await this.repos.users.revokeRefreshToken(rec.id);
    return this.issue(user, rec.familyId);
  }

  async logout(refreshToken: string): Promise<void> {
    const rec = await this.repos.users.findRefreshToken(this.tokens.hashRefresh(refreshToken));
    if (rec) await this.repos.users.revokeFamily(rec.familyId);
  }

  async me(id: string) {
    const u = await this.repos.users.findById(id);
    if (!u) throw unauthorized('Account no longer exists', 'INVALID_TOKEN');
    return publicUser(u);
  }

  private async issue(user: UserRecord, familyId: string): Promise<Session> {
    const refresh = this.tokens.newRefreshToken();
    await this.repos.users.saveRefreshToken({
      userId: user.id, familyId, tokenHash: refresh.hash, expiresAt: new Date(Date.now() + this.tokens.refreshTtlSeconds * 1000),
    });
    return {
      accessToken: await this.tokens.signAccess({ sub: user.id, role: user.role, email: user.email }),
      refreshToken: refresh.token, tokenType: 'Bearer', expiresIn: this.tokens.accessTtlSeconds, user: publicUser(user),
    };
  }
}
