/**
 * Bayesian Knowledge Tracing — the canonical mastery estimator.
 *
 * PURE. No I/O, no Prisma, no Date.now(). Every input is an argument, every
 * output is a value. This is what makes mastery reproducible: given the same
 * ordered observations you get the same posterior, in a test, in a migration
 * backfill, or in production.
 *
 * Model (Corbett & Anderson, 1995), four parameters:
 *   pL0 — prior probability the learner already knows the skill
 *   pT  — probability of learning it at each opportunity (transition)
 *   pS  — slip:  knows it, answers wrong
 *   pG  — guess: doesn't know it, answers right
 */

export interface BktParameters {
  readonly pL0: number;
  readonly pT: number;
  readonly pS: number;
  readonly pG: number;
}

export const DEFAULT_BKT_PARAMETERS: BktParameters = Object.freeze({
  pL0: 0.1,
  pT: 0.15,
  pS: 0.1,
  pG: 0.25,
});

/** Probability floor/ceiling — keeps the recursion numerically stable forever. */
const EPS = 1e-4;
const clamp01 = (p: number): number => Math.min(1 - EPS, Math.max(EPS, p));

export interface BktStep {
  /** P(knows | this observation) — belief AFTER seeing the answer. */
  readonly posterior: number;
  /** P(knows) carried into the NEXT opportunity, after the learning transition. */
  readonly nextPrior: number;
}

/**
 * One Bayesian update.
 *
 *   correct:   P(L|C) = P(L)(1-pS) / [ P(L)(1-pS) + (1-P(L))pG ]
 *   incorrect: P(L|I) = P(L)pS     / [ P(L)pS     + (1-P(L))(1-pG) ]
 *   then:      P(L') = P(L|obs) + (1 - P(L|obs)) * pT
 */
export function bktUpdate(
  prior: number,
  isCorrect: boolean,
  params: BktParameters = DEFAULT_BKT_PARAMETERS,
): BktStep {
  const p = clamp01(prior);
  const { pS, pG, pT } = params;

  const numerator = isCorrect ? p * (1 - pS) : p * pS;
  const denominator = isCorrect
    ? numerator + (1 - p) * pG
    : numerator + (1 - p) * (1 - pG);

  const posterior = clamp01(denominator > 0 ? numerator / denominator : p);
  const nextPrior = clamp01(posterior + (1 - posterior) * pT);

  return { posterior, nextPrior };
}

export interface BktObservation {
  readonly isCorrect: boolean;
  /**
   * Evidence weight in [0,1]. A three-mark structured question carries more
   * signal than a two-option true/false. Weight 0 means "observed but carries
   * no mastery signal" (e.g. an ungradable answer) and leaves belief unchanged.
   */
  readonly weight?: number;
}

export interface BktTrace {
  readonly finalPosterior: number;
  readonly nextPrior: number;
  readonly observationCount: number;
  /** Posterior after each observation, in order. For explainability UIs. */
  readonly trajectory: readonly number[];
}

/**
 * Replay an ORDERED observation sequence.
 *
 * Order matters: BKT is a recursive filter, so shuffling the same answers
 * yields a different belief. Callers must pass observations sorted by the time
 * the learner actually answered — this is the single most common source of
 * mastery drift in learning platforms.
 */
export function bktReplay(
  observations: readonly BktObservation[],
  params: BktParameters = DEFAULT_BKT_PARAMETERS,
  initialPrior: number = params.pL0,
): BktTrace {
  let prior = clamp01(initialPrior);
  let posterior = clamp01(initialPrior);
  const trajectory: number[] = [];

  for (const obs of observations) {
    const weight = obs.weight ?? 1;

    // Zero weight means "we saw an answer but it tells us nothing about
    // mastery" — an ungradable response, or an essay awaiting a teacher. It
    // must leave belief COMPLETELY untouched: no Bayesian update, and no
    // learning transition either. Applying the transition here would let a
    // learner's mastery drift upward simply by submitting blank answers.
    if (weight <= 0) {
      trajectory.push(posterior);
      continue;
    }

    const step = bktUpdate(prior, obs.isCorrect, params);
    // Partial-credit blending: interpolate between "no evidence" and "full evidence".
    posterior = clamp01(prior + (step.posterior - prior) * Math.min(1, weight));
    trajectory.push(posterior);
    prior = clamp01(posterior + (1 - posterior) * params.pT);
  }

  const finalPosterior = trajectory.length > 0 ? trajectory[trajectory.length - 1]! : clamp01(initialPrior);

  return {
    finalPosterior,
    nextPrior: prior,
    observationCount: observations.length,
    trajectory,
  };
}

/**
 * Confidence in the estimate itself — distinct from the estimate.
 *
 * A learner at 0.85 after 2 questions and one at 0.85 after 20 are not the
 * same situation. Confidence grows with evidence count and saturates; the UI
 * uses it to decide whether to say "mastered" or "looks mastered so far".
 */
export function estimateConfidence(observationCount: number): number {
  if (observationCount <= 0) return 0;
  return Number((1 - Math.exp(-observationCount / 5)).toFixed(4));
}
