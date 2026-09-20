/**
 * Express application assembly.
 *
 * Separated from `main.ts` so integration tests can build the app without
 * binding a port.
 */

import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import type { Container } from '../../composition/container.js';
import type { Env } from '../../shared/config/env.js';
import { success } from '../../shared/http/envelope.js';
import { assessmentRoutes } from './assessment.routes.js';
import { authRoutes } from './auth.routes.js';
import { contentRoutes } from './content.routes.js';
import { provisioningRoutes } from './provisioning.routes.js';
import { catalogueRoutes } from './catalogue.routes.js';
import { instructionRoutes } from './instruction.routes.js';
import { itemBankRoutes } from './item-bank.routes.js';
import { administrationRoutes } from './administration.routes.js';
import { analyticsRoutes } from './analytics.routes.js';
import { remediationRoutes } from './remediation.routes.js';
import { engagementRoutes } from './engagement.routes.js';
import { learningRoutes } from './learning.routes.js';
import { tutoringRoutes } from './tutoring.routes.js';
import { createFrontendGateway, type FrontendGateway } from './frontend-gateway.js';
import {
  authenticate,
  errorHandler,
  notFoundHandler,
  requestContext,
} from './middleware/context.js';

/**
 * Exactly one API version is live at a time. The legacy project served both
 * `/api` and `/api/v1` with divergent behaviour; that ambiguity is not
 * recreated here.
 */
const API_ROOT = '/api/v1';

/**
 * Every mounted segment, in one place.
 *
 * The service index at the version prefix is generated from this, so a new
 * router cannot be added without appearing in the directory — the usual way
 * such a list rots. `content` appears once even though two routers mount
 * there.
 */
const MOUNTS = [
  'auth',
  'learning',
  'assessment',
  'instruction',
  'content',
  'catalogue',
  'administration',
  'provisioning',
  'analytics',
  'engagement',
  'remediation',
  'tutoring',
] as const;

export function createApp(
  container: Container,
  env: Env,
  options: { frontendGateway?: FrontendGateway } = {},
): Express {
  const app = express();

  /**
   * Trust the reverse proxy's forwarding headers.
   *
   * Without this, `req.secure` is false and `req.ip` is the proxy's address
   * whenever the app runs behind a TLS-terminating proxy — which breaks both
   * the cookie's Secure decision and the IP recorded on a session. Scoped to
   * one hop: trusting every hop lets a client forge `X-Forwarded-For` and
   * poison the audit trail.
   */
  app.set('trust proxy', 1);

  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());
  app.use(
    cors({
      origin: env.CORS_ORIGINS === '*' ? true : env.CORS_ORIGINS.split(',').map((s) => s.trim()),
      credentials: true,
    }),
  );
  app.use(requestContext());
  app.use(authenticate(env.JWT_SECRET));

  app.get('/api/v1/health', (req, res) => {
    res.json(
      success({ status: 'ok', version: '0.1.0', environment: env.NODE_ENV }, req.requestId),
    );
  });

  /**
   * The service index.
   *
   * The API's root is `GET /api/v1`. The bare `/` belongs to the frontend
   * gateway below — the API's port is the product's port, and what a browser
   * finds there is the application, not a directory.
   *
   * This is a directory, not documentation: it lists where things are mounted
   * and nothing about what they do. It is derived from MOUNTS, the same
   * constant the routers are mounted from, so it cannot drift out of date the
   * way a hand-written list would.
   */
  const serviceIndex = (): Record<string, unknown> => ({
    service: 'edu7-api',
    version: '0.1.0',
    environment: env.NODE_ENV,
    health: `${API_ROOT}/health`,
    endpoints: Object.fromEntries(MOUNTS.map((m) => [m, `${API_ROOT}/${m}`])),
    note: 'All endpoints require authentication except POST /auth/login and /auth/refresh.',
  });

  app.get(API_ROOT, (req, res) => {
    res.json(success(serviceIndex(), req.requestId));
  });

  app.use(
    `${API_ROOT}/learning`,
    learningRoutes({ ...container.useCases, guardianLinks: container.guardianLinks }),
  );
  app.use(
    `${API_ROOT}/auth`,
    authRoutes({
      ...container.useCases,
      userRepository: container.userRepository,
      registerAccount: container.useCases.registerAccount,
      secureCookies: container.secureCookies,
      cookieSameSite: container.cookieSameSite,
    }),
  );
  app.use(
    `${API_ROOT}/assessment`,
    assessmentRoutes({
      ...container.useCases,
      attemptHistory: container.attemptHistory,
      examCatalog: container.examCatalog,
      guardianLinks: container.guardianLinks,
    }),
  );
  app.use(`${API_ROOT}/provisioning`, provisioningRoutes(container.useCases));
  app.use(`${API_ROOT}/catalogue`, catalogueRoutes(container.useCases));
  app.use(`${API_ROOT}/administration`, administrationRoutes(container.useCases));
  app.use(`${API_ROOT}/content`, contentRoutes(container.useCases));
  app.use(`${API_ROOT}/content`, itemBankRoutes(container.useCases));
  app.use(
    `${API_ROOT}/analytics`,
    analyticsRoutes({
      ...container.useCases,
      guardianLinks: container.guardianLinks,
      analyticsReader: container.analyticsReader,
    }),
  );
  app.use(
    `${API_ROOT}/engagement`,
    engagementRoutes({
      ...container.useCases,
      analyticsReader: container.analyticsReader,
      guardianLinks: container.guardianLinks,
    }),
  );
  app.use(
    `${API_ROOT}/remediation`,
    remediationRoutes({
      ...container.useCases,
      analyticsReader: container.analyticsReader,
      guardianLinks: container.guardianLinks,
    }),
  );
  app.use(
    `${API_ROOT}/instruction`,
    instructionRoutes({ ...container.useCases, guardianLinks: container.guardianLinks }),
  );
  app.use(`${API_ROOT}/tutoring`, tutoringRoutes(container.useCases));

  /**
   * The frontend gateway owns every path `/api` is not.
   *
   * It sits AFTER the routers, so the API serves its own, and BEFORE the 404
   * handler, so unknown API paths still get the JSON envelope rather than the
   * SPA's index page. `main.ts` injects the instance it wires to the HTTP
   * server's 'upgrade' event so Vite's HMR socket survives the single-port
   * setup; tests and other embedders get a gateway built from the env.
   */
  const gateway = options.frontendGateway ?? createFrontendGateway(env);
  app.use(gateway.handler);

  app.use(notFoundHandler());
  app.use(errorHandler());

  return app;
}
