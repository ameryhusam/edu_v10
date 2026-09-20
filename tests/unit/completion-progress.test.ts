/**
 * Completion gating, progress rollup, and adaptive flashcard ordering.
 *
 * These three were the strongest pedagogy in the legacy system and the least
 * testable, because each lived inside a service holding Prisma or inside a
 * React component. Pinned here as pure functions.
 */

import { describe, expect, it } from 'vitest';
import {
  evaluateCompletion,
  type CompletionEvidence,
} from '../../src/contexts/learning/domain/completion-policy.js';
import {
  classifyConcept,
  summariseProgress,
  type ConceptProgressInput,
} from '../../src/contexts/learning/domain/progress.js';
import {
  orderFlashcards,
  tierOf,
  type FlashcardSignal,
} from '../../src/contexts/learning/domain/flashcard-ordering.js';

// ── Completion ──────────────────────────────────────────────────────────────

const complete = (over: Partial<CompletionEvidence> = {}): CompletionEvidence => ({
  requiresAssessment: true,
  minimumMastery: 0.7,
  masteryAchieved: 0.9,
  assessmentPassed: true,
  contentConsumed: true,
  practiceDone: true,
  attempted: true,
  ...over,
});

describe('evaluateCompletion', () => {
  it('allows progression when every requirement is met', () => {
    const result = evaluateCompletion(complete());

    expect(result.decision).toBe('ALLOW_NEXT');
    expect(result.gate).toBe('NONE');
    expect(result.masteryDeficit).toBe(0);
  });

  it('does NOT gate a non-assessment task on mastery', () => {
    // The most important rule carried over from legacy LD-4: a default
    // minimumMastery on an ordinary reading task must not silently become a
    // mandatory exam. Mastery here is 0 and the task still completes.
    const result = evaluateCompletion(
      complete({ requiresAssessment: false, masteryAchieved: 0, assessmentPassed: null, attempted: false }),
    );

    expect(result.allowedNext).toBe(true);
    expect(result.gate).toBe('NONE');
  });

  it('blocks an unattempted assessment before anything else', () => {
    const result = evaluateCompletion(complete({ attempted: false, assessmentPassed: null }));

    expect(result.gate).toBe('NOT_ATTEMPTED');
    expect(result.decision).toBe('REVIEW');
  });

  it('blocks when the assessment was taken but not passed', () => {
    const result = evaluateCompletion(complete({ assessmentPassed: false }));

    expect(result.gate).toBe('ASSESSMENT_REQUIRED');
  });

  it('blocks on unconsumed content even without assessment', () => {
    const result = evaluateCompletion(
      complete({ requiresAssessment: false, contentConsumed: false }),
    );

    expect(result.gate).toBe('CONTENT_REQUIRED');
    expect(result.allowedNext).toBe(false);
  });

  it('blocks on outstanding practice', () => {
    const result = evaluateCompletion(complete({ requiresAssessment: false, practiceDone: false }));

    expect(result.gate).toBe('PRACTICE_REQUIRED');
  });

  it('routes low mastery to REMEDIAL, not REVIEW, and sizes the deficit', () => {
    // The learner did the work but has not understood it. That needs support,
    // not a repeat — which is why this gate alone returns REMEDIAL.
    const result = evaluateCompletion(complete({ masteryAchieved: 0.45, minimumMastery: 0.8 }));

    expect(result.decision).toBe('REMEDIAL');
    expect(result.gate).toBe('MASTERY_BELOW_THRESHOLD');
    expect(result.masteryDeficit).toBeCloseTo(0.35, 6);
  });

  it('checks gates in pedagogical order', () => {
    // Everything is unmet at once; the earliest gate must win so the learner is
    // told the FIRST thing to do, not the last.
    const result = evaluateCompletion(
      complete({
        attempted: false,
        assessmentPassed: false,
        contentConsumed: false,
        practiceDone: false,
        masteryAchieved: 0,
      }),
    );

    expect(result.gate).toBe('NOT_ATTEMPTED');
  });

  it('treats never-measured mastery as zero rather than throwing', () => {
    const result = evaluateCompletion(complete({ masteryAchieved: null }));

    expect(result.mastery).toBe(0);
    expect(result.gate).toBe('MASTERY_BELOW_THRESHOLD');
  });
});

