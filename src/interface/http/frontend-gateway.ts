/**
 * The frontend gateway: one port carries the whole product.
 *
 * The API's port is the only one routed to the browser in the sandboxed
 * preview, and the only one any reverse proxy guarantees everywhere else. A
 * second port for the UI works on a desktop and nowhere else: previews,
 * tunnels and firewalls all carry exactly one. So the API owns every path
 * `/api` is not:
 *
 *   development — every non-API request, and every WebSocket upgrade (Vite's
 *   HMR), is proxied to the Vite dev server on 127.0.0.1:5173;
 *   production  — `web/dist` is served statically, with a fallback to
 *   `index.html` so a client-side route survives a reload.
 *
 * Requests under `/api` are never touched. An unknown API path must reach the
 * API's own JSON 404 envelope, not come back as the SPA's index page wearing
 * a 200 it did not earn.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import type { ServerResponse } from 'node:http';
import express, { type NextFunction, type Request, type Response } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import type { Env } from '../../shared/config/env.js';

/** The API's ground. Everything below it belongs to the API, not the gateway. */
const API_PREFIX = '/api';

/**
 * Where the Vite dev server listens. Fixed, not configurable: the browser
 * never dials it (it dials the gateway), so it only has to be a private
 * agreement between these two processes.
 */
const VITE_DEV_ORIGIN = 'http://127.0.0.1:5173';

/** The built SPA, produced by `npm --prefix web run build`. */
const WEB_DIST = path.resolve(import.meta.dirname, '../../../web/dist');

export interface FrontendGateway {
  /** Express middleware: serves the SPA, or proxies to Vite in development. */
  handler: (req: Request, res: Response, next: NextFunction) => void;
  /**
   * WebSocket upgrade hook for Vite's HMR — attach to the HTTP server's
   * `'upgrade'` event. `undefined` in production, where there is nothing to
   * upgrade: the SPA ships pre-built and nothing hot-reloads.
   */
  upgrade: ((req: Request, socket: import('node:net').Socket, head: Buffer) => void) | undefined;
}

/** An Env carrying just what the gateway branches on, for tests. */
type GatewayEnv = Pick<Env, 'NODE_ENV'>;

/**
 * A plain-text answer, for when the gateway itself is what failed.
 *
 * The `res` a proxy error hands over is the RAW `http.ServerResponse`, not
 * Express's — `.status()` does not exist on it, and the socket may already be
 * gone. So this writes with the low-level API only, and never lets a failed
 * write take the API down: a dead Vite is a 502, not a crash. That crash
 * happened once, on shutdown, when Vite died a moment before the API.
 */
function plain(res: unknown, status: number, body: string): void {
  const target = res as ServerResponse | undefined;
  if (!target || typeof target.end !== 'function') return;
  try {
    if (!target.headersSent) {
      target.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
    }
    target.end(body);
  } catch {
    // The client disconnected first; there is nothing left to answer.
  }
}

/**
 * Development: hand everything non-API to Vite, including HMR upgrades.
 *
 * `changeOrigin` is set because Vite is configured with `allowedHosts`, but
 * the forwarded request still carries the browser's original `Host` — the
 * sandbox's per-preview hostname — and the proxy should speak to Vite as
 * itself, not as the browser.
 */
function devGateway(): FrontendGateway {
  const proxy = createProxyMiddleware({
    target: VITE_DEV_ORIGIN,
    changeOrigin: true,
    ws: true,
    on: {
      error: (err, _req, res) => {
        // The one failure worth naming: `npm run dev:api` started the gateway
        // but `dev:web` never came up (or Vite is still compiling, or just
        // died). A bare 500 from the terminal error handler would send the
        // reader hunting through API code for a frontend problem — and the
        // raw `res` this callback receives must never crash the API itself.
        console.error('[gateway] cannot reach the Vite dev server:', err.message);
        plain(
          res,
          502,
          [
            'The Vite dev server is not answering on 127.0.0.1:5173.',
            '',
            '  It is started by `npm run dev:web`, or all at once by `npm run dev`.',
            '  If it is starting up, reload in a moment.',
          ].join('\n'),
        );
      },
    },
  });

  return {
    handler: (req, res, next) => {
      if (req.path.startsWith(API_PREFIX)) return next();
      return proxy(req, res, next);
    },
    upgrade: (req, socket, head) => {
      // Vite's HMR socket is the only upgrade there is; the API has no
      // WebSockets. An upgrade under /api gets a refusal rather than silence.
      if (req.url?.startsWith(API_PREFIX)) {
        socket.destroy();
        return;
      }
      proxy.upgrade(req, socket, head);
    },
  };
}

/**
 * Production: serve the built SPA. `index.html` is the fallback for every
 * non-file path so client-side routes resolve on a hard load or deep link;
 * a missing *asset* still 404s instead of returning HTML that a `<script>`
 * or `<img>` tag cannot parse.
 */
function productionGateway(distDir: string): FrontendGateway {
  const indexHtml = path.join(distDir, 'index.html');

  if (!existsSync(indexHtml)) {
    // Fail with instructions, not a stack of ENOENTs: the container that
    // runs `npm start` without building the frontend first would otherwise
    // answer every page with five lines of filesystem noise.
    return {
      handler: (_req, res) => {
        plain(
          res,
          503,
          [
            'The frontend has not been built — web/dist/index.html is missing.',
            '',
            '  Build it with:  npm --prefix web run build',
            '  then restart the server.',
          ].join('\n'),
        );
      },
      upgrade: undefined,
    };
  }

  const serveStatic = express.static(distDir);

  return {
    handler: (req, res, next) => {
      if (req.path.startsWith(API_PREFIX)) return next();
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      serveStatic(req, res, () => {
        if (req.accepts('html')) {
          res.sendFile(indexHtml);
          return;
        }
        // A request that does not want HTML (a missing asset, an API probe)
        // falls through to the API's own 404 — honest, and JSON.
        next();
      });
    },
    upgrade: undefined,
  };
}

/**
 * `distDir` is where the built SPA lives. It is a parameter, not a constant
 * read inside, so the not-built branch can be tested without deleting a real
 * build — the default is the one true location.
 */
export function createFrontendGateway(env: GatewayEnv, distDir: string = WEB_DIST): FrontendGateway {
  return env.NODE_ENV === 'production' ? productionGateway(distDir) : devGateway();
}
