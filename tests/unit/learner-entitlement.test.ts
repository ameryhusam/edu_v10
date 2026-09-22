/**
 * Which textbooks a learner may study (gap G1).
 *
 * The rule under test is that entitlement is *derived from enrollment*, never
 * asserted. Before this endpoint existed the seed hid the question entirely by
 * hardcoding one textbook key, and the tempting shortcut when building the UI
 * would have been "textbooks for the learner's grade".
 *
 * That shortcut is wrong, and the test that matters here proves it: two schools
 * in the same academic year can adopt different editions of the same subject
 * for the same grade. Filtering by grade alone shows a learner a book their
 * school does not teach.
 *
 * These are unit tests over the query the adapter builds, because the rule
 * lives in the shape of the `where` clause. The live probe in
 * scripts/check-learner-entitlement.mjs covers the real database.
 */

import { describe, expect, it } from 'vitest';
import { PrismaLearnerEntitlementReader } from '../../src/infrastructure/database/learning.repository.js';
import type { Db } from '../../src/infrastructure/database/prisma.client.js';

interface Recorded {
  enrollmentWhere?: unknown;
  textbookWhere?: unknown;
}

/**
 * A double that records the queries instead of running them. It returns rows
 * shaped like the adapter's `select`, so a mismatch between select and mapper
 * surfaces as a type error rather than silently producing undefined fields.
 */
function dbDouble(options: {
  enrollment:
    | {
        schoolId: string;
        academicYearId: string;
        gradeId: string;
        termId: string;
        academicYear: { key: string };
        term: { key: string; name: string };
      }
    | null;
  textbooks?: readonly {
    key: string;
    title: string;
    edition: string;
    totalPages: number | null;
    subject: { key: string; name: string };
    grade: { key: string; name: string };
    term: { key: string; name: string };
  }[];
}): { db: Db; recorded: Recorded } {
  const recorded: Recorded = {};
  const db = {
    enrollment: {
      findFirst: async (args: { where: unknown }) => {
        recorded.enrollmentWhere = args.where;
        return options.enrollment;
      },
    },
    textbook: {
      findMany: async (args: { where: unknown }) => {
        recorded.textbookWhere = args.where;
        return options.textbooks ?? [];
      },
    },
  } as unknown as Db;
  return { db, recorded };
}

const ENROLLMENT = {
  schoolId: 'school-a',
  academicYearId: 'year-2026',
  gradeId: 'grade-7',
  termId: 'term-1',
  academicYear: { key: '2026-2027' },
  term: { key: '2026-2027-T01', name: 'الفصل الأول' },
};

describe('learner textbook entitlement', () => {
  it('scopes to the school and academic year the learner is enrolled in', async () => {
    // The rule the "textbooks for my grade" shortcut gets wrong.
    const { db, recorded } = dbDouble({ enrollment: ENROLLMENT });
    await new PrismaLearnerEntitlementReader(db).textbooksFor('lrn_x');

    const where = recorded.textbookWhere as {
      adoptions?: { some?: { schoolId?: string; academicYearId?: string } };
    };

    expect(where.adoptions?.some?.schoolId).toBe('school-a');
    expect(where.adoptions?.some?.academicYearId).toBe('year-2026');
  });

  it('filters to the enrolled grade and term', async () => {
    const { db, recorded } = dbDouble({ enrollment: ENROLLMENT });
    await new PrismaLearnerEntitlementReader(db).textbooksFor('lrn_x');

    const where = recorded.textbookWhere as {
      gradeId?: string;
      adoptions?: { some?: { termId?: string } };
    };
    expect(where.gradeId).toBe('grade-7');
    expect(where.adoptions?.some?.termId).toBe('term-1');
  });

  it('never returns unpublished content', async () => {
    // Composed from the shared publication gate rather than a literal status,
    // so a lifecycle change cannot leave this read behind.
    const { db, recorded } = dbDouble({ enrollment: ENROLLMENT });
    await new PrismaLearnerEntitlementReader(db).textbooksFor('lrn_x');

    const where = recorded.textbookWhere as { status?: { in?: readonly string[] } };
    expect(where.status?.in).toEqual(['PUBLISHED']);
  });

  it('only considers the current enrollment', async () => {
    const { db, recorded } = dbDouble({ enrollment: ENROLLMENT });
    await new PrismaLearnerEntitlementReader(db).textbooksFor('lrn_x');

    const where = recorded.enrollmentWhere as {
      isCurrent?: boolean;
      learner?: { key?: string };
    };
    // A past enrollment would entitle a learner to last year's books forever.
    expect(where.isCurrent).toBe(true);
    expect(where.learner?.key).toBe('lrn_x');
  });

  it('returns nothing for a learner with no current enrollment', async () => {
    const { db, recorded } = dbDouble({ enrollment: null });
    const result = await new PrismaLearnerEntitlementReader(db).textbooksFor('lrn_new');

    expect(result).toEqual([]);
    // And it must not fall back to an unscoped query when enrollment is absent.
    expect(recorded.textbookWhere).toBeUndefined();
  });

  it('carries subject and grade names so a list needs no second round trip', async () => {
    const { db } = dbDouble({
      enrollment: ENROLLMENT,
      textbooks: [
        {
          key: 'EDU-MATH-G07-P1-ED2026',
          title: 'الرياضيات',
          edition: '2026',
          totalPages: 180,
          subject: { key: 'MATH', name: 'الرياضيات' },
          grade: { key: 'G07', name: 'الصف السابع' },
        },
      ],
    });

    const [book] = await new PrismaLearnerEntitlementReader(db).textbooksFor('lrn_x');

    expect(book).toEqual({
      key: 'EDU-MATH-G07-P1-ED2026',
      title: 'الرياضيات',
      subjectKey: 'MATH',
      subjectName: 'الرياضيات',
      gradeKey: 'G07',
      gradeName: 'الصف السابع',
      termKey: '2026-2027-T01',
      termName: 'الفصل الأول',
      academicYearKey: '2026-2027',
      edition: '2026',
      totalPages: 180,
    });
  });
});
