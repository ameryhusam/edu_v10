/**
 * SubmitAttempt — close an attempt and publish its outcome.
 *
 * Totals are computed from the stored items, never from client-supplied
 * numbers: the server already graded every answer, so re-deriving the score is
 * both free and the only trustworthy option.
 *
 * Ungradable and pending-review items are counted separately rather than as
 * zeros. Reporting an essay awaiting marking as "incorrect" would be a lie, and
 * it is a lie that compounds — it would flow into class analytics as genuine
 * failure.
 *
 * Mastery is not written here. Submitting requests a recompute over exactly the
 * concepts this attempt touched; Mastery decides what that means.
 */

import type { Clock } from '../../../shared/kernel/clock.js';
import { Errors } from '../../../shared/kernel/errors.js';
import { Err, Ok, type Result } from '../../../shared/kernel/result.js';
import type {
  AttemptRecord,
  AttemptRepository,
  MasteryRecomputeTrigger,
  QuestionRepository,
} from './ports.js';

export interface SubmitAttemptCommand {
  readonly attemptKey: string;
  readonly learnerKey: string;
}

export interface AttemptTotals {
  readonly score: number;
  readonly maxScore: number;
  /** Percentage of the gradable maximum, or null when nothing was gradable. */
  readonly percentage: number | null;
  readonly answeredCount: number;
  readonly correctCount: number;
  readonly incorrectCount: number;
  readonly partiallyCorrectCount: number;
  /** Answered but not yet scoreable — essays, or a missing answer key. */
  readonly pendingReviewCount: number;
}

export interface SubmitAttemptResult {
  readonly attempt: AttemptRecord;
  readonly totals: AttemptTotals;
  /** Concepts whose mastery a recompute was requested for. */
  readonly affectedConcepts: readonly string[];
}

export class SubmitAttemptUseCase {
  constructor(
    private readonly attempts: AttemptRepository,
    private readonly questions: QuestionRepository,
    private readonly recompute: MasteryRecomputeTrigger,
    private readonly clock: Clock,
  ) {}

  async execute(command: SubmitAttemptCommand): Promise<Result<SubmitAttemptResult>> {
    const attempt = await this.attempts.findByKey(command.attemptKey);
    if (!attempt) {
      return Err(
        Errors.notFound('assessment.attempt_not_found', 'Attempt not found.', {
          attemptKey: command.attemptKey,
        }),
      );
    }
    if (attempt.learnerKey !== command.learnerKey) {
      return Err(
        Errors.forbidden('assessment.attempt_not_owned', 'This attempt belongs to another learner.'),
      );
    }
    if (attempt.status !== 'IN_PROGRESS') {
      // Submitting twice is a client retry, not a new outcome. Returning a
      // conflict keeps the first submission authoritative.
      return Err(
        Errors.conflict('assessment.attempt_closed', 'This attempt has already been closed.', {
          status: attempt.status,
        }),
      );
    }

    const totals = computeTotals(attempt);
    const submittedAt = this.clock.now();

    const submitted = await this.attempts.submit(command.attemptKey, submittedAt, {
      score: totals.score,
      maxScore: totals.maxScore,
      correctCount: totals.correctCount,
      incorrectCount: totals.incorrectCount,
      pendingReviewCount: totals.pendingReviewCount,
    });

    // Concepts are resolved from the questions actually answered, so a
    // recompute is scoped to what this attempt could possibly have changed.
    const conceptKeys = new Set<string>();
    for (const item of attempt.items) {
      const question = await this.questions.findByKey(item.questionKey);
      for (const link of question?.conceptLinks ?? []) conceptKeys.add(link.conceptKey);
    }

    const affectedConcepts = [...conceptKeys];
    if (affectedConcepts.length > 0) {
      await this.recompute.request(command.learnerKey, affectedConcepts);
    }

    return Ok({ attempt: submitted, totals, affectedConcepts });
  }
}

/**
 * Exported for testing: scoring rules are the part of submission most likely to
 * be argued about, so they are verifiable without a repository.
 */
export function computeTotals(attempt: AttemptRecord): AttemptTotals {
  let score = 0;
  let maxScore = 0;
  let correctCount = 0;
  let incorrectCount = 0;
  let partiallyCorrectCount = 0;
  let pendingReviewCount = 0;

  for (const item of attempt.items) {
    const { verdict, scoreEarned, scorePossible } = item.evaluation;

    if (verdict === 'REQUIRES_MANUAL_REVIEW' || verdict === 'UNGRADABLE') {
      // Excluded from BOTH sides of the ratio: an unmarked essay must not
      // depress the percentage of the work that was actually gradable.
      pendingReviewCount++;
      continue;
    }

    maxScore += scorePossible;
    score += scoreEarned ?? 0;

    if (verdict === 'CORRECT') correctCount++;
    else if (verdict === 'PARTIALLY_CORRECT') partiallyCorrectCount++;
    else incorrectCount++; // INCORRECT, INVALID, SKIPPED — all count against.
  }

  return {
    score: round4(score),
    maxScore: round4(maxScore),
    percentage: maxScore > 0 ? round4(score / maxScore) : null,
    answeredCount: attempt.items.length,
    correctCount,
    incorrectCount,
    partiallyCorrectCount,
    pendingReviewCount,
  };
}

const round4 = (n: number): number => Math.round(n * 10_000) / 10_000;
