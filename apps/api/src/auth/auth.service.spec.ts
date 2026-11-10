import { describe, expect, it } from 'vitest';
import { createMemoryRepositories } from '../infrastructure/persistence/memory/memory.repositories.js';
import type { AppConfig } from '../config/env.schema.js';
import { AuthService } from './auth.service.js';
import { PasswordService } from './password.service.js';
import { TokenService } from './token.service.js';

const cfg = { JWT_ACCESS_SECRET: 's'.repeat(40), JWT_ACCESS_TTL_SECONDS: 60, JWT_REFRESH_TTL_SECONDS: 3600 } as AppConfig;
const make = () => {
  const repos = createMemoryRepositories();
  const tokens = new TokenService(cfg);
  return { repos, tokens, auth: new AuthService(repos, new PasswordService(), tokens, cfg) };
};
const PW = 'correct horse battery';

describe('AuthService', () => {
  it('logs in, issues verifiable tokens and never stores plaintext passwords', async () => {
    const { auth, repos, tokens } = make();
    await auth.createUser('A@x.io', PW, 'reviewer');
    const s = await auth.login('a@x.io', PW);
    expect((await tokens.verifyAccess(s.accessToken)).role).toBe('reviewer');
    expect((await repos.users.findByEmail('a@x.io'))?.passwordHash).toMatch(/^\$argon2id\$/);
  });
  it('rejects bad credentials identically for unknown users and wrong passwords', async () => {
    const { auth } = make();
    await auth.createUser('a@x.io', PW, 'uploader');
    await expect(auth.login('a@x.io', 'wrong-password-123')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    await expect(auth.login('nobody@x.io', 'wrong-password-123')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
  });
  it('rotates refresh tokens and revokes the family on reuse', async () => {
    const { auth } = make();
    await auth.createUser('a@x.io', PW, 'uploader');
    const s1 = await auth.login('a@x.io', PW);
    const s2 = await auth.refresh(s1.refreshToken);
    expect(s2.refreshToken).not.toBe(s1.refreshToken);
    await expect(auth.refresh(s1.refreshToken)).rejects.toMatchObject({ code: 'TOKEN_REUSED' });
    await expect(auth.refresh(s2.refreshToken)).rejects.toMatchObject({ status: 401 });
  });
  it('rejects tampered and foreign tokens', async () => {
    const { tokens } = make();
    await expect(tokens.verifyAccess('abc.def.ghi')).rejects.toMatchObject({ status: 401 });
    const other = new TokenService({ ...cfg, JWT_ACCESS_SECRET: 'x'.repeat(40) });
    await expect(tokens.verifyAccess(await other.signAccess({ sub: 'u', role: 'admin', email: 'e@x.io' }))).rejects.toMatchObject({ status: 401 });
  });
  it('prevents duplicate accounts', async () => {
    const { auth } = make();
    await auth.createUser('a@x.io', PW, 'uploader');
    await expect(auth.createUser('A@X.IO', PW, 'admin')).rejects.toMatchObject({ code: 'EMAIL_TAKEN' });
  });
});
