/**
 * Exam assembly rules.
 *
 * The cases that matter are the adaptive ones. A fixed form that is slightly
 * wrong is visibly wrong; an adaptive exam with a bad pool looks fine, runs to
 * completion, and reports an ability estimate that means nothing.
 */

import { describe, expect, it } from 'vitest';
import {
  checkExamComposable,
  checkExamPublishable,
  summariseBlueprint,
  validateAdaptiveConfig,
  validateAdaptivePool,
  validateExam,
  type ExamDraft,
  type ExamItemDraft,
} from '../../src/contexts/content/domain/exam-authoring.js';

const codes = (issues: readonly { code: string }[]) => issues.map((i) => i.code);

const ADAPTIVE = { minItems: 5, maxItems: 25, targetStandardError: 0.3 };

function item(overrides: Partial<ExamItemDraft> = {}): ExamItemDraft {
  return {
    questionKey: `Q-${Math.random().toString(36).slice(2, 8)}`,
    orderIndex: 0,
    points: 1,
    questionStatus: 'PUBLISHED',
    autoGradable: true,
    irtDifficulty: 0,
    conceptKeys: ['C-SET'],
    ...overrides,
  };
}

/** A pool spread across the difficulty range, as an adaptive exam needs. */
function pool(size: number, overrides: Partial<ExamItemDraft> = {}): ExamItemDraft[] {
  return Array.from({ length: size }, (_, i) =>
    item({
      questionKey: `Q-${i}`,
      orderIndex: i,
      // −2 to +2 logits: enough spread for the selector to have somewhere to go.
      irtDifficulty: -2 + (4 * i) / Math.max(1, size - 1),
      ...overrides,
    }),
  );
}

function fixed(overrides: Partial<ExamDraft> = {}): ExamDraft {
  return {
    title: 'Sets — end of unit',
    isAdaptive: false,
    passingScore: 0.6,
    adaptive: ADAPTIVE,
    items: [
      item({ questionKey: 'Q-1', orderIndex: 0 }),
      item({ questionKey: 'Q-2', orderIndex: 1 }),
    ],
    ...overrides,
  };
}

describe('a valid exam', () => {
  it('accepts a fixed form', () => {
    expect(validateExam(fixed())).toEqual([]);
  });

  it('accepts an adaptive exam with a deep, spread pool', () => {
    const draft = fixed({ isAdaptive: true, items: pool(12) });
    expect(validateExam(draft)).toEqual([]);
  });
});

describe('exam metadata', () => {
  it('requires a title', () => {
    expect(codes(validateExam(fixed({ title: '  ' })))).toContain('exam.title_required');
  });

  it('refuses a passing score outside (0, 1]', () => {
    expect(codes(validateExam(fixed({ passingScore: 0 })))).toContain(
      'exam.passing_score_out_of_range',
    );
    expect(codes(validateExam(fixed({ passingScore: 60 })))).toContain(
      'exam.passing_score_out_of_range',
    );
  });

  it('accepts a passing score of exactly 1', () => {
    expect(codes(validateExam(fixed({ passingScore: 1 })))).not.toContain(
      'exam.passing_score_out_of_range',
    );
  });

  it('refuses a fractional time limit', () => {
    expect(codes(validateExam(fixed({ timeLimitMins: 12.5 })))).toContain(
      'exam.time_limit_invalid',
    );
  });

  it('accepts no time limit', () => {
    expect(codes(validateExam(fixed({ timeLimitMins: null })))).not.toContain(
      'exam.time_limit_invalid',
    );
  });
});

