/**
 * Attempt lifecycle: opening, resuming, and scoring on submission.
 *
 * The scoring rules here are the ones most likely to be disputed by a teacher,
 * so they are pinned explicitly — especially the treatment of work that cannot
 * yet be scored.
 */

import { describe, expect, it } from 'vitest';
import { fixedClock } from '../../src/shared/kernel/clock.js';
import type {
  AttemptItemRecord,
  AttemptRecord,
  AttemptRepository,
  LearnerExamCatalog,
} from '../../src/contexts/assessment/application/ports.js';
import { StartAttemptUseCase } from '../../src/contexts/assessment/application/start-attempt.use-case.js';
import {
  computeTotals,
  SubmitAttemptUseCase,
} from '../../src/contexts/assessment/application/submit-attempt.use-case.js';
import type { Evaluation } from '../../src/contexts/assessment/domain/evaluation.js';

const AT_ISO = '2026-03-01T10:00:00Z';
const AT = new Date(AT_ISO);

function item(
  questionKey: string,
  verdict: Evaluation['verdict'],
  scoreEarned: number | null,
  scorePossible = 1,
): AttemptItemRecord {
  return {
    questionKey,
    answeredAt: AT,
    timeSpentSeconds: 10,
    rawAnswer: {},
    evaluation: {
      verdict,
      scoreEarned,
      scorePossible,
      normalizedAnswer: null,
      normalizationApplied: [],
      evaluatorVersion: 'canonical-2.0',
    },
  };
}

function attempt(items: AttemptItemRecord[], over: Partial<AttemptRecord> = {}): AttemptRecord {
  return {
    key: 'att_1',
    learnerKey: 'lrn_1',
    kind: 'PRACTICE',
    lessonKey: 'L01',
    examKey: null,
    status: 'IN_PROGRESS',
    startedAt: AT,
    submittedAt: null,
    items,
    ...over,
  };
}

/** In-memory attempt store, sufficient to drive both use cases. */
class FakeAttempts implements AttemptRepository {
  readonly store = new Map<string, AttemptRecord>();
  private counter = 0;

  nextKey(): string {
    this.counter += 1;
    return `att_generated_${this.counter}`;
  }

  async findOpenByScope(
    learnerKey: string,
    scope: { lessonKey: string | null; examKey: string | null },
  ): Promise<AttemptRecord | null> {
    for (const a of this.store.values()) {
      if (
        a.learnerKey === learnerKey &&
        a.status === 'IN_PROGRESS' &&
        a.lessonKey === scope.lessonKey &&
        a.examKey === scope.examKey
      ) {
        return a;
      }
    }
    return null;
  }

  async create(input: {
    key: string;
    learnerKey: string;
    kind: AttemptRecord['kind'];
    lessonKey?: string | null;
    examKey?: string | null;
    startedAt: Date;
  }): Promise<AttemptRecord> {
    const record = attempt([], {
      key: input.key,
      learnerKey: input.learnerKey,
      kind: input.kind,
      lessonKey: input.lessonKey ?? null,
      examKey: input.examKey ?? null,
      startedAt: input.startedAt,
    });
    this.store.set(input.key, record);
    return record;
  }

  async findByKey(key: string): Promise<AttemptRecord | null> {
    return this.store.get(key) ?? null;
  }

  async appendItem(attemptKey: string, appended: AttemptItemRecord): Promise<void> {
    const current = this.store.get(attemptKey)!;
    this.store.set(attemptKey, { ...current, items: [...current.items, appended] });
  }

  async submit(attemptKey: string, submittedAt: Date): Promise<AttemptRecord> {
    const current = this.store.get(attemptKey)!;
    const next = { ...current, status: 'SUBMITTED' as const, submittedAt };
    this.store.set(attemptKey, next);
    return next;
  }
}

const questions = {
  async findByKey(key: string) {
    return {
      key,
      text: '',
      type: 'MCQ_SINGLE' as const,
      choices: [],
      points: 1,
      hint: null,
      conceptLinks: [{ conceptKey: `C-${key}`, weight: 1, isPrimary: true }],
      irt: { id: key, a: 1, b: 0, c: 0.25 },
    };
  },
  async findPoolByConcepts() {
    return [];
  },
  async findAnswerKey() {
    return null;
  },
};

