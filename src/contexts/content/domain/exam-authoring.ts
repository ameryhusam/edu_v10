/**
 * Exam assembly rules — PURE.
 *
 * An exam is a *selection*, not a container: it holds references to questions
 * that exist independently and are shared across forms. That single decision
 * removes the legacy failure where editing a question changed a past paper.
 *
 * Two families, one model:
 *
 *   FIXED     every learner sees the same items, in the authored order.
 *   ADAPTIVE  the item list is a POOL; CAT picks from it per learner using
 *             IRT, stopping at targetStandardError or maxItems.
 *
 * The difference is enforced here rather than in the exam runner, because the
 * runner discovers a pool is too small only once a learner is halfway through
 * it — and by then the sensible options are all bad.
 */

import { Errors } from '../../../shared/kernel/errors.js';
import { Err, Ok, type Result } from '../../../shared/kernel/result.js';
import type { AuthoringIssue } from './question-authoring.js';

/** An item as it sits on a form: a reference plus its weight on this paper. */
export interface ExamItemDraft {
  readonly questionKey: string;
  readonly orderIndex: number;
  readonly points: number;
  /** The question's own publication status. A draft item cannot go live. */
  readonly questionStatus: string;
  /** True when the question has an auto-gradable key (ESSAY does not). */
  readonly autoGradable: boolean;
  /** Calibrated IRT difficulty, used to judge pool coverage. */
  readonly irtDifficulty: number;
  readonly conceptKeys: readonly string[];
}

export interface AdaptiveConfig {
  readonly minItems: number;
  readonly maxItems: number;
  readonly targetStandardError: number;
}

export interface ExamDraft {
  readonly title: string;
  readonly isAdaptive: boolean;
  readonly passingScore: number;
  readonly timeLimitMins?: number | null;
  readonly adaptive: AdaptiveConfig;
  readonly items: readonly ExamItemDraft[];
}

/**
 * Adaptive parameters that make sense.
 *
 * The canonical values are minItems 5, maxItems 25, targetSE 0.30. These
 * bounds exist because an ability estimate from fewer than 3 items is noise
 * dressed up as a number, and an SE target below 0.20 is unreachable within
 * any tolerable test length — the exam would simply always run to maxItems.
 */
export function validateAdaptiveConfig(config: AdaptiveConfig): readonly AuthoringIssue[] {
  const issues: AuthoringIssue[] = [];

  if (!Number.isInteger(config.minItems) || config.minItems < 3) {
    issues.push({
      code: 'exam.min_items_too_low',
      message: 'An adaptive exam needs at least 3 items before its estimate means anything.',
      field: 'minItems',
    });
  }
  if (!Number.isInteger(config.maxItems) || config.maxItems < config.minItems) {
    issues.push({
      code: 'exam.max_items_invalid',
      message: 'The maximum item count must be a whole number no lower than the minimum.',
      field: 'maxItems',
    });
  }
  if (config.maxItems > 100) {
    issues.push({
      code: 'exam.max_items_too_high',
      message: 'An adaptive exam longer than 100 items measures stamina, not ability.',
      field: 'maxItems',
    });
  }
  if (
    !Number.isFinite(config.targetStandardError) ||
    config.targetStandardError < 0.15 ||
    config.targetStandardError > 1
  ) {
    issues.push({
      code: 'exam.target_se_out_of_range',
      message:
        'Target standard error must be between 0.15 and 1.0; below that the exam never stops early.',
      field: 'targetStandardError',
    });
  }

  return issues;
}

/**
 * Is the item pool big and varied enough for adaptive selection to work?
 *
 * CAT is only adaptive if it has somewhere to go. A pool of exactly maxItems
 * administers every item to everyone — the same fixed form, with extra
 * machinery and a misleading label on the results.
 *
 * The spread check is the one that actually bites in practice: a pool where
 * every item sits at b ≈ 0 cannot distinguish a strong learner from an average
 * one, because after two items there is no harder question to ask.
 */
