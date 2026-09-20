/**
 * Identity: credential policy, scoped roles, and session lifecycle.
 *
 * Authorisation bugs are silent — nothing fails, the wrong person simply sees
 * data. So the cases pinned here are mostly the ones that should be REFUSED.
 */

import { describe, expect, it } from 'vitest';
import { fixedClock } from '../../src/shared/kernel/clock.js';
import {
  checkSession,
  isAccessToken,
  isRefreshToken,
  normalizeLoginIdentifier,
  validatePassword,
} from '../../src/contexts/identity/domain/credentials.js';
import {
  canReadAnyLearner,
  hasRole,
  isRoleName,
  roleNames,
  type ScopedRoleGrant,
} from '../../src/contexts/identity/domain/roles.js';
import { LoginUseCase } from '../../src/contexts/identity/application/login.use-case.js';
import { RefreshSessionUseCase } from '../../src/contexts/identity/application/refresh-session.use-case.js';
import { LogoutUseCase } from '../../src/contexts/identity/application/logout.use-case.js';
import type {
  SessionRecord,
  SessionRepository,
  UserAccount,
  UserRepository,
} from '../../src/contexts/identity/application/ports.js';

// ── Credentials ─────────────────────────────────────────────────────────────

describe('validatePassword', () => {
  it('accepts a reasonable password', () => {
    expect(validatePassword('demo1234')).toEqual([]);
  });

  it('rejects short, letterless and digitless passwords', () => {
    expect(validatePassword('ab1')).toContain('TOO_SHORT');
    expect(validatePassword('12345678')).toContain('NO_LETTER');
    expect(validatePassword('abcdefgh')).toContain('NO_DIGIT');
  });

  it('accepts non-Latin scripts', () => {
    // The product is Arabic-first; a rule that only counts [a-z] would reject
    // a perfectly good Arabic password.
    expect(validatePassword('كلمةسر1234')).toEqual([]);
  });

  it('reports whitespace-only as a single problem', () => {
    expect(validatePassword('        ')).toEqual(['WHITESPACE_ONLY']);
  });
});

describe('normalizeLoginIdentifier', () => {
  it('is case- and whitespace-insensitive', () => {
    expect(normalizeLoginIdentifier('  Ahmed  ')).toBe('ahmed');
    expect(normalizeLoginIdentifier('A@B.COM')).toBe('a@b.com');
  });
});

describe('token type discrimination', () => {
  it('separates access from refresh', () => {
    const access = { sub: 'u', key: 'k', roles: [], typ: 'access' } as const;
    const refresh = { sub: 'u', sid: 's', typ: 'refresh' } as const;

    expect(isAccessToken(access)).toBe(true);
    expect(isAccessToken(refresh)).toBe(false);
    expect(isRefreshToken(refresh)).toBe(true);
  });
});

describe('checkSession', () => {
  const now = new Date('2026-03-01T10:00:00Z');
  const future = new Date('2026-04-01T10:00:00Z');
  const past = new Date('2026-02-01T10:00:00Z');

  it('accepts a live session', () => {
    expect(checkSession({ expiresAt: future, revokedAt: null, rotatedToId: null }, now)).toBeNull();
  });

  it('reports rotation ahead of revocation', () => {
    // A rotated session is also revoked. Reuse must surface as ALREADY_ROTATED
    // so the caller knows to revoke the family, not just refuse this token.
    expect(
      checkSession({ expiresAt: future, revokedAt: now, rotatedToId: 'next' }, now),
    ).toBe('ALREADY_ROTATED');
  });

  it('reports revoked and expired distinctly', () => {
    expect(checkSession({ expiresAt: future, revokedAt: now, rotatedToId: null }, now)).toBe('REVOKED');
    expect(checkSession({ expiresAt: past, revokedAt: null, rotatedToId: null }, now)).toBe('EXPIRED');
  });

  it('treats the exact expiry instant as expired', () => {
    expect(checkSession({ expiresAt: now, revokedAt: null, rotatedToId: null }, now)).toBe('EXPIRED');
  });
});