describe('computeTotals', () => {
  it('scores a straightforward mix of verdicts', () => {
    const totals = computeTotals(
      attempt([
        item('Q1', 'CORRECT', 1),
        item('Q2', 'INCORRECT', 0),
        item('Q3', 'PARTIALLY_CORRECT', 0.7),
      ]),
    );

    expect(totals.score).toBe(1.7);
    expect(totals.maxScore).toBe(3);
    expect(totals.correctCount).toBe(1);
    expect(totals.incorrectCount).toBe(1);
    expect(totals.partiallyCorrectCount).toBe(1);
    expect(totals.answeredCount).toBe(3);
  });

  it('excludes unmarked work from BOTH sides of the ratio', () => {
    // One correct answer and one essay awaiting marking is 100% of what has
    // been marked — not 50%. Counting the essay as a zero would report a
    // false failure that then flows into class analytics.
    const totals = computeTotals(
      attempt([item('Q1', 'CORRECT', 1), item('Q2', 'REQUIRES_MANUAL_REVIEW', null)]),
    );

    expect(totals.percentage).toBe(1);
    expect(totals.maxScore).toBe(1);
    expect(totals.pendingReviewCount).toBe(1);
    expect(totals.incorrectCount).toBe(0);
  });

  it('treats an ungradable answer as pending, never as wrong', () => {
    const totals = computeTotals(attempt([item('Q1', 'UNGRADABLE', null)]));

    expect(totals.pendingReviewCount).toBe(1);
    expect(totals.incorrectCount).toBe(0);
    // Nothing was gradable, so a percentage would be a fiction.
    expect(totals.percentage).toBeNull();
  });

  it('counts INVALID and SKIPPED against the learner', () => {
    // These differ from ungradable: the learner did have the opportunity.
    const totals = computeTotals(attempt([item('Q1', 'INVALID', 0), item('Q2', 'SKIPPED', 0)]));

    expect(totals.incorrectCount).toBe(2);
    expect(totals.pendingReviewCount).toBe(0);
    expect(totals.percentage).toBe(0);
  });

  it('reports no percentage for an empty attempt', () => {
    expect(computeTotals(attempt([])).percentage).toBeNull();
  });
});

describe('StartAttemptUseCase', () => {
  const clock = fixedClock(AT_ISO);

  it('resumes an open attempt on the same scope instead of forking', async () => {
    const attempts = new FakeAttempts();
    const useCase = new StartAttemptUseCase(attempts, clock);

    const first = await useCase.execute({ learnerKey: 'lrn_1', kind: 'PRACTICE', lessonKey: 'L01' });
    const second = await useCase.execute({ learnerKey: 'lrn_1', kind: 'PRACTICE', lessonKey: 'L01' });

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.value.resumed).toBe(true);
    expect(second.value.attempt.key).toBe(first.value.attempt.key);
    expect(attempts.store.size).toBe(1);
  });

  it('opens a distinct attempt for a different lesson', async () => {
    const attempts = new FakeAttempts();
    const useCase = new StartAttemptUseCase(attempts, clock);

    await useCase.execute({ learnerKey: 'lrn_1', kind: 'PRACTICE', lessonKey: 'L01' });
    const other = await useCase.execute({ learnerKey: 'lrn_1', kind: 'PRACTICE', lessonKey: 'L02' });

    expect(other.ok && other.value.resumed).toBe(false);
    expect(attempts.store.size).toBe(2);
  });

  it('forces a new attempt when resumeExisting is false', async () => {
    const attempts = new FakeAttempts();
    const useCase = new StartAttemptUseCase(attempts, clock);

    await useCase.execute({ learnerKey: 'lrn_1', kind: 'PRACTICE', lessonKey: 'L01' });
    const forced = await useCase.execute({
      learnerKey: 'lrn_1',
      kind: 'PRACTICE',
      lessonKey: 'L01',
      resumeExisting: false,
    });

    expect(forced.ok && forced.value.resumed).toBe(false);
    expect(attempts.store.size).toBe(2);
  });


  it('refuses exam attempts outside the learner catalogue', async () => {
    const attempts = new FakeAttempts();
    const catalog: LearnerExamCatalog = {
      async examsFor() {
        return [{ key: 'exam-visible', title: 'Unit exam', description: null, isAdaptive: false, timeLimitMins: null, passingScore: 0.7, textbookKey: 'book', itemCount: 3, conceptKeys: ['c1'] }];
      },
    };
    const useCase = new StartAttemptUseCase(attempts, clock, catalog);

    const rejected = await useCase.execute({ learnerKey: 'lrn_1', kind: 'EXAM', examKey: 'exam-hidden' });
    const allowed = await useCase.execute({ learnerKey: 'lrn_1', kind: 'EXAM', examKey: 'exam-visible' });

    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.error.code).toBe('assessment.exam_not_available');
    expect(allowed.ok && allowed.value.resumed).toBe(false);
    expect(attempts.store.size).toBe(1);
  });

  it('rejects an attempt with no scope, and one with both', async () => {
    const useCase = new StartAttemptUseCase(new FakeAttempts(), clock);

    const none = await useCase.execute({ learnerKey: 'lrn_1', kind: 'PRACTICE' });
    const both = await useCase.execute({
      learnerKey: 'lrn_1',
      kind: 'EXAM',
      lessonKey: 'L01',
      examKey: 'E01',
    });

    expect(none.ok).toBe(false);
    expect(both.ok).toBe(false);
    if (none.ok || both.ok) return;
    expect(none.error.code).toBe('assessment.attempt_scope_required');
    expect(both.error.code).toBe('assessment.attempt_scope_ambiguous');
  });
});