export function validateAdaptivePool(
  items: readonly ExamItemDraft[],
  config: AdaptiveConfig,
): readonly AuthoringIssue[] {
  const issues: AuthoringIssue[] = [];

  if (items.length < config.minItems) {
    issues.push({
      code: 'exam.pool_below_minimum',
      message: `The pool holds ${items.length} items but the exam must administer at least ${config.minItems}.`,
      field: 'items',
    });
    return issues;
  }

  // Enough room to choose. Twice the minimum is the smallest pool where the
  // selector's choice can differ between two learners for most of the test.
  if (items.length < config.minItems * 2) {
    issues.push({
      code: 'exam.pool_too_shallow',
      message:
        `An adaptive pool of ${items.length} for a ${config.minItems}-item minimum leaves almost ` +
        'no room to adapt. Aim for at least twice the minimum.',
      field: 'items',
    });
  }

  const difficulties = items.map((i) => i.irtDifficulty);
  const spread = Math.max(...difficulties) - Math.min(...difficulties);
  if (spread < 1.0) {
    issues.push({
      code: 'exam.pool_difficulty_too_narrow',
      message:
        'Every item sits at nearly the same difficulty, so the exam cannot tell learners apart. ' +
        'Include easier and harder items (a logit spread of at least 1.0).',
      field: 'items',
    });
  }

  // Adaptive selection scores candidates by information at the current theta;
  // an essay has no IRT parameters and cannot be scored mid-flight.
  const manual = items.filter((i) => !i.autoGradable);
  if (manual.length > 0) {
    issues.push({
      code: 'exam.manual_item_in_adaptive_pool',
      message:
        `${manual.length} item(s) need manual marking. An adaptive exam must score each answer ` +
        'before choosing the next one, so it cannot contain them.',
      field: 'items',
    });
  }

  return issues;
}

/** Rules that hold for every exam, adaptive or not. */
export function validateExam(draft: ExamDraft): readonly AuthoringIssue[] {
  const issues: AuthoringIssue[] = [];

  if (!draft.title.trim()) {
    issues.push({ code: 'exam.title_required', message: 'An exam needs a title.', field: 'title' });
  }

  if (
    !Number.isFinite(draft.passingScore) ||
    draft.passingScore <= 0 ||
    draft.passingScore > 1
  ) {
    issues.push({
      code: 'exam.passing_score_out_of_range',
      message: 'The passing score is a proportion in (0, 1].',
      field: 'passingScore',
    });
  }

  if (draft.timeLimitMins != null && (!Number.isInteger(draft.timeLimitMins) || draft.timeLimitMins < 1)) {
    issues.push({
      code: 'exam.time_limit_invalid',
      message: 'A time limit must be a whole number of minutes, or absent.',
      field: 'timeLimitMins',
    });
  }

  if (draft.items.length === 0) {
    issues.push({ code: 'exam.no_items', message: 'An exam with no items is empty.', field: 'items' });
    return issues;
  }

  const seen = new Set<string>();
  for (const item of draft.items) {
    if (seen.has(item.questionKey)) {
      issues.push({
        code: 'exam.duplicate_item',
        message: `${item.questionKey} appears on this exam twice.`,
        field: 'items',
      });
    }
    seen.add(item.questionKey);

    if (!Number.isInteger(item.points) || item.points < 1) {
      issues.push({
        code: 'exam.item_points_invalid',
        message: 'Each item is worth a whole number of points, at least 1.',
        field: `items.${item.questionKey}.points`,
      });
    }
  }

  // A published exam pointing at a draft question is the same class of bug as
  // a published lesson pointing at a draft concept: live for the author,
  // invisible or broken for the learner.
  const unpublished = draft.items.filter((i) => i.questionStatus !== 'PUBLISHED');
  if (unpublished.length > 0) {
    issues.push({
      code: 'exam.unpublished_item',
      message:
        `${unpublished.length} item(s) are not published. Publish the questions first, or the ` +
        'exam will reference content learners cannot be shown.',
      field: 'items',
    });
  }

  issues.push(
    ...(draft.isAdaptive
      ? [...validateAdaptiveConfig(draft.adaptive), ...validateAdaptivePool(draft.items, draft.adaptive)]
      : validateFixedForm(draft.items)),
  );

  return issues;
}

