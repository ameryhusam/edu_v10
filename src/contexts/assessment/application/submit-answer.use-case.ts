/**
 * SubmitAnswer — grade one answer and emit evidence.
 *
 * This is the busiest write path in the platform, so its boundaries are strict:
 *
 *  - Grading is delegated to the pure evaluator. No inline comparisons here.
 *  - Evidence is emitted for EVERY graded answer, including ungradable ones
 *    (with weight 0). Silence is not a valid outcome; an answer that produced
 *    no evidence row is indistinguishable from an answer that was never made.
 *  - Mastery is NOT written here. This use case only publishes evidence and
 *    requests a recompute. Assessment must never be able to write mastery.
 */

import type { Clock } from '../../../shared/kernel/clock.js';
import { Errors } from '../../../shared/kernel/errors.js';
import { Err, Ok, type Result } from '../../../shared/kernel/result.js';
import { evaluateAnswer, type Evaluation, type SubmittedAnswer } from '../domain/evaluation.js';
import { buildEvidence, type Evidence } from '../domain/evidence.js';
import type {
  AttemptRepository,
  EvidenceWriter,
  MasteryRecomputeTrigger,
  QuestionRepository,
  RewardTrigger,
} from './ports.js';

export interface SubmitAnswerCommand {
  readonly attemptKey: string;
  readonly learnerKey: string;
  readonly questionKey: string;
  readonly answer: SubmittedAnswer;
  readonly timeSpentSeconds?: number;
}

export interface SubmitAnswerResult {
  readonly evaluation: Evaluation;
  readonly evidence: readonly Evidence[];
  /** Feedback safe to return to a learner — never the answer key itself. */
  readonly feedback: {
    readonly verdict: Evaluation['verdict'];
    readonly explanation: string | null;
    readonly misconceptionKey: string | null;
  };
}

export class SubmitAnswerUseCase {
  constructor(
    private readonly questions: QuestionRepository,
    private readonly attempts: AttemptRepository,
    private readonly evidenceWriter: EvidenceWriter,
    private readonly recompute: MasteryRecomputeTrigger,
    private readonly clock: Clock,
    private readonly reward?: RewardTrigger,
  ) {}

  async execute(command: SubmitAnswerCommand): Promise<Result<SubmitAnswerResult>> {
    const attempt = await this.attempts.findByKey(command.attemptKey);
    if (!attempt) {
      return Err(Errors.notFound('assessment.attempt_not_found', 'Attempt not found.', {
        attemptKey: command.attemptKey,
      }));
    }
    if (attempt.learnerKey !== command.learnerKey) {
      return Err(
        Errors.forbidden('assessment.attempt_not_owned', 'This attempt belongs to another learner.'),
      );
    }
    if (attempt.status !== 'IN_PROGRESS') {
      return Err(
        Errors.conflict('assessment.attempt_closed', 'This attempt has already been submitted.', {
          status: attempt.status,
        }),
      );
    }
    const alreadyAnswered = attempt.items.find((i) => i.questionKey === command.questionKey);
    if (alreadyAnswered) {
      if (!sameSubmittedAnswer(alreadyAnswered.rawAnswer, command.answer)) {
        return Err(
          Errors.conflict('assessment.question_already_answered', 'This question was already answered in this attempt.'),
        );
      }
      const question = await this.questions.findByKey(command.questionKey);
      if (!question) {
        return Err(Errors.notFound('assessment.question_not_found', 'Question not found.', {
          questionKey: command.questionKey,
        }));
      }
      const misconceptionKey = this.diagnoseMisconception(
        question,
        command.answer,
        alreadyAnswered.evaluation,
      );
      return Ok({
        evaluation: alreadyAnswered.evaluation,
        // Idempotent replay: the first submission already emitted evidence.
        evidence: [],
        feedback: {
          verdict: alreadyAnswered.evaluation.verdict,
          explanation: alreadyAnswered.evaluation.verdict === 'CORRECT' ? null : (question.hint ?? null),
          misconceptionKey: misconceptionKey ?? null,
        },
      });
    }

    const question = await this.questions.findByKey(command.questionKey);
    if (!question) {
      return Err(Errors.notFound('assessment.question_not_found', 'Question not found.', {
        questionKey: command.questionKey,
      }));
    }

    const answerKey = await this.questions.findAnswerKey(command.questionKey);
    const evaluation = answerKey
      ? evaluateAnswer(answerKey, command.answer, question.points)
      : ({
          verdict: 'UNGRADABLE' as const,
          scoreEarned: null,
          scorePossible: question.points,
          normalizedAnswer: null,
          normalizationApplied: [],
          evaluatorVersion: 'canonical-2.0',
          note: 'answer_key_missing',
        } satisfies Evaluation);

    const answeredAt = this.clock.now();

    await this.attempts.appendItem(command.attemptKey, {
      questionKey: command.questionKey,
      evaluation,
      answeredAt,
      timeSpentSeconds: command.timeSpentSeconds ?? null,
      rawAnswer: command.answer as Record<string, unknown>,
    });

    // A question may measure several concepts; each gets its own evidence,
    // weighted by how strongly the question links to that concept.
    const misconceptionKey = this.diagnoseMisconception(question, command.answer, evaluation);
    const evidence = question.conceptLinks.map((link) =>
      buildEvidence({
        conceptKey: link.conceptKey,
        questionKey: question.key,
        evaluation,
        observedAt: answeredAt,
        conceptLinkWeight: link.weight,
        ...(misconceptionKey ? { misconceptionKey } : {}),
      }),
    );

    await this.evidenceWriter.append(command.learnerKey, evidence);
    await this.recompute.request(
      command.learnerKey,
      evidence.map((e) => e.conceptKey),
    );

    if (this.reward) {
      try {
        await this.reward.answerGraded({
          learnerKey: command.learnerKey,
          attemptKey: command.attemptKey,
          questionKey: question.key,
          isCorrect: evaluation.verdict === 'CORRECT',
          secondsToAnswer: command.timeSpentSeconds ?? null,
          difficulty: difficultyFromLogit(question.irt.b),
        });
      } catch {
        // XP is motivation, not measurement. A learner must never lose a
        // graded answer because the points failed to post; the ledger is
        // idempotent, so a lost award can be replayed without double paying.
      }
    }

    return Ok({
      evaluation,
      evidence,
      feedback: {
        verdict: evaluation.verdict,
        explanation: evaluation.verdict === 'CORRECT' ? null : (question.hint ?? null),
        misconceptionKey: misconceptionKey ?? null,
      },
    });
  }

