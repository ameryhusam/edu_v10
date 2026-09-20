/**
 * Cohort and exam analytics — every number is computed on the backend.
 */

import { api } from '../../shared/api/client';

export interface CohortDistribution {
  readonly assessed: number;
  readonly unassessed: number;
  readonly bands: {
    readonly struggling: number;
    readonly developing: number;
    readonly approaching: number;
    readonly mastered: number;
  };
}

export interface CohortActivity {
  readonly totalLearners: number;
  readonly activeLearners: number;
  readonly activeShare: number;
  readonly totalAttempts: number;
}

export interface CohortReport {
  readonly learners: number;
  readonly distribution: CohortDistribution;
  readonly activity: CohortActivity;
}

export interface ScoreBand { readonly label: string; readonly count: number }

export interface SittingRow {
  readonly learnerKey: string;
  readonly attemptKey: string;
  readonly status: 'IN_PROGRESS' | 'SUBMITTED';
  readonly score: number | null;
  readonly maxScore: number | null;
  readonly percentage: number | null;
  readonly awaitingReview: boolean;
  readonly submittedAt: string | null;
}

export interface ItemOutcomeRow {
  readonly questionKey: string;
  readonly orderIndex: number;
  readonly correct: number;
  readonly incorrect: number;
  readonly pending: number;
}

export interface ExamResults {
  readonly examKey: string;
  readonly title: string;
  readonly assigned: number;
  readonly submitted: number;
  readonly inProgress: number;
  readonly notStarted: number;
  readonly awaitingReview: number;
  readonly meanPercentage: number | null;
  readonly medianPercentage: number | null;
  readonly lowestPercentage: number | null;
  readonly highestPercentage: number | null;
  readonly distribution: readonly ScoreBand[];
  readonly sittings: readonly SittingRow[];
  readonly items: readonly ItemOutcomeRow[];
  readonly notStartedLearners: readonly string[];
}

export const analyticsApi = {
  /** A school-wide cohort report. Errors with `analytics.empty_cohort` when nobody is enrolled. */
  cohort: (scope: { schoolId: string; gradeId?: string; termId?: string }) =>
    api.get<CohortReport>('analytics/cohort', { query: scope }),
  examResults: (scope: { examKey: string; schoolId: string; gradeId?: string; termId?: string }) =>
    api.get<ExamResults>(`analytics/exams/${encodeURIComponent(scope.examKey)}/results`, {
      query: { schoolId: scope.schoolId, gradeId: scope.gradeId, termId: scope.termId },
    }),
};
