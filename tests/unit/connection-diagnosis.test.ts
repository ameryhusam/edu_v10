/**
 * Naming the real cause of a database connection failure.
 *
 * These cases are transcribed from errors the project actually produced. The
 * point of the module is that all of them accuse the wrong thing: PGlite's
 * `P1010 / DatabaseAccessDenied` reads as a permissions problem when the dev
 * database never checks users — the refusal came from a real PostgreSQL
 * answering at the same address — and a dropped slot reads as a network
 * problem when the real cause is the connection limit. Time was spent
 * granting rights and debugging networks that were never the issue.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  classifyConnectionError,
  explainConnectionError,
  reportConnectionError,
} from '../../src/infrastructure/database/connection-diagnosis.js';

/** The error Prisma raises when a login is refused: P1010 / SQLSTATE 28000. */
function prismaAccessDenied(): Error {
  const error = new Error(
    'Invalid `prisma.academicYear.upsert()` invocation: User was denied access on the database',
  );
  (error as Error & { code: string }).code = 'P1010';
  return error;
}

/** A raw pg error carrying a PostgreSQL SQLSTATE. */
function errorWithCode(code: string, message: string): Error {
  const error = new Error(message);
  (error as Error & { code: string }).code = code;
  return error;
}

describe('a login refusal, misreported as a permissions failure', () => {
  it('recognises P1010 as a refused login, not a busy database', () => {
    expect(classifyConnectionError(prismaAccessDenied())).toBe('refused');
  });

  it('recognises the PostgreSQL SQLSTATE the refusal actually is', () => {
    // pg surfaces the server's own error code: 28000 (unknown role / pg_hba)
    // and 28P01 (bad password). Both mean "a server answered and said no".
    expect(classifyConnectionError(errorWithCode('28000', 'role "root" does not exist'))).toBe(
      'refused',
    );
    expect(classifyConnectionError(errorWithCode('28P01', 'password authentication failed'))).toBe(
      'refused',
    );
  });

  it('names the real cause: another server answered, not missing rights', () => {
    // The whole reason this case exists: the error blames access control, and
    // following that lead means resetting passwords that were correct. The
    // dev database never checks users — a refusal came from elsewhere.
    const explanation = explainConnectionError(prismaAccessDenied());
    expect(explanation).toMatch(/not the one refusing|NOT a permissions problem/i);
    expect(explanation).toMatch(/accepts any user/i);
    expect(explanation).toMatch(/DATABASE_URL/);
  });

  it('recognises the driver-level wording of a dropped slot', () => {
    // The socket server's connection-limit rejection surfaces as a dropped
    // socket, not a SQLSTATE — that remains contention.
    expect(classifyConnectionError(new Error('Connection terminated unexpectedly'))).toBe(
      'contended',
    );
  });

  it('says explicitly that the limit is the cause when it is contention', () => {
    const explanation = explainConnectionError(new Error('Connection terminated unexpectedly'));
    expect(explanation).toMatch(/connection limit/i);
    expect(explanation).toMatch(/DEV_DB_MAX_CONNECTIONS/);
  });
});

describe('an absent database', () => {
  it('recognises a refused connection', () => {
    expect(classifyConnectionError(new Error('connect ECONNREFUSED 127.0.0.1:5432'))).toBe(
      'unreachable',
    );
  });

  it("recognises Prisma's driver-adapter wording, which carries no P1001", () => {
    // Reported as a raw-query failure with code `N/A`, so only the message
    // identifies it. Matching on P1001 alone missed this in practice.
    const error = new Error("Raw query failed. Code: `N/A`. Message: `Can't reach database server`");
    expect(classifyConnectionError(error)).toBe('unreachable');
  });

  it('tells the reader how to start it', () => {
    const explanation = explainConnectionError(new Error('connect ECONNREFUSED 127.0.0.1:5432'));
    expect(explanation).toMatch(/npm run db:dev/);
  });
});

describe('everything else', () => {
  it('stays silent rather than guessing', () => {
    // A unique-constraint violation is a real bug in the seed. Dressing it up
    // as a connection problem would send the reader to the wrong place, so the
    // caller is left to print the original error.
    const error = new Error('Unique constraint failed on the fields: (`key`)');
    expect(classifyConnectionError(error)).toBe('other');
    expect(explainConnectionError(error)).toBeNull();
  });

  it('reports handled status so the caller can still print the raw error', () => {
    const log = vi.fn();
    expect(reportConnectionError(new Error('Unique constraint failed'), log)).toBe(false);
    expect(log).not.toHaveBeenCalled();

    expect(reportConnectionError(prismaAccessDenied(), log)).toBe(true);
    expect(log).toHaveBeenCalledOnce();
  });
});
