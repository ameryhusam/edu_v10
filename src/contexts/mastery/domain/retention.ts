/**
 * Forgetting and review scheduling.
 *
 * BKT tells you what the learner knew at the moment they answered. It says
 * nothing about last month. Retention modelling closes that gap, and it is why
 * mastery must always be read as "mastery AS OF a date", never as a bare number
 * sitting in a column.
 *
 * PURE. Time enters only as an explicit `daysElapsed` argument.
 */

export interface RetentionState {
  /** Mastery at the moment of the last observation, in [0,1]. */
  readonly masteryAtObservation: number;
  /** Memory stability in days — how slowly this memory decays. Grows with review. */
  readonly stabilityDays: number;
}

export interface RetentionResult {
  /** Retrievability R(t) in [0,1] — probability of successful recall right now. */
  readonly retrievability: number;
  /** Mastery discounted by forgetting — what the learner can actually do today. */
  readonly effectiveMastery: number;
  readonly needsReview: boolean;
}

/** Below this retrievability we schedule a review before new material. */
export const REVIEW_THRESHOLD = 0.7;

/** Ebbinghaus exponential decay: R(t) = e^(-t/S). */
export function retrievability(daysElapsed: number, stabilityDays: number): number {
  if (daysElapsed <= 0) return 1;
  const s = Math.max(0.1, stabilityDays);
  return Number(Math.exp(-daysElapsed / s).toFixed(6));
}

export function applyDecay(state: RetentionState, daysElapsed: number): RetentionResult {
  const r = retrievability(daysElapsed, state.stabilityDays);
  return {
    retrievability: r,
    effectiveMastery: Number((state.masteryAtObservation * r).toFixed(6)),
    needsReview: r < REVIEW_THRESHOLD,
  };
}

/**
 * Stability growth after a successful review (SM-2 family, simplified).
 *
 * A correct recall of a *weak* memory teaches you more than a correct recall of
 * something already solid, so growth is scaled by how close to forgetting the
 * item was. A failed recall resets stability rather than zeroing mastery —
 * the learner has not un-learned, they have lost access.
 */
export function nextStability(
  currentStability: number,
  recallSucceeded: boolean,
  retrievabilityAtReview: number,
): number {
  const s = Math.max(0.1, currentStability);
  if (!recallSucceeded) {
    return Number(Math.max(0.5, s * 0.4).toFixed(4));
  }
  const difficultyBonus = 1 + (1 - retrievabilityAtReview);
  return Number(Math.min(365, s * (1 + 0.6 * difficultyBonus)).toFixed(4));
}

/** Days until retrievability falls to the review threshold: t = -S * ln(threshold). */
export function daysUntilReview(
  stabilityDays: number,
  threshold: number = REVIEW_THRESHOLD,
): number {
  const s = Math.max(0.1, stabilityDays);
  return Number((-s * Math.log(threshold)).toFixed(2));
}
