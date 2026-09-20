/**
 * Authentication routes.
 *
 * Refresh tokens are returned in the body AND set as an httpOnly cookie. The
 * cookie is what a browser client should use — JavaScript cannot read it, so an
 * XSS bug cannot exfiltrate a 30-day credential. The body is for native and
 * test clients that have no cookie jar.
 */

import { Router, type Request } from 'express';
import { z } from 'zod';
import type { LoginUseCase } from '../../contexts/identity/application/login.use-case.js';
import type { LogoutUseCase } from '../../contexts/identity/application/logout.use-case.js';
import type { RefreshSessionUseCase } from '../../contexts/identity/application/refresh-session.use-case.js';
import { toAuthenticatedUser } from '../../contexts/identity/application/login.use-case.js';
import type { UserRepository } from '../../contexts/identity/application/ports.js';
import { REFRESH_TOKEN_TTL_SECONDS } from '../../contexts/identity/domain/credentials.js';
import {
  RegisterAccountUseCase,
  SELF_SERVICE_ROLES,
} from '../../contexts/identity/application/register-account.use-case.js';
import { Errors } from '../../shared/kernel/errors.js';
import { Ok } from '../../shared/kernel/result.js';
import { handle } from './handler.js';

export interface AuthRouteDeps {
  readonly login: LoginUseCase;
  readonly refreshSession: RefreshSessionUseCase;
  readonly logout: LogoutUseCase;
  /**
   * Used only by GET /me, to return the same user shape login returns. This is
   * the existing canonical read (UserRepository.findById) rather than a new
   * profile service: /me and /login must never describe a user differently.
   */
  readonly userRepository: UserRepository;
  readonly registerAccount: RegisterAccountUseCase;
  readonly secureCookies: boolean;
  readonly cookieSameSite: 'lax' | 'none';
}

const REFRESH_COOKIE = 'refresh_token';

const loginInput = z.object({
  identifier: z.string().trim().min(1, 'Username or email is required'),
  password: z.string().min(1, 'Password is required'),
});

/**
 * Registration input.
 *
 * Field-shape validation only — length, format, presence. Every *rule* that
 * matters (is this username taken, may this role be self-assigned, is the key
 * derivable) lives in the domain and is enforced by the same code path an
 * administrator uses. Restating those here would create a second opinion.
 */
const registerInput = z.object({
  username: z.string().trim().min(1, 'Username is required'),
  fullName: z.string().trim().min(1, 'Full name is required'),
  // A minimum length is a genuine format rule rather than a policy judgement,
  // and refusing it at the edge saves a pointless round trip.
  password: z.string().min(8, 'Password must be at least 8 characters'),
  email: z.string().trim().email('Enter a valid email address').nullish(),
  phone: z.string().trim().max(40).nullish(),
  role: z.string().min(1, 'Choose an account type'),
});

const refreshInput = z.object({
  refreshToken: z.string().min(1).optional(),
});

const logoutInput = z.object({
  refreshToken: z.string().min(1).optional(),
  allDevices: z.boolean().optional(),
});

