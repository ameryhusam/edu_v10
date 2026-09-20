/**
 * Local Postgres for development, with zero installation.
 *
 * PGlite is a real Postgres compiled to WASM, exposed here over a TCP socket so
 * that Prisma, psql and the app all talk to it exactly as they would to a
 * server. That means a fresh clone can run migrations and tests immediately,
 * while production still points at a normal managed Postgres — same engine,
 * same SQL, same migrations.
 *
 *   node scripts/dev-db.mjs            # serve on 5432, data in .pgdata
 *   node scripts/dev-db.mjs --fresh    # wipe first
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer, PGLiteSocketHandler } from '@electric-sql/pglite-socket';

/**
 * pglite-socket 0.2.x leaks a connection slot on every error-detached client
 * — an idle timeout, an ECONNRESET from an abruptly killed script. In its
 * `detach()` the handler removes the socket's `close` listener *before*
 * destroying the socket, so `handleClose()` never runs; the server only
 * removes a handler from its count on the handler's `close` event, which
 * nothing emits on that path. Each abruptly terminated client therefore stays
 * counted forever, until every slot is gone and the next client is rejected
 * as `P1010 User was denied access on the database` — a rights message for an
 * accounting bug.
 *
 * Re-emitting the handler's `close` after detach closes the leak for both the
 * idle and reset paths. A normal disconnect emits it twice (once from
 * `handleClose`, once here); deleting a Set member twice is a no-op, so that
 * is safe. Drop this patch when the package fixes its detach ordering.
 */
const upstreamDetach = PGLiteSocketHandler.prototype.detach;
PGLiteSocketHandler.prototype.detach = async function patchedDetach(...args) {
  await upstreamDetach.apply(this, args);
  this.dispatchEvent(new Event('close'));
};

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, '.pgdata');
const PORT = Number(process.env.DEV_DB_PORT ?? 5432);

if (process.argv.includes('--fresh') && fs.existsSync(DATA_DIR)) {
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  console.log('[dev-db] removed existing data directory');
}

const pidFile = path.join(DATA_DIR, 'postmaster.pid');
if (fs.existsSync(pidFile)) {
  try {
    fs.unlinkSync(pidFile);
  } catch {
    // ignore
  }
}

const db = await PGlite.create({ dataDir: DATA_DIR });
/**
 * Allow more than one client.
 *
 * The server defaults to `maxConnections: 1`, which is why a second client —
 * `db:seed` while the API was up, or `scripts/query.mjs` during development —
 * was dropped and reported the failure as `P1010 DatabaseAccessDenied` or
 * `Connection terminated unexpectedly`. Both name access control, which was
 * never the problem, and chasing that wording means granting rights that are
 * not missing.
 *
 * Raising it is supported rather than a workaround: this version of
 * pglite-socket documents itself as supporting multiple concurrent connections
 * and queues work in a QueryQueueManager, so PGlite itself still executes one
 * statement at a time. Verified directly against this version — two clients
 * connect, and concurrent inserts from both commit.
 *
 * The queue defers to a handler that has an open transaction, so a LONG
 * transaction on one connection still stalls the others. That is why setup
 * remains ordered (`db:setup` finishes before the API starts) instead of
 * relying on concurrency to paper over the race. This limit is for short,
 * autocommit traffic — a psql session, a seed re-run, an ad-hoc query —
 * alongside a running API.
 */
const MAX_CONNECTIONS = Number(process.env.DEV_DB_MAX_CONNECTIONS ?? 10);

/**
 * Reclaim slots from connections that stopped talking without closing.
 *
 * A socket whose peer vanished — a phone suspended mid-session, a tunnel
 * dropped, a proot container restarted — never delivers a close event, so its
 * handler keeps a slot forever. On mobile development setups those half-open
 * connections accumulate until every slot is gone, and the next client is
 * rejected as `P1010 User was denied access on the database (not available)`:
 * a message about rights, for a problem about capacity.
 *
 * The idle timeout arms on every message and detaches a connection that has
 * gone quiet longer than this, releasing its slot. Pooled clients (pg,
 * Prisma) notice the closed socket, evict it and reconnect on the next query,
 * so only truly dead peers lose anything.
 */
const IDLE_TIMEOUT_MS = Number(process.env.DEV_DB_IDLE_TIMEOUT_MS ?? 300_000);

const server = new PGLiteSocketServer({
  db,
  port: PORT,
  host: '127.0.0.1',
  maxConnections: MAX_CONNECTIONS,
  idleTimeout: IDLE_TIMEOUT_MS,
});
await server.start();

console.log(`[dev-db] postgres listening on 127.0.0.1:${PORT}`);
console.log(`[dev-db] DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres"`);
/**
 * Two things worth knowing about this server, both of which have cost time:
 *
 * 1. The database NAME in the URL is ignored. PGlite hosts exactly one
 *    database and reports it as `postgres` whatever you ask for, so
 *    `.../edu7_dev` and `.../template1` both connect to the same place. The
 *    URL said `template1` for a while, which reads as "the app is running in
 *    Postgres's template database" — alarming, and untrue. It is `postgres`
 *    now because that is what `current_database()` actually returns.
 *
 * 2. It serves ONE connection at a time. A second client does not queue; the
 *    server drops a connection, and the loser reports something unhelpful
 *    like `P1010 DatabaseAccessDenied` or `Connection terminated
 *    unexpectedly`. Neither is a permissions problem. If a command fails that
 *    way, something else is already attached — usually `npm run dev`.
 */
console.log(`[dev-db] accepting up to ${MAX_CONNECTIONS} connections (PGlite runs one query at a time)`);
if (IDLE_TIMEOUT_MS > 0) {
  console.log(`[dev-db] connections idle for over ${IDLE_TIMEOUT_MS / 1000}s are closed and their slot reclaimed`);
}

const shutdown = async () => {
  await server.stop();
  await db.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
