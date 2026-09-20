/**
 * Credential and session rules.
 *
 * PURE. Hashing and token signing are effects and live behind ports — this file
 * decides *policy*, not mechanism. That split is what lets the rules be tested
 * without bcrypt, a clock, or a secret.
 */

import type { RoleName } from './roles.js';

/** Minimum password length. Short enough to be usable in schools, long enough to matter. */
export const MIN_PASSWORD_LENGTH = 8;

/** How long an access token is valid. Short: it cannot be revoked. */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

/** How long a refresh token is valid. Long, but revocable server-side. */
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

export type PasswordProblem =
  | 'TOO_SHORT'
  | 'NO_LETTER'
  | 'NO_DIGIT'
  | 'WHITESPACE_ONLY';

/**
 * Validate a new password.
 *
 * Deliberately modest: length, one letter, one digit. Aggressive composition
 * rules push people towards `Passw0rd!` and sticky notes, and this product
 * serves schools where many users are children. Length carries the strength.
 */
export function validatePassword(password: string): PasswordProblem[] {
  const problems: PasswordProblem[] = [];
  if (password.trim().length === 0) return ['WHITESPACE_ONLY'];
  if (password.length < MIN_PASSWORD_LENGTH) problems.push('TOO_SHORT');
  if (!/\p{L}/u.test(password)) problems.push('NO_LETTER');
  if (!/\d/u.test(password)) problems.push('NO_DIGIT');
  return problems;
}

/**
 * Normalise a login identifier.
 *
 * Usernames and emails are matched case-insensitively: a learner typing
 * `Ahmed` at 8am and `ahmed` at 9am is the same person, and treating them as
 * different accounts is a support burden, not a security feature.
 */
export function normalizeLoginIdentifier(identifier: string): string {
  return identifier.trim().toLowerCase();
}

/** A role together with the school it applies in. `null` = platform-wide. */
export interface ScopedRole {
  readonly role: RoleName;
  readonly schoolId: string | null;
}

export interface AccessTokenClaims {
  readonly sub: string;
  readonly key: string;
  readonly roles: readonly ScopedRole[];
  readonly learnerKey?: string;
  /**
   * Distinguishes an access token from a refresh token.
   *
   * Legacy got this right and it is worth restating: without an explicit type,
   * a refresh token — which is long-lived by design — can be replayed as a
   * bearer token, silently turning a 15-minute credential into a 30-day one.
   */
  readonly typ: 'access';
}

export interface RefreshTokenClaims {
  readonly sub: string;
  /** Session identity, so the server can revoke this exact token. */
  readonly sid: string;
  readonly typ: 'refresh';
}

export type TokenClaims = AccessTokenClaims | RefreshTokenClaims;

export function isAccessToken(claims: TokenClaims): claims is AccessTokenClaims {
  return claims.typ === 'access';
}

export function isRefreshToken(claims: TokenClaims): claims is RefreshTokenClaims {
  return claims.typ === 'refresh';
}

export interface SessionState {
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly rotatedToId: string | null;
}

export type SessionRejection = 'EXPIRED' | 'REVOKED' | 'ALREADY_ROTATED';

/**
 * Decide whether a stored session may still be used to refresh.
 *
 * `ALREADY_ROTATED` is separate from `REVOKED` on purpose. A refresh token
 * presented after it was exchanged is a strong signal of theft — the legitimate
 * client has already moved on — so it warrants a different response from an
 * ordinary logout. The caller is expected to revoke the whole family.
 */
export function checkSession(session: SessionState, now: Date): SessionRejection | null {
  if (session.rotatedToId !== null) return 'ALREADY_ROTATED';
  if (session.revokedAt !== null) return 'REVOKED';
  if (session.expiresAt.getTime() <= now.getTime()) return 'EXPIRED';
  return null;
}
