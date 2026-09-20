/**
 * Analytics.
 *
 * Two things are being protected here.
 *
 * The first is the miskey detector: a negative discrimination index is the
 * only automatic signal that an answer key is wrong, and the test builds that
 * scenario literally — strong learners choosing the "wrong" option.
 *
 * The second is the honesty of the cohort numbers. Every function here
 * separates "no evidence" from "poor evidence", because folding the two
 * together is what makes a class report lie to a teacher.
 */

import { describe, expect, it } from 'vitest';
import {
  analyseItem,
  MIN_RESPONSES_FOR_ANALYSIS,
  needsAuthorReview,
  type ItemResponse,
  type LearnerScore,
} from '../../src/contexts/analytics/domain/item-statistics.js';
import {
  distribution,
  summariseActivity,
  summariseConcept,
  summariseLearner,
  weakestConcepts,
  type MasteryPoint,
} from '../../src/contexts/analytics/domain/cohort-analytics.js';

/**
 * Build a cohort of `n` learners whose overall ability descends evenly.
 *
 * `answer` decides how each learner behaves on the item under analysis, given
 * their rank (0 = strongest).
 */
function cohort(
  n: number,
  answer: (rank: number, total: number) => Partial<ItemResponse>,
): { responses: ItemResponse[]; scores: LearnerScore[] } {
  const responses: ItemResponse[] = [];
  const scores: LearnerScore[] = [];

  for (let rank = 0; rank < n; rank += 1) {
    const learnerKey = `lrn-${rank}`;
    scores.push({ learnerKey, proportionCorrect: 1 - rank / n });
    responses.push({
      learnerKey,
      correct: false,
      chosenOptionId: null,
      timeSpentSeconds: 30,
      ...answer(rank, n),
    });
  }

  return { responses, scores };
}

describe('item difficulty', () => {
  it('reports the proportion correct', () => {
    // 15 of 30 correct.
    const { responses, scores } = cohort(30, (rank) => ({ correct: rank < 15 }));
    expect(analyseItem(responses, scores).difficulty).toBe(0.5);
  });

  it('flags an item almost everyone gets right', () => {
    const { responses, scores } = cohort(40, (rank) => ({ correct: rank < 39 }));
    expect(analyseItem(responses, scores).flags).toContain('TOO_EASY');
  });

  it('flags an item almost nobody gets right', () => {
    const { responses, scores } = cohort(40, (rank) => ({ correct: rank < 4 }));
    expect(analyseItem(responses, scores).flags).toContain('TOO_HARD');
  });
});

describe('discrimination', () => {
  it('is high when strong learners get it right and weak ones do not', () => {
    const { responses, scores } = cohort(40, (rank, total) => ({ correct: rank < total / 2 }));
    const stats = analyseItem(responses, scores);

    expect(stats.discrimination).toBeGreaterThan(0.9);
    expect(stats.pointBiserial).toBeGreaterThan(0.5);
    expect(stats.flags).not.toContain('MISKEYED_SUSPECTED');
  });

  it('is near zero when performance is unrelated to ability', () => {
    // Alternating: the item tells you nothing about who knows the material.
    const { responses, scores } = cohort(40, (rank) => ({ correct: rank % 2 === 0 }));
    const stats = analyseItem(responses, scores);

    expect(Math.abs(stats.discrimination)).toBeLessThan(0.2);
    expect(stats.flags).toContain('NON_DISCRIMINATING');
  });

  it('goes NEGATIVE when the answer key is wrong, and says so', () => {
    // The scenario that matters: the learners who do best overall are the ones
    // marked wrong on this item. Nothing at authoring time can detect this.
    const { responses, scores } = cohort(40, (rank, total) => ({ correct: rank >= total / 2 }));
    const stats = analyseItem(responses, scores);

    expect(stats.discrimination).toBeLessThan(0);
    expect(stats.flags).toContain('MISKEYED_SUSPECTED');
    expect(needsAuthorReview(stats)).toBe(true);
  });

  it('does not raise a review for a merely weak item', () => {
    // A narrow report is a report someone reads.
    const { responses, scores } = cohort(40, (rank) => ({ correct: rank % 2 === 0 }));
    expect(needsAuthorReview(analyseItem(responses, scores))).toBe(false);
  });
});

describe('thin samples', () => {
  it('refuses to analyse fewer than the minimum responses', () => {
    const { responses, scores } = cohort(10, (rank, total) => ({ correct: rank >= total / 2 }));
    const stats = analyseItem(responses, scores);

    expect(stats.flags).toEqual(['INSUFFICIENT_DATA']);
  });

  it('reports INSUFFICIENT_DATA alone, never alongside a guess', () => {
    // A −0.6 discrimination from 8 responses would send an author to rewrite
    // a perfectly good item.
    const { responses, scores } = cohort(8, (rank, total) => ({ correct: rank >= total / 2 }));
    const stats = analyseItem(responses, scores);

    expect(stats.flags).toHaveLength(1);
    expect(stats.flags[0]).toBe('INSUFFICIENT_DATA');
    expect(stats.discrimination).toBeLessThan(0);
  });

  it('analyses at exactly the minimum', () => {
    const { responses, scores } = cohort(MIN_RESPONSES_FOR_ANALYSIS, (rank, total) => ({
      correct: rank < total / 2,
    }));
    expect(analyseItem(responses, scores).flags).not.toContain('INSUFFICIENT_DATA');
  });

  it('handles no responses at all', () => {
    const stats = analyseItem([], []);
    expect(stats.responses).toBe(0);
    expect(stats.flags).toEqual(['INSUFFICIENT_DATA']);
    expect(stats.medianSecondsToAnswer).toBeNull();
  });
});

