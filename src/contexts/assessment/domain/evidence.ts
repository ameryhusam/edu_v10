/**
 * Evidence — the contract between Assessment and Mastery.
 *
 * This tiny type is the most important boundary in the platform. Assessment
 * knows how to grade; Mastery knows how to believe. They talk ONLY through an
 * ordered stream of Evidence. Consequences that fall out of that:
 *
 *  - Mastery never reads Attempt rows, so grading can be reworked freely.
 *  - Any future source (a game, an oral quiz, a teacher observation) can feed
 *    mastery by emitting Evidence, with no change to the estimator.
 *  - Ungradable and pending answers emit weight 0 — observed, but no signal.
 */

import type { Evaluation, Verdict } from './evaluation.js';

export interface Evidence {
  /** Canonical concept key this evidence speaks to. */
  readonly conceptKey: string;
  /** Canonical question key that produced it. */
  readonly questionKey: string;
  readonly isCorrect: boolean;
  /**
   * Mastery signal strength in [0,1]:
   *   0    = no signal (skipped, ungradable, awaiting manual review)
   *   0..1 = partial credit, or a weak link between question and concept
   *   1    = full, unambiguous signal
   */
  readonly weight: number;
  /** When the learner answered. Mastery MUST order by this, not by row id. */
  readonly observedAt: Date;
  readonly verdict: Verdict;
  /** Misconception implicated by the chosen distractor, when known. */
  readonly misconceptionKey?: string;
}

/** Verdicts that must never move a mastery belief. */
const NO_SIGNAL: ReadonlySet<Verdict> = new Set<Verdict>([
  'SKIPPED',
  'INVALID',
  'UNGRADABLE',
  'REQUIRES_MANUAL_REVIEW',
]);

export function evidenceWeight(evaluation: Evaluation, conceptLinkWeight = 1): number {
  if (NO_SIGNAL.has(evaluation.verdict)) return 0;
  const credit =
    evaluation.scoreEarned != null && evaluation.scorePossible > 0
      ? evaluation.scoreEarned / evaluation.scorePossible
      : evaluation.verdict === 'CORRECT'
        ? 1
        : 0;
  // Partial credit still carries FULL evidential weight — the strength of the
  // signal is about how much we learn, and a half-right answer is informative.
  // What partial credit changes is `isCorrect`, not `weight`.
  const strength = credit > 0 && credit < 1 ? 0.7 : 1;
  return Number((strength * Math.min(1, Math.max(0, conceptLinkWeight))).toFixed(4));
}

export function buildEvidence(input: {
  conceptKey: string;
  questionKey: string;
  evaluation: Evaluation;
  observedAt: Date;
  conceptLinkWeight?: number;
  misconceptionKey?: string;
}): Evidence {
  const { evaluation } = input;
  const credit =
    evaluation.scoreEarned != null && evaluation.scorePossible > 0
      ? evaluation.scoreEarned / evaluation.scorePossible
      : 0;

  return {
    conceptKey: input.conceptKey,
    questionKey: input.questionKey,
    isCorrect: credit >= 0.5 && !NO_SIGNAL.has(evaluation.verdict),
    weight: evidenceWeight(evaluation, input.conceptLinkWeight ?? 1),
    observedAt: input.observedAt,
    verdict: evaluation.verdict,
    ...(input.misconceptionKey ? { misconceptionKey: input.misconceptionKey } : {}),
  };
}

/** Chronological ordering. Mastery replay depends on this being applied. */
export function orderEvidence(evidence: readonly Evidence[]): Evidence[] {
  return [...evidence].sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime());
}

export function groupByConcept(evidence: readonly Evidence[]): Map<string, Evidence[]> {
  const out = new Map<string, Evidence[]>();
  for (const e of orderEvidence(evidence)) {
    const list = out.get(e.conceptKey);
    if (list) list.push(e);
    else out.set(e.conceptKey, [e]);
  }
  return out;
}
