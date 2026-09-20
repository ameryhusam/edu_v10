/**
 * Obligation status — PURE.
 *
 * The gate's central rule (ASSIGNMENT-GATE.md §2, case 5):
 *
 *     An assignment records that something was ASKED.
 *     It never records how well it was DONE.
 *
 * So this module computes status but owns no pedagogy. "Has the learner done
 * enough?" is answered by Learning's completion policy, which is passed in
 * already evaluated. What is decided here is only the *commitment* view of
 * that verdict: not started, under way, met, missed, or excused.
 *
 * Legacy stored `masteryAchieved` on the assignment row and let a teacher PATCH
 * it (learning-plans.controller.ts:524). Nothing here accepts an achievement
 * value, which is why `deriveStatus` takes a CompletionResult rather than a
 * number a caller could invent.
 */

import type { CompletionResult } from '../../learning/domain/completion-policy.js';

export const OBLIGATION_STATUSES = [
  'PENDING',
  'IN_PROGRESS',
  'COMPLETED',
  'EXPIRED',
  'WAIVED',
] as const;

export type ObligationStatus = (typeof OBLIGATION_STATUSES)[number];

export function isObligationStatus(value: string): value is ObligationStatus {
  return (OBLIGATION_STATUSES as readonly string[]).includes(value);
}

/** Everything needed to decide a status, and nothing that could assert one. */
export interface ObligationEvidence {
  /** A human excused this learner. Terminal and asserted, never derived. */
  readonly waived: boolean;
  /** Any observed activity — an attempt started, content opened. */
  readonly started: boolean;
  /** The completion policy's verdict, or null when it could not be evaluated. */
  readonly completion: CompletionResult | null;
  readonly dueAt: Date | null;
  readonly now: Date;
}

export interface ObligationVerdict {
  readonly status: ObligationStatus;
  /** The completion gate blocking it, for explainability. */
  readonly blockedByGate: string | null;
  /** Why this status, in words a teacher can read. */
  readonly rationale: string;
}

/**
 * Decide an obligation's status from evidence.
 *
 * Order is deliberate and each step is a decision:
 *
 *  1. WAIVED wins over everything — a human said this learner is excused, and
 *     no later fact should quietly un-excuse them.
 *  2. COMPLETED beats EXPIRED. Work finished before the deadline stays
 *     complete forever; checking the clock first would silently expire
 *     finished work the moment the due date passed.
 *  3. EXPIRED only applies to unfinished work past its deadline.
 */
export function deriveStatus(evidence: ObligationEvidence): ObligationVerdict {
  if (evidence.waived) {
    return {
      status: 'WAIVED',
      blockedByGate: null,
      rationale: 'A teacher or administrator excused this learner from the work.',
    };
  }

  const completed = evidence.completion?.allowedNext === true;

  if (completed) {
    return {
      status: 'COMPLETED',
      blockedByGate: null,
      rationale: 'The completion policy allows the learner to move on.',
    };
  }

  const overdue = evidence.dueAt != null && evidence.now.getTime() > evidence.dueAt.getTime();
  const gate = evidence.completion?.gate ?? null;
  const blockedByGate = gate && gate !== 'NONE' ? gate : null;

  if (overdue) {
    return {
      status: 'EXPIRED',
      blockedByGate,
      rationale: blockedByGate
        ? `The due date passed with the work unfinished (${blockedByGate}).`
        : 'The due date passed with the work unfinished.',
    };
  }

  if (evidence.started) {
    return {
      status: 'IN_PROGRESS',
      blockedByGate,
      rationale: blockedByGate
        ? `The learner has begun; ${describeGate(blockedByGate)}`
        : 'The learner has begun this work.',
    };
  }

  return {
    status: 'PENDING',
    blockedByGate,
    rationale: 'The learner has not started this work.',
  };
}

/**
 * Which status changes may a human assert?
 *
 * Exactly one. Everything else is a function of evidence, so an endpoint that
 * accepted it would be inventing a fact — which is the legacy mistake this
 * whole context is shaped to prevent.
 */
export function isAssertableStatus(status: ObligationStatus): boolean {
  return status === 'WAIVED';
}

/**
 * Is a waiver allowed right now?
 *
 * Refused on already-completed work: "excusing" work the learner has finished
 * would erase a real achievement from the record and confuse any report built
 * on it.
 */
export function checkWaivable(current: ObligationStatus): { ok: true } | { ok: false; code: string; reason: string } {
  if (current === 'WAIVED') {
    return {
      ok: false,
      code: 'instruction.already_waived',
      reason: 'This obligation has already been waived.',
    };
  }
  if (current === 'COMPLETED') {
    return {
      ok: false,
      code: 'instruction.cannot_waive_completed',
      reason: 'This work is already complete; waiving it would erase the learner\'s achievement.',
    };
  }
  return { ok: true };
}

/**
 * Is reopening allowed right now?
 *
 * Reopen is the inverse of waive, and it is the ONLY way out of WAIVED: the
 * recompute loop deliberately skips waived rows so a human decision is never
 * silently undone by a nightly job. That safety property is exactly what makes
 * a mistaken waiver permanent without this, and a teacher who excuses the wrong
 * learner currently has no remedy at all.
 *
 * Note what reopening does NOT do. It clears the waiver and nothing else — the
 * status that follows is recomputed from evidence like any other obligation. It
 * cannot mark work done, cannot un-complete finished work, and writes no
 * mastery. It withdraws a human assertion; it does not make a new one.
 */
export function checkReopenable(
  current: ObligationStatus,
): { ok: true } | { ok: false; code: string; reason: string } {
  if (current !== 'WAIVED') {
    return {
      ok: false,
      code: 'instruction.not_waived',
      reason: 'Only a waived obligation can be reopened.',
    };
  }
  return { ok: true };
}

/** Human-readable gate explanations, so a teacher is not shown an enum. */
function describeGate(gate: string): string {
  switch (gate) {
    case 'NOT_ATTEMPTED':
      return 'the required assessment has not been attempted.';
    case 'ASSESSMENT_REQUIRED':
      return 'the required assessment has not been passed.';
    case 'CONTENT_REQUIRED':
      return 'the required content has not been studied.';
    case 'PRACTICE_REQUIRED':
      return 'the required practice is not done.';
    case 'MASTERY_BELOW_THRESHOLD':
      return 'mastery is still below the threshold — this needs support, not repetition.';
    default:
      return `it is blocked by ${gate}.`;
  }
}

/** Aggregate view of one plan, for the teacher's "how is the class doing?". */
export interface PlanProgress {
  readonly total: number;
  readonly pending: number;
  readonly inProgress: number;
  readonly completed: number;
  readonly expired: number;
  readonly waived: number;
  /**
   * Completion rate over learners who were actually expected to do the work:
   * waived learners are excluded from the denominator, because counting an
   * excused learner as a failure would misreport the class.
   */
  readonly completionRate: number;
}

export function summarisePlan(statuses: readonly ObligationStatus[]): PlanProgress {
  const count = (s: ObligationStatus) => statuses.filter((x) => x === s).length;

  const total = statuses.length;
  const waived = count('WAIVED');
  const completed = count('COMPLETED');
  const expected = total - waived;

  return {
    total,
    pending: count('PENDING'),
    inProgress: count('IN_PROGRESS'),
    completed,
    expired: count('EXPIRED'),
    waived,
    completionRate: expected > 0 ? round4(completed / expected) : 0,
  };
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