// ── Progress ────────────────────────────────────────────────────────────────

const concept = (over: Partial<ConceptProgressInput> = {}): ConceptProgressInput => ({
  conceptKey: 'T-U01-L01-C01',
  lessonKey: 'T-U01-L01',
  unitKey: 'T-U01',
  effectiveMastery: 0.9,
  masteryThreshold: 0.85,
  attemptsCount: 5,
  isBlocked: false,
  ...over,
});

describe('classifyConcept', () => {
  it('reports LOCKED ahead of any other state', () => {
    // A learner cannot be "struggling" with material they were never allowed to
    // reach; saying so would send them to remediation for the wrong concept.
    expect(
      classifyConcept(concept({ isBlocked: true, effectiveMastery: 0, attemptsCount: 0 })),
    ).toBe('LOCKED');
  });

  it('distinguishes never-started from struggling', () => {
    expect(classifyConcept(concept({ attemptsCount: 0, effectiveMastery: 0 }))).toBe('NOT_STARTED');
    expect(classifyConcept(concept({ attemptsCount: 3, effectiveMastery: 0.1 }))).toBe('STRUGGLING');
  });

  it('measures against the concept OWN threshold', () => {
    // 0.8 is mastered against a 0.7 bar and merely in-progress against a 0.95
    // bar. A platform-wide default would misreport one of these.
    expect(classifyConcept(concept({ effectiveMastery: 0.8, masteryThreshold: 0.7 }))).toBe('MASTERED');
    expect(classifyConcept(concept({ effectiveMastery: 0.8, masteryThreshold: 0.95 }))).toBe('IN_PROGRESS');
  });

  it('scales the struggling band to the threshold', () => {
    // Half of the concept's own threshold, so a strict concept is not flagged
    // as struggling just for being strict.
    expect(classifyConcept(concept({ effectiveMastery: 0.4, masteryThreshold: 0.9 }))).toBe('STRUGGLING');
    expect(classifyConcept(concept({ effectiveMastery: 0.5, masteryThreshold: 0.9 }))).toBe('IN_PROGRESS');
  });
});

describe('summariseProgress', () => {
  it('rolls up across lessons and units', () => {
    const summary = summariseProgress([
      concept({ conceptKey: 'C1', lessonKey: 'L1', unitKey: 'U1', effectiveMastery: 0.9 }),
      concept({ conceptKey: 'C2', lessonKey: 'L1', unitKey: 'U1', effectiveMastery: 0.2, attemptsCount: 2 }),
      concept({ conceptKey: 'C3', lessonKey: 'L2', unitKey: 'U2', attemptsCount: 0, effectiveMastery: 0 }),
    ]);

    expect(summary.overall.total).toBe(3);
    expect(summary.overall.mastered).toBe(1);
    expect(summary.units).toHaveLength(2);
    expect(summary.lessons).toHaveLength(2);
    expect(summary.units[0]?.completion).toBe(0.5);
  });

  it('keeps locked concepts in the denominator', () => {
    // Excluding them would make progress jump BACKWARDS as prerequisites
    // unlock and previously hidden work appears.
    const summary = summariseProgress([
      concept({ conceptKey: 'C1', effectiveMastery: 0.9 }),
      concept({ conceptKey: 'C2', isBlocked: true }),
    ]);

    expect(summary.overall.total).toBe(2);
    expect(summary.overall.locked).toBe(1);
    expect(summary.overall.completion).toBe(0.5);
  });

  it('separates completion from average mastery', () => {
    // Two concepts just under their bar: 0% complete, but clearly not 0% known.
    // Reporting only completion would tell a learner they have achieved nothing.
    const summary = summariseProgress([
      concept({ conceptKey: 'C1', effectiveMastery: 0.8, masteryThreshold: 0.85 }),
      concept({ conceptKey: 'C2', effectiveMastery: 0.84, masteryThreshold: 0.85 }),
    ]);

    expect(summary.overall.completion).toBe(0);
    expect(summary.overall.averageMastery).toBeCloseTo(0.82, 6);
  });

  it('handles an empty scope without dividing by zero', () => {
    const summary = summariseProgress([]);

    expect(summary.overall.completion).toBe(0);
    expect(summary.overall.averageMastery).toBe(0);
  });
});

