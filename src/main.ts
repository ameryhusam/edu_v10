/**
 * Process entry point. Loads config, builds the container, serves HTTP.
 */

import 'dotenv/config';
import { buildContainer } from './composition/container.js';
import { createApp } from './interface/http/app.js';
import { createFrontendGateway } from './interface/http/frontend-gateway.js';
import { loadEnv } from './shared/config/env.js';
import { reportConnectionError } from './infrastructure/database/connection-diagnosis.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const container = buildContainer(env);
  /**
   * The gateway is created here, not inside createApp, because the HTTP
   * server's 'upgrade' event — where Vite's HMR websocket arrives — is wired
   * in this file and needs the same instance the app mounted.
   */
  const frontendGateway = createFrontendGateway(env);
  const app = createApp(container, env, { frontendGateway });

  /**
   * Confirm the database answers before accepting traffic.
   *
   * In development, the database process (PGlite WASM) is launched concurrently
   * with the API, so we poll for readiness with a timeout before giving up.
   * Failing here is noisier and far cheaper: one clear message, at the moment
   * the cause exists, before anything depends on it.
   */
  const dbTimeoutMs = 30_000;
  const dbDeadline = Date.now() + dbTimeoutMs;
  let dbConnected = false;
  let lastDbError: unknown = null;

  while (Date.now() < dbDeadline) {
    try {
      await container.db.$queryRaw`select 1`;
      dbConnected = true;
      break;
    } catch (error) {
      lastDbError = error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  if (!dbConnected) {
    console.error('[edu7] cannot reach the database');
    if (!reportConnectionError(lastDbError)) console.error(lastDbError);
    process.exit(1);
  }

  /**
   * Reachable is not the same as ready.
   *
   * An empty database answers `select 1` perfectly well. Without this check the
   * API would bind its port, log a healthy start, and then fail every request
   * with `The table public.users does not exist` — which reaches the browser as
   * a 500 from POST /auth/login and reads as an authentication bug. It is not:
   * it is an initialisation failure wearing an authentication failure's face,
   * and the two must not be confused.
   *
   * `users` is the probe because it is the first table any request touches.
   */
  let probe: { ready: boolean }[] = [];
  const probeDeadline = Date.now() + 15_000;
  while (Date.now() < probeDeadline) {
    try {
      probe = await container.db.$queryRaw<{ ready: boolean }[]>`
        select to_regclass('public.users') is not null as ready
      `;
      if (probe[0]?.ready === true) break;
    } catch {
      // transient query error while table is being initialized
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  // No row at all is treated as "not ready" rather than as success: the point
  // of the check is to refuse when readiness cannot be demonstrated.
  if (probe[0]?.ready !== true) {
    console.error(
      [
        '[edu7] the database has no schema — migrations have not been applied.',
        '',
        '  The server will not start, because every request would fail with',
        '  "The table public.users does not exist" and surface as a 500.',
        '',
        '  Run:  npm run db:setup      (applies migrations, then seeds)',
      ].join('\n'),
    );
    process.exit(1);
  }

  const server = app.listen(env.APP_PORT, env.HOST, () => {
    console.log(`[edu7] listening on http://${env.HOST}:${env.APP_PORT} (${env.NODE_ENV})`);
    console.log(
      env.NODE_ENV === 'production'
        ? '[edu7] serving the API and the built UI from this one port'
        : '[edu7] serving the API and the Vite dev UI from this one port — HMR included',
    );
  });

  /**
   * Vite's HMR socket arrives as an HTTP upgrade on this same port: the
   * browser dials the page's own origin (see web/vite.config.ts, hmr), and
   * the gateway forwards the socket to Vite. Without this, the first
   * file save would hang the HMR connection and every change would need a
   * manual reload — the single-port preview would work but stop being live.
   */
  if (frontendGateway.upgrade) {
    server.on('upgrade', frontendGateway.upgrade);
  }

  // Graceful shutdown: finish in-flight requests, then release the pool.
  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[edu7] ${signal} received, shutting down`);
    server.close(async () => {
      await container.shutdown();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[edu7] fatal startup error:', err);
  process.exit(1);
});
