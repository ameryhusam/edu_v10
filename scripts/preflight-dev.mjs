/**
 * Check the obvious things before starting three servers at once.
 *
 * `npm run dev` launches db, api and web concurrently with interleaved output.
 * When one of them dies on startup its message scrolls past under two other
 * processes' logs, and the failure a newcomer actually sees is whichever line
 * happened to land last. `sh: vite: not found` followed by a healthy API and a
 * healthy database reads as "it started" until you look closely.
 *
 * So the preconditions are checked first, in one place, with the fix printed
 * next to the problem. This does not start anything and cannot fix anything —
 * it refuses early and says exactly which command to run.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const problems = [];

/** The frontend's own dependency tree — the `vite: not found` trap. */
const viteBin = path.join(ROOT, 'web', 'node_modules', '.bin', 'vite');
if (!fs.existsSync(viteBin)) {
  problems.push({
    what: "web/ dependencies are not installed, so the web server cannot start ('vite: not found').",
    fix: 'npm install        # from the repository root — this now installs web/ too',
  });
}

/** The backend's own tree. Rare, but the same failure mode. */
if (!fs.existsSync(path.join(ROOT, 'node_modules', '.bin', 'tsx'))) {
  problems.push({
    what: 'Root dependencies are not installed, so the API cannot start.',
    fix: 'npm install',
  });
}

/** The development database initialization (.pgdata). */
const pgdataDir = path.join(ROOT, '.pgdata');
if (!fs.existsSync(pgdataDir)) {
  console.log('  [preflight] database (.pgdata) not initialized yet — db:setup will initialize it');
}

/**
 * Configuration.
 *
 * `.env` is gitignored, so a fresh clone has none and every database call
 * fails later with a connection error that says nothing about the real cause.
 */
if (!fs.existsSync(path.join(ROOT, '.env'))) {
  if (fs.existsSync(path.join(ROOT, '.env.example'))) {
    fs.copyFileSync(path.join(ROOT, '.env.example'), path.join(ROOT, '.env'));
    console.log('  [preflight] .env was missing, auto-created from .env.example');
  } else {
    problems.push({
      what: '.env is missing, so DATABASE_URL and JWT_SECRET are unset.',
      fix: 'cp .env.example .env',
    });
  }
}

if (problems.length > 0) {
  console.error('\n  Cannot start the development stack:\n');
  for (const problem of problems) {
    console.error(`  ✗ ${problem.what}`);
    console.error(`    → ${problem.fix}\n`);
  }
  process.exit(1);
}

// The three services print their own addresses, but they interleave and none
// of them states the one fact that matters: a single URL carries the whole
// product. Stating it once, up front, is the difference between opening the
// app and guessing at internal ports.
const dbPort = process.env.DEV_DB_PORT ?? '5432';
const appPort = process.env.APP_PORT ?? '3000';
console.log('');
console.log('  Edu7 development stack');
console.log('  ──────────────────────────────────────────────');
console.log(`   The app (open this)  http://localhost:${appPort}`);
console.log('   ─ UI and /api/v1 from one origin; HMR included');
console.log(`   API health           http://localhost:${appPort}/api/v1/health`);
console.log(`   Database             postgresql://127.0.0.1:${dbPort}  (PGlite, embedded)`);
console.log('  ──────────────────────────────────────────────');
console.log('');
