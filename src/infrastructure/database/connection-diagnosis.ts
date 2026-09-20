/**
 * Turn a database connection failure into something a person can act on.
 *
 * The development database is PGlite served over a socket, and three of its
 * behaviours produce errors that name the wrong cause:
 *
 *   - its socket server has a connection LIMIT (it defaulted to 1). Once that
 *     limit is reached a further client is dropped, and Prisma reports
 *     `Connection terminated unexpectedly`. That reads as a network problem.
 *     It is not: the server simply had no free slot.
 *
 *     `scripts/dev-db.mjs` sets `maxConnections` well above 1 and reclaims
 *     idle slots, so this is rare. It remains diagnosable because the error
 *     text would otherwise send someone off debugging a network that is fine.
 *
 *   - it ignores the database NAME in the URL and always serves `postgres`.
 *     So a URL naming a database that "does not exist" still connects, and a
 *     URL naming the right one proves nothing.
 *
 *   - and the one that cost a full day: `P1010 / User was denied access on
 *     the database` is a *login refusal*, not a permissions problem and —
 *     despite how it looks — usually not contention either. The dev database
 *     never checks users or passwords, so a real refusal came from a
 *     DIFFERENT PostgreSQL answering at the same address: a real server
 *     installed on the machine, reached because a client without its
 *     DATABASE_URL falls back to "the OS user at localhost" and localhost
 *     resolved somewhere the dev database is not. The seed did exactly that
 *     for its whole life while `db:apply` (which loads .env) worked beside
 *     it, which is why the pair failed one way and not the other.
 *
 * Chasing `DatabaseAccessDenied` as an access-control problem — granting
 * rights, resetting passwords, recreating the database — is time spent on a
 * diagnosis the error handed over and that was never true. This module
 * exists so the tooling states the real cause once, where it happens.
 *
 * It only explains. It never reconnects, retries or repairs: a script that
 * silently works around a busy or wrong database hides the one fact worth
 * knowing.
 */

/**
 * Error codes and driver messages that mean "the server answered and refused
 * this login". The dev database (PGlite behind the socket server) accepts
 * any user and any database name, so it cannot produce these — a server that
 * does check them answered instead.
 */
const REFUSED_SIGNATURES = [
  // PostgreSQL SQLSTATEs: 28000 invalid_authorization_specification (unknown
  // role, pg_hba), 28P01 invalid_password.
  '28000',
  '28P01',
  // Prisma's wrap of 28000 through the driver adapter, and the adapter's own
  // error kind name.
  'P1010',
  'DatabaseAccessDenied',
  'User was denied access on the database',
  'password authentication failed',
  'no pg_hba.conf entry',
];

/** Error codes and driver messages that mean "could not get a connection". */
const CONTENTION_SIGNATURES = [
  'Connection terminated unexpectedly',
  'Connection terminated',
  'terminating connection',
  'server closed the connection',
];

const UNREACHABLE_SIGNATURES = [
  'ECONNREFUSED',
  'P1001',
  // Prisma's driver-adapter path reports this as a raw-query failure with code
  // `N/A` rather than P1001, so the message itself has to be matched.
  "Can't reach database server",
  'ENOTFOUND',
  'connect ETIMEDOUT',
];

function textOf(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return `${String(code ?? '')} ${error.message} ${error.stack ?? ''}`;
  }
  return String(error);
}

export type ConnectionFault = 'contended' | 'unreachable' | 'refused' | 'other';

export function classifyConnectionError(error: unknown): ConnectionFault {
  const text = textOf(error);
  // A login refusal is checked first: it means a server DID answer — and it
  // was not the dev database, which never refuses a login. Calling it
  // contention (the old behaviour) sent the reader to raise a limit that was
  // never the problem while a real PostgreSQL answered the phone.
  if (REFUSED_SIGNATURES.some((signature) => text.includes(signature))) return 'refused';
  if (CONTENTION_SIGNATURES.some((signature) => text.includes(signature))) return 'contended';
  if (UNREACHABLE_SIGNATURES.some((signature) => text.includes(signature))) return 'unreachable';
  return 'other';
}

/**
 * A human explanation, or null when this is not a connection fault.
 *
 * Returns null rather than a vague guess so the caller still prints the real
 * error for anything else. Suppressing an unrecognised failure behind a
 * friendly message is how the underlying bug stays invisible.
 */
export function explainConnectionError(error: unknown): string | null {
  switch (classifyConnectionError(error)) {
    case 'refused':
      return [
        'A database server answered — and refused this login.',
        '',
        '  This is NOT a permissions problem, and the development database is',
        '  not the one refusing: it accepts any user and any database name.',
        '  A server that DOES check logins answered instead — almost always a',
        '  real PostgreSQL installed on this machine, reached because the',
        '  client had no DATABASE_URL and fell back to the OS user at',
        '  "localhost", and localhost resolved to where that server listens.',
        '',
        '  Check where DATABASE_URL points. The development database is at',
        '  127.0.0.1 (spelled as the IP — "localhost" can resolve to IPv6 and',
        '  reach the other server). Then either stop that PostgreSQL or move',
        '  one of them: DEV_DB_PORT in .env moves the development database.',
      ].join('\n');

    case 'contended':
      return [
        'The development database refused the connection.',
        '',
        '  This is NOT a password or permissions problem, whatever the error says.',
        '  The database server hit its connection limit and dropped this client.',
        '',
        '  Raise it with DEV_DB_MAX_CONNECTIONS (default 10), or close whatever',
        '  else is attached. Slots idle for five minutes are reclaimed',
        '  automatically; restarting the dev database (npm run db:dev) reclaims',
        '  them immediately.',
      ].join('\n');

    case 'unreachable':
      return [
        'The development database is not running.',
        '',
        '  Nothing is listening on the address in DATABASE_URL.',
        '',
        '  Start it with:  npm run db:dev        (or the full stack: npm run dev)',
        '  Missing .env?   cp .env.example .env',
      ].join('\n');

    case 'other':
      return null;
  }
}

/**
 * Print the explanation if there is one, and say whether it was handled.
 *
 * The raw error is still printed by the caller when this returns false, so
 * nothing is ever swallowed.
 */
export function reportConnectionError(error: unknown, log = console.error): boolean {
  const explanation = explainConnectionError(error);
  if (explanation === null) return false;
  log(`\n${explanation}\n`);
  return true;
}
