import { Injectable } from '@nestjs/common';
import { hash, verify, Algorithm } from '@node-rs/argon2';

// OWASP-recommended Argon2id parameters (19 MiB, t=2, p=1).
const OPTIONS = { algorithm: Algorithm.Argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

@Injectable()
export class PasswordService {
  /** Verified against when a user does not exist, so login timing does not reveal account existence. */
  private dummy: Promise<string> | null = null;
  hash(plain: string): Promise<string> { return hash(plain, OPTIONS); }
  async verify(hashed: string, plain: string): Promise<boolean> {
    try { return await verify(hashed, plain); } catch { return false; }
  }
  async verifyAgainstDummy(plain: string): Promise<void> {
    this.dummy ??= this.hash('dummy-password-for-timing');
    await this.verify(await this.dummy, plain);
  }
}
