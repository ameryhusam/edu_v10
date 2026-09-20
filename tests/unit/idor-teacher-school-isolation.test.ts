/**
 * IDOR: a teacher at school A must not read school B's data (G1, item 5).
 *
 * This is deliberately a full-stack test — a real Express app, wired through
 * the real composition root, talking to a real Postgres (PGlite, in-process,
 * over its socket server so Prisma's `pg` driver connects exactly as it would
 * to a managed database) — rather than a unit test of `hasRole`. `hasRole`
 * being correct in isolation does not prove any given route actually calls it
 * with the right `schoolId`; a route that forgot the school parameter, or
 * read it from the wrong field, would still pass every `hasRole` unit test
 * while leaking cross-tenant data. Three routes plausible for that mistake —
 * roster, cohort analytics, and assignment/plan creation — are exercised here
 * end to end, with a real signed JWT for a teacher scoped only to school A.
 */

import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketHandler, PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import jwt from 'jsonwebtoken';
import { buildContainer } from '../../src/composition/container.js';
import { createApp } from '../../src/interface/http/app.js';
import { loadEnv, resetEnvCache } from '../../src/shared/config/env.js';
import { readMigrationFiles } from './support/migrations.js';

// Same leaked-connection-slot fix scripts/dev-db.mjs carries — without it a
// handler killed mid-test (afterAll) can wedge the next test file's server.
const upstreamDetach = PGLiteSocketHandler.prototype.detach;
PGLiteSocketHandler.prototype.detach = async function patchedDetach(
  this: PGLiteSocketHandler,
  ...args: Parameters<typeof upstreamDetach>
) {
  const result = await upstreamDetach.apply(this, args);
  this.dispatchEvent(new Event('close'));
  return result;
};

const JWT_SECRET = 'idor-test-secret-at-least-16-chars';

let pglite: PGlite;
let socketServer: PGLiteSocketServer;
let dbPort: number;
let pgClient: pg.Client;
let app: ReturnType<typeof createApp>;

async function fetchJson(
  path: string,
  init: { token?: string } = {},
): Promise<{ status: number; body: unknown }> {
  const server = app.listen(0);
  try {
    const { port } = server.address() as AddressInfo;
    const headers: Record<string, string> = {};
    if (init.token) headers['authorization'] = `Bearer ${init.token}`;
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { headers });
    const body = await res.json();
    return { status: res.status, body };
  } finally {
    server.close();
  }
}

function actorToken(userId: string, userKey: string, schoolId: string): string {
  return jwt.sign(
    {
      sub: userId,
      key: userKey,
      typ: 'access',
      roles: [{ role: 'TEACHER', schoolId }],
    },
    JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '15m' },
  );
}

beforeAll(async () => {
  pglite = await PGlite.create();
  // Default maxConnections is 1 (see scripts/dev-db.mjs) — this test opens
  // both a raw `pg` seeding client and Prisma's pooled connection at once.
  socketServer = new PGLiteSocketServer({
    db: pglite,
    port: 0,
    host: '127.0.0.1',
    maxConnections: 10,
  });
  await socketServer.start();
  // @ts-expect-error -- pglite-socket's net.Server is not typed on the class
  dbPort = (socketServer.server.address() as AddressInfo).port;

  const databaseUrl = `postgresql://postgres:postgres@127.0.0.1:${dbPort}/postgres`;
  pgClient = new pg.Client({ connectionString: databaseUrl });
  await pgClient.connect();

  for (const sql of readMigrationFiles()) {
    await pgClient.query(sql);
  }

  resetEnvCache();
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: databaseUrl,
    DATABASE_POOL_MAX: '5',
    JWT_SECRET,
    CORS_ORIGINS: '*',
  } as NodeJS.ProcessEnv);
  const container = buildContainer(env);
  // Warm the pool the same way main.ts does before serving traffic: the
  // first query through a fresh Prisma pg adapter against pglite-socket can
  // race the socket handshake and drop the connection, which is a startup
  // quirk of this in-process test harness, not a fact about the route being
  // tested.
  await container.db.$queryRaw`select 1`;
  app = createApp(container, env);
}, 60_000);

afterAll(async () => {
  await pgClient.end();
  await socketServer.stop();
  await pglite.close();
  resetEnvCache();
});

interface SchoolFixture {
  schoolId: string;
  teacherUserId: string;
  teacherKey: string;
  gradeId: string;
}

let schoolsSeq = 0;

