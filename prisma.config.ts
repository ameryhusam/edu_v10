import 'dotenv/config';
import { defineConfig } from 'prisma/config';

/**
 * Prisma 7 configuration.
 *
 * The connection URL is resolved HERE and nowhere else. In the legacy project
 * the URL was resolved in three places with three different relative-path
 * rules, so `prisma db push` and the running server quietly used two different
 * database files. One resolver, one truth.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed/seed.ts',
  },
  datasource: {
    /**
     * The fallback must match the one in `.env.example` exactly.
     *
     * It used to read `…@localhost:5432/edu7?schema=public` while every other
     * entry point defaulted to `…@127.0.0.1:5432/postgres`. Whenever
     * DATABASE_URL was unset, Prisma CLI commands therefore addressed a
     * different database name than the server did — the precise failure the
     * comment above claims this file prevents. Two differences hid in it:
     * `edu7` vs `postgres`, and `localhost` vs `127.0.0.1` (which can resolve
     * to ::1 and fail to connect at all).
     */
    url: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/postgres',
  },
});
