import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';
import { APP_CONFIG } from '../app.tokens.js';
import type { AppConfig } from '../config/env.schema.js';
import type { Role } from '../domain/types.js';
import { unauthorized } from '../common/errors.js';

const ISSUER = 'docint'; const AUDIENCE = 'docint-api';
export interface AccessClaims { sub: string; role: Role; email: string }

@Injectable()
export class TokenService {
  private readonly key: Uint8Array;
  constructor(@Inject(APP_CONFIG) private readonly cfg: Pick<AppConfig, 'JWT_ACCESS_SECRET' | 'JWT_ACCESS_TTL_SECONDS' | 'JWT_REFRESH_TTL_SECONDS'>) {
    this.key = new TextEncoder().encode(cfg.JWT_ACCESS_SECRET);
  }
  get accessTtlSeconds(): number { return this.cfg.JWT_ACCESS_TTL_SECONDS; }
  get refreshTtlSeconds(): number { return this.cfg.JWT_REFRESH_TTL_SECONDS; }

  signAccess(c: AccessClaims): Promise<string> {
    return new SignJWT({ role: c.role, email: c.email }).setProtectedHeader({ alg: 'HS256' }).setSubject(c.sub)
      .setIssuer(ISSUER).setAudience(AUDIENCE).setIssuedAt().setExpirationTime(`${this.cfg.JWT_ACCESS_TTL_SECONDS}s`).sign(this.key);
  }
  async verifyAccess(token: string): Promise<AccessClaims> {
    try {
      const { payload } = await jwtVerify(token, this.key, { issuer: ISSUER, audience: AUDIENCE, algorithms: ['HS256'] });
      if (typeof payload.sub !== 'string' || typeof payload['role'] !== 'string' || typeof payload['email'] !== 'string') throw new Error('claims');
      return { sub: payload.sub, role: payload['role'] as Role, email: payload['email'] };
    } catch (e) {
      throw unauthorized(e instanceof joseErrors.JWTExpired ? 'Access token expired' : 'Invalid access token', e instanceof joseErrors.JWTExpired ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN');
    }
  }
  /** Opaque refresh token: 256 bits of entropy; only its SHA-256 is stored. */
  newRefreshToken(): { token: string; hash: string } {
    const token = randomBytes(32).toString('base64url');
    return { token, hash: this.hashRefresh(token) };
  }
  hashRefresh(token: string): string { return createHash('sha256').update(token).digest('hex'); }
}
