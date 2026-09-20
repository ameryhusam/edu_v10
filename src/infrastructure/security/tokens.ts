/**
 * Password hashing and JWT signing.
 *
 * The only place in the codebase that knows about bcrypt or jsonwebtoken. The
 * Identity domain decides policy; this file performs the effect.
 */

import { createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type {
  PasswordHasher,
  TokenService,
} from '../../contexts/identity/application/ports.js';
import type {
  AccessTokenClaims,
  RefreshTokenClaims,
  TokenClaims,
} from '../../contexts/identity/domain/credentials.js';

/**
 * bcrypt cost. 10 is ~100ms on typical hardware — slow enough to make offline
 * cracking expensive, fast enough that a class of 30 logging in at once does
 * not stall the server.
 */
const BCRYPT_COST = 10;

export class BcryptPasswordHasher implements PasswordHasher {
  async hash(plain: string): Promise<string> {
    return bcrypt.hash(plain, BCRYPT_COST);
  }

  async verify(plain: string, hash: string): Promise<boolean> {
    try {
      return await bcrypt.compare(plain, hash);
    } catch {
      // A malformed stored hash must read as "wrong password", never as a crash
      // that reveals the account exists.
      return false;
    }
  }
}

export class JwtTokenService implements TokenService {
  constructor(private readonly secret: string) {}

  signAccess(claims: AccessTokenClaims, ttlSeconds: number): string {
    return jwt.sign(claims, this.secret, { algorithm: 'HS256', expiresIn: ttlSeconds });
  }

  signRefresh(claims: RefreshTokenClaims, ttlSeconds: number): string {
    return jwt.sign(claims, this.secret, { algorithm: 'HS256', expiresIn: ttlSeconds });
  }

  verify(token: string): TokenClaims | null {
    try {
      // Algorithm is pinned: without it a token signed with `alg: none` — or
      // with a different algorithm — could be accepted.
      const payload = jwt.verify(token, this.secret, { algorithms: ['HS256'] });
      if (typeof payload !== 'object' || payload === null) return null;

      const typ = (payload as { typ?: unknown }).typ;
      if (typ !== 'access' && typ !== 'refresh') return null;

      return payload as unknown as TokenClaims;
    } catch {
      return null;
    }
  }

  hashToken(token: string): string {
    // SHA-256, not bcrypt: this is a lookup key for a high-entropy value, so it
    // must be deterministic and fast. bcrypt is for low-entropy secrets people
    // choose; a signed JWT is neither.
    return createHash('sha256').update(token).digest('hex');
  }
}