// ── Roles ───────────────────────────────────────────────────────────────────

const grant = (role: string, schoolId: string | null = null): ScopedRoleGrant =>
  ({ role, schoolId }) as ScopedRoleGrant;

describe('hasRole', () => {
  it('refuses a teacher from another school', () => {
    // The bug this exists to prevent: a flat role list would grant access.
    const grants = [grant('TEACHER', 'school-A')];

    expect(hasRole(grants, ['TEACHER'], 'school-A')).toBe(true);
    expect(hasRole(grants, ['TEACHER'], 'school-B')).toBe(false);
  });

  it('treats SYSTEM_ADMIN as platform-wide', () => {
    const grants = [grant('SYSTEM_ADMIN', 'school-A')];

    expect(hasRole(grants, ['SYSTEM_ADMIN'], 'school-B')).toBe(true);
  });

  it('treats an unscoped grant as platform-wide', () => {
    // Single-school deployments seed roles without a school id.
    expect(hasRole([grant('TEACHER', null)], ['TEACHER'], 'school-Z')).toBe(true);
  });

  it('ignores scope when the resource is not school-owned', () => {
    expect(hasRole([grant('TEACHER', 'school-A')], ['TEACHER'], null)).toBe(true);
  });

  it('refuses a role the actor does not hold', () => {
    expect(hasRole([grant('STUDENT')], ['TEACHER'])).toBe(false);
    expect(hasRole([], ['STUDENT'])).toBe(false);
  });
});

describe('roles helpers', () => {
  it('deduplicates role names across schools', () => {
    expect(roleNames([grant('TEACHER', 'a'), grant('TEACHER', 'b')])).toEqual(['TEACHER']);
  });

  it('validates role names', () => {
    expect(isRoleName('TEACHER')).toBe(true);
    expect(isRoleName('SUPERUSER')).toBe(false);
  });

  it('does not let a parent read arbitrary learners', () => {
    // A guardian reaches their own child through a verified link, never
    // through a role.
    expect(canReadAnyLearner([grant('PARENT')])).toBe(false);
    expect(canReadAnyLearner([grant('TEACHER', 'a')], 'a')).toBe(true);
  });
});

// ── Use cases ───────────────────────────────────────────────────────────────

const NOW_ISO = '2026-03-01T10:00:00Z';
const clock = fixedClock(NOW_ISO);

const account = (over: Partial<UserAccount> = {}): UserAccount => ({
  id: 'user-1',
  key: 'usr_demo',
  username: 'student',
  email: null,
  fullName: 'Demo Student',
  passwordHash: 'hash:demo1234',
  status: 'ACTIVE',
  locale: 'ar',
  roles: [grant('STUDENT')],
  learnerKey: 'lrn_demo',
  ...over,
});

class FakeUsers implements UserRepository {
  constructor(private readonly user: UserAccount | null) {}
  logins = 0;

  async findByLoginIdentifier(identifier: string) {
    return this.user && this.user.username === identifier ? this.user : null;
  }
  async findById(id: string) {
    return this.user && this.user.id === id ? this.user : null;
  }
  async recordLogin() {
    this.logins += 1;
  }
  async updatePasswordHash() {}
}

class FakeSessions implements SessionRepository {
  readonly rows = new Map<string, SessionRecord & { tokenHash: string }>();
  private seq = 0;

