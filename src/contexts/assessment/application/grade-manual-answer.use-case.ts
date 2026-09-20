/**
 * Convert a pending essay answer into a graded assessment item.
 *
 * The initial learner submission intentionally emits zero-weight evidence. Only
 * this explicit review path can create score-bearing evidence for essay work,
 * keeping human judgement out of the automatic CAT loop while still letting the
 * answer affect mastery after a reviewer has marked it.
 */

import type { Clock } from '../../../shared/kernel/clock.js';
import { Errors } from '../../../shared/kernel/errors.js';
import { Err, Ok, type Result } from '../../../shared/kernel/result.js';
import type { Evaluation } from '../domain/evaluation.js';
import { buildEvidence, type Evidence } from '../domain/evidence.js';
import type {
  AttemptRecord,
  EvidenceWriter,
  ManualReviewRepository,
  MasteryRecomputeTrigger,
  QuestionRepository,
} from './ports.js';
import { computeTotals, type AttemptTotals } from './submit-attempt.use-case.js';

export interface GradeManualAnswerCommand {
  readonly attemptKey: string;
  readonly questionKey: string;
  readonly reviewerUserId: string;
  /** Undefined means platform-wide reviewer; empty means no scoped access. */
  readonly allowedSchoolIds?: readonly string[] | undefined;
  readonly scoreEarned: number;
  readonly feedback?: string | null;
}

export interface GradeManualAnswerResult {
  readonly attempt: AttemptRecord;
  readonly evaluation: Evaluation;
  readonly totals: AttemptTotals;
  readonly evidence: readonly Evidence[];
}

const MANUAL_EVALUATOR_VERSION = 'manual-1.0';

export class GradeManualAnswerUseCase {
  constructor(
    private readonly attempts: ManualReviewRepository,
    private readonly questions: QuestionRepository,
    private readonly evidenceWriter: EvidenceWriter,
    private readonly recompute: MasteryRecomputeTrigger,
    private readonly clock: Clock,
  ) {}

  async execute(command: GradeManualAnswerCommand): Promise<Result<GradeManualAnswerResult>> {
    const pending = await this.attempts.findPendingManualReview(
      command.attemptKey,
      command.questionKey,
    );
    if (!pending) {
      return Err(
        Errors.notFound('assessment.manual_review_not_found', 'No pending manual review was found.'),
      );
    }

    if (
      command.allowedSchoolIds &&
      (!pending.schoolId || !command.allowedSchoolIds.includes(pending.schoolId))
    ) {
      return Err(
        Errors.forbidden(
          'assessment.manual_review_forbidden',
          'You may not grade this learner\'s answer.',
        ),
      );
    }

    if (pending.attemptStatus !== 'IN_PROGRESS' && pending.attemptStatus !== 'SUBMITTED') {
      return Err(
        Errors.conflict('assessment.attempt_closed', 'This attempt is no longer gradeable.', {
          status: pending.attemptStatus,
        }),
      );
    }

    if (!Number.isFinite(command.scoreEarned) || command.scoreEarned < 0) {
      return Err(
        Errors.validation('assessment.manual_score_invalid', 'Score must be a non-negative number.'),
      );
    }
    if (command.scoreEarned > pending.scorePossible) {
      return Err(
        Errors.validation(
          'assessment.manual_score_exceeds_max',
          'Score cannot exceed the question maximum.',
          { scorePossible: pending.scorePossible },
        ),
      );
    }

    const question = await this.questions.findByKey(command.questionKey);
    if (!question) {
      return Err(Errors.notFound('assessment.question_not_found', 'Question not found.'));
    }

    const reviewedAt = this.clock.now();
    const evaluation = manualEvaluation({
      scoreEarned: command.scoreEarned,
      scorePossible: pending.scorePossible,
      rawAnswer: pending.rawAnswer,
      feedback: command.feedback ?? null,
    });

    const updated = await this.attempts.replaceItemEvaluation({
      attemptKey: command.attemptKey,
      questionKey: command.questionKey,
      evaluation,
      reviewedByUserId: command.reviewerUserId,
      reviewedAt,
      feedback: command.feedback ?? null,
    });

    const totals = computeTotals(updated);
    const attempt =
      updated.status === 'SUBMITTED'
        ? await this.attempts.updateTotals(command.attemptKey, totals)
        : updated;

    const evidence = question.conceptLinks.map((link) =>
      buildEvidence({
        conceptKey: link.conceptKey,
        questionKey: question.key,
        evaluation,
        observedAt: reviewedAt,
        conceptLinkWeight: link.weight,
      }),
    );

    await this.evidenceWriter.append(pending.learnerKey, evidence);
    if (evidence.length > 0) {
      await this.recompute.request(
        pending.learnerKey,
        evidence.map((e) => e.conceptKey),
      );
    }

    return Ok({ attempt, evaluation, totals, evidence });
  }
}

function manualEvaluation(input: {
  scoreEarned: number;
  scorePossible: number;
  rawAnswer: Readonly<Record<string, unknown>>;
  feedback: string | null;
}): Evaluation {
  const score = Math.round(input.scoreEarned * 10_000) / 10_000;
  const max = input.scorePossible;
  const verdict = score >= max ? 'CORRECT' : score <= 0 ? 'INCORRECT' : 'PARTIALLY_CORRECT';
  const rawText = typeof input.rawAnswer.text === 'string' ? input.rawAnswer.text : null;
  return {
    verdict,
    scoreEarned: score,
    scorePossible: max,
    normalizedAnswer: rawText,
    normalizationApplied: [],
    evaluatorVersion: MANUAL_EVALUATOR_VERSION,
    note: input.feedback ? 'manual_review_with_feedback' : 'manual_review',
  };
}
