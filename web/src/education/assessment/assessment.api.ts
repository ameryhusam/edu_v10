/**
 * The learner's own assessment history (gap G4).
 *
 * A read-only window. Starting and answering attempts is a different surface
 * with different authorization — history is delegable to a verified guardian
 * or to staff, acting never is — so it lives in its own module rather than
 * being bolted onto an attempt-taking client.
 */

import { api } from '../../shared/api/client';

/** Why the learner was answering. Drives how a result should be read. */
export type AttemptKind = 'PRACTICE' | 'LESSON_CHECK' | 'EXAM' | 'REVIEW' | 'DIAGNOSTIC';

/** `EXPIRED` is not `ABANDONED`: the clock ended it, not the learner. */
export type AttemptStatus = 'SUBMITTED' | 'ABANDONED' | 'EXPIRED';

export interface AttemptSummary {
  readonly key: string;
  readonly kind: AttemptKind;
  readonly status: AttemptStatus;
  readonly lessonKey: string | null;
  readonly examKey: string | null;
  /**
   * Null when the attempt ended without being graded. Null is "no result",
   * never zero — a learner who walked away did not score 0%.
   */
  readonly score: number | null;
  readonly maxScore: number | null;
  readonly correctCount: number | null;
  readonly incorrectCount: number | null;
  readonly startedAt: string;
  readonly submittedAt: string | null;
}

export const assessmentApi = {
  history: (scope: { learnerKey?: string; kind?: AttemptKind; limit?: number }) =>
    api.get<{ attempts: readonly AttemptSummary[] }>('assessment/attempts', { query: scope }),
};
