/**
 * Teacher assignment client.
 *
 * A plan is an instruction commitment, not evidence. These calls create and
 * publish the obligation shell; completion is still read from backend evidence.
 */

import { api } from '../../shared/api/client';

export const INSTRUCTIONAL_ACTIVITY_TYPES = [
  'LESSON',
  'CONCEPT',
  'EXAM',
  'REVIEW_SET',
  'REMEDIATION_PLAN',
] as const;

export type InstructionalActivityType = (typeof INSTRUCTIONAL_ACTIVITY_TYPES)[number];
export type PlanStatus = 'DRAFT' | 'PUBLISHED' | 'CANCELLED';
export type PlanAction = 'PUBLISH' | 'CANCEL';
export type AssignmentOrigin = 'TEACHER' | 'PARENT' | 'REMEDIAL' | 'ADAPTIVE' | 'SELF';

export interface PlanRecord {
  readonly key: string;
  readonly title: string;
  readonly instructions: string | null;
  readonly origin: AssignmentOrigin;
  readonly activityType: InstructionalActivityType;
  readonly activityKey: string;
  readonly scope: {
    readonly schoolId: string;
    readonly gradeId: string | null;
    readonly termId: string | null;
  };
  readonly status: PlanStatus;
  readonly targetLearnerKey: string | null;
  readonly availableAt: string | null;
  readonly dueAt: string | null;
  readonly assignedByKey: string | null;
}

export interface CreatePlanInput {
  readonly title: string;
  readonly instructions?: string | null;
  readonly activityType: InstructionalActivityType;
  readonly activityKey: string;
  readonly scope: {
    readonly schoolId: string;
    readonly gradeId?: string | null;
    readonly termId?: string | null;
  };
  readonly targetLearnerKey?: string | null;
  readonly availableAt?: string | null;
  readonly dueAt?: string | null;
}

export const assignmentsApi = {
  createPlan: (input: CreatePlanInput) => api.post<PlanRecord>('instruction/plans', input),
  transition: (planKey: string, action: PlanAction) =>
    api.post<{ planKey: string; status: PlanStatus; obligationsCreated: number }>(
      `instruction/plans/${encodeURIComponent(planKey)}/transitions`,
      { action },
    ),
  materialise: (planKey: string) =>
    api.post<{ planKey: string; obligationsCreated: number }>(
      `instruction/plans/${encodeURIComponent(planKey)}/materialise`,
      {},
    ),
};
