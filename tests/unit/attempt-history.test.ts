/**
 * A learner's assessment history (gap G4).
 *
 * Two rules carry the weight here.
 *
 * **An attempt still in progress is not history.** Including it would show a
 * null score next to finished work, and a null score renders as "no result" —
 * so a learner would see the exam they are *currently sitting* listed as
 * though it had gone badly.
 *
 * **The stored totals are the result.** The score written at submission is
 * canonical. Re-deriving it from `AttemptItem` rows here would be a second
 * grading implementation, and it would diverge the first time partial credit
 * or pending review changes.
 *
 * These assert the query and the projection, because that is where both rules
 * live. The live probe covers the real database.
 */

import { describe, expect, it } from 'vitest';
import { PrismaAttemptHistoryReader } from '../../src/infrastructure/database/assessment.repository.js';
import type { Db } from '../../src/infrastructure/database/prisma.client.js';

interface Recorded {
  where?: Record<string, unknown>;
  orderBy?: unknown;
  take?: number;
}

function dbDouble(
  rows: readonly unknown[],
  options: { learnerExists?: boolean } = {},
): { db: Db; recorded: Recorded } {
  const recorded: Recorded = {};
  const db = {
    learnerProfile: {
      findUnique: async () => (options.learnerExists === false ? null : { id: 'learner-uuid' }),
    },
    attempt: {
      findMany: async (args: { where: Record<string, unknown>; orderBy: unknown; take: number }) => {
        recorded.where = args.where;
        recorded.orderBy = args.orderBy;
        recorded.take = args.take;
        return rows;
      },
    },
  } as unknown as Db;
  return { db, recorded };
}

function attempt(over: Record<string, unknown> = {}) {
  return {
    key: 'att_1',
    kind: 'LESSON_CHECK',
    status: 'SUBMITTED',
    lessonKey: 'EDU-MATH-G07-T1-ED2026-U-SETS-L-SET',
    score: 8,
    maxScore: 10,
    correctCount: 4,
    incorrectCount: 1,
    startedAt: new Date('2026-09-01T10:00:00Z'),
    submittedAt: new Date('2026-09-01T10:20:00Z'),
    exam: null,
    ...over,
  };
}

describe('PrismaAttemptHistoryReader', () => {
  it('excludes attempts that are still in progress', async () => {
    const { db, recorded } = dbDouble([]);
    await new PrismaAttemptHistoryReader(db).listForLearner('lrn_x', { limit: 20 });

    expect(recorded.where?.['status']).toEqual({ not: 'IN_PROGRESS' });
  });

  it('scopes to the learner and honours the caller-clamped limit', async () => {
    const { db, recorded } = dbDouble([]);
    await new PrismaAttemptHistoryReader(db).listForLearner('lrn_x', { limit: 5 });

    expect(recorded.where?.['learnerId']).toBe('learner-uuid');
    expect(recorded.take).toBe(5);
  });

  it('filters by kind only when one is asked for', async () => {
    const { db: db1, recorded: r1 } = dbDouble([]);
    await new PrismaAttemptHistoryReader(db1).listForLearner('lrn_x', { limit: 20 });
    expect(r1.where).not.toHaveProperty('kind');

    const { db: db2, recorded: r2 } = dbDouble([]);
    await new PrismaAttemptHistoryReader(db2).listForLearner('lrn_x', {
      limit: 20,
      kind: 'EXAM',
    });
    expect(r2.where?.['kind']).toBe('EXAM');
  });

  it('orders by submission date first, falling back to start date', async () => {
    const { db, recorded } = dbDouble([]);
    await new PrismaAttemptHistoryReader(db).listForLearner('lrn_x', { limit: 20 });

    expect(recorded.orderBy).toEqual([{ submittedAt: 'desc' }, { startedAt: 'desc' }]);
  });

  it('reports the stored score rather than recomputing it from items', async () => {
    // correctCount deliberately disagrees with score: if the reader ever
    // starts summing items, this row will stop reporting 8.
    const { db } = dbDouble([attempt({ score: 8, maxScore: 10, correctCount: 99 })]);
    const [row] = await new PrismaAttemptHistoryReader(db).listForLearner('lrn_x', { limit: 20 });

    expect(row?.score).toBe(8);
    expect(row?.maxScore).toBe(10);
  });

  it('keeps an ungraded outcome null rather than scoring it zero', async () => {
    const { db } = dbDouble([
      attempt({ status: 'ABANDONED', score: null, maxScore: null, submittedAt: null }),
    ]);
    const [row] = await new PrismaAttemptHistoryReader(db).listForLearner('lrn_x', { limit: 20 });

    expect(row?.status).toBe('ABANDONED');
    expect(row?.score).toBeNull();
    expect(row?.score).not.toBe(0);
  });

  it('projects the exam key from the relation', async () => {
    const { db } = dbDouble([attempt({ kind: 'EXAM', lessonKey: null, exam: { key: 'EXM-1' } })]);
    const [row] = await new PrismaAttemptHistoryReader(db).listForLearner('lrn_x', { limit: 20 });

    expect(row?.examKey).toBe('EXM-1');
    expect(row?.lessonKey).toBeNull();
  });

  it('returns an empty history for an unknown learner instead of throwing', async () => {
    // The caller has already proved it may read this learner; a missing
    // profile is an empty list, not an error to render.
    const { db } = dbDouble([attempt()], { learnerExists: false });
    const rows = await new PrismaAttemptHistoryReader(db).listForLearner('lrn_ghost', {
      limit: 20,
    });

    expect(rows).toEqual([]);
  });
});
