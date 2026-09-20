/**
 * Apply pending migrations.
 *
 * `prisma migrate deploy` is the right tool against a normal Postgres server.
 * This script exists because the native Prisma migration engine is downloaded
 * from binaries.prisma.sh, which is unreachable on restricted networks. It
 * applies the same migration SQL through the pg driver and records it in
 * `_prisma_migrations`, so a later `prisma migrate` sees a consistent history.
 *
 *   node scripts/apply-migrations.mjs
 */
import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS = path.join(ROOT, 'prisma', 'migrations');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env first.');
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();

await client.query(`
  CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    id                  varchar(36)  PRIMARY KEY,
    checksum            varchar(64)  NOT NULL,
    finished_at         timestamptz,
    migration_name      varchar(255) NOT NULL,
    logs                text,
    rolled_back_at      timestamptz,
    started_at          timestamptz  NOT NULL DEFAULT now(),
    applied_steps_count integer      NOT NULL DEFAULT 0
  )`);

const applied = new Set(
  (await client.query('SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL'))
    .rows.map((r) => r.migration_name),
);

const dirs = fs.existsSync(MIGRATIONS)
  ? fs.readdirSync(MIGRATIONS).filter((d) => fs.existsSync(path.join(MIGRATIONS, d, 'migration.sql'))).sort()
  : [];

let count = 0;
for (const dir of dirs) {
  if (applied.has(dir)) {
    console.log(`  = ${dir} (already applied)`);
    continue;
  }
  const sql = fs.readFileSync(path.join(MIGRATIONS, dir, 'migration.sql'), 'utf8');
  const checksum = crypto.createHash('sha256').update(sql).digest('hex');

  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query(
      `INSERT INTO "_prisma_migrations"(id, checksum, finished_at, migration_name, applied_steps_count)
       VALUES ($1, $2, now(), $3, 1)`,
      [crypto.randomUUID(), checksum, dir],
    );
    await client.query('COMMIT');
    console.log(`  + ${dir}`);
    count++;
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`  ! ${dir} failed: ${err.message}`);
    await client.end();
    process.exit(1);
  }
}

const tables = await client.query(
  `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'`,
);
console.log(`\n${count} migration(s) applied. ${tables.rows[0].n} tables in public schema.`);

await client.end();