describe('items', () => {
  it('refuses an empty exam', () => {
    expect(codes(validateExam(fixed({ items: [] })))).toContain('exam.no_items');
  });

  it('refuses the same question twice', () => {
    const draft = fixed({
      items: [
        item({ questionKey: 'Q-1', orderIndex: 0 }),
        item({ questionKey: 'Q-1', orderIndex: 1 }),
      ],
    });
    expect(codes(validateExam(draft))).toContain('exam.duplicate_item');
  });

  it('refuses an unpublished question', () => {
    const draft = fixed({
      items: [
        item({ questionKey: 'Q-1', orderIndex: 0 }),
        item({ questionKey: 'Q-2', orderIndex: 1, questionStatus: 'DRAFT' }),
      ],
    });
    expect(codes(validateExam(draft))).toContain('exam.unpublished_item');
  });

  it('refuses zero-point items', () => {
    const draft = fixed({
      items: [item({ questionKey: 'Q-1', orderIndex: 0, points: 0 })],
    });
    expect(codes(validateExam(draft))).toContain('exam.item_points_invalid');
  });

  it('refuses a gap in the fixed-form order', () => {
    const draft = fixed({
      items: [
        item({ questionKey: 'Q-1', orderIndex: 0 }),
        item({ questionKey: 'Q-2', orderIndex: 5 }),
      ],
    });
    expect(codes(validateExam(draft))).toContain('exam.order_not_contiguous');
  });

  it('refuses a repeated order index', () => {
    const draft = fixed({
      items: [
        item({ questionKey: 'Q-1', orderIndex: 0 }),
        item({ questionKey: 'Q-2', orderIndex: 0 }),
      ],
    });
    expect(codes(validateExam(draft))).toContain('exam.order_not_contiguous');
  });

  it('does not apply the ordering rule to an adaptive pool', () => {
    // A pool has no presentation order — the selector decides per learner.
    const items = pool(12).map((i) => ({ ...i, orderIndex: 99 }));
    const draft = fixed({ isAdaptive: true, items });
    expect(codes(validateExam(draft))).not.toContain('exam.order_not_contiguous');
  });
});

describe('adaptive configuration', () => {
  it('accepts the canonical parameters', () => {
    expect(validateAdaptiveConfig(ADAPTIVE)).toEqual([]);
  });

  it('refuses fewer than three items', () => {
    expect(codes(validateAdaptiveConfig({ ...ADAPTIVE, minItems: 2 }))).toContain(
      'exam.min_items_too_low',
    );
  });

  it('refuses a maximum below the minimum', () => {
    expect(codes(validateAdaptiveConfig({ ...ADAPTIVE, maxItems: 3 }))).toContain(
      'exam.max_items_invalid',
    );
  });

  it('refuses an exam longer than 100 items', () => {
    expect(codes(validateAdaptiveConfig({ ...ADAPTIVE, maxItems: 250 }))).toContain(
      'exam.max_items_too_high',
    );
  });

  it('refuses an unreachable standard error target', () => {
    // Below 0.15 the exam always runs to maxItems and is adaptive in name only.
    expect(codes(validateAdaptiveConfig({ ...ADAPTIVE, targetStandardError: 0.05 }))).toContain(
      'exam.target_se_out_of_range',
    );
  });
});

describe('the adaptive pool', () => {
  it('refuses a pool smaller than the minimum item count', () => {
    expect(codes(validateAdaptivePool(pool(3), ADAPTIVE))).toContain('exam.pool_below_minimum');
  });

  it('refuses a pool with no room to adapt', () => {
    // 6 items for a 5-item minimum: nearly every learner sees nearly every
    // item, which is a fixed form wearing a CAT badge.
    expect(codes(validateAdaptivePool(pool(6), ADAPTIVE))).toContain('exam.pool_too_shallow');
  });

  it('refuses a pool where every item is the same difficulty', () => {
    const flat = pool(12).map((i) => ({ ...i, irtDifficulty: 0.1 }));
    expect(codes(validateAdaptivePool(flat, ADAPTIVE))).toContain(
      'exam.pool_difficulty_too_narrow',
    );
  });

  it('accepts a pool spread across the ability range', () => {
    expect(validateAdaptivePool(pool(12), ADAPTIVE)).toEqual([]);
  });

  it('refuses an essay in an adaptive pool', () => {
    // CAT must score each answer before choosing the next item; a manually
    // marked item leaves it with nothing to compute theta from.
    const withEssay = [...pool(12), item({ questionKey: 'Q-E', autoGradable: false })];
    expect(codes(validateAdaptivePool(withEssay, ADAPTIVE))).toContain(
      'exam.manual_item_in_adaptive_pool',
    );
  });

  it('allows an essay on a fixed form', () => {
    const draft = fixed({
      items: [
        item({ questionKey: 'Q-1', orderIndex: 0 }),
        item({ questionKey: 'Q-2', orderIndex: 1, autoGradable: false }),
      ],
    });
    expect(codes(validateExam(draft))).not.toContain('exam.manual_item_in_adaptive_pool');
  });

  it('stops after the size check when the pool is far too small', () => {
    // No point telling an author their 2-item pool is also badly spread.
    const issues = validateAdaptivePool(pool(2), ADAPTIVE);
    expect(codes(issues)).toEqual(['exam.pool_below_minimum']);
  });
});

