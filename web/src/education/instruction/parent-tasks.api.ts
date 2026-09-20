import { api } from '../../shared/api/client';

export type InstructionalActivityType =
  | 'LESSON'
  | 'CONCEPT'
  | 'EXAM'
  | 'REVIEW_SET'
  | 'REMEDIATION_PLAN';

export interface ParentTaskRow {
  readonly obligationKey: string;
  readonly planKey: string;
  readonly title: string;
  readonly origin: string;
  readonly status: string;
  readonly dueAt: string | null;
  readonly setByThisParent: boolean;
  readonly countsTowardCompletion: boolean;
}

export interface ParentTasksResponse {
  readonly learnerKey: string;
  readonly tasks: readonly ParentTaskRow[];
  readonly academicSummary: { readonly total: number; readonly completed: number };
}

export interface CreateParentTaskInput {
  readonly learnerKey: string;
  readonly title: string;
  readonly instructions?: string | null;
  readonly activityType: InstructionalActivityType;
  readonly activityKey: string;
  readonly dueAt?: string | null;
}

export const parentTasksApi = {
  list: (learnerKey: string) =>
    api.get<ParentTasksResponse>('/instruction/parent-tasks', { query: { learnerKey } }),
  create: (input: CreateParentTaskInput) => api.post('/instruction/parent-tasks', input),
  cancel: (planKey: string) => api.post('/instruction/parent-tasks/cancel', { planKey }),
};