/**
 * Fixed forms have one ordering rule, and it is not cosmetic.
 *
 * Items are presented in `orderIndex` order; a gap or a duplicate makes the
 * sequence ambiguous, and two learners can then see the same paper in two
 * different orders — which is precisely the thing a fixed form promises not to
 * do.
 */
function validateFixedForm(items: readonly ExamItemDraft[]): readonly AuthoringIssue[] {
  const indices = items.map((i) => i.orderIndex).sort((a, b) => a - b);
  const expected = indices.map((_, i) => i);

  if (indices.some((value, i) => value !== expected[i])) {
    return [
      {
        code: 'exam.order_not_contiguous',
        message: 'Item order must be 0..n-1 with no gaps or repeats.',
        field: 'items',
      },
    ];
  }
  return [];
}

/**
 * What does this exam actually measure?
 *
 * Reported rather than refused. An exam that covers three of a unit's ten
 * concepts may be exactly what the teacher wants — a targeted check — so this
 * informs the author instead of blocking them.
 */
export interface Blueprint {
  readonly totalItems: number;
  readonly totalPoints: number;
  readonly conceptCoverage: ReadonlyArray<{ conceptKey: string; items: number; points: number }>;
  readonly difficultyBands: { easy: number; medium: number; hard: number };
}

export function summariseBlueprint(items: readonly ExamItemDraft[]): Blueprint {
  const byConcept = new Map<string, { items: number; points: number }>();

  for (const item of items) {
    for (const conceptKey of item.conceptKeys) {
      const entry = byConcept.get(conceptKey) ?? { items: 0, points: 0 };
      entry.items += 1;
      // Points are split across the concepts an item measures, so a
      // multi-concept item does not inflate every total it touches.
      entry.points += item.points / item.conceptKeys.length;
      byConcept.set(conceptKey, entry);
    }
  }

  // Bands on the IRT b scale: below -0.5 is easy for a median learner, above
  // +0.5 is hard. The middle band is where most items should sit.
  const bands = { easy: 0, medium: 0, hard: 0 };
  for (const item of items) {
    if (item.irtDifficulty < -0.5) bands.easy += 1;
    else if (item.irtDifficulty > 0.5) bands.hard += 1;
    else bands.medium += 1;
  }

  return {
    totalItems: items.length,
    totalPoints: items.reduce((sum, i) => sum + i.points, 0),
    conceptCoverage: [...byConcept.entries()]
      .map(([conceptKey, v]) => ({ conceptKey, items: v.items, points: Math.round(v.points * 100) / 100 }))
      .sort((a, b) => b.items - a.items),
    difficultyBands: bands,
  };
}

/** The publication gate for an exam. */
export function checkExamPublishable(draft: ExamDraft): Result<void> {
  const issues = validateExam(draft);
  if (issues.length === 0) return Ok(undefined);

  return Err(
    Errors.validation('exam.not_publishable', 'This exam is not ready to publish.', { issues }),
  );
}

/**
 * May an item be removed from, or added to, an exam in this state?
 *
 * Same reasoning as the content tree: once learners have sat a paper, its
 * composition is history. Changing it would silently rewrite what a past score
 * was out of.
 */
export function checkExamComposable(
  status: string,
  hasAttempts: boolean,
): Result<void> {
  if (hasAttempts) {
    return Err(
      Errors.conflict(
        'exam.has_attempts',
        'Learners have already sat this exam, so its items are frozen. Create a new version instead.',
        { status },
      ),
    );
  }
  if (status === 'PUBLISHED' || status === 'ARCHIVED') {
    return Err(
      Errors.conflict(
        'exam.locked',
        `A ${status.toLowerCase()} exam cannot be recomposed.`,
        { status },
      ),
    );
  }
  return Ok(undefined);
}
