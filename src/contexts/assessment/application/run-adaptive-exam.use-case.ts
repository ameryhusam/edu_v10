/**
 * RunAdaptiveExam — serve the next item in a computerised adaptive test.
 *
 * The exam session is STATELESS on the server: theta and the stopping decision
 * are recomputed from the stored attempt items on every request. There is no
 * in-memory session object to lose, expire, or desynchronise, so a learner can
 * resume on another device mid-exam and get exactly the same next item.
 */

import { Errors } from '../../../shared/kernel/errors.js';
import { Err, Ok, type Result } from '../../../shared/kernel/result.js';
import {
  evaluateStoppingRule,
  selectNextItem,
  DEFAULT_ADAPTIVE_CONFIG,
  type AdaptiveConfig,
  type StopReason,
} from '../domain/adaptive-selection.js';
import { estimateThetaEAP, type ItemParameters, type ItemResponse } from '../domain/irt.js';
import type {
  AttemptRepository,
  QuestionChoiceView,
  QuestionRepository,
  QuestionView,
} from './ports.js';

/**
 * A choice as a learner may see it, before they answer.
 *
 * `misconceptionKey` is removed rather than made optional. It is only ever set
 * on a distractor — it names the error that option is designed to expose — so
 * in a four-option item with three tagged distractors the untagged option is
 * the answer. That is not a theoretical leak: it was observed on a live seeded
 * question, where three of four choices carried the tag.
 *
 * The diagnosis itself is not secret, and it is still returned *after* an
 * answer is graded, in the feedback payload of `submit-answer`. What must not
 * happen is the client receiving it while the question is still open.
 */
export type LearnerSafeChoice = Omit<QuestionChoiceView, 'misconceptionKey'>;

/**
 * The question payload a learner receives.
 *
 * `irt` (item difficulty/discrimination/guessing) and `conceptLinks` are
 * dropped for the same reason: they describe how the item behaves and what it
 * measures, which is authoring and psychometric information, not something to
 * hand to the person being measured.
 */
export type LearnerSafeQuestion = Omit<QuestionView, 'irt' | 'conceptLinks' | 'choices'> & {
  readonly choices: readonly LearnerSafeChoice[];
};

/**
 * Strip everything that would help a learner answer without knowing the answer.
 *
 * Written as an explicit allow-list rather than a `delete`, so that a field
 * added to `QuestionView` later is excluded by default instead of silently
 * shipping to learners.
 */
function toLearnerSafe(question: QuestionView): LearnerSafeQuestion {
  return {
    key: question.key,
    text: question.text,
    type: question.type,
    points: question.points,
    ...(question.hint !== undefined ? { hint: question.hint } : {}),
    choices: question.choices.map((choice) => ({
      id: choice.id,
      text: choice.text,
      orderIndex: choice.orderIndex,
    })),
  };
}

export interface NextExamItemQuery {
  readonly attemptKey: string;
  readonly learnerKey: string;
  /** Concept scope of the exam blueprint. */
  readonly conceptKeys: readonly string[];
  readonly config?: AdaptiveConfig;
  readonly random?: () => number;
}

export interface NextExamItemResult {
  readonly finished: boolean;
  readonly reason: StopReason;
  readonly theta: number;
  readonly standardError: number;
  readonly itemsAdministered: number;
  /** Learner-safe question payload. Answer keys are never included. */
  readonly question: LearnerSafeQuestion | null;
}

export class RunAdaptiveExamUseCase {
  constructor(
    private readonly questions: QuestionRepository,
    private readonly attempts: AttemptRepository,
  ) {}

  async execute(query: NextExamItemQuery): Promise<Result<NextExamItemResult>> {
    const attempt = await this.attempts.findByKey(query.attemptKey);
    if (!attempt) {
      return Err(Errors.notFound('assessment.attempt_not_found', 'Attempt not found.'));
    }
    if (attempt.learnerKey !== query.learnerKey) {
      return Err(Errors.forbidden('assessment.attempt_not_owned', 'This attempt belongs to another learner.'));
    }
    if (attempt.status !== 'IN_PROGRESS') {
      return Err(Errors.conflict('assessment.attempt_closed', 'This attempt has already been submitted.'));
    }

    const pool = await this.questions.findPoolByConcepts(query.conceptKeys, 500);

    // A starved CAT pool is an operational content problem, not a learner
    // error. Return a normal finished state so the client can show an honest
    // "not enough questions yet" screen or hide the CTA, instead of surfacing a
    // failing request in the middle of an exam.
    if (pool.length === 0) {
      return Ok({
        finished: true,
        reason: 'POOL_EXHAUSTED',
        theta: 0,
        standardError: 1,
        itemsAdministered: attempt.items.length,
        question: null,
      });
    }

    const itemsById = new Map<string, ItemParameters>(pool.map((q) => [q.key, q.irt]));

    // Rebuild ability from the graded record — the single source of truth.
    const responses: ItemResponse[] = attempt.items
      .filter((i) => i.evaluation.verdict === 'CORRECT' || i.evaluation.verdict === 'INCORRECT')
      .map((i) => ({ itemId: i.questionKey, isCorrect: i.evaluation.verdict === 'CORRECT' }));

    const { theta, standardError: se } = estimateThetaEAP(responses, itemsById);
    const administeredIds = attempt.items.map((i) => i.questionKey);
    const administered = administeredIds
      .map((id) => itemsById.get(id))
      .filter((x): x is ItemParameters => x != null);

    const stop = evaluateStoppingRule({
      theta,
      administered,
      poolRemaining: pool.length - administeredIds.length,
      config: query.config ?? DEFAULT_ADAPTIVE_CONFIG,
    });

    if (stop.shouldStop) {
      return Ok({
        finished: true,
        reason: stop.reason,
        theta,
        standardError: stop.standardError,
        itemsAdministered: administeredIds.length,
        question: null,
      });
    }

    const selection = selectNextItem({
      theta,
      pool: pool.map((q) => q.irt),
      administeredIds,
      config: query.config ?? DEFAULT_ADAPTIVE_CONFIG,
      ...(query.random ? { random: query.random } : {}),
    });

    if (!selection) {
      return Ok({
        finished: true,
        reason: 'POOL_EXHAUSTED',
        theta,
        standardError: se,
        itemsAdministered: administeredIds.length,
        question: null,
      });
    }

    const chosen = pool.find((q) => q.key === selection.item.id)!;

    return Ok({
      finished: false,
      reason: 'CONTINUE',
      theta,
      standardError: se,
      itemsAdministered: administeredIds.length,
      question: toLearnerSafe(chosen),
    });
  }
}