describe('SubmitAttemptUseCase', () => {
  const clock = fixedClock(AT_ISO);

  function makeSubmit(attempts: FakeAttempts) {
    const requested: { learnerKey: string; conceptKeys: readonly string[] }[] = [];
    const useCase = new SubmitAttemptUseCase(
      attempts,
      questions,
      {
        async request(learnerKey, conceptKeys) {
          requested.push({ learnerKey, conceptKeys });
        },
      },
      clock,
    );
    return { useCase, requested };
  }

  it('closes the attempt and requests a recompute for the concepts touched', async () => {
    const attempts = new FakeAttempts();
    attempts.store.set('att_1', attempt([item('Q1', 'CORRECT', 1), item('Q2', 'INCORRECT', 0)]));
    const { useCase, requested } = makeSubmit(attempts);

    const result = await useCase.execute({ attemptKey: 'att_1', learnerKey: 'lrn_1' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.attempt.status).toBe('SUBMITTED');
    expect(result.value.totals.percentage).toBe(0.5);
    expect([...result.value.affectedConcepts].sort()).toEqual(['C-Q1', 'C-Q2']);
    expect(requested).toHaveLength(1);
  });

  it('refuses a second submission so the first stays authoritative', async () => {
    const attempts = new FakeAttempts();
    attempts.store.set('att_1', attempt([item('Q1', 'CORRECT', 1)]));
    const { useCase } = makeSubmit(attempts);

    await useCase.execute({ attemptKey: 'att_1', learnerKey: 'lrn_1' });
    const again = await useCase.execute({ attemptKey: 'att_1', learnerKey: 'lrn_1' });

    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.error.code).toBe('assessment.attempt_closed');
  });

  it("refuses to submit another learner's attempt", async () => {
    const attempts = new FakeAttempts();
    attempts.store.set('att_1', attempt([item('Q1', 'CORRECT', 1)]));
    const { useCase } = makeSubmit(attempts);

    const result = await useCase.execute({ attemptKey: 'att_1', learnerKey: 'lrn_intruder' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('assessment.attempt_not_owned');
  });

  it('does not request a recompute when nothing was answered', async () => {
    const attempts = new FakeAttempts();
    attempts.store.set('att_1', attempt([]));
    const { useCase, requested } = makeSubmit(attempts);

    const result = await useCase.execute({ attemptKey: 'att_1', learnerKey: 'lrn_1' });

    expect(result.ok).toBe(true);
    expect(requested).toHaveLength(0);
  });
});
