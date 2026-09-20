/**
 * StartAttempt — open an attempt for a learner.
 *
 * Deliberately small, because the interesting decisions belong elsewhere:
 *
 *  - It does not choose questions. For adaptive attempts the item is chosen
 *    per request by `RunAdaptiveExam`, from stored items; for fixed attempts
 *    the exam defines them. Freezing a question list here would break the
 *    device-independent resume guarantee.
 *  - It does not touch mastery. Opening an attempt is not evidence.
 *
 * Resuming is the default, not an error. A learner whose connection dropped
 * mid-quiz should return to the same attempt rather than silently start a
 * second one and split their evidence across two records.
 */

import type { Clock } from '../../../shared/kernel/clock.js';
import { Errors } from '../../../shared/kernel/errors.js';
import { Err, Ok, type Result } from '../../../shared/kernel/result.js';
import type { AttemptKind, AttemptRecord, AttemptRepository, LearnerExamCatalog } from './ports.js';

export interface StartAttemptCommand {
  readonly learnerKey: string;
  readonly kind: AttemptKind;
  readonly lessonKey?: string | null;
  readonly examKey?: string | null;
  /**
   * Reuse an open attempt with the same scope instead of opening another.
   * Defaults to true — see the resume note above.
   */
  readonly resumeExisting?: boolean;
}

export interface StartAttemptResult {
  readonly attempt: AttemptRecord;
  /** True when an existing in-progress attempt was returned unchanged. */
  readonly resumed: boolean;
}

export class StartAttemptUseCase {
  constructor(
    private readonly attempts: AttemptRepository,
    private readonly clock: Clock,
    private readonly examCatalog?: LearnerExamCatalog,
  ) {}

  async execute(command: StartAttemptCommand): Promise<Result<StartAttemptResult>> {
    const lessonKey = command.lessonKey ?? null;
    const examKey = command.examKey ?? null;

    if (lessonKey === null && examKey === null) {
      return Err(
        Errors.validation(
          'assessment.attempt_scope_required',
          'An attempt must target either a lesson or an exam.',
        ),
      );
    }
    if (lessonKey !== null && examKey !== null) {
      return Err(
        Errors.validation(
          'assessment.attempt_scope_ambiguous',
          'An attempt targets a lesson or an exam, never both.',
        ),
      );
    }

    if (examKey !== null && this.examCatalog) {
      const visibleExams = await this.examCatalog.examsFor(command.learnerKey);
      if (!visibleExams.some((exam) => exam.key === examKey)) {
        return Err(
          Errors.forbidden(
            'assessment.exam_not_available',
            'This exam is not available to this learner.',
            { examKey, learnerKey: command.learnerKey },
          ),
        );
      }
    }

    if (command.resumeExisting !== false) {
      const open = await this.attempts.findOpenByScope(command.learnerKey, { lessonKey, examKey });
      if (open) return Ok({ attempt: open, resumed: true });
    }

    const startedAt = this.clock.now();
    const attempt = await this.attempts.create({
      key: this.attempts.nextKey(),
      learnerKey: command.learnerKey,
      kind: command.kind,
      lessonKey,
      examKey,
      startedAt,
    });

    return Ok({ attempt, resumed: false });
  }
}
