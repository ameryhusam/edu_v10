/**
 * Run `prisma generate` against the locally installed schema-engine shim.
 *
 * The Prisma CLI otherwise re-downloads the native engine from
 * binaries.prisma.sh on every invocation — including `generate`, which does not
 * need it. On a restricted network that turns a routine `npm install` into a
 * checkout with no Prisma Client at all.
 *
 * Failure here is reported but never fatal: a postinstall that aborts leaves
 * node_modules half-built, which is worse than a missing client the developer
 * can regenerate.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const enginesDir = path.join(ROOT, 'node_modules', '@prisma', 'engines');

const shim = fs.existsSync(enginesDir)
  ? fs.readdirSync(enginesDir).find((f) => f.startsWith('schema-engine-'))
  : undefined;

const result = spawnSync('npx', ['prisma', 'generate'], {
  cwd: ROOT,
  stdio: 'inherit',
  env: {
    ...process.env,
    ...(shim ? { PRISMA_SCHEMA_ENGINE_BINARY: path.join(enginesDir, shim) } : {}),
  },
});

if (result.status !== 0) {
  console.warn(
    '\nprisma-generate: client generation failed. Run `npm run db:generate` once ' +
      'the network allows it.',
  );
}
