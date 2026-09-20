/**
 * `enrollments_one_current_per_learner` (G1, P0.1) — a real, live-database
 * proof, not just a schema-comment promise.
 *
 * This runs every tracked migration.sql file, in order, against a real
 * Postgres (PGlite, in-process — the same engine `scripts/apply-migrations.mjs`
 * targets, just embedded rather than served over a socket) and then tries to
 * do the thing the constraint exists to forbid: give one learner two
 * simultaneously-current enrollments. Before
 * prisma/migrations/20260915000000_enrollments_one_current_per_learner this
 * silently succeeded — "current enrollment" was an application convention,
 * never a database constraint — which is exactly the ambiguity every "what
 * grade is this learner in right now" read implicitly assumed could not
 * happen.
 */

import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readMigrationFiles } from './support/migrations.js';

let db: PGlite;

beforeAll(async () => {
  db = await PGlite.create();

  for (const sql of readMigrationFiles()) {
    await db.exec(sql);
  }
}, 60_000);

afterAll(async () => {
  await db.close();
});

let fixtureSeq = 0;

/** Minimal fixture graph an enrollment row needs to satisfy its foreign keys. */
async function seedFixtures() {
  const n = fixtureSeq++;
  const ids = {
    user: crypto.randomUUID(),
    learner: crypto.randomUUID(),
    school: crypto.randomUUID(),
    yearA: crypto.randomUUID(),
    yearB: crypto.randomUUID(),
    termA: crypto.randomUUID(),
    termB: crypto.randomUUID(),
    grade: crypto.randomUUID(),
  };

  await db.query(
    `INSERT INTO "users" (id, key, username, "passwordHash", "fullName", "updatedAt")
     VALUES ($1, $2, $3, 'x', 'Test Learner', now())`,
    [ids.user, `u-test-${n}`, `learner.test.${n}`],
  );
  await db.query(
    `INSERT INTO "learner_profiles" (id, key, "userId", "updatedAt")
     VALUES ($1, $2, $3, now())`,
    [ids.learner, `lp-test-${n}`, ids.user],
  );
  await db.query(`INSERT INTO "schools" (id, key, name, "updatedAt") VALUES ($1, $2, 'Test School', now())`, [
    ids.school,
    `s-test-${n}`,
  ]);
  await db.query(
    `INSERT INTO "academic_years" (id, key, "startsOn", "endsOn") VALUES ($1, $2, '2025-01-01', '2025-12-31')`,
    [ids.yearA, `ay-a-${n}`],
  );
  await db.query(
    `INSERT INTO "academic_years" (id, key, "startsOn", "endsOn") VALUES ($1, $2, '2026-01-01', '2026-12-31')`,
    [ids.yearB, `ay-b-${n}`],
  );
  await db.query(`INSERT INTO "terms" (id, key, "academicYearId", ordinal, name) VALUES ($1, $2, $3, 1, 'Term A')`, [
    ids.termA,
    `t-a-${n}`,
    ids.yearA,
  ]);
  await db.query(`INSERT INTO "terms" (id, key, "academicYearId", ordinal, name) VALUES ($1, $2, $3, 1, 'Term B')`, [
    ids.termB,
    `t-b-${n}`,
    ids.yearB,
  ]);
  await db.query(`INSERT INTO "grades" (id, key, ordinal, name) VALUES ($1, $2, $3, 'Grade 1')`, [
    ids.grade,
    `g-test-${n}`,
    100 + n,
  ]);

  return ids;
}

async function insertEnrollment(args: {
  key: string;
  learnerId: string;
  schoolId: string;
  academicYearId: string;
  termId: string;
  gradeId: string;
  isCurrent: boolean;
}) {
  return db.query(
    `INSERT INTO "enrollments" (id, key, "learnerId", "schoolId", "academicYearId", "termId", "gradeId", "isCurrent")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      crypto.randomUUID(),
      args.key,
      args.learnerId,
      args.schoolId,
      args.academicYearId,
      args.termId,
      args.gradeId,
      args.isCurrent,
    ],
  );
}

describe('enrollments_one_current_per_learner (live PGlite)', () => {
  it('every tracked migration applied cleanly and the partial index exists', async () => {
    const { rows } = await db.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'enrollments_one_current_per_learner'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.indexdef).toMatch(/WHERE \(?"isCurrent" = true\)?/);
  });

  it('allows a learner many historical (non-current) enrollments', async () => {
    const ids = await seedFixtures();

    await insertEnrollment({
      key: 'enr-history-1',
      learnerId: ids.learner,
      schoolId: ids.school,
      academicYearId: ids.yearA,
      termId: ids.termA,
      gradeId: ids.grade,
      isCurrent: false,
    });
    await insertEnrollment({
      key: 'enr-history-2',
      learnerId: ids.learner,
      schoolId: ids.school,
      academicYearId: ids.yearB,
      termId: ids.termB,
      gradeId: ids.grade,
      isCurrent: false,
    });

    const { rows } = await db.query<{ count: number }>(
      `SELECT count(*)::int FROM "enrollments" WHERE "learnerId" = $1 AND "isCurrent" = false`,
      [ids.learner],
    );
    expect(rows[0]?.count).toBe(2);
  });

  it('refuses a second CURRENT enrollment for the same learner', async () => {
    const ids = await seedFixtures();

    await insertEnrollment({
      key: 'enr-current-1',
      learnerId: ids.learner,
      schoolId: ids.school,
      academicYearId: ids.yearA,
      termId: ids.termA,
      gradeId: ids.grade,
      isCurrent: true,
    });

    await expect(
      insertEnrollment({
        key: 'enr-current-2',
        learnerId: ids.learner,
        schoolId: ids.school,
        academicYearId: ids.yearB,
        termId: ids.termB,
        gradeId: ids.grade,
        isCurrent: true,
      }),
    ).rejects.toThrow(/duplicate key value violates unique constraint/);
  });

  it('allows two DIFFERENT learners to each have their own current enrollment', async () => {
    const a = await seedFixtures();
    const b = await seedFixtures();

    await insertEnrollment({
      key: 'enr-a-current',
      learnerId: a.learner,
      schoolId: a.school,
      academicYearId: a.yearA,
      termId: a.termA,
      gradeId: a.grade,
      isCurrent: true,
    });
    await expect(
      insertEnrollment({
        key: 'enr-b-current',
        learnerId: b.learner,
        schoolId: b.school,
        academicYearId: b.yearA,
        termId: b.termA,
        gradeId: b.grade,
        isCurrent: true,
      }),
    ).resolves.toBeDefined();
  });
});