  async create(input: { userId: string; tokenHash: string; expiresAt: Date }) {
    this.seq += 1;
    const row = {
      id: `sess-${this.seq}`,
      userId: input.userId,
      expiresAt: input.expiresAt,
      revokedAt: null,
      rotatedToId: null,
      tokenHash: input.tokenHash,
    };
    this.rows.set(row.id, row);
    return row;
  }
  async setTokenHash(sessionId: string, tokenHash: string) {
    const row = this.rows.get(sessionId)!;
    this.rows.set(sessionId, { ...row, tokenHash });
  }
  async findByTokenHash(tokenHash: string) {
    return [...this.rows.values()].find((r) => r.tokenHash === tokenHash) ?? null;
  }
  async findById(id: string) {
    return this.rows.get(id) ?? null;
  }
  async revoke(id: string, at: Date) {
    const row = this.rows.get(id)!;
    this.rows.set(id, { ...row, revokedAt: at });
  }
  async revokeAllForUser(userId: string, at: Date) {
    for (const [id, row] of this.rows) {
      if (row.userId === userId && row.revokedAt === null) {
        this.rows.set(id, { ...row, revokedAt: at });
      }
    }
  }
  async markRotated(id: string, newId: string) {
    const row = this.rows.get(id)!;
    this.rows.set(id, { ...row, rotatedToId: newId, revokedAt: new Date(NOW_ISO) });
  }
  async touch() {}
}

/** Deterministic stand-ins: the real crypto is exercised over HTTP, not here. */
const hasher = {
  async hash(p: string) {
    return `hash:${p}`;
  },
  async verify(plain: string, hash: string) {
    return hash === `hash:${plain}`;
  },
};

function makeTokens() {
  let n = 0;
  return {
    issued: [] as string[],
    signAccess(claims: unknown) {
      n += 1;
      return `access.${JSON.stringify(claims)}.${n}`;
    },
    signRefresh(claims: { sub: string; sid: string; typ: 'refresh' }) {
      n += 1;
      const t = `refresh.${claims.sub}.${claims.sid}.${n}`;
      this.issued.push(t);
      return t;
    },
    verify(token: string) {
      if (token.startsWith('refresh.')) {
        const [, sub, sid] = token.split('.');
        return { sub: sub!, sid: sid!, typ: 'refresh' as const };
      }
      if (token.startsWith('access.')) return { sub: 'u', key: 'k', roles: [], typ: 'access' as const };
      return null;
    },
    hashToken(token: string) {
      return `sha:${token}`;
    },
  };
}

const noAudit = { async record() {} };

