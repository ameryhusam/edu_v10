import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The development database lifecycle.
 *
 * These tests exist because of a real failure: `npm run dev` started the
 * database, the API and the web server in parallel with nothing applying
 * migrations, so the API met an empty database and every login returned a 500.
 * The bug was in the ORDER of a wiring script, which no unit test covered, so
 * the test suite was fully green while the application could not start.
 *
 * They assert the ordering and configuration facts directly, since the failure
 * lived in exactly the layer that had no coverage.
 */

const ROOT = path.resolve(__dirname, '..', '..');
const read = (relative: string) => readFileSync(path.join(ROOT, relative), 'utf8');
const packageJson = JSON.parse(read('package.json')) as {
  scripts: Record<string, string | undefined>;
};

/** Fail with the script's name rather than on `undefined` further down. */
function script(name: string): string {
  const value = packageJson.scripts[name];
  if (value === undefined) throw new Error(`package.json has no "${name}" script`);
  return value;
}

describe('npm run dev', () => {
  it('makes the database ready before starting the API', () => {
    const dev = script('dev');

    expect(dev).toContain('db:setup');

    // `&&` rather than `concurrently`: the API must not race the migration.
    const setupIndex = dev.indexOf('db:setup');
    const concurrentlyIndex = dev.indexOf('concurrently');
    expect(setupIndex).toBeLessThan(concurrentlyIndex);
    expect(dev.slice(setupIndex, concurrentlyIndex)).toContain('&&');
  });

  it('starts the API only after the preflight check passes', () => {
    const dev = script('dev');
    expect(dev.indexOf('preflight-dev')).toBeLessThan(dev.indexOf('db:setup'));
  });

  it('still runs the three long-lived services together', () => {
    const dev = script('dev');
    for (const service of ['npm:dev:db', 'npm:dev:api', 'npm:dev:web']) {
      expect(dev).toContain(service);
    }
  });
});

describe('db:setup', () => {
  const script = read('scripts/db-setup.mjs');

  it('applies migrations before seeding', () => {
    expect(script.indexOf("'db:apply'")).toBeLessThan(script.indexOf("'db:seed'"));
  });

  it('never destroys data', () => {
    // Wiping the development database is `db:reset`, run deliberately.
    // Comments are stripped first: the file *discusses* being non-destructive,
    // and matching that prose would pass the test for the wrong reason.
    const code = script
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    expect(code).not.toContain('--fresh');
    expect(code).not.toMatch(/rm -rf|rmSync/);
    expect(code).not.toMatch(/drop\s+schema/i);
  });

  it('waits for the database to accept connections instead of sleeping a fixed time', () => {
    expect(script).toContain('waitForPort');
  });

  it('leaves a database it did not start running', () => {
    // Only the child process it spawned is killed.
    expect(script).toMatch(/if \(child\) \{/);
  });
});

describe('the development database server', () => {
  const script = read('scripts/dev-db.mjs');

  it('accepts more than one connection', () => {
    // The default is 1, which dropped the second client and reported it as
    // `P1010 DatabaseAccessDenied` — a permissions message for a capacity
    // limit, which sent debugging in the wrong direction entirely.
    expect(script).toContain('maxConnections');

    const limit = /DEV_DB_MAX_CONNECTIONS \?\? (\d+)/.exec(script);
    expect(limit).not.toBeNull();
    expect(Number(limit?.[1])).toBeGreaterThan(1);
  });
});

describe('the database URL', () => {
  /**
   * Every fallback has to name the same database. A divergent default means
   * the CLI and the server address different data while both appear to work.
   */
  const expected = 'postgresql://postgres:postgres@127.0.0.1:5432/postgres';

  it('is consistent between prisma.config.ts and .env.example', () => {
    expect(read('prisma.config.ts')).toContain(expected);
    expect(read('.env.example')).toContain(expected);
  });

  it('never falls back to localhost, which may resolve to IPv6', () => {
    const fallbacks = read('prisma.config.ts').match(/postgresql:\/\/[^'"`\s]+/g) ?? [];
    for (const url of fallbacks) {
      expect(url).not.toContain('localhost');
    }
  });

  it('is loaded by the seed, not just by db:apply', () => {
    // The seed was the only database client that did not load .env: with
    // DATABASE_URL unset, the PrismaPg pool fell back to pg's defaults (the
    // OS user at "localhost") and could reach a real PostgreSQL installed on
    // the machine, which refuses the unknown user with 28000 → Prisma's
    // "User was denied access on the database". db:apply loaded .env, so
    // apply succeeded while the seed failed on the same machine.
    const seed = read('prisma/seed/seed.ts');
    expect(seed).toContain(`import 'dotenv/config'`);
    // And with no URL at all it must refuse loudly, like apply-migrations,
    // rather than connect to whoever answers at pg's defaults.
    expect(seed).toContain('DATABASE_URL is not set');
  });
});
