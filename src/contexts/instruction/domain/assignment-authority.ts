/**
 * Who may assign what, and what an assignment is allowed to DO.
 *
 * The owner's ruling, 2026-09-12, made structural:
 *
 *   > PARENT assignments are advisory only. They may appear in the learner's
 *   > task feed and support parent–child accountability, but they must never
 *   > gate progression, count toward academic completion, alter mastery, emit
 *   > assessment evidence, or change prerequisite eligibility.
 *   >
 *   > The distinction must be enforced in the domain/application layer, not
 *   > merely hidden in the UI.
 *
 * Hence this file rather than a conditional in a React component. A parent task
 * is a real obligation — it is tracked, it is visible, a parent can see whether
 * it was done — but it carries no academic authority. The two ideas are
 * separated here so that no future caller can conflate "has outstanding work"
 * with "is academically behind".
 */

import type { AssignmentOrigin } from './plan.js';

/**
 * Origins whose obligations participate in academic gating and completion.
 *
 * An allow-list, not a deny-list: a new origin added later is advisory by
 * default and has to be argued into academic authority deliberately.
 */
const ACADEMIC_ORIGINS: ReadonlySet<AssignmentOrigin> = new Set([
  'TEACHER',
  'REMEDIAL',
  'ADAPTIVE',
]);

/**
 * May work from this origin gate progression or count toward completion?
 *
 * `SELF` is advisory too: a learner setting their own homework must not be able
 * to manufacture an academic record, for the same reason they cannot mark their
 * own mastery.
 */
export function hasAcademicAuthority(origin: AssignmentOrigin): boolean {
  return ACADEMIC_ORIGINS.has(origin);
}

/** Advisory work is tracked and shown, but never counted. */
export function isAdvisoryOnly(origin: AssignmentOrigin): boolean {
  return !hasAcademicAuthority(origin);
}

export interface AuthorityRefusal {
  readonly code: string;
  readonly reason: string;
}

/**
 * Guard for anything that would give advisory work academic consequences.
 *
 * Returns a named refusal rather than a boolean so the caller reports *why*,
 * and so the rule reads the same at every call site.
 */
export function checkAcademicAuthority(
  origin: AssignmentOrigin,
): { ok: true } | { ok: false; refusal: AuthorityRefusal } {
  if (hasAcademicAuthority(origin)) return { ok: true };
  return {
    ok: false,
    refusal: {
      code: 'instruction.advisory_origin',
      reason:
        `Work of origin ${origin} is advisory: it is tracked and visible, but it ` +
        'cannot gate progression or count toward academic completion.',
    },
  };
}

/**
 * Split obligations into the ones that count and the ones that merely exist.
 *
 * Used wherever a completion figure is produced. Counting advisory work into a
 * completion rate is the specific mistake this function exists to prevent: a
 * parent who sets five tasks would otherwise make their child's academic
 * progress appear to collapse.
 */
export function partitionByAuthority<T extends { origin: AssignmentOrigin }>(
  obligations: readonly T[],
): { academic: T[]; advisory: T[] } {
  const academic: T[] = [];
  const advisory: T[] = [];
  for (const obligation of obligations) {
    if (hasAcademicAuthority(obligation.origin)) academic.push(obligation);
    else advisory.push(obligation);
  }
  return { academic, advisory };
}