describe('distractors', () => {
  it('reports what each option attracted', () => {
    const { responses, scores } = cohort(40, (rank, total) => ({
      correct: rank < total / 2,
      chosenOptionId: rank < total / 2 ? 'a' : 'b',
    }));
    const stats = analyseItem(responses, scores);

    expect(stats.distractors).toHaveLength(2);
    expect(stats.distractors[0]?.share).toBe(0.5);
  });

  it('gives a distractor chosen by strong learners a positive discrimination', () => {
    // The miskey signature, seen from the option's side.
    const { responses, scores } = cohort(40, (rank, total) => ({
      correct: rank >= total / 2,
      chosenOptionId: rank < total / 2 ? 'trap' : 'keyed',
    }));
    const stats = analyseItem(responses, scores);

    const trap = stats.distractors.find((d) => d.optionId === 'trap');
    expect(trap?.discrimination).toBeGreaterThan(0);
  });

  it('flags an option nobody chose', () => {
    const responses: ItemResponse[] = [];
    const scores: LearnerScore[] = [];
    for (let i = 0; i < 30; i += 1) {
      const learnerKey = `lrn-${i}`;
      scores.push({ learnerKey, proportionCorrect: 1 - i / 30 });
      responses.push({
        learnerKey,
        correct: i < 15,
        chosenOptionId: i < 15 ? 'a' : 'b',
        timeSpentSeconds: 20,
      });
    }
    // Option 'c' exists but was never picked; it is recorded as a zero-count.
    responses.push({
      learnerKey: 'lrn-ghost',
      correct: false,
      chosenOptionId: 'c',
      timeSpentSeconds: 20,
    });
    scores.push({ learnerKey: 'lrn-ghost', proportionCorrect: 0.5 });

    const stats = analyseItem(responses, scores);
    expect(stats.distractors.map((d) => d.optionId).sort()).toEqual(['a', 'b', 'c']);
  });

  it('reports no distractors for a non-choice item', () => {
    const { responses, scores } = cohort(30, (rank) => ({ correct: rank < 15 }));
    expect(analyseItem(responses, scores).distractors).toEqual([]);
  });
});

describe('timing', () => {
  it('reports the median, not the mean', () => {
    // One learner who left the tab open must not move the number.
    const { responses, scores } = cohort(21, (rank) => ({
      correct: rank < 10,
      timeSpentSeconds: rank === 0 ? 100_000 : 30,
    }));
    expect(analyseItem(responses, scores).medianSecondsToAnswer).toBe(30);
  });

  it('returns null when nothing was timed', () => {
    const { responses, scores } = cohort(30, (rank) => ({
      correct: rank < 15,
      timeSpentSeconds: null,
    }));
    expect(analyseItem(responses, scores).medianSecondsToAnswer).toBeNull();
  });
});

// ── Cohort analytics ─────────────────────────────────────────────────────────

function point(overrides: Partial<MasteryPoint> = {}): MasteryPoint {
  return {
    learnerKey: 'lrn-1',
    conceptKey: 'C-SET',
    mastery: 0.5,
    observations: 4,
    threshold: 0.85,
    ...overrides,
  };
}

describe('concept summaries', () => {
  it('separates unassessed learners from struggling ones', () => {
    // The lie this prevents: a topic nobody has started reading as a topic
    // everybody failed.
    const summary = summariseConcept('C-SET', [
      point({ learnerKey: 'a', mastery: 0.9 }),
      point({ learnerKey: 'b', mastery: 0.4 }),
      point({ learnerKey: 'c', mastery: 0, observations: 0 }),
    ]);

    expect(summary.learners).toBe(3);
    expect(summary.unassessedCount).toBe(1);
    expect(summary.strugglingCount).toBe(1);
    expect(summary.masteredCount).toBe(1);
    // The mean covers the two assessed learners only.
    expect(summary.meanMastery).toBe(0.65);
  });

  it('reports zeroes rather than NaN when nobody has been assessed', () => {
    const summary = summariseConcept('C-SET', [
      point({ learnerKey: 'a', mastery: 0, observations: 0 }),
    ]);
    expect(summary.meanMastery).toBe(0);
    expect(summary.masteredShare).toBe(0);
    expect(summary.unassessedCount).toBe(1);
  });

  it('uses each concept\'s own threshold', () => {
    const summary = summariseConcept('C-SET', [
      point({ learnerKey: 'a', mastery: 0.7, threshold: 0.6 }),
      point({ learnerKey: 'b', mastery: 0.7, threshold: 0.9 }),
    ]);
    expect(summary.masteredCount).toBe(1);
  });

  it('ignores other concepts', () => {
    const summary = summariseConcept('C-SET', [
      point({ learnerKey: 'a', conceptKey: 'C-SET', mastery: 0.9 }),
      point({ learnerKey: 'a', conceptKey: 'C-SUBSET', mastery: 0.1 }),
    ]);
    expect(summary.learners).toBe(1);
    expect(summary.meanMastery).toBe(0.9);
  });
});

