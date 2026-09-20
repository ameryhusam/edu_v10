/**
 * Can the built server actually run after a production install?
 *
 * `npm run build` emits JavaScript that still imports bare package names, so
 * every one of those must exist after `npm ci --omit=dev`. A devDependency is
 * absent there, and the failure arrives at the worst moment: the build is
 * green, the tests pass, and the deployed process dies at startup with
 * ERR_MODULE_NOT_FOUND.
 *
 * This is not hypothetical. `@prisma/adapter-pg` — which the Prisma client is
 * constructed with, on the hot path of every query — was a devDependency while
 * `src/infrastructure/database/prisma.client.ts` imported it at runtime. Tests
 * and dev both installed dev dependencies, so nothing noticed.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

interface Manifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const manifest = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as Manifest;

/** Source files, since `dist/` only exists after a build. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (full.endsWith('.ts') && !full.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

/** The package a bare specifier resolves to: `@scope/name` or `name`. */
function packageOf(specifier: string): string {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;
}

function runtimeImports(): Set<string> {
  const found = new Set<string>();
  // `import x from 'pkg'` and `export … from 'pkg'`, ignoring type-only
  // imports: those are erased by the compiler and need no runtime package.
  const pattern = /(?:^|\n)\s*(?:import|export)(?!\s+type\s)([^'"]*?)from\s+['"]([^'"]+)['"]/g;

  for (const file of sourceFiles(path.join(ROOT, 'src'))) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(pattern)) {
      const clause = match[1] ?? '';
      const specifier = match[2]!;
      if (specifier.startsWith('.') || specifier.startsWith('node:')) continue;
      // `import { type A, type B }` is also fully erased.
      const names = clause.match(/\{([^}]*)\}/)?.[1];
      if (names && names.trim() && names.split(',').every((n) => n.trim().startsWith('type '))) {
        continue;
      }
      found.add(packageOf(specifier));
    }
  }
  return found;
}

describe('production install', () => {
  it('declares every package the server imports at runtime', () => {
    const production = new Set(Object.keys(manifest.dependencies ?? {}));
    const development = new Set(Object.keys(manifest.devDependencies ?? {}));

    const missing = [...runtimeImports()].filter(
      (pkg) => !production.has(pkg) && development.has(pkg),
    );

    // Named explicitly so a failure says which package and where it belongs.
    expect(
      missing,
      `imported by src/ at runtime but only in devDependencies: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('keeps the dev-only toolchain out of production dependencies', () => {
    // The other direction. Shipping vitest or tsx to production is harmless at
    // runtime but pulls a large tree into the deployed image, and it hides the
    // distinction this test exists to protect.
    const production = new Set(Object.keys(manifest.dependencies ?? {}));
    const devOnly = ['vitest', 'tsx', 'concurrently', 'prisma', 'typescript'];

    expect(devOnly.filter((pkg) => production.has(pkg))).toEqual([]);
  });
});
