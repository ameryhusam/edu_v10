/**
 * Item Response Theory (1PL/2PL/3PL) — item calibration and ability estimation.
 *
 * PURE. Where BKT tracks "does this learner know concept X", IRT places both
 * learners and items on one latent ability scale (theta), which is what makes
 * adaptive item selection possible.
 */

export interface ItemParameters {
  /** Stable item identity — the canonical question key. */
  readonly id: string;
  /** Discrimination `a`: how sharply the item separates ability levels. */
  readonly a: number;
  /** Difficulty `b`: ability level at which P(correct) is halfway up the curve. */
  readonly b: number;
  /** Guessing `c`: lower asymptote. 0.25 for 4-option MCQ, 0 for constructed response. */
  readonly c: number;
  /** Optional content grouping used for exposure/content balancing. */
  readonly domain?: string;
}

export interface ItemResponse {
  readonly itemId: string;
  readonly isCorrect: boolean;
}

/** Logistic-to-normal-ogive scaling constant. */
export const D = 1.702;

const clampTheta = (t: number): number => Math.min(4, Math.max(-4, t));

/** P(correct | theta) = c + (1 - c) / (1 + exp(-D·a·(theta - b))). */
export function probabilityCorrect(theta: number, item: ItemParameters): number {
  const z = Math.min(30, Math.max(-30, -D * item.a * (theta - item.b)));
  const p = item.c + (1 - item.c) / (1 + Math.exp(z));
  return Math.min(0.999999, Math.max(1e-6, p));
}

/**
 * Fisher information — how much this item tells you about ability at `theta`.
 * Peaks near b, which is why adaptive tests converge fast.
 */
export function itemInformation(theta: number, item: ItemParameters): number {
  const p = probabilityCorrect(theta, item);
  const q = 1 - p;
  if (p <= item.c) return 1e-6;
  const num = (D * item.a) ** 2 * q * (p - item.c) ** 2;
  const den = p * (1 - item.c) ** 2;
  return den > 0 ? num / den : 1e-6;
}

export function testInformation(theta: number, items: readonly ItemParameters[]): number {
  return items.reduce((sum, it) => sum + itemInformation(theta, it), 0);
}

/** SE(theta) = 1 / sqrt(I(theta)) — the stopping signal for adaptive tests. */
export function standardError(theta: number, items: readonly ItemParameters[]): number {
  const info = testInformation(theta, items);
  return info > 0 ? 1 / Math.sqrt(info) : Number.POSITIVE_INFINITY;
}

/**
 * Expected a posteriori (EAP) ability estimate over a standard-normal prior.
 *
 * EAP over MLE by default: MLE is undefined for all-correct or all-incorrect
 * response patterns, which happens constantly in short classroom quizzes.
 */
export function estimateThetaEAP(
  responses: readonly ItemResponse[],
  itemsById: ReadonlyMap<string, ItemParameters>,
  quadraturePoints = 41,
): { theta: number; standardError: number } {
  if (responses.length === 0) return { theta: 0, standardError: 1 };

  const min = -4;
  const max = 4;
  const step = (max - min) / (quadraturePoints - 1);

  let weightSum = 0;
  let thetaSum = 0;
  const posteriors: { node: number; w: number }[] = [];

  for (let i = 0; i < quadraturePoints; i++) {
    const node = min + i * step;
    const prior = Math.exp(-(node ** 2) / 2); // standard normal, constant dropped
    let likelihood = 1;

    for (const r of responses) {
      const item = itemsById.get(r.itemId);
      if (!item) continue;
      const p = probabilityCorrect(node, item);
      likelihood *= r.isCorrect ? p : 1 - p;
    }

    const w = prior * likelihood;
    posteriors.push({ node, w });
    weightSum += w;
    thetaSum += node * w;
  }

  if (weightSum <= 0) return { theta: 0, standardError: 1 };

  const theta = thetaSum / weightSum;
  const variance =
    posteriors.reduce((sum, { node, w }) => sum + w * (node - theta) ** 2, 0) / weightSum;

  return {
    theta: Number(clampTheta(theta).toFixed(4)),
    standardError: Number(Math.sqrt(Math.max(variance, 1e-6)).toFixed(4)),
  };
}

/** Map a [0,1] difficulty stored on a question onto the theta scale. */
export function difficultyToTheta(difficulty01: number): number {
  return Number((clampTheta((Math.min(1, Math.max(0, difficulty01)) - 0.5) * 6)).toFixed(4));
}

/** Inverse of {@link difficultyToTheta}. */
export function thetaToDifficulty(theta: number): number {
  return Number((Math.min(1, Math.max(0, clampTheta(theta) / 6 + 0.5))).toFixed(4));
}