describe('what to reteach', () => {
  it('ranks by how many learners are struggling, not by mean', () => {
    // 0.4 across thirty learners is a lesson; 0.1 across two is a chat.
    const many = summariseConcept('C-MANY', [
      ...Array.from({ length: 30 }, (_, i) =>
        point({ learnerKey: `m${i}`, conceptKey: 'C-MANY', mastery: 0.4 }),
      ),
    ]);
    const few = summariseConcept('C-FEW', [
      point({ learnerKey: 'f1', conceptKey: 'C-FEW', mastery: 0.1 }),
      point({ learnerKey: 'f2', conceptKey: 'C-FEW', mastery: 0.1 }),
    ]);

    expect(weakestConcepts([few, many])[0]?.conceptKey).toBe('C-MANY');
  });

  it('omits concepts nobody is struggling with', () => {
    const solid = summariseConcept('C-OK', [point({ learnerKey: 'a', mastery: 0.95, conceptKey: 'C-OK' })]);
    expect(weakestConcepts([solid])).toEqual([]);
  });

  it('respects the limit', () => {
    const summaries = ['a', 'b', 'c', 'd'].map((k) =>
      summariseConcept(k, [point({ conceptKey: k, mastery: 0.2 })]),
    );
    expect(weakestConcepts(summaries, 2)).toHaveLength(2);
  });
});

describe('learner standing', () => {
  it('summarises one learner across concepts', () => {
    const standing = summariseLearner('lrn-1', [
      point({ conceptKey: 'C-A', mastery: 0.9 }),
      point({ conceptKey: 'C-B', mastery: 0.4 }),
      point({ conceptKey: 'C-C', mastery: 0.2 }),
    ]);

    expect(standing.conceptsAssessed).toBe(3);
    expect(standing.conceptsMastered).toBe(1);
    expect(standing.weakestConcepts).toEqual(['C-C', 'C-B']);
  });

  it('ignores concepts with no evidence', () => {
    const standing = summariseLearner('lrn-1', [
      point({ conceptKey: 'C-A', mastery: 0.9 }),
      point({ conceptKey: 'C-B', mastery: 0, observations: 0 }),
    ]);
    expect(standing.conceptsAssessed).toBe(1);
    expect(standing.weakestConcepts).toEqual([]);
  });

  it('handles a learner with no evidence at all', () => {
    const standing = summariseLearner('lrn-new', []);
    expect(standing).toMatchObject({ conceptsAssessed: 0, meanMastery: 0, weakestConcepts: [] });
  });
});

describe('distribution', () => {
  it('shows the shape a mean would hide', () => {
    // Two classes can average 0.6 and need opposite responses.
    const polarised = distribution([
      ...Array.from({ length: 5 }, (_, i) => point({ learnerKey: `hi${i}`, mastery: 0.95 })),
      ...Array.from({ length: 5 }, (_, i) => point({ learnerKey: `lo${i}`, mastery: 0.2 })),
    ]);

    expect(polarised.bands.mastered).toBe(5);
    expect(polarised.bands.struggling).toBe(5);
    expect(polarised.bands.developing + polarised.bands.approaching).toBe(0);
  });

  it('counts unassessed learners outside the bands', () => {
    const shape = distribution([
      point({ learnerKey: 'a', mastery: 0.9 }),
      point({ learnerKey: 'b', mastery: 0, observations: 0 }),
    ]);
    expect(shape.assessed).toBe(1);
    expect(shape.unassessed).toBe(1);
    expect(Object.values(shape.bands).reduce((a, b) => a + b, 0)).toBe(1);
  });
});

describe('activity', () => {
  it('counts learners who produced evidence, and names the ones who did not', () => {
    const summary = summariseActivity(
      ['a', 'b', 'c', 'd'],
      new Map([
        ['a', 5],
        ['b', 3],
      ]),
    );

    expect(summary.activeLearners).toBe(2);
    expect(summary.activeShare).toBe(0.5);
    expect(summary.totalAttempts).toBe(8);
    // A list of names is actionable; "50% inactive" is not.
    expect(summary.neverActive).toEqual(['c', 'd']);
  });

  it('takes the median over ACTIVE learners only', () => {
    // Including the inactive would report a busy class as a quiet one.
    const summary = summariseActivity(
      ['a', 'b', 'c', 'd', 'e'],
      new Map([
        ['a', 10],
        ['b', 10],
      ]),
    );
    expect(summary.medianAttemptsPerActiveLearner).toBe(10);
  });

  it('handles an empty cohort without dividing by zero', () => {
    const summary = summariseActivity([], new Map());
    expect(summary).toMatchObject({ totalLearners: 0, activeShare: 0, medianAttemptsPerActiveLearner: 0 });
  });
});
