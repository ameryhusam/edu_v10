/**
 * Bring the development database up to a usable state, then get out of the way.
 *
 * One command, one responsibility: after this exits, the schema is applied and
 * the reference data exists. It owns the database for its whole run and holds
 * no connection afterwards.
 *
 * Why this exists
 * ---------------
 * `npm run dev` used to start the database, the API and the web server at the
 * same time. Nothing applied migrations, so on a fresh checkout the API came up
 * against an empty database and every query failed with
 * `The table public.users does not exist`, surfacing to the user as a 500 from
 * POST /auth/login. The database was "running" — three green log lines said so
 * — and was not *ready*. Those are different states, and only one of them is
 * worth starting an API against.
 *
 * The fix is ordering, not tolerance: readiness is established BEFORE anything
 * depends on it, which is also the only version that is honest about what went
 * wrong when it fails.
 *
 * It starts its own database process when one is not already listening, and
 * stops that process on the way out. If a database is already up — a developer
 * running `npm run db:dev` in another terminal — it uses that one and leaves it
 * running. Deciding by observation rather than by flag means the command reads
 * the same in both situations.
 *
 * Non-destructive by construction: it never deletes `.pgdata` and never passes
 * `--fresh`. Wiping data is `npm run db:reset`, explicitly, by a human who
 * means it. Re-running this is safe — migrations are tracked in
 * `_prisma_migrations` and the seed is built from upserts.
 */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, '.pgdata');
const SETUP_MARKER = path.join(DATA_DIR, '.setup-complete');
const HOST = '127.0.0.1';
const PORT = Number(process.env.DEV_DB_PORT ?? 5432);

/** Is something already accepting connections on the dev database port? */
function isListening(port, host, timeoutMs = 600) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (answer) => {
      socket.destroy();
      resolve(answer);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, host);
  });
}

/**
 * Wait until the port answers.
 *
 * PGlite has to initialise its WASM engine and, on a first run, create the data
 * directory, so "the process started" and "the socket answers" are seconds
 * apart. Polling the socket is what makes the next step's success meaningful; a
 * fixed sleep would be a guess that is too short on a cold machine and wasted
 * time on a warm one.
 */
async function waitForPort(port, host, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isListening(port, host)) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

function run(label, command, args) {
  console.log(`[db:setup] ${label}…`);
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(`${label} failed`);
  }
}

async function main() {
  const force = process.argv.includes('--force') || process.env.FORCE_DB_SETUP === '1';
  const isInitialized =
    fs.existsSync(SETUP_MARKER) ||
    (!force && fs.existsSync(path.join(DATA_DIR, 'PG_VERSION')) && fs.existsSync(path.join(DATA_DIR, 'base')));

  if (isInitialized && !force) {
    console.log('[db:setup] database already initialized; skipping migrations and seed.');
    if (!fs.existsSync(SETUP_MARKER)) {
      try {
        fs.writeFileSync(SETUP_MARKER, new Date().toISOString(), 'utf8');
      } catch {
        // ignore
      }
    }
    return;
  }

  let child = null;

  const alreadyRunning = await isListening(PORT, HOST);

  if (alreadyRunning) {
    console.log(`[db:setup] using the database already listening on ${HOST}:${PORT}`);
  } else {
    console.log(`[db:setup] starting the development database on ${HOST}:${PORT}…`);
    child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'dev-db.mjs')], {
      cwd: ROOT,
      // Its own log lines would interleave with the migration output for no
      // benefit; failure is reported by the port never answering.
      stdio: 'ignore',
      env: process.env,
      detached: false,
    });

    child.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        console.error(`[db:setup] the database process exited with code ${code}`);
      }
    });

    if (!(await waitForPort(PORT, HOST))) {
      child.kill();
      throw new Error(`the database did not start listening on ${HOST}:${PORT}`);
    }
  }

  try {
    // Order is a dependency, not a preference: the seed writes rows into tables
    // the migration creates.
    run('applying migrations', 'npm', ['run', '--silent', 'db:apply']);
    run('seeding reference data', 'npm', ['run', '--silent', 'db:seed']);
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      fs.writeFileSync(SETUP_MARKER, new Date().toISOString(), 'utf8');
    } catch {
      // ignore
    }
    console.log('[db:setup] database ready');
  } finally {
    // Only stop what we started. A database the developer is running in another
    // terminal is theirs, and killing it would be a surprising side effect of
    // a setup command.
    if (child) {
      console.log('[db:setup] stopping the database it started');
      child.kill('SIGTERM');
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }
}

main().catch((error) => {
  console.error(`\n[db:setup] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
