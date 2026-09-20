import { describe, expect, it } from 'vitest';
import {
  summariseExam,
  type ExamItemOutcome,
  type ExamSitting,
} from '../../src/contexts/analytics/domain/exam-results.js';

const sitting = (over: Partial<ExamSitting> & { learnerKey: string }): ExamSitting => ({
  attemptKey: `AT-${over.learnerKey}`,
  score: 8,
  maxScore: 10,
  correctCount: 8,
  incorrectCount: 2,
  pendingReviewCount: 0,
  submittedAt: new Date('2026-03-01T10:00:00Z'),
  ...over,
});

const run = (input: {
  learnerKeys: string[];
  sittings: ExamSitting[];
  items?: ExamItemOutcome[];
}) =>
  summariseExam({
    examKey: 'EXAM-1',
    title: 'Term 1',
    learnerKeys: input.learnerKeys,
    sittings: input.sittings,
    items: input.items ?? [],
  });

describe('exam results — participation', () => {
  it('names who has not sat it, not just how many', () => {
    const r = run({
      learnerKeys: ['a', 'b', 'c'],
      sittings: [sitting({ learnerKey: 'a' })],
    });

    expect(r.assigned).toBe(3);
    expect(r.submitted).toBe(1);
    expect(r.notStarted).toBe(2);
    expect(r.notStartedLearners).toEqual(['b', 'c']);
  });

  it('counts an unsubmitted attempt as in progress, not as a zero', () => {
    const r = run({
      learnerKeys: ['a'],
      sittings: [sitting({ learnerKey: 'a', submittedAt: null, score: null, maxScore: null })],
    });

    expect(r.inProgress).toBe(1);
    expect(r.submitted).toBe(0);
    expect(r.notStarted).toBe(0);
    // The decisive assertion: an unfinished paper must not drag the average
    // down as if it were a failure.
    expect(r.meanPercentage).toBeNull();
  });
});

describe('exam results — scores are read, never recomputed', () => {
  it('uses the stored score even when it disagrees with the verdict counts', () => {
    // Partial credit, a manual adjustment, or a rulebook change can all make
    // score/maxScore differ from correct/(correct+incorrect). The stored score
    // is the truth; deriving one here would be a second source of truth.
    const r = run({
      learnerKeys: ['a'],
      sittings: [
        sitting({ learnerKey: 'a', score: 7.5, maxScore: 10, correctCount: 5, incorrectCount: 5 }),
      ],
    });

    expect(r.sittings[0]!.score).toBe(7.5);
    expect(r.sittings[0]!.percentage).toBe(0.75);
  });

  it('reports no percentage while a human still has marking to do', () => {
    const r = run({
      learnerKeys: ['a'],
      sittings: [sitting({ learnerKey: 'a', pendingReviewCount: 2 })],
    });

    expect(r.awaitingReview).toBe(1);
    expect(r.sittings[0]!.awaitingReview).toBe(true);
    expect(r.sittings[0]!.percentage).toBeNull();
    expect(r.meanPercentage).toBeNull();
  });

  it('excludes half-marked papers from the cohort statistics', () => {
    const r = run({
      learnerKeys: ['a', 'b'],
      sittings: [
        sitting({ learnerKey: 'a', score: 10, maxScore: 10 }),
        sitting({ learnerKey: 'b', score: 2, maxScore: 10, pendingReviewCount: 3 }),
      ],
    });

    // Only 'a' is comparable, so the mean is 1.0 — not 0.6.
    expect(r.meanPercentage).toBe(1);
    expect(r.submitted).toBe(2);
  });

  it('guards against division by zero on a zero-mark exam', () => {
    const r = run({
      learnerKeys: ['a'],
      sittings: [sitting({ learnerKey: 'a', score: 0, maxScore: 0 })],
    });

    expect(r.sittings[0]!.percentage).toBeNull();
    expect(r.meanPercentage).toBeNull();
  });
});