// ── Flashcard ordering ──────────────────────────────────────────────────────

const signal = (over: Partial<FlashcardSignal> = {}): FlashcardSignal => ({
  conceptKey: 'C1',
  effectiveMastery: 0.9,
  hasActiveMisconception: false,
  ...over,
});

const card = (cardKey: string, conceptKey: string | null, reviewPriority = 0, difficulty = 0.5) => ({
  cardKey,
  conceptKey,
  reviewPriority,
  difficulty,
});

describe('tierOf', () => {
  it('puts an active misconception first, whatever the mastery', () => {
    // A confidently wrong model is more urgent than a weak one.
    const signals = new Map([['C1', signal({ effectiveMastery: 0.95, hasActiveMisconception: true })]]);

    expect(tierOf('C1', signals)).toBe(0);
  });

  it('bands by mastery', () => {
    const low = new Map([['C1', signal({ effectiveMastery: 0.3 })]]);
    const shaky = new Map([['C1', signal({ effectiveMastery: 0.6 })]]);
    const strong = new Map([['C1', signal({ effectiveMastery: 0.9 })]]);

    expect(tierOf('C1', low)).toBe(1);
    expect(tierOf('C1', shaky)).toBe(2);
    expect(tierOf('C1', strong)).toBe(3);
  });

  it('treats unmeasured concepts as general review, not as trouble', () => {
    expect(tierOf('C-unknown', new Map())).toBe(3);
    expect(tierOf(null, new Map())).toBe(3);
    expect(tierOf('C1', new Map([['C1', signal({ effectiveMastery: null })]]))).toBe(3);
  });
});

describe('orderFlashcards', () => {
  it('orders by tier, then priority, then difficulty, then key', () => {
    const ordered = orderFlashcards(
      [
        card('K-mastered', 'C-ok'),
        card('K-low', 'C-low'),
        card('K-misconception', 'C-mis'),
        card('K-shaky', 'C-shaky'),
      ],
      [
        signal({ conceptKey: 'C-ok', effectiveMastery: 0.95 }),
        signal({ conceptKey: 'C-low', effectiveMastery: 0.2 }),
        signal({ conceptKey: 'C-mis', effectiveMastery: 0.9, hasActiveMisconception: true }),
        signal({ conceptKey: 'C-shaky', effectiveMastery: 0.6 }),
      ],
    );

    expect(ordered.map((c) => c.cardKey)).toEqual([
      'K-misconception',
      'K-low',
      'K-shaky',
      'K-mastered',
    ]);
    expect(ordered[0]?.reason).toBe('active_misconception');
  });

  it('breaks ties inside a tier by priority then difficulty', () => {
    const ordered = orderFlashcards(
      [
        card('A', 'C1', 1, 0.9),
        card('B', 'C1', 5, 0.1),
        card('C', 'C1', 1, 0.2),
      ],
      [signal({ conceptKey: 'C1', effectiveMastery: 0.2 })],
    );

    expect(ordered.map((c) => c.cardKey)).toEqual(['B', 'A', 'C']);
  });

  it('is deterministic, so a reload does not reshuffle the deck', () => {
    const cards = [card('Z', 'C1'), card('A', 'C1'), card('M', 'C1')];
    const signals = [signal({ conceptKey: 'C1', effectiveMastery: 0.2 })];

    const first = orderFlashcards(cards, signals).map((c) => c.cardKey);
    const second = orderFlashcards([...cards].reverse(), signals).map((c) => c.cardKey);

    expect(first).toEqual(second);
    expect(first).toEqual(['A', 'M', 'Z']);
  });

  it('does not mutate the input deck', () => {
    const cards = [card('B', 'C1'), card('A', 'C1')];
    orderFlashcards(cards, []);

    expect(cards.map((c) => c.cardKey)).toEqual(['B', 'A']);
  });
});
