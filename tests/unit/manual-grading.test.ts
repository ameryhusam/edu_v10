import { describe, expect, it } from 'vitest';
import { GradeManualAnswerUseCase } from '../../src/contexts/assessment/application/grade-manual-answer.use-case.js';
import type {
  AttemptRecord,
  AttemptRepository,
  EvidenceWriter,
  ManualReviewRepository,
  ManualReviewListPage,
  ManualReviewListQuery,
  ManualReviewQueueItem,
  MasteryRecomputeTrigger,
  QuestionRepository,
  QuestionView,
} from '../../src/contexts/assessment/application/ports.js';
import type { Evidence } from '../../src/contexts/assessment/domain/evidence.js';
import { fixedClock } from '../../src/shared/kernel/clock.js';

const NOW = '2026-09-14T09:00:00.000Z';

function question(): QuestionView {
  return {
    key: 'Q-ESSAY',
    text: 'Explain why the set is well defined.',
    type: 'ESSAY',
    points: 4,
    hint: null,
    choices: [],
    conceptLinks: [{ conceptKey: 'C-SETS', weight: 1, isPrimary: true }],
    irt: { id: 'Q-ESSAY', a: 1, b: 0, c: 0 },
  };
}

function attempt(): AttemptRecord {
  return {
    key: 'ATT-1',
    learnerKey: 'LRN-1',
    kind: 'EXAM',
    lessonKey: null,
    examKey: 'EXAM-1',
    status: 'SUBMITTED',
    startedAt: new Date('2026-09-14T08:30:00.000Z'),
    submittedAt: new Date('2026-09-14T08:50:00.000Z'),
    items: [
      {
        questionKey: 'Q-ESSAY',
        answeredAt: new Date('2026-09-14T08:45:00.000Z'),
        timeSpentSeconds: 300,
        rawAnswer: { text: 'A set is well defined when membership is objective.' },
        evaluation: {
          verdict: 'REQUIRES_MANUAL_REVIEW',
          scoreEarned: null,
          scorePossible: 4,
          normalizedAnswer: 'A set is well defined when membership is objective.',
          normalizationApplied: [],
          evaluatorVersion: 'canonical-2.0',
          note: 'essay_requires_human_or_ai_rubric',
        },
      },
    ],
  };
}

function pending(schoolId = 'school-A'): ManualReviewQueueItem {
  return {
    attemptKey: 'ATT-1',
    attemptStatus: 'SUBMITTED',
    learnerKey: 'LRN-1',
    learnerName: 'Demo Learner',
    schoolId,
    questionKey: 'Q-ESSAY',
    questionText: 'Explain why the set is well defined.',
    rawAnswer: { text: 'A set is well defined when membership is objective.' },
    answeredAt: new Date('2026-09-14T08:45:00.000Z'),
    submittedAt: new Date('2026-09-14T08:50:00.000Z'),
    scorePossible: 4,
    note: 'essay_requires_human_or_ai_rubric',
  };
}

function harness(review: ManualReviewQueueItem | null = pending()) {
  let record = attempt();
  const evidence: Evidence[] = [];
  const recomputes: string[][] = [];
  const totalsWrites: Array<{ score: number; maxScore: number; pendingReviewCount: number }> = [];

  const attempts: AttemptRepository & ManualReviewRepository = {
    nextKey: () => 'unused',
    findOpenByScope: async () => null,
    create: async () => record,
    findByKey: async () => record,
    appendItem: async () => {},
    submit: async () => record,
    listPendingManualReviews: async (_query: ManualReviewListQuery): Promise<ManualReviewListPage> => ({
      rows: review ? [review] : [],
      total: review ? 1 : 0,
    }),
    findPendingManualReview: async () => review,
    replaceItemEvaluation: async (input) => {
      record = {
        ...record,
        items: record.items.map((item) =>
          item.questionKey === input.questionKey ? { ...item, evaluation: input.evaluation } : item,
        ),
      };
      return record;
    },
    updateTotals: async (_attemptKey, totals) => {
      totalsWrites.push(totals);
      return record;
    },
  };

  const questions: QuestionRepository = {
    findByKey: async (key) => (key === 'Q-ESSAY' ? question() : null),
    findPoolByConcepts: async () => [],
    findAnswerKey: async () => null,
  };
  const evidenceWriter: EvidenceWriter = {
    append: async (_learner, rows) => {
      evidence.push(...rows);
    },
  };
  const recompute: MasteryRecomputeTrigger = {
    request: async (_learner, keys) => {
      recomputes.push([...keys]);
    },
  };

  return {
    useCase: new GradeManualAnswerUseCase(
      attempts,
      questions,
      evidenceWriter,
      recompute,
      fixedClock(NOW),
    ),
    evidence,
    recomputes,
    totalsWrites,
  };
}

describe('manual grading loop', () => {
  it('turns a pending essay into scored evidence and refreshes submitted totals', async () => {
    const h = harness();

    const result = await h.useCase.execute({
      attemptKey: 'ATT-1',
      questionKey: 'Q-ESSAY',
      reviewerUserId: 'teacher-1',
      allowedSchoolIds: ['school-A'],
      scoreEarned: 2,
      feedback: 'Membership is objective; include a counterexample next time.',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.evaluation.verdict).toBe('PARTIALLY_CORRECT');
    expect(result.value.evaluation.scoreEarned).toBe(2);
    expect(result.value.totals).toMatchObject({ score: 2, maxScore: 4, pendingReviewCount: 0 });
    expect(h.totalsWrites).toHaveLength(1);
    expect(h.evidence).toMatchObject([
      { conceptKey: 'C-SETS', questionKey: 'Q-ESSAY', verdict: 'PARTIALLY_CORRECT', weight: 0.7 },
    ]);
    expect(h.recomputes).toEqual([['C-SETS']]);
  });

  it('keeps school-scoped reviewers out of another school\'s queue', async () => {
    const h = harness(pending('school-B'));

    const result = await h.useCase.execute({
      attemptKey: 'ATT-1',
      questionKey: 'Q-ESSAY',
      reviewerUserId: 'teacher-1',
      allowedSchoolIds: ['school-A'],
      scoreEarned: 3,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('assessment.manual_review_forbidden');
  });
});
