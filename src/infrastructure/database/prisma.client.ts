/**
 * The single Prisma client instance.
 *
 * This is the ONLY module in the codebase permitted to construct a
 * PrismaClient. Everything else receives it by injection. That rule is checked
 * by scripts/check-architecture.ts, and it is what keeps `import { prisma }`
 * from spreading into domain code the way it did in the legacy project.
 *
 * Prisma 7 connects through a driver adapter rather than a bundled native
 * engine, so the pg pool is created here and owned here.
 */

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

export interface PrismaClientOptions {
  /** Postgres connection string. Supplied by the composition root. */
  readonly databaseUrl: string;
  /** Verbose logging in development, errors only in production. */
  readonly verbose?: boolean;
  /**
   * Maximum pooled connections.
   *
   * Set this to 1 when running against the embedded PGlite dev database, which
   * accepts a single connection at a time. A managed Postgres should use the
   * default. Application code issues the same concurrent queries either way —
   * only the pool size differs.
   */
  readonly poolMax?: number;
}

const globalForPrisma = globalThis as unknown as { __edu7Prisma?: PrismaClient };

export function createPrismaClient(options: PrismaClientOptions): PrismaClient {
  // Reuse across dev watch-mode restarts so connections are not leaked.
  if (options.verbose && globalForPrisma.__edu7Prisma) {
    return globalForPrisma.__edu7Prisma;
  }

  const adapter = new PrismaPg({
    connectionString: options.databaseUrl,
    ...(options.poolMax != null ? { max: options.poolMax } : {}),
  });
  const client = new PrismaClient({
    adapter,
    log: options.verbose ? ['error', 'warn'] : ['error'],
  });

  if (options.verbose) globalForPrisma.__edu7Prisma = client;
  return client;
}

export type Db = PrismaClient;