describe('LoginUseCase', () => {
  it('issues tokens for valid credentials', async () => {
    const users = new FakeUsers(account());
    const sessions = new FakeSessions();
    const useCase = new LoginUseCase(users, sessions, hasher, makeTokens(), noAudit, clock);

    const result = await useCase.execute({ identifier: 'student', password: 'demo1234' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.user.learnerKey).toBe('lrn_demo');
    expect(result.value.tokens.refreshToken).toContain('refresh.');
    expect(users.logins).toBe(1);
    // The stored hash must be the real one, never the placeholder.
    expect([...sessions.rows.values()][0]!.tokenHash).toBe('sha:refresh.user-1.sess-1.2');
  });

  it('returns the SAME error for unknown user and wrong password', async () => {
    // Any difference here turns the login form into an account-existence oracle.
    const known = new LoginUseCase(
      new FakeUsers(account()), new FakeSessions(), hasher, makeTokens(), noAudit, clock,
    );
    const unknown = new LoginUseCase(
      new FakeUsers(null), new FakeSessions(), hasher, makeTokens(), noAudit, clock,
    );

    const wrongPassword = await known.execute({ identifier: 'student', password: 'nope' });
    const noSuchUser = await unknown.execute({ identifier: 'ghost', password: 'demo1234' });

    expect(wrongPassword.ok).toBe(false);
    expect(noSuchUser.ok).toBe(false);
    if (wrongPassword.ok || noSuchUser.ok) return;
    expect(wrongPassword.error.code).toBe(noSuchUser.error.code);
    expect(wrongPassword.error.message).toBe(noSuchUser.error.message);
  });

  it('refuses an inactive account', async () => {
    const useCase = new LoginUseCase(
      new FakeUsers(account({ status: 'SUSPENDED' })),
      new FakeSessions(), hasher, makeTokens(), noAudit, clock,
    );

    const result = await useCase.execute({ identifier: 'student', password: 'demo1234' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('auth.account_inactive');
  });

  it('logs in case-insensitively', async () => {
    const useCase = new LoginUseCase(
      new FakeUsers(account()), new FakeSessions(), hasher, makeTokens(), noAudit, clock,
    );

    const result = await useCase.execute({ identifier: '  STUDENT ', password: 'demo1234' });

    expect(result.ok).toBe(true);
  });
});

describe('RefreshSessionUseCase', () => {
  async function loggedIn() {
    const users = new FakeUsers(account());
    const sessions = new FakeSessions();
    const tokens = makeTokens();
    const login = new LoginUseCase(users, sessions, hasher, tokens, noAudit, clock);
    const first = await login.execute({ identifier: 'student', password: 'demo1234' });
    if (!first.ok) throw new Error('login failed');
    const refresh = new RefreshSessionUseCase(users, sessions, tokens, noAudit, clock);
    return { users, sessions, tokens, refresh, tokenPair: first.value.tokens };
  }

  it('rotates the refresh token', async () => {
    const { refresh, tokenPair } = await loggedIn();

    const result = await refresh.execute({ refreshToken: tokenPair.refreshToken });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.tokens.refreshToken).not.toBe(tokenPair.refreshToken);
  });

  it('detects reuse of a rotated token and kills every session', async () => {
    const { refresh, sessions, tokenPair } = await loggedIn();
    await refresh.execute({ refreshToken: tokenPair.refreshToken });

    const replay = await refresh.execute({ refreshToken: tokenPair.refreshToken });

    expect(replay.ok).toBe(false);
    if (replay.ok) return;
    expect(replay.error.code).toBe('auth.session_compromised');
    // Two parties held that token, so nothing for this user stays valid.
    expect([...sessions.rows.values()].every((r) => r.revokedAt !== null)).toBe(true);
  });

  it('refuses an access token presented as a refresh token', async () => {
    const { refresh } = await loggedIn();

    const result = await refresh.execute({ refreshToken: 'access.whatever.1' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('auth.invalid_refresh_token');
  });

  it('refuses a revoked session', async () => {
    const { refresh, sessions, tokenPair } = await loggedIn();
    await sessions.revokeAllForUser('user-1', new Date(NOW_ISO));

    const result = await refresh.execute({ refreshToken: tokenPair.refreshToken });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('auth.session_expired');
  });

  it('refuses to extend a session for a deactivated user', async () => {
    const sessions = new FakeSessions();
    const tokens = makeTokens();
    const active = new FakeUsers(account());
    const login = new LoginUseCase(active, sessions, hasher, tokens, noAudit, clock);
    const first = await login.execute({ identifier: 'student', password: 'demo1234' });
    if (!first.ok) return;

    const deactivated = new FakeUsers(account({ status: 'INACTIVE' }));
    const refresh = new RefreshSessionUseCase(deactivated, sessions, tokens, noAudit, clock);
    const result = await refresh.execute({ refreshToken: first.value.tokens.refreshToken });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('auth.account_inactive');
  });
});

describe('LogoutUseCase', () => {
  it('revokes the presented session', async () => {
    const users = new FakeUsers(account());
    const sessions = new FakeSessions();
    const tokens = makeTokens();
    const login = new LoginUseCase(users, sessions, hasher, tokens, noAudit, clock);
    const first = await login.execute({ identifier: 'student', password: 'demo1234' });
    if (!first.ok) return;

    const logout = new LogoutUseCase(sessions, tokens, noAudit, clock);
    const result = await logout.execute({ refreshToken: first.value.tokens.refreshToken });

    expect(result.ok && result.value.sessionsRevoked).toBe(1);
    expect([...sessions.rows.values()][0]!.revokedAt).not.toBeNull();
  });

  it('succeeds quietly on an unknown or absent token', async () => {
    // Logout is idempotent: "logout failed" is alarming and has no remedy.
    const logout = new LogoutUseCase(new FakeSessions(), makeTokens(), noAudit, clock);

    expect((await logout.execute({ refreshToken: 'refresh.x.y.1' })).ok).toBe(true);
    expect((await logout.execute({})).ok).toBe(true);
  });
});