export function authRoutes(deps: AuthRouteDeps): Router {
  const router = Router();

  /**
   * Refresh-cookie attributes, decided per request.
   *
   * `SameSite` cannot be a constant. `lax` is right when the app and the API
   * share a site, and it is silently fatal when the app is embedded in an
   * iframe on another origin — the browser withholds the cookie, every refresh
   * 401s, and nothing in any log says why. That is why this is configurable.
   *
   * `SameSite=None` is only honoured on a secure connection, so it is paired
   * with `Secure`. The request decides whether the connection is secure:
   * behind the preview proxy Express sees plain HTTP while the browser sees
   * HTTPS, so `X-Forwarded-Proto` is consulted (Express exposes it as
   * `req.secure` once `trust proxy` is set). Emitting `SameSite=None` without
   * `Secure` would produce a cookie every modern browser simply rejects, so
   * that combination is downgraded to `lax` rather than shipped broken.
   */
  const cookieOptionsFor = (req: Request) => {
    const https = req.secure;
    const crossSite = deps.cookieSameSite === 'none' && https;
    return {
      httpOnly: true,
      secure: deps.secureCookies || crossSite,
      sameSite: crossSite ? ('none' as const) : ('lax' as const),
      maxAge: REFRESH_TOKEN_TTL_SECONDS * 1000,
      path: '/api/v1/auth',
    };
  };

  router.post(
    '/login',
    handle({
      input: loginInput,
      execute: async ({ input, req }) => {
        const result = await deps.login.execute({
          identifier: input.identifier,
          password: input.password,
          userAgent: req.header('user-agent') ?? null,
          ip: req.ip ?? null,
          requestId: req.requestId,
        });
        return result;
      },
      onSuccess: ({ value, res, req }) => {
        res.cookie(REFRESH_COOKIE, value.tokens.refreshToken, cookieOptionsFor(req));
      },
    }),
  );

  /**
   * Create your own account.
   *
   * Public by necessity — the caller has no session yet. Everything that makes
   * that safe is below the HTTP layer: the role is checked against the domain's
   * self-service list, no school can be named by the registrant, and the write
   * itself is the same `provisionUser` an administrator calls.
   *
   * On success the user is signed in immediately, through the ordinary login
   * use case rather than a second token path. Making someone type the password
   * they just chose is friction with no security value, and a private
   * token-minting branch here would be exactly the kind of duplicate write path
   * the architecture rules exist to prevent.
   */
  router.post(
    '/register',
    handle({
      input: registerInput,
      successStatus: 201,
      execute: async ({ input, req }) => {
        const created = await deps.registerAccount.execute({
          username: input.username,
          fullName: input.fullName,
          password: input.password,
          email: input.email ?? null,
          phone: input.phone ?? null,
          role: input.role,
        });
        if (!created.ok) return created;

        // Authenticate through the canonical path, so a registered session is
        // indistinguishable from a signed-in one.
        return deps.login.execute({
          identifier: created.value.username,
          password: input.password,
          userAgent: req.header('user-agent') ?? null,
          ip: req.ip ?? null,
          requestId: req.requestId,
        });
      },
      onSuccess: ({ value, res, req }) => {
        res.cookie(REFRESH_COOKIE, value.tokens.refreshToken, cookieOptionsFor(req));
      },
    }),
  );

  /**
   * Which roles may be self-registered, so the form need not hardcode a list
   * that could drift from the server's.
   */
  router.get(
    '/self-service-roles',
    handle({
      input: z.object({}),
      execute: async () => Ok({ roles: SELF_SERVICE_ROLES }),
    }),
  );

  router.post(
    '/refresh',
    handle({
      input: refreshInput,
      execute: async ({ input, req }) =>
        deps.refreshSession.execute({
          refreshToken: input.refreshToken ?? req.cookies?.[REFRESH_COOKIE] ?? '',
          userAgent: req.header('user-agent') ?? null,
          ip: req.ip ?? null,
          requestId: req.requestId,
        }),
      onSuccess: ({ value, res, req }) => {
        res.cookie(REFRESH_COOKIE, value.tokens.refreshToken, cookieOptionsFor(req));
      },
    }),
  );

  router.post(
    '/logout',
    handle({
      input: logoutInput,
      execute: async ({ input, req, actor }) =>
        deps.logout.execute({
          refreshToken: input.refreshToken ?? req.cookies?.[REFRESH_COOKIE] ?? null,
          userId: actor?.userId ?? null,
          ...(input.allDevices != null ? { allDevices: input.allDevices } : {}),
          requestId: req.requestId,
          ip: req.ip ?? null,
        }),
      onSuccess: ({ res, req }) => {
        // Removal must repeat the attributes used to set it: a browser matches
        // name+path+secure+sameSite, so a mismatched clear leaves the cookie.
        res.clearCookie(REFRESH_COOKIE, { ...cookieOptionsFor(req), maxAge: undefined });
      },
    }),
  );

  /** Who am I? The canonical way for a client to learn its own identity. */
  router.get(
    '/me',
    handle({
      input: z.object({}),
      requireAuth: true,
      execute: async ({ actor }) => {
        // Gap G5: /me previously returned only the token claims, so a restored
        // session could not greet the user by name and the UI had to fall back
        // to a key. The claims are the authorization truth; the account is the
        // identity truth. Reading the account keeps /me and /login identical.
        const user = await deps.userRepository.findById(actor!.userId);

        if (!user) {
          // A valid token for an account that no longer exists. Treat it as an
          // ended session rather than a server error.
          return {
            ok: false as const,
            error: Errors.unauthenticated('auth.required', 'Session is no longer valid.'),
          };
        }

        return {
          ok: true as const,
          value: {
            ...toAuthenticatedUser(user),
            // Scoped grants, which toAuthenticatedUser flattens to role names.
            // The UI needs the school scope to pick a default school.
            scopedRoles: actor!.roles,
          },
        };
      },
    }),
  );

  return router;
}
