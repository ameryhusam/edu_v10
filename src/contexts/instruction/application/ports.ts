/**
 * Ports owned by the Instruction context.
 *
 * Instruction is a COMMITMENT context. It owns who was asked to do what, and
 * nothing else: every port that touches achievement is read-only, and there is
 * no port at all for writing mastery, evidence or scores. The absence is the
 * enforcement, the same way Learning's read-only content ports are.
 */

import type { CompletionResult } from '../../learning/domain/completion-policy.js';
import type { ObligationStatus } from '../domain/obligation.js';
import type {
  AssignmentOrigin,
  InstructionalActivityType,
  PlanScope,
  PlanStatus,
} from '../domain/plan.js';

export interface PlanRecord {
  readonly key: string;
  readonly title: string;
  readonly instructions: string | null;
  readonly origin: AssignmentOrigin;
  readonly activityType: InstructionalActivityType;
  readonly activityKey: string;
  readonly scope: PlanScope;
  readonly status: PlanStatus;
  /** Null for cohort plans; set for a plan deliberately materialised to one learner. */
  readonly targetLearnerKey: string | null;
  readonly availableAt: Date | null;
  readonly dueAt: Date | null;
  readonly assignedByKey: string | null;
}

export interface ObligationRecord {
  readonly key: string;
  readonly planKey: string;
  readonly learnerKey: string;
  readonly status: ObligationStatus;
  readonly blockedByGate: string | null;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
  readonly waivedAt: Date | null;
  readonly waiverReason: string | null;
}

export interface PlanRepository {
  findPlan(key: string): Promise<PlanRecord | null>;

  createPlan(input: {
    key: string;
    title: string;
    instructions: string | null;
    origin: AssignmentOrigin;
    activityType: InstructionalActivityType;
    activityKey: string;
    scope: PlanScope;
    targetLearnerKey?: string | null;
    availableAt: Date | null;
    dueAt: Date | null;
    assignedByUserKey: string | null;
  }): Promise<PlanRecord>;

  updatePlan(key: string, fields: Readonly<Record<string, unknown>>): Promise<void>;

  setPlanStatus(key: string, status: PlanStatus, publishedAt?: Date): Promise<void>;

  /** Obligation learner keys already materialised for a plan. */
  obligationLearnerKeys(planKey: string): Promise<string[]>;

  createObligations(
    planKey: string,
    entries: ReadonlyArray<{ learnerKey: string; key: string }>,
  ): Promise<number>;

  findObligation(key: string): Promise<ObligationRecord | null>;

  obligationsForPlan(planKey: string): Promise<ObligationRecord[]>;

  obligationsForLearner(
    learnerKey: string,
    options?: { readonly includeInactive?: boolean },
  ): Promise<Array<ObligationRecord & { plan: PlanRecord }>>;

  /** Persist a derived status. Never accepts a score or mastery value. */
  updateObligationStatus(
    key: string,
    update: {
      status: ObligationStatus;
      blockedByGate: string | null;
      evaluatedAt: Date;
      startedAt?: Date | null;
      completedAt?: Date | null;
    },
  ): Promise<void>;

  waiveObligation(
    key: string,
    waiver: { waivedByUserKey: string; waivedAt: Date; reason: string },
  ): Promise<void>;

  /**
   * Clear a waiver so the obligation returns to evidence-derived status.
   *
   * Deliberately does not take a status: reopening withdraws a human assertion,
   * it does not make a new one. What the obligation becomes afterwards is
   * recomputed from the completion policy like any other row.
   */
  reopenObligation(key: string): Promise<void>;
}

/**
 * Resolves a cohort to learners.
 *
 * This is the "class is a query" decision made concrete: there is no roster
 * entity to read, only a scoped query over Enrollment. Identity stays frozen —
 * it answers who an actor is, not which learners a scope contains.
 */
export interface RosterReader {
  learnersInScope(scope: PlanScope): Promise<string[]>;
  /** School a learner is currently enrolled in — used to block cross-school reach. */
  schoolOfLearner(learnerKey: string): Promise<string | null>;
  /** Current enrolment coordinates for safe one-learner assignments. */
  currentEnrollmentOfLearner(
    learnerKey: string,
  ): Promise<{ schoolId: string; gradeId: string | null; termId: string | null } | null>;
}

/**
 * Read-only window into the activity being assigned.
 *
 * Instruction must never load question text or answer keys; it needs only
 * enough to refuse an out-of-scope assignment before writing (LD-2).
 */
export interface ActivityReader {
  describe(
    activityType: InstructionalActivityType,
    activityKey: string,
  ): Promise<{ exists: boolean; gradeId: string | null; title: string | null }>;
}

/**
 * Read-only window into whether the work is done.
 *
 * Returns the completion policy's verdict. Instruction cannot compute one and
 * cannot be handed a raw mastery number — the type makes the legacy mistake
 * (`PATCH {masteryAchieved}`) unrepresentable.
 */
export interface CompletionReader {
  evaluate(
    learnerKey: string,
    activityType: InstructionalActivityType,
    activityKey: string,
  ): Promise<{ completion: CompletionResult | null; started: boolean }>;
}
