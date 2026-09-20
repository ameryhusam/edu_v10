/**
 * Ad-hoc SQL against the dev database, over the same TCP socket the API uses.
 * Usage: node scripts/query.mjs "select 1"
 * Kept as a committed script because /tmp scratch files do not survive.
 */
import pg from 'pg';

const sql = process.argv[2];
if (!sql) {
  console.error('usage: node scripts/query.mjs "<sql>"');
  process.exit(1);
}

const client = new pg.Client({
  connectionString:
    process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/postgres',
});
await client.connect();
const result = await client.query(sql);
console.table(result.rows);
await client.end();
