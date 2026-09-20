/**
 * Read every tracked migration.sql, in order, for tests that need a real
 * schema on a real (PGlite, in-process) Postgres. Kept separate from
 * `scripts/apply-migrations.mjs` because that script also writes to
 * `_prisma_migrations`; tests that only need the schema — not a resumable
 * migration history — can skip that bookkeeping entirely.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const MIGRATIONS_DIR = path.join(ROOT, 'prisma', 'migrations');

export function readMigrationFiles(): readonly string[] {
  const dirs = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((d) => fs.existsSync(path.join(MIGRATIONS_DIR, d, 'migration.sql')))
    .sort();

  return dirs.map((dir) => fs.readFileSync(path.join(MIGRATIONS_DIR, dir, 'migration.sql'), 'utf8'));
}
