/**
 * A teacher's roster (gap G3).
 *
 * Edu7 has no class or section model by decision: a class is a query over
 * current enrollments. So the rules that matter are about the scope.
 *
 * **`isCurrent` is the whole safety property.** Without it a roster would
 * accumulate every learner who ever enrolled at the school, including those
 * who left years ago, and a teacher would be handed names they have no
 * business seeing.
 *
 * **Order must be stable.** A roster that reshuffles between loads cannot be
 * read down, and Postgres gives no ordering guarantee without an ORDER BY.
 */

import { describe, expect, it } from 'vitest';
import { PrismaAnalyticsReader } from '../../src/infrastructure/database/analytics.repository.js';
import type { Db } from '../../src/infrastructure/database/prisma.client.js';

interface Recorded {
  where?: Record<string, unknown>;
  orderBy?: unknown;
}

function dbDouble(rows: readonly unknown[]): { db: Db; recorded: Recorded } {
  const recorded: Recorded = {};
  const db = {
    enrollment: {
      findMany: async (args: { where: Record<string, unknown>; orderBy: unknown }) => {
        recorded.where = args.where;
        recorded.orderBy = args.orderBy;
        return rows;
      },
    },
  } as unknown as Db;
  return { db, recorded };
}

function enrolment(fullName: string, gradeName = 'الصف السابع') {
  return {
    grade: { id: 'grade-uuid', name: gradeName, ordinal: 7 },
    learner: { key: `lrn_${fullName}`, user: { fullName } },
  };
}

const SCHOOL = '26891d38-52d3-4555-b885-a39a8379c647';

describe('PrismaAnalyticsReader.rosterInScope', () => {
  it('lists only current enrollments', async () => {
    const { db, recorded } = dbDouble([]);
    await new PrismaAnalyticsReader(db).rosterInScope({ schoolId: SCHOOL });

    expect(recorded.where?.['isCurrent']).toBe(true);
  });

  it('scopes to the requested school', async () => {
    const { db, recorded } = dbDouble([]);
    await new PrismaAnalyticsReader(db).rosterInScope({ schoolId: SCHOOL });

    expect(recorded.where?.['schoolId']).toBe(SCHOOL);
  });

  it('omits grade and term filters when they are not supplied', async () => {
    // A null filter must not become `gradeId: null`, which would match only
    // enrollments with no grade — that is, none of them.
    const { db, recorded } = dbDouble([]);
    await new PrismaAnalyticsReader(db).rosterInScope({
      schoolId: SCHOOL,
      gradeId: null,
      termId: null,
    });

    expect(recorded.where).not.toHaveProperty('gradeId');
    expect(recorded.where).not.toHaveProperty('termId');
  });

  it('narrows to a grade when one is given', async () => {
    const { db, recorded } = dbDouble([]);
    await new PrismaAnalyticsReader(db).rosterInScope({
      schoolId: SCHOOL,
      gradeId: 'grade-uuid',
    });

    expect(recorded.where?.['gradeId']).toBe('grade-uuid');
  });

  it('orders by grade then name, so the list is stable between loads', async () => {
    const { db, recorded } = dbDouble([]);
    await new PrismaAnalyticsReader(db).rosterInScope({ schoolId: SCHOOL });

    expect(recorded.orderBy).toEqual([
      { grade: { ordinal: 'asc' } },
      { learner: { user: { fullName: 'asc' } } },
    ]);
  });

  it('projects names and grades, not just keys', async () => {
    const { db } = dbDouble([enrolment('طالب تجريبي')]);
    const [row] = await new PrismaAnalyticsReader(db).rosterInScope({ schoolId: SCHOOL });

    expect(row).toEqual({
      learnerKey: 'lrn_طالب تجريبي',
      fullName: 'طالب تجريبي',
      gradeName: 'الصف السابع',
      gradeId: 'grade-uuid',
    });
  });

  it('carries no mastery — a roster is identity, not analysis', async () => {
    // Guards the boundary against the cohort report creeping in here. Loading
    // every learner's standing to render a name list is the performance bug
    // this separation exists to prevent.
    const { db } = dbDouble([enrolment('طالب تجريبي')]);
    const [row] = await new PrismaAnalyticsReader(db).rosterInScope({ schoolId: SCHOOL });

    expect(row).not.toHaveProperty('mastery');
    expect(row).not.toHaveProperty('completion');
  });
});
