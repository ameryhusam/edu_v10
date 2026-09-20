/**
 * Refresh — exchange a refresh token for a new pair.
 *
 * Refresh tokens ROTATE: each use issues a new one and marks the old as
 * rotated. That makes theft detectable. If a token that has already been
 * rotated is presented, two parties hold it — the legitimate client and someone
 * else — so every session for that user is revoked and the holder must log in
 * again.
 *
 * Rotation without reuse-detection would be pointless ceremony; detection
 * without rotation is impossible. They only work as a pair.
 */

import type { Clock } from '../../../shared/kernel/clock.js';
import { Errors } from '../../../shared/kernel/errors.js';
import { Err, Ok, type Result } from '../../../shared/kernel/result.js';
import { checkSession, isRefreshToken } from '../domain/credentials.js';
import { issueTokens, toAuthenticatedUser, type LoginResult } from './login.use-case.js';
import type {
  AuditWriter,
  SessionRepository,
  TokenService,
  UserRepository,
} from './ports.js';

export interface RefreshCommand {
  readonly refreshToken: string;
  readonly userAgent?: string | null;
  readonly ip?: string | null;
  readonly requestId?: string | null;
}

export class RefreshSessionUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly sessions: SessionRepository,
    private readonly tokens: TokenService,
    private readonly audit: AuditWriter,
    private readonly clock: Clock,
  ) {}

  async execute(command: RefreshCommand): Promise<Result<LoginResult>> {
    const claims = this.tokens.verify(command.refreshToken);
    if (!claims || !isRefreshToken(claims)) {
      // Covers expiry, tampering, and — importantly — an ACCESS token being
      // presented here. The two token types are never interchangeable.
      return Err(Errors.unauthenticated('auth.invalid_refresh_token', 'Invalid refresh token.'));
    }

    const session = await this.sessions.findByTokenHash(
      this.tokens.hashToken(command.refreshToken),
    );
    if (!session) {
      return Err(Errors.unauthenticated('auth.invalid_refresh_token', 'Invalid refresh token.'));
    }

    const now = this.clock.now();
    const rejection = checkSession(session, now);

    if (rejection === 'ALREADY_ROTATED') {
      // Presenting a spent token means it was captured. Kill the whole family.
      await this.sessions.revokeAllForUser(session.userId, now);
      await this.safeAudit({
        actorId: session.userId,
        action: 'auth.refresh_reuse_detected',
        entity: 'Session',
        entityKey: session.id,
        requestId: command.requestId ?? null,
        ip: command.ip ?? null,
      });
      return Err(
        Errors.unauthenticated(
          'auth.session_compromised',
          'This session has been closed for security reasons. Please sign in again.',
        ),
      );
    }

    if (rejection !== null) {
      return Err(
        Errors.unauthenticated('auth.session_expired', 'Your session has ended. Please sign in again.', {
          reason: rejection,
        }),
      );
    }

    const user = await this.users.findById(session.userId);
    if (!user || user.status !== 'ACTIVE') {
      // A user deactivated mid-session must not be able to extend it.
      await this.sessions.revoke(session.id, now);
      return Err(Errors.forbidden('auth.account_inactive', 'This account is not active.'));
    }

    const issued = await issueTokens({
      user,
      sessions: this.sessions,
      tokenService: this.tokens,
      now,
      userAgent: command.userAgent ?? null,
      ip: command.ip ?? null,
    });

    const replacement = await this.sessions.findByTokenHash(
      this.tokens.hashToken(issued.refreshToken),
    );
    if (replacement) {
      await this.sessions.markRotated(session.id, replacement.id);
    }
    await this.sessions.touch(session.id, now);

    return Ok({ user: toAuthenticatedUser(user), tokens: issued });
  }

  private async safeAudit(entry: Parameters<AuditWriter['record']>[0]): Promise<void> {
    try {
      await this.audit.record(entry);
    } catch {
      /* intentionally ignored */
    }
  }
}