describe('the blueprint', () => {
  it('counts items and points', () => {
    const blueprint = summariseBlueprint([
      item({ questionKey: 'Q-1', points: 2 }),
      item({ questionKey: 'Q-2', points: 3 }),
    ]);
    expect(blueprint.totalItems).toBe(2);
    expect(blueprint.totalPoints).toBe(5);
  });

  it('splits a multi-concept item across its concepts', () => {
    // Otherwise a single item counts its full weight against every concept and
    // the coverage report overstates the exam.
    const blueprint = summariseBlueprint([
      item({ questionKey: 'Q-1', points: 4, conceptKeys: ['C-SET', 'C-SUBSET'] }),
    ]);
    const set = blueprint.conceptCoverage.find((c) => c.conceptKey === 'C-SET');
    expect(set).toEqual({ conceptKey: 'C-SET', items: 1, points: 2 });
    expect(blueprint.totalPoints).toBe(4);
  });

  it('bands items by difficulty', () => {
    const blueprint = summariseBlueprint([
      item({ questionKey: 'a', irtDifficulty: -1.5 }),
      item({ questionKey: 'b', irtDifficulty: 0 }),
      item({ questionKey: 'c', irtDifficulty: 1.5 }),
    ]);
    expect(blueprint.difficultyBands).toEqual({ easy: 1, medium: 1, hard: 1 });
  });

  it('orders coverage by how heavily each concept is examined', () => {
    const blueprint = summariseBlueprint([
      item({ questionKey: 'a', conceptKeys: ['C-SET'] }),
      item({ questionKey: 'b', conceptKeys: ['C-SET'] }),
      item({ questionKey: 'c', conceptKeys: ['C-SUBSET'] }),
    ]);
    expect(blueprint.conceptCoverage[0]?.conceptKey).toBe('C-SET');
  });
});

describe('the publication gate', () => {
  it('passes a complete exam', () => {
    expect(checkExamPublishable(fixed()).ok).toBe(true);
  });

  it('refuses with every issue in one error', () => {
    const result = checkExamPublishable(fixed({ title: '', items: [] }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('exam.not_publishable');
    const issues = result.error.details?.issues as readonly { code: string }[];
    expect(codes(issues)).toEqual(
      expect.arrayContaining(['exam.title_required', 'exam.no_items']),
    );
  });
});

describe('recomposition', () => {
  it('allows editing a draft exam', () => {
    expect(checkExamComposable('DRAFT', false).ok).toBe(true);
  });

  it('refuses editing a published exam', () => {
    const result = checkExamComposable('PUBLISHED', false);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('exam.locked');
  });

  it('refuses editing an exam learners have sat, whatever its status', () => {
    // Changing the items would rewrite what a past score was out of.
    const result = checkExamComposable('DRAFT', true);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('exam.has_attempts');
  });

  it('reports attempts before status, because it is the stronger reason', () => {
    const result = checkExamComposable('PUBLISHED', true);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('exam.has_attempts');
  });
});
