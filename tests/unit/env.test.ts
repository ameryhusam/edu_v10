/**
 * Boot-time environment validation (G1, docs/BACKEND-FINAL-AUDIT-AND-PRODUCTION-PLAN-2026-09-15.md §10).
 *
 * `loadEnv` must refuse to start rather than silently run insecurely. Two
 * refusals matter today: a placeholder JWT secret, and a wide-open CORS
 * allow-list — both are safe defaults for local development and both are a
 * real vulnerability in production if nobody overrides them.
 */

import { describe, expect, it, afterEach } from 'vitest';
import { loadEnv, resetEnvCache } from '../../src/shared/config/env.js';

function baseEnv(overrides: Partial<NodeJS.ProcessEnv> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    JWT_SECRET: 'a-real-production-secret-value',
    CORS_ORIGINS: 'https://app.example.com',
    ...overrides,
  } as NodeJS.ProcessEnv;
}

describe('loadEnv', () => {
  afterEach(() => {
    resetEnvCache();
  });

  it('boots in production with an explicit CORS allow-list', () => {
    const env = loadEnv(baseEnv());
    expect(env.CORS_ORIGINS).toBe('https://app.example.com');
  });

  it('refuses to boot in production when CORS_ORIGINS is the wildcard default', () => {
    expect(() => loadEnv(baseEnv({ CORS_ORIGINS: '*' }))).toThrow(/CORS_ORIGINS/);
  });

  it('refuses to boot in production when CORS_ORIGINS is the wildcard with surrounding whitespace', () => {
    expect(() => loadEnv(baseEnv({ CORS_ORIGINS: '  *  ' }))).toThrow(/CORS_ORIGINS/);
  });

  it('allows the wildcard default outside production', () => {
    const env = loadEnv(baseEnv({ NODE_ENV: 'development', CORS_ORIGINS: '*' }));
    expect(env.CORS_ORIGINS).toBe('*');
  });

  it('still refuses the placeholder JWT secret in production', () => {
    expect(() =>
      loadEnv(baseEnv({ JWT_SECRET: 'dev-only-insecure-secret-change-me' })),
    ).toThrow(/JWT_SECRET/);
  });

  it('caches the parsed result across calls until reset', () => {
    const first = loadEnv(baseEnv());
    const second = loadEnv(baseEnv({ CORS_ORIGINS: '*' }));
    expect(second).toBe(first);
  });
});
