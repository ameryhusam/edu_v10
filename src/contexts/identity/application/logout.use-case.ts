/**
 * Logout — revoke a session server-side.
 *
 * This is the reason the `Session` table exists. Deleting a cookie ends a
 * session on one device and leaves a stolen token working for thirty days;
 * revoking the row ends it everywhere at once.
 *
 * Logout is idempotent and never reports failure to the caller. Telling a user
 * "logout failed" is both alarming and useless — there is no corrective action
 * — and an unknown token is indistinguishable from an already-revoked one.
 */

import type { Clock } from '../../../shared/kernel/clock.js';
import { Ok, type Result } from '../../../shared/kernel/result.js';
import { isRefreshToken } from '../domain/credentials.js';
import type { AuditWriter, SessionRepository, TokenService } from './ports.js';

export interface LogoutCommand {
  readonly refreshToken?: string | null;
  /** Present when the caller has a valid access token. */
  readonly userId?: string | null;
  /** End every session for this user, not just the current one. */
  readonly allDevices?: boolean;
  readonly requestId?: string | null;
  readonly ip?: string | null;
}

export interface LogoutResult {
  readonly sessionsRevoked: number;
}

export class LogoutUseCase {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly tokens: TokenService,
    private readonly audit: AuditWriter,
    private readonly clock: Clock,
  ) {}

  async execute(command: LogoutCommand): Promise<Result<LogoutResult>> {
    const now = this.clock.now();

    if (command.allDevices && command.userId) {
      await this.sessions.revokeAllForUser(command.userId, now);
      await this.safeAudit(command, 'auth.logout_all', command.userId);
      // Count is not reported: it would disclose how many devices are signed in
      // to anyone holding a single token.
      return Ok({ sessionsRevoked: -1 });
    }

    if (!command.refreshToken) return Ok({ sessionsRevoked: 0 });

    const claims = this.tokens.verify(command.refreshToken);
    if (!claims || !isRefreshToken(claims)) return Ok({ sessionsRevoked: 0 });

    const session = await this.sessions.findByTokenHash(
      this.tokens.hashToken(command.refreshToken),
    );
    if (!session || session.revokedAt !== null) return Ok({ sessionsRevoked: 0 });

    await this.sessions.revoke(session.id, now);
    await this.safeAudit(command, 'auth.logout', session.userId);

    return Ok({ sessionsRevoked: 1 });
  }

  private async safeAudit(
    command: LogoutCommand,
    action: string,
    actorId: string,
  ): Promise<void> {
    try {
      await this.audit.record({
        actorId,
        action,
        entity: 'Session',
        requestId: command.requestId ?? null,
        ip: command.ip ?? null,
      });
    } catch {
      /* intentionally ignored */
    }
  }
}
