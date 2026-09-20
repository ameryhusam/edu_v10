/**
 * Request context, authentication and error handling.
 *
 * These three middlewares are the entire boundary between HTTP and the
 * application. Nothing below this folder knows what a Request is.
 */

import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { Errors, type DomainError } from '../../../shared/kernel/errors.js';
import { failure, statusFor } from '../../../shared/http/envelope.js';
import { isRoleName, type ScopedRoleGrant } from '../../../contexts/identity/domain/roles.js';

/**
 * A role together with the school it is valid in.
 *
 * Scope is carried through to the request because `UserRole` is stored per
 * school: a TEACHER at school A is not a TEACHER at school B. Flattening this
 * to a list of role names at the HTTP boundary would silently grant
 * cross-school access.
 */
export type ActorRole = ScopedRoleGrant;

export interface Actor {
  readonly userId: string;
  readonly userKey: string;
  readonly roles: readonly ScopedRoleGrant[];
  readonly learnerKey?: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
      actor?: Actor;
    }
  }
}

export function requestContext() {
  return (req: Request, res: Response, next: NextFunction): void => {
    req.requestId = (req.header('x-request-id') ?? randomUUID()).slice(0, 64);
    res.setHeader('x-request-id', req.requestId);
    next();
  };
}

/** Attaches an actor when a valid bearer token is present. Does not reject. */
export function authenticate(secret: string) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const header = req.header('authorization');
    const token = header?.startsWith('Bearer ') ? header.slice(7) : req.cookies?.access_token;
    if (!token) return next();

    try {
      const payload = jwt.verify(token, secret, { algorithms: ['HS256'] }) as {
        sub: string;
        key: string;
        roles?: (string | { role: string; schoolId: string | null })[];
        learnerKey?: string;
        typ?: string;
      };

      // A refresh token must never authenticate a request: it is long-lived by
      // design, so replaying it as a bearer token would turn a 15-minute
      // credential into a 30-day one.
      if (payload.typ === 'refresh') return next();

      req.actor = {
        userId: payload.sub,
        userKey: payload.key,
        // A token is user-supplied input: anything that is not a role this
        // build knows about is discarded rather than carried around as a
        // string that no check will ever match.
        roles: (payload.roles ?? [])
          .map((r) => (typeof r === 'string' ? { role: r, schoolId: null } : r))
          .filter((r): r is ScopedRoleGrant => isRoleName(r.role)),
        ...(payload.learnerKey ? { learnerKey: payload.learnerKey } : {}),
      };
    } catch {
      // An invalid token is treated as no token. Endpoints that require an
      // actor will reject with 401 through `requireActor`.
    }
    next();
  };
}

export function requireActor(req: Request): Actor | DomainError {
  return req.actor ?? Errors.unauthenticated('auth.required', 'Authentication is required.');
}

export function requireRole(...roles: readonly string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const actor = req.actor;
    if (!actor) {
      const err = Errors.unauthenticated('auth.required', 'Authentication is required.');
      res.status(statusFor(err)).json(failure(err, req.requestId));
      return;
    }
    if (!roles.some((r) => actor.roles.some((held) => held.role === r))) {
      const err = Errors.forbidden('auth.insufficient_role', 'You do not have access to this resource.', {
        required: roles,
      });
      res.status(statusFor(err)).json(failure(err, req.requestId));
      return;
    }
    next();
  };
}

/**
 * Terminal error handler. Anything that reaches here is a bug, so it is logged
 * with full detail and returned WITHOUT detail — internals never leak to clients.
 */
export function errorHandler() {
  return (err: unknown, req: Request, res: Response, _next: NextFunction): void => {
    const domainError: DomainError = Errors.internal(
      'server.unhandled',
      'An unexpected error occurred.',
    );

    console.error(
      JSON.stringify({
        level: 'error',
        requestId: req.requestId,
        path: req.path,
        method: req.method,
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      }),
    );

    if (res.headersSent) return;
    res.status(500).json(failure(domainError, req.requestId));
  };
}

/**
 * The final 404.
 *
 * `index` points the caller at the service directory. A 404 that says only
 * "no" leaves someone guessing at the version prefix; one that says where to
 * look costs nothing and ends the guessing.
 */
export function notFoundHandler(indexPath = '/') {
  return (req: Request, res: Response): void => {
    const err = Errors.notFound('route.not_found', `No route matches ${req.method} ${req.path}.`, {
      index: indexPath,
    });
    res.status(404).json(failure(err, req.requestId));
  };
}
