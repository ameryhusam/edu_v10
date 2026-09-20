/**
 * Login — exchange credentials for an access/refresh pair.
 *
 * Security decisions worth stating, because each is easy to get wrong quietly:
 *
 *  - **One failure message.** Unknown user and wrong password return the same
 *    error. Distinguishing them turns the login form into an account-existence
 *    oracle, which matters in a school where usernames are predictable.
 *
 *  - **The password is verified even when the user does not exist.** Otherwise
 *    the response time reveals whether an account exists — the timing version
 *    of the same leak.
 *
 *  - **An inactive account fails after verification, not before**, for the same
 *    reason.
 */

import { randomUUID } from 'node:crypto';

import type { Clock } from '../../../shared/kernel/clock.js';
import { Errors } from '../../../shared/kernel/errors.js';
import { Err, Ok, type Result } from '../../../shared/kernel/result.js';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  normalizeLoginIdentifier,
} from '../domain/credentials.js';
import { roleNames } from '../domain/roles.js';
import type {
  AuditWriter,
  PasswordHasher,
  SessionRepository,
  TokenService,
  UserRepository,
} from './ports.js';

/**
 * A bcrypt hash of a random value, used to burn the same CPU time when no user
 * is found. Cost must match the hasher's configured cost to be effective.
 */
const TIMING_DECOY_HASH = '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

export interface LoginCommand {
  readonly identifier: string;
  readonly password: string;
  readonly userAgent?: string | null;
  readonly ip?: string | null;
  readonly requestId?: string | null;
}

export interface AuthTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresInSeconds: number;
}

export interface AuthenticatedUser {
  readonly key: string;
  readonly username: string;
  readonly fullName: string;
  readonly email: string | null;
  readonly locale: string;
  readonly roles: readonly string[];
  readonly learnerKey: string | null;
}

export interface LoginResult {
  readonly user: AuthenticatedUser;
  readonly tokens: AuthTokens;
}

export class LoginUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly sessions: SessionRepository,
    private readonly hasher: PasswordHasher,
    private readonly tokens: TokenService,
    private readonly audit: AuditWriter,
    private readonly clock: Clock,
  ) {}

  async execute(command: LoginCommand): Promise<Result<LoginResult>> {
    const identifier = normalizeLoginIdentifier(command.identifier);
    const user = await this.users.findByLoginIdentifier(identifier);

    const passwordMatches = await this.hasher.verify(
      command.password,
      user?.passwordHash ?? TIMING_DECOY_HASH,
    );

    if (!user || !passwordMatches) {
      await this.safeAudit({
        actorId: user?.id ?? null,
        action: 'auth.login_failed',
        entity: 'User',
        entityKey: identifier,
        requestId: command.requestId ?? null,
        ip: command.ip ?? null,
      });
      return Err(
        Errors.unauthenticated('auth.invalid_credentials', 'Incorrect username or password.'),
      );
    }

    if (user.status !== 'ACTIVE') {
      await this.safeAudit({
        actorId: user.id,
        action: 'auth.login_blocked',
        entity: 'User',
        entityKey: user.key,
        requestId: command.requestId ?? null,
        ip: command.ip ?? null,
        after: { status: user.status },
      });
      return Err(
        Errors.forbidden('auth.account_inactive', 'This account is not active.', {
          status: user.status,
        }),
      );
    }

    const now = this.clock.now();
    const issued = await issueTokens({
      user,
      sessions: this.sessions,
      tokenService: this.tokens,
      now,
      userAgent: command.userAgent ?? null,
      ip: command.ip ?? null,
    });

    await this.users.recordLogin(user.id, now);
    await this.safeAudit({
      actorId: user.id,
      action: 'auth.login',
      entity: 'User',
      entityKey: user.key,
      requestId: command.requestId ?? null,
      ip: command.ip ?? null,
    });

    return Ok({ user: toAuthenticatedUser(user), tokens: issued });
  }

  private async safeAudit(entry: Parameters<AuditWriter['record']>[0]): Promise<void> {
    // A failed audit write must never block a legitimate login.
    try {
      await this.audit.record(entry);
    } catch {
      /* intentionally ignored */
    }
  }
}

export function toAuthenticatedUser(user: {
  key: string;
  username: string;
  fullName: string;
  email: string | null;
  locale: string;
  roles: readonly { role: string }[];
  learnerKey: string | null;
}): AuthenticatedUser {
  return {
    key: user.key,
    username: user.username,
    fullName: user.fullName,
    email: user.email,
    locale: user.locale,
    roles: roleNames(user.roles as never),
    learnerKey: user.learnerKey,
  };
}

/**
 * Mint a session and its token pair. Shared by login and refresh so the two
 * paths cannot drift — a refresh that issued different claims from a login
 * would be a subtle privilege bug.
 */
export async function issueTokens(input: {
  user: {
    id: string;
    key: string;
    roles: readonly { role: string; schoolId: string | null }[];
    learnerKey: string | null;
  };
  sessions: SessionRepository;
  tokenService: TokenService;
  now: Date;
  userAgent: string | null;
  ip: string | null;
}): Promise<AuthTokens> {
  const { user, sessions, tokenService, now } = input;

  const accessToken = tokenService.signAccess(
    {
      sub: user.id,
      key: user.key,
      roles: user.roles as never,
      ...(user.learnerKey ? { learnerKey: user.learnerKey } : {}),
      typ: 'access',
    },
    ACCESS_TOKEN_TTL_SECONDS,
  );

  // The session row must exist before the refresh token references it, so the
  // id is allocated first and the token signed against it.
  const expiresAt = new Date(now.getTime() + REFRESH_TOKEN_TTL_SECONDS * 1000);
  const placeholder = await sessions.create({
    userId: user.id,
    tokenHash: `pending:${randomUUID()}`,
    expiresAt,
    userAgent: input.userAgent,
    ip: input.ip,
  });

  const refreshToken = tokenService.signRefresh(
    { sub: user.id, sid: placeholder.id, typ: 'refresh' },
    REFRESH_TOKEN_TTL_SECONDS,
  );

  await sessions.setTokenHash(placeholder.id, tokenService.hashToken(refreshToken));

  return { accessToken, refreshToken, expiresInSeconds: ACCESS_TOKEN_TTL_SECONDS };
}
