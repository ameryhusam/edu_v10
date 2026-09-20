/**
 * The frontend gateway — one port for the whole product.
 *
 * The properties that matter are asserted by reading the source and by driving
 * the handler directly, because what would be an end-to-end test (a real Vite
 * behind the proxy) is what `npm run dev` is for, and the two things that
 * break in practice are structural: the gateway swallowing an API 404, or the
 * app binding a port the browser cannot reach.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { createFrontendGateway } from '../../src/interface/http/frontend-gateway.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const source = {
  app: readFileSync(resolve(ROOT, 'src/interface/http/app.ts'), 'utf8'),
  main: readFileSync(resolve(ROOT, 'src/main.ts'), 'utf8'),
  env: readFileSync(resolve(ROOT, 'src/shared/config/env.ts'), 'utf8'),
  envExample: readFileSync(resolve(ROOT, '.env.example'), 'utf8'),
};

/** A fake express trio that records which way a request was sent. */
function harness() {
  const next = vi.fn();
  const writeHead = vi.fn();
  const end = vi.fn();
  const req = { path: '/', method: 'GET', url: '/', accepts: () => false } as unknown as Request;
  const res = { headersSent: false, writeHead, end } as unknown as Response;
  return { next, req, res, writeHead, end };
}

describe('the port', () => {
  it('is APP_PORT, not PORT — the container exports PORT for its own router', () => {
    // PORT=8080 arrives from the sandbox runtime; binding there makes the app
    // unreachable because only the product port is routed to the browser.
    // This is asserted against the source because the schema silently not
    // reading a variable is invisible until the app vanishes from its port.
    expect(source.env).toMatch(/APP_PORT/);
    expect(source.env).not.toMatch(/\bPORT:/);
    expect(source.envExample).toMatch(/APP_PORT=3000/);
    expect(source.envExample).not.toMatch(/^PORT=/m);
  });

  it('main listens on APP_PORT and wires the HMR upgrade', () => {
    expect(source.main).toMatch(/app\.listen\(env\.APP_PORT/);
    expect(source.main).toMatch(/server\.on\('upgrade', frontendGateway\.upgrade\)/);
  });
});

describe('the gateway in app.ts', () => {
  it('is mounted after the API routers and before the 404 handler', () => {
    const mountedAt = source.app.indexOf('app.use(gateway.handler)');
    const notFoundAt = source.app.indexOf('app.use(notFoundHandler())');
    const lastRouterAt = source.app.lastIndexOf(`app.use(\`${'${API_ROOT}'}/tutoring\``);
    expect(mountedAt).toBeGreaterThan(lastRouterAt);
    expect(mountedAt).toBeLessThan(notFoundAt);
  });

  it('never claims the bare root for the API', () => {
    expect(source.app).not.toMatch(/app\.get\('\/',/);
  });
});

describe('the production gateway without a build', () => {
  it('answers 503 with the build command, not a filesystem error', () => {
    // Injected with a directory that has no index.html — exactly the state
    // `npm start` lands in when the frontend was never built. What would
    // surface without this branch is a wall of ENOENT stack traces on every
    // page.
    const gateway = createFrontendGateway(
      { NODE_ENV: 'production' },
      resolve(ROOT, 'tests/fixtures/definitely-not-built'),
    );
    const { req, res, next, writeHead, end } = harness();
    gateway.handler(req, res, next);
    // Written with the low-level API: the production branch serves real
    // Express responses, but `plain` must also survive the raw
    // ServerResponse a proxy error hands over.
    expect(writeHead).toHaveBeenCalledWith(503, expect.objectContaining({ 'content-type': expect.stringContaining('text/plain') }));
    expect(end.mock.calls[0]?.[0]).toMatch(/npm --prefix web run build/);
    expect(next).not.toHaveBeenCalled();
    expect(gateway.upgrade).toBeUndefined();
  });
});

describe('the dev gateway', () => {
  it('lets API paths through to the API', () => {
    // If the gateway answered /api/anything itself, an unknown API route
    // would return the SPA's index.html — a 200 that lies — instead of the
    // JSON envelope the clients parse.
    const gateway = createFrontendGateway({ NODE_ENV: 'development' });
    const { req, res, next } = harness();
    (req as { path: string }).path = '/api/v1/nope';
    req.url = '/api/v1/nope';
    gateway.handler(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(gateway.upgrade).toBeTypeOf('function');
  });

  it('answers proxy errors with the low-level API, never a crash', () => {
    // The `res` a proxy error callback receives is a RAW ServerResponse —
    // `.status()` does not exist on it. Calling it once, when Vite died a
    // moment before the API on shutdown, took the whole API process down.
    const source = readFileSync(
      resolve(ROOT, 'src/interface/http/frontend-gateway.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/res\.status\(/);
    // And a response that is already gone is dropped, not thrown at.
    expect(source).toMatch(/typeof target\.end !== 'function'/);
    expect(source).toContain('catch {');
  });
});