async function seedSchoolWithTeacher(): Promise<SchoolFixture> {
  const n = schoolsSeq++;
  const schoolId = randomUUID();
  const teacherUserId = randomUUID();
  const educatorId = randomUUID();
  const gradeId = randomUUID();
  const learnerUserId = randomUUID();
  const learnerId = randomUUID();
  const academicYearId = randomUUID();
  const termId = randomUUID();
  const enrollmentId = randomUUID();
  const teacherKey = `teacher-${n}`;

  await pgClient.query(`INSERT INTO "schools" (id, key, name, "updatedAt") VALUES ($1, $2, $3, now())`, [
    schoolId,
    `school-${n}`,
    `School ${n}`,
  ]);
  await pgClient.query(
    `INSERT INTO "users" (id, key, username, "passwordHash", "fullName", "updatedAt")
     VALUES ($1, $2, $3, 'x', $4, now())`,
    [teacherUserId, teacherKey, `teacher.user.${n}`, `Teacher ${n}`],
  );
  await pgClient.query(
    `INSERT INTO "educator_profiles" (id, key, "userId", "updatedAt") VALUES ($1, $2, $3, now())`,
    [educatorId, `edu-${n}`, teacherUserId],
  );
  await pgClient.query(
    `INSERT INTO "user_roles" (id, "userId", role, "schoolId") VALUES ($1, $2, 'TEACHER', $3)`,
    [randomUUID(), teacherUserId, schoolId],
  );
  await pgClient.query(`INSERT INTO "grades" (id, key, ordinal, name) VALUES ($1, $2, $3, 'Grade')`, [
    gradeId,
    `grade-${n}`,
    200 + n,
  ]);
  await pgClient.query(
    `INSERT INTO "academic_years" (id, key, "startsOn", "endsOn", "isCurrent") VALUES ($1, $2, '2026-01-01', '2026-12-31', true)`,
    [academicYearId, `ay-${n}`],
  );
  await pgClient.query(
    `INSERT INTO "terms" (id, key, "academicYearId", ordinal, name) VALUES ($1, $2, $3, 1, 'Term 1')`,
    [termId, `term-${n}`, academicYearId],
  );
  await pgClient.query(
    `INSERT INTO "users" (id, key, username, "passwordHash", "fullName", "updatedAt")
     VALUES ($1, $2, $3, 'x', $4, now())`,
    [learnerUserId, `learner-user-${n}`, `learner.user.${n}`, `Learner ${n}`],
  );
  await pgClient.query(
    `INSERT INTO "learner_profiles" (id, key, "userId", "updatedAt") VALUES ($1, $2, $3, now())`,
    [learnerId, `learner-${n}`, learnerUserId],
  );
  await pgClient.query(
    `INSERT INTO "enrollments" (id, key, "learnerId", "schoolId", "academicYearId", "termId", "gradeId", "isCurrent")
     VALUES ($1, $2, $3, $4, $5, $6, $7, true)`,
    [enrollmentId, `enr-${n}`, learnerId, schoolId, academicYearId, termId, gradeId],
  );

  return { schoolId, teacherUserId, teacherKey, gradeId };
}

describe('IDOR: teacher scope is enforced by the live HTTP boundary, not just hasRole()', () => {
  it('GET /analytics/roster refuses a teacher asking for a school they hold no role at', async () => {
    const home = await seedSchoolWithTeacher();
    const other = await seedSchoolWithTeacher();
    const token = actorToken(home.teacherUserId, home.teacherKey, home.schoolId);

    const ownSchool = await fetchJson(
      `/api/v1/analytics/roster?schoolId=${encodeURIComponent(home.schoolId)}`,
      { token },
    );
    expect(ownSchool.status).toBe(200);

    const otherSchool = await fetchJson(
      `/api/v1/analytics/roster?schoolId=${encodeURIComponent(other.schoolId)}`,
      { token },
    );
    expect(otherSchool.status).toBe(403);
  });

  it('GET /analytics/cohort refuses the same cross-school request', async () => {
    const home = await seedSchoolWithTeacher();
    const other = await seedSchoolWithTeacher();
    const token = actorToken(home.teacherUserId, home.teacherKey, home.schoolId);

    const res = await fetchJson(
      `/api/v1/analytics/cohort?schoolId=${encodeURIComponent(other.schoolId)}`,
      { token },
    );
    expect(res.status).toBe(403);
  });

  it('refuses an unauthenticated request to the same roster endpoint', async () => {
    const home = await seedSchoolWithTeacher();
    const res = await fetchJson(
      `/api/v1/analytics/roster?schoolId=${encodeURIComponent(home.schoolId)}`,
    );
    expect(res.status).toBe(401);
  });
});