  /**
   * Distractor-driven diagnosis: a well-authored wrong option tells you WHY the
   * learner is wrong, which is worth far more than the fact that they are.
   */
  private diagnoseMisconception(
    question: { choices: readonly { id: string; misconceptionKey?: string }[] },
    answer: SubmittedAnswer,
    evaluation: Evaluation,
  ): string | undefined {
    if (evaluation.verdict !== 'INCORRECT' && evaluation.verdict !== 'PARTIALLY_CORRECT') {
      return undefined;
    }
    for (const id of answer.choiceIds ?? []) {
      const choice = question.choices.find((c) => c.id === id);
      if (choice?.misconceptionKey) return choice.misconceptionKey;
    }
    return undefined;
  }
}

function sameSubmittedAnswer(
  stored: Readonly<Record<string, unknown>>,
  replayed: SubmittedAnswer,
): boolean {
  const storedChoices = Array.isArray(stored.choiceIds)
    ? stored.choiceIds.map(String).sort()
    : [];
  const replayedChoices = [...(replayed.choiceIds ?? [])].map(String).sort();
  if (storedChoices.join('\u0000') !== replayedChoices.join('\u0000')) return false;

  const storedText = typeof stored.text === 'string' ? stored.text : undefined;
  if ((replayed.text ?? undefined) !== storedText) return false;

  const storedNumeric = typeof stored.numeric === 'number' ? stored.numeric : undefined;
  if ((replayed.numeric ?? undefined) !== storedNumeric) return false;

  const storedOrder = Array.isArray(stored.order) ? stored.order.map(String).join('\u0000') : '';
  const replayedOrder = (replayed.order ?? []).map(String).join('\u0000');
  if (storedOrder !== replayedOrder) return false;

  const storedPairs = stableRecordString(stored.pairs);
  const replayedPairs = stableRecordString(replayed.pairs);
  return storedPairs === replayedPairs;
}

function stableRecordString(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  return Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, raw]) => `${key}:${String(raw)}`)
    .join('\u0000');
}

/**
 * Map an IRT difficulty (`b`, a logit roughly in −3..+3) onto the 0..1 scale
 * the XP formula expects.
 *
 * Legacy passed `itemDifficulty` straight through from a field that was already
 * 0..1 on the question row, so a port that reused `b` unchanged would silently
 * pay 15 XP for everything below average and 20 for everything above — the
 * formula would still "work", and the reward would stop tracking difficulty.
 */
function difficultyFromLogit(b: number): number {
  if (!Number.isFinite(b)) return 0.5;
  return Math.max(0, Math.min(1, (b + 3) / 6));
}
