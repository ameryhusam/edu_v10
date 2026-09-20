/**
 * Staff manual grading client.
 *
 * Essay answers are deliberately not auto-scored. These calls expose the human
 * review queue and submit the final human-approved score back to Assessment.
 */

import { api } from '../../shared/api/client';

export interface ManualReviewQueueItem {
  readonly attemptKey: string;
  readonly attemptStatus: string;
  readonly learnerKey: string;
  readonly learnerName: string | null;
  readonly schoolId: string | null;
  readonly questionKey: string;
  readonly questionText: string;
  readonly rawAnswer: Readonly<Record<string, unknown>>;
  readonly answeredAt: string;
  readonly submittedAt: string | null;
  readonly scorePossible: number;
  readonly note: string | null;
}

export interface ManualReviewListPage {
  readonly rows: readonly ManualReviewQueueItem[];
  readonly total: number;
}

export const manualGradingApi = {
  list: (query: { learnerKey?: string; limit?: number; offset?: number } = {}) =>
    api.get<ManualReviewListPage>('assessment/manual-reviews', { query }),
  grade: (input: {
    attemptKey: string;
    questionKey: string;
    scoreEarned: number;
    feedback?: string | null;
  }) =>
    api.post<{ attemptKey: string; score: number; maxScore: number }>(
      `assessment/manual-reviews/${encodeURIComponent(input.attemptKey)}/${encodeURIComponent(
        input.questionKey,
      )}/grade`,
      { scoreEarned: input.scoreEarned, feedback: input.feedback ?? null },
    ),
};
