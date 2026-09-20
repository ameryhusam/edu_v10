/**
 * Completion policy — may the learner move on?
 *
 * Reconstructed from the legacy LD-4 service, which was the single best piece
 * of pedagogy in the old codebase. Two things are preserved deliberately:
 *
 *  1. Gates are ORDERED and each returns a named reason. "Blocked" is never a
 *     bare boolean — a learner (or a parent) is always told which requirement
 *     is outstanding.
 *
 *  2. Mastery gates ONLY when the activity actually requires assessment. The
 *     legacy comment on this is worth keeping: a default `minimumMastery` on an
 *     ordinary reading task must not silently become a mandatory exam. Without
 *     this rule every task inherits an assessment gate by accident.
 *
 * Two corrections to the legacy version:
 *
 *  - It is a pure function, not a service holding Prisma. Evidence comes in as
 *    a value; nothing is loaded here.
 *  - Reason text is no longer Arabic UI copy embedded in the rule. The domain
 *    returns a stable `gate` code; the interface layer renders it in the
 *    learner's language. A rule that hardcodes one language cannot serve a
 *    bilingual product, and a translated string is not a business decision.
 */

/** What the learner may do next. */
export type CompletionDecision = 'ALLOW_NEXT' | 'REVIEW' | 'REMEDIAL';

/**
 * Which requirement is outstanding. Stable codes — safe to translate, log,
 * and compare across releases.
 */
export type CompletionGate =
  | 'NONE'
  | 'NOT_ATTEMPTED'
  | 'ASSESSMENT_REQUIRED'
  | 'CONTENT_REQUIRED'
  | 'PRACTICE_REQUIRED'
  | 'MASTERY_BELOW_THRESHOLD';

export interface CompletionEvidence {
  /** Does this activity gate on assessment at all? */
  readonly requiresAssessment: boolean;
  /** Mastery required to pass, when assessment is required. */
  readonly minimumMastery: number;
  /** Effective (decay-adjusted) mastery. Null when never measured. */
  readonly masteryAchieved?: number | null;
  readonly assessmentPassed?: boolean | null;
  readonly contentConsumed?: boolean | null;
  readonly practiceDone?: boolean | null;
  readonly attempted?: boolean | null;
}

export interface CompletionResult {
  readonly decision: CompletionDecision;
  readonly gate: CompletionGate;
  readonly allowedNext: boolean;
  readonly threshold: number;
  readonly mastery: number;
  /** How far below the threshold, 0 when met. Sizes the remediation. */
  readonly masteryDeficit: number;
}

const DEFAULT_MINIMUM_MASTERY = 0.7;

const clamp01 = (n: number): number =>
  Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;

const round4 = (n: number): number => Math.round(n * 10_000) / 10_000;

/**
 * Evaluate the gates in order and return the first unmet one.
 *
 * Order is pedagogical, not arbitrary: attempt before assessment (you cannot
 * pass what you never took), content before practice (you cannot practise what
 * you never read), and mastery last because it is the only gate that leads to
 * remediation rather than a simple "go back".
 */
export function evaluateCompletion(evidence: CompletionEvidence): CompletionResult {
  const threshold = clamp01(evidence.minimumMastery ?? DEFAULT_MINIMUM_MASTERY);
  const mastery = clamp01(evidence.masteryAchieved ?? 0);
  const masteryDeficit = round4(Math.max(0, threshold - mastery));

  const blocked = (decision: CompletionDecision, gate: CompletionGate): CompletionResult => ({
    decision,
    gate,
    allowedNext: false,
    threshold,
    mastery,
    masteryDeficit,
  });

  if (evidence.requiresAssessment && evidence.attempted === false) {
    return blocked('REVIEW', 'NOT_ATTEMPTED');
  }

  if (evidence.requiresAssessment && evidence.assessmentPassed !== true) {
    return blocked('REVIEW', 'ASSESSMENT_REQUIRED');
  }

  if (evidence.contentConsumed === false) {
    return blocked('REVIEW', 'CONTENT_REQUIRED');
  }

  if (evidence.practiceDone === false) {
    return blocked('REVIEW', 'PRACTICE_REQUIRED');
  }

  // Mastery is the only gate that routes to REMEDIAL: the learner did the work
  // but has not understood it, which needs support rather than repetition.
  if (evidence.requiresAssessment && mastery < threshold) {
    return blocked('REMEDIAL', 'MASTERY_BELOW_THRESHOLD');
  }

  return {
    decision: 'ALLOW_NEXT',
    gate: 'NONE',
    allowedNext: true,
    threshold,
    mastery,
    // A non-assessment task reports no deficit: there was no bar to fall short of.
    masteryDeficit: evidence.requiresAssessment ? 0 : masteryDeficit,
  };
}
