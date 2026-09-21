/**
 * Environment configuration — parsed once, validated loudly, frozen.
 *
 * The application must refuse to boot with a bad configuration rather than
 * fail at 2am on the first request that happens to need a missing variable.
 * `process.env` is read here and nowhere else.
 */

import { z } from 'zod';

/**
 * The one port the whole product is served on — API and frontend alike.
 *
 * Deliberately NOT `PORT`: the sandboxed container exports `PORT=8080`
 * pointing at its own router, and binding there makes the app reachable by
 * nobody, because the preview's reverse proxy routes the product port (3000)
 * only. A variable the platform sets for its own purposes cannot be allowed
 * to move the app off the one port that reaches the browser. `APP_PORT`
 * cannot collide with it; any environment that genuinely needs a different
 * port can still set it.
 */
export const DEFAULT_APP_PORT = 3000;

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_PORT: z.coerce.number().int().positive().default(DEFAULT_APP_PORT),
  HOST: z.string().default('0.0.0.0'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  /** Set to 1 for the embedded PGlite dev database (single connection). */
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),

  // Auth. In production a real secret is mandatory; there is no dev default
  // that could ever be shipped by accident.
  JWT_SECRET: z.string().min(16).default('dev-only-insecure-secret-change-me'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),

  // AI is optional by design — the platform degrades, it does not break.
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-2.5-flash'),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),
  OPENAI_BASE_URL: z.string().url().default('https://api.openai.com/v1'),
  /** Comma-separated provider ids. Deterministic is appended if omitted. */
  AI_PROVIDER_ORDER: z.string().default('gemini,openai,deterministic'),
  AI_DAILY_QUOTA: z.coerce.number().int().positive().default(50),

  // Python content-engine bridge. The browser never talks to Python directly.
  CONTENT_ENGINE_PYTHON: z.string().default('python'),
  CONTENT_ENGINE_ROOT: z.string().default('./edu7-content-engine'),
  CONTENT_ENGINE_TIMEOUT_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  CONTENT_UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(250 * 1024 * 1024),
  WORKSPACE_ROOT: z.string().default('./workspaces'),

  /**
   * Whether the refresh cookie may travel in a cross-site context.
   *
   * `lax` is correct for a normal deployment where the API and the app share a
   * site. It is WRONG whenever the app is embedded in an iframe on another
   * origin — a sandboxed preview, for instance — because the browser silently
   * withholds a Lax cookie there and the session dies on every reload with no
   * error anywhere to explain it.
   *
   * `none` is only honoured over HTTPS; the code downgrades it to `lax` on a
   * plain-HTTP request rather than emitting a cookie every browser rejects.
   */
  COOKIE_SAMESITE: z.enum(['lax', 'none']).default('lax'),

  /**
   * Comma-separated list of allowed origins, or `*` for "any origin".
   *
   * `*` is a fine default for local development — there is no browser
   * exposure until a real deployment exists to protect — but it is never
   * fine in production: paired with `credentials: true` (see
   * interface/http/app.ts) it would let any website read an authenticated
   * user's session. `loadEnv` refuses to boot with this default in
   * production, the same way it refuses the default JWT secret below.
   */
  CORS_ORIGINS: z.string().default('*'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type Env = Readonly<z.infer<typeof schema>>;

let cached: Env | null = null;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached;

  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  const env = parsed.data;
  if (env.NODE_ENV === 'production' && env.JWT_SECRET.startsWith('dev-only')) {
    throw new Error('JWT_SECRET must be set to a real secret in production.');
  }
  if (env.NODE_ENV === 'production' && env.CORS_ORIGINS.trim() === '*') {
    throw new Error(
      'CORS_ORIGINS must be set to an explicit, comma-separated allow-list in production ' +
        '(it defaults to "*", which — combined with credentialed cookies — would let any ' +
        "website read an authenticated user's session).",
    );
  }

  cached = Object.freeze(env);
  return cached;
}

/** Test helper — never call from application code. */
export function resetEnvCache(): void {
  cached = null;
}
