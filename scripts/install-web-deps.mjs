/**
 * Install `web/`'s dependencies as part of the root install.
 *
 * The frontend is a separate npm project with its own lockfile, deliberately:
 * it has its own toolchain, its own architecture rules and its own test run,
 * and npm workspaces would hoist the two dependency trees into one where a
 * backend package could satisfy a frontend import that the real build would
 * reject.
 *
 * The cost of that separation was a trap. `npm install` at the root installed
 * the backend, printed success, and left `web/node_modules` empty — so the
 * documented next step, `npm run dev`, died with `sh: vite: not found`. The
 * instructions were correct and complete; nothing enforced them, and a missing
 * step that only fails three commands later is a missing step people keep
 * taking.
 *
 * So the root install now installs both. The separation is preserved — two
 * projects, two lockfiles — while "install the project" means what a newcomer
 * assumes it means.
 *
 * Skipped when `EDU7_SKIP_WEB_INSTALL` is set, which CI uses when it installs
 * the two halves itself, and when `web/` has no manifest.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB = path.join(ROOT, 'web');

function main() {
  if (process.env.EDU7_SKIP_WEB_INSTALL) {
    console.log('[web-deps] skipped (EDU7_SKIP_WEB_INSTALL is set)');
    return;
  }

  if (!fs.existsSync(path.join(WEB, 'package.json'))) {
    console.log('[web-deps] no web/package.json — nothing to install');
    return;
  }

  // `npm ci` when a lockfile is present: reproducible, and it is what the
  // documentation tells a newcomer to run by hand. Falls back to `install`
  // only when there is no lockfile to be faithful to.
  const hasLock = fs.existsSync(path.join(WEB, 'package-lock.json'));
  const command = hasLock ? 'ci' : 'install';

  // Already installed and the lockfile has not moved? Do nothing. Without this
  // every `npm install` at the root would re-run a full frontend install.
  if (hasLock && isUpToDate()) {
    console.log('[web-deps] web/node_modules is up to date');
    return;
  }

  console.log(`[web-deps] installing web/ dependencies (npm ${command})…`);

  const result = spawnSync('npm', [command, '--prefix', WEB], {
    stdio: 'inherit',
    // npm on Windows is a shim, not an executable.
    shell: process.platform === 'win32',
    env: { ...process.env, EDU7_SKIP_WEB_INSTALL: '1' },
  });

  if (result.status !== 0) {
    console.error(
      '[web-deps] FAILED. The frontend will not start until this succeeds:\n' +
        '           cd web && npm ci',
    );
    process.exit(result.status ?? 1);
  }

  console.log('[web-deps] web/ dependencies installed');
}

/**
 * Has `web/` been installed since its lockfile last changed?
 *
 * Compares mtimes rather than hashing: this runs on every root install, and
 * the question is only "is this obviously stale", not "prove it is identical".
 * npm itself still verifies the tree when it runs.
 */
function isUpToDate() {
  const marker = path.join(WEB, 'node_modules', '.package-lock.json');
  if (!fs.existsSync(marker)) return false;
  try {
    return fs.statSync(marker).mtimeMs >= fs.statSync(path.join(WEB, 'package-lock.json')).mtimeMs;
  } catch {
    return false;
  }
}

main();
