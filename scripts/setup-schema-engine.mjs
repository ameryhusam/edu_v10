/**
 * Install the WASM schema-engine shim so Prisma schema commands work without
 * downloading a native binary from binaries.prisma.sh.
 *
 * Runs from `postinstall`. On networks where the download works this is
 * harmless; on networks where it does not, it is the difference between a
 * working checkout and a dead one.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requireFromRoot = createRequire(path.join(ROOT, 'package.json'));

const SHIM_SRC = path.join(ROOT, 'scripts', 'wasm-schema-engine-shim.cjs');
const ENGINES_DIR = path.join(ROOT, 'node_modules', '@prisma', 'engines');

async function main() {
  if (!fs.existsSync(SHIM_SRC)) {
    console.warn('setup-schema-engine: shim source not found, skipping');
    return;
  }

  let platform = 'debian-openssl-3.0.x';
  try {
    const gp = requireFromRoot('@prisma/get-platform');
    const getPlatform = gp.getPlatform || gp.getBinaryTargetForCurrentPlatform;
    if (getPlatform) platform = await getPlatform();
  } catch {
    // Fall back to the default target; the shim is platform-independent.
  }

  fs.mkdirSync(ENGINES_DIR, { recursive: true });
  const dest = path.join(ENGINES_DIR, `schema-engine-${platform}`);
  fs.copyFileSync(SHIM_SRC, dest);
  fs.chmodSync(dest, 0o755);
  console.log(`setup-schema-engine: installed schema-engine-${platform} (wasm shim)`);
}

main().catch((err) => {
  console.warn('setup-schema-engine failed:', err?.message ?? err);
});