describe('exam results — distribution', () => {
  it('summarises mean, median and range over comparable sittings', () => {
    const r = run({
      learnerKeys: ['a', 'b', 'c'],
      sittings: [
        sitting({ learnerKey: 'a', score: 10, maxScore: 10 }),
        sitting({ learnerKey: 'b', score: 5, maxScore: 10 }),
        sitting({ learnerKey: 'c', score: 6, maxScore: 10 }),
      ],
    });

    expect(r.meanPercentage).toBe(0.7);
    expect(r.medianPercentage).toBe(0.6);
    expect(r.lowestPercentage).toBe(0.5);
    expect(r.highestPercentage).toBe(1);
  });

  it('places 100% in the top band rather than dropping it', () => {
    const r = run({
      learnerKeys: ['a'],
      sittings: [sitting({ learnerKey: 'a', score: 10, maxScore: 10 })],
    });

    const top = r.distribution.find((b) => b.label === '90-100');
    expect(top?.learners).toBe(1);
    expect(r.distribution.reduce((n, b) => n + b.learners, 0)).toBe(1);
  });

  it('puts every comparable learner in exactly one band', () => {
    const scores = [0, 3, 5, 6.4, 6.5, 7.9, 8, 8.9, 9, 10];
    const r = run({
      learnerKeys: scores.map((_, i) => `l${i}`),
      sittings: scores.map((s, i) => sitting({ learnerKey: `l${i}`, score: s, maxScore: 10 })),
    });

    expect(r.distribution.reduce((n, b) => n + b.learners, 0)).toBe(scores.length);
  });
});

describe('exam results — per-item outcomes', () => {
  const items: ExamItemOutcome[] = [
    { questionKey: 'Q2', orderIndex: 2, correct: 1, incorrect: 3, pending: 0 },
    { questionKey: 'Q1', orderIndex: 1, correct: 4, incorrect: 0, pending: 0 },
  ];

  it('orders items by their printed position, not by how they were fetched', () => {
    const r = run({ learnerKeys: ['a'], sittings: [], items });

    expect(r.items.map((i) => i.questionKey)).toEqual(['Q1', 'Q2']);
  });

  it('computes a correct rate per item', () => {
    const r = run({ learnerKeys: ['a'], sittings: [], items });

    expect(r.items.find((i) => i.questionKey === 'Q2')?.correctRate).toBe(0.25);
  });

  it('excludes unmarked answers from the denominator', () => {
    // 2 correct, 2 incorrect, 4 awaiting marking → 50%, not 25%. An unmarked
    // essay is not evidence that the item was answered wrongly.
    const r = run({
      learnerKeys: ['a'],
      sittings: [],
      items: [{ questionKey: 'Q1', orderIndex: 1, correct: 2, incorrect: 2, pending: 4 }],
    });

    expect(r.items[0]!.answered).toBe(4);
    expect(r.items[0]!.correctRate).toBe(0.5);
  });

  it('reports null rather than zero for an item nobody answered', () => {
    const r = run({
      learnerKeys: ['a'],
      sittings: [],
      items: [{ questionKey: 'Q1', orderIndex: 1, correct: 0, incorrect: 0, pending: 0 }],
    });

    // 0% would read as "everyone got it wrong", which is a different claim.
    expect(r.items[0]!.correctRate).toBeNull();
  });
});

describe('exam results — empty cohort behaviour', () => {
  it('reports an exam nobody has sat without inventing numbers', () => {
    const r = run({ learnerKeys: ['a', 'b'], sittings: [] });

    expect(r.assigned).toBe(2);
    expect(r.notStarted).toBe(2);
    expect(r.meanPercentage).toBeNull();
    expect(r.medianPercentage).toBeNull();
    expect(r.lowestPercentage).toBeNull();
    expect(r.highestPercentage).toBeNull();
    expect(r.distribution.every((b) => b.learners === 0)).toBe(true);
  });

  it('sorts the roster deterministically', () => {
    const r = run({
      learnerKeys: ['c', 'a', 'b'],
      sittings: [
        sitting({ learnerKey: 'c' }),
        sitting({ learnerKey: 'a' }),
        sitting({ learnerKey: 'b' }),
      ],
    });

    expect(r.sittings.map((s) => s.learnerKey)).toEqual(['a', 'b', 'c']);
  });
});
