/**
 * Due-work client.
 *
 * The endpoint already separates academic obligations from advisory parent/self
 * tasks. This module preserves that split instead of returning one mixed list,
 * because the UI must never total advisory work into official completion.
 */

import { api } from '../../shared/api/client';

export type AssignmentOrigin = 'TEACHER' | 'PARENT' | 'REMEDIAL' | 'ADAPTIVE' | 'SELF';
export type ObligationStatus =
  | 'PENDING'
  | 'AVAILABLE'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'OVERDUE'
  | 'WAIVED'
  | 'EXPIRED';

export interface DueWorkItem {
  readonly obligationKey: string;
  readonly planKey: string;
  readonly title: string;
  readonly activityType: string;
  readonly activityKey: string;
  readonly origin: AssignmentOrigin;
  readonly status: ObligationStatus;
  readonly dueAt: string | null;
  readonly isOverdue: boolean;
  readonly daysOverdue: number | null;
  readonly countsTowardCompletion: boolean;
}

export interface DueWorkView {
  readonly learnerKey: string;
  readonly academic: readonly DueWorkItem[];
  readonly advisory: readonly DueWorkItem[];
  readonly summary: {
    readonly outstanding: number;
    readonly overdue: number;
    readonly overdueAcademic: number;
    readonly needsAttention: boolean;
  };
}

export const dueWorkApi = {
  forLearner: (scope: { learnerKey?: string } = {}) =>
    api.get<DueWorkView>('instruction/due-work', { query: scope }),
};
