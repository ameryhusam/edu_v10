/**
 * Instructional plans — PURE.
 *
 * A plan is the authored intent: one act of assigning, however many learners
 * it reaches. Its lifecycle is deliberately much smaller than a textbook's,
 * because a plan is not content — nobody reviews it, and it has no readership
 * beyond the cohort it names.
 *
 *     DRAFT ──publish──> PUBLISHED ──cancel──> CANCELLED
 *       └────────────────cancel───────────────────┘
 *
 * Publishing is the moment obligations materialise. Cancelling a published
 * plan does NOT delete them: a learner who already did the work has produced
 * real evidence, and deleting the obligation would make that work
 * unattributable.
 */

export const PLAN_STATUSES = ['DRAFT', 'PUBLISHED', 'CANCELLED'] as const;

export type PlanStatus = (typeof PLAN_STATUSES)[number];

export const PLAN_ACTIONS = ['PUBLISH', 'CANCEL'] as const;

export type PlanAction = (typeof PLAN_ACTIONS)[number];

export const INSTRUCTIONAL_ACTIVITY_TYPES = [
  'LESSON',
  'CONCEPT',
  'EXAM',
  'REVIEW_SET',
  'REMEDIATION_PLAN',
] as const;

export type InstructionalActivityType = (typeof INSTRUCTIONAL_ACTIVITY_TYPES)[number];

export const ASSIGNMENT_ORIGINS = ['TEACHER', 'PARENT', 'REMEDIAL', 'ADAPTIVE', 'SELF'] as const;

export type AssignmentOrigin = (typeof ASSIGNMENT_ORIGINS)[number];

export function isInstructionalActivityType(v: string): v is InstructionalActivityType {
  return (INSTRUCTIONAL_ACTIVITY_TYPES as readonly string[]).includes(v);
}

export function isAssignmentOrigin(v: string): v is AssignmentOrigin {
  return (ASSIGNMENT_ORIGINS as readonly string[]).includes(v);
}

export type PlanTransition =
  | { readonly allowed: true; readonly to: PlanStatus; readonly materialises: boolean }
  | { readonly allowed: false; readonly code: string; readonly reason: string };

/**
 * May this action be applied to a plan in `from`?
 *
 * There is no un-publish. Withdrawing an assignment learners can already see
 * is `CANCEL`, which is honest about the fact that it happened; silently
 * reverting to DRAFT would make an assignment disappear from a learner's list
 * with no record it ever existed.
 */
export function checkPlanTransition(from: PlanStatus, action: PlanAction): PlanTransition {
  if (action === 'PUBLISH') {
    if (from === 'DRAFT') return { allowed: true, to: 'PUBLISHED', materialises: true };
    if (from === 'PUBLISHED') {
      return {
        allowed: false,
        code: 'instruction.already_published',
        reason: 'This plan is already published. Re-materialise it instead to pick up new learners.',
      };
    }
    return {
      allowed: false,
      code: 'instruction.cancelled_cannot_publish',
      reason: 'A cancelled plan cannot be published. Create a new plan.',
    };
  }

  if (from === 'CANCELLED') {
    return {
      allowed: false,
      code: 'instruction.already_cancelled',
      reason: 'This plan is already cancelled.',
    };
  }
  return { allowed: true, to: 'CANCELLED', materialises: false };
}

/** A plan may only be edited before anyone has been told about it. */
export function isPlanEditable(status: PlanStatus): boolean {
  return status === 'DRAFT';
}

/**
 * The cohort a plan targets.
 *
 * Not a class id. A class is a query over Enrollment, not an entity — it fails
 * all three entity tests, and legacy reached the same conclusion, returning
 * `class_name: null` at six call sites. See CLASS-ROSTER-INVESTIGATION.md.
 */
export interface PlanScope {
  readonly schoolId: string;
  readonly gradeId: string | null;
  readonly termId: string | null;
}

export interface ScopeRefusal {
  readonly code: string;
  readonly reason: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

/**
 * Is the referenced activity inside the plan's scope?
 *
 * Legacy rule LD-2, kept verbatim in spirit: a named refusal BEFORE any write,
 * never a half-applied materialisation. A lesson from another textbook, or an
 * exam for a different grade, is refused here rather than discovered by a
 * learner who cannot open it.
 *
 * The activity's own textbook is resolved by the caller (it belongs to
 * Content), so this stays pure and testable.
 */
export function checkActivityInScope(input: {
  activityType: InstructionalActivityType;
  activityKey: string;
  /** Grade the activity's textbook belongs to, if the activity is content. */
  activityGradeId: string | null;
  scope: PlanScope;
}): ScopeRefusal | null {
  if (!input.activityKey.trim()) {
    return {
      code: 'instruction.activity_key_required',
      reason: 'An assignment must name the activity it requires.',
    };
  }

  // A plan with no grade targets the whole school, so any grade is in scope.
  if (input.scope.gradeId == null || input.activityGradeId == null) return null;

  if (input.activityGradeId !== input.scope.gradeId) {
    return {
      code: 'instruction.activity_out_of_scope',
      reason:
        'This activity belongs to a different grade than the plan targets. Learners in this cohort could not open it.',
      details: {
        activityKey: input.activityKey,
        activityGradeId: input.activityGradeId,
        scopeGradeId: input.scope.gradeId,
      },
    };
  }
  return null;
}

/**
 * Is the assignment window coherent?
 *
 * A due date before the release date would create an obligation that is
 * overdue the instant a learner can first see it.
 */
export function checkWindow(availableAt: Date | null, dueAt: Date | null): ScopeRefusal | null {
  if (availableAt && dueAt && dueAt.getTime() < availableAt.getTime()) {
    return {
      code: 'instruction.window_inverted',
      reason: 'The due date is before the release date.',
      details: { availableAt: availableAt.toISOString(), dueAt: dueAt.toISOString() },
    };
  }
  return null;
}

/**
 * Which learners must be given an obligation, and which already have one?
 *
 * Materialisation is a pure function of (plan, current roster) and is
 * idempotent by the `@@unique([planId, learnerId])` constraint. Re-running it
 * after a late enrolment adds exactly the missing learner — legacy never
 * handled that case at all.
 *
 * Learners are never REMOVED here. Someone who leaves the cohort keeps any
 * obligation they already had, because they may already have done the work and
 * that evidence must stay attributable.
 */
export function planMaterialisation(
  rosterLearnerKeys: readonly string[],
  existingLearnerKeys: readonly string[],
): { readonly toCreate: readonly string[]; readonly alreadyPresent: readonly string[] } {
  const existing = new Set(existingLearnerKeys);
  const seen = new Set<string>();
  const toCreate: string[] = [];
  const alreadyPresent: string[] = [];

  for (const key of rosterLearnerKeys) {
    // A roster returning the same learner twice must not create two rows.
    if (seen.has(key)) continue;
    seen.add(key);
    (existing.has(key) ? alreadyPresent : toCreate).push(key);
  }

  return { toCreate, alreadyPresent };
}
