/**
 * The service index at `GET /api/v1`.
 *
 * The bare `/` once held this directory; it now belongs to the frontend
 * gateway, because the API's port is the port a browser is sent to, and what
 * it must find there is the application. The directory still exists — at the
 * version prefix — for the person or client that wants to know what is
 * mounted where.
 *
 * The risk with a directory like this is that it rots: someone mounts a router
 * and forgets the list. So the index is generated from the same `MOUNTS`
 * constant the routers are mounted from, and this test asserts that property by
 * reading the source — if a `app.use(`${API_ROOT}/x`)` appears without `x` in
 * MOUNTS, it fails here rather than silently shipping a lying directory.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '../../src/interface/http/app.ts');
const source = readFileSync(APP, 'utf8');

/** The declared directory. */
const declared = (() => {
  const block = /const MOUNTS = \[([\s\S]*?)\] as const;/.exec(source);
  if (!block) throw new Error('MOUNTS not found in app.ts');
  return [...block[1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!);
})();

/** What is actually mounted, read back out of the mount calls. */
const mounted = (() => {
  const segments = [
    ...source.matchAll(/app\.use\(\s*`\$\{API_ROOT\}\/([a-z-]+)`/g),
  ].map((m) => m[1]!);
  return [...new Set(segments)];
})();

describe('service index', () => {
  it('reads both lists from the source', () => {
    // Guards against a regex that silently matches nothing, which would make
    // every assertion below vacuously true.
    expect(declared.length).toBeGreaterThanOrEqual(10);
    expect(mounted.length).toBeGreaterThanOrEqual(10);
  });

  it('lists every mounted router', () => {
    const missing = mounted.filter((m) => !declared.includes(m));
    expect(missing, `mounted but absent from MOUNTS: ${missing.join(', ')}`).toEqual([]);
  });

  it('does not advertise anything that is not mounted', () => {
    const phantom = declared.filter((d) => !mounted.includes(d));
    expect(phantom, `advertised but not mounted: ${phantom.join(', ')}`).toEqual([]);
  });

  it('serves the index at the version prefix, and only there', () => {
    // The bare root belongs to the frontend gateway — the API's port is the
    // product's port, and a browser opening it must find the application.
    // The directory lives at the version prefix, where an API consumer
    // (or a person guessing the convention) looks for it.
    expect(source).toMatch(/app\.get\(API_ROOT,/);
    expect(source).not.toMatch(/app\.get\('\/',/);
  });

  it('pins exactly one API version', () => {
    // Legacy served both /api and /api/v1 with divergent behaviour.
    expect(source).toMatch(/const API_ROOT = '\/api\/v1';/);
    expect(source).not.toMatch(/app\.use\('\/api\/v2/);
  });
});
