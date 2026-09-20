/**
 * Mastery as a bounded value object, not a loose float.
 *
 * Legacy pain this fixes: four different services each decided independently
 * what "mastered" meant. Here the threshold semantics live in ONE type, and
 * every consumer asks the type rather than re-deriving a comparison.
 */

export type MasteryBand = 'UNKNOWN' | 'STRUGGLING' | 'DEVELOPING' | 'PROFICIENT' | 'MASTERED';

/** Platform default. A concept may override it (`Concept.masteryThreshold`). */
export const DEFAULT_MASTERY_THRESHOLD = 0.85;

export interface MasterySnapshot {
  /** Belief the learner knows the concept, at `observedAt`, in [0,1]. */
  readonly value: number;
  /** Certainty about that belief, in [0,1]. Driven by evidence volume. */
  readonly confidence: number;
  /** Effective mastery today after forgetting. Equals `value` when fresh. */
  readonly effective: number;
  readonly band: MasteryBand;
  readonly isMastered: boolean;
}

export function bandFor(value: number, threshold: number): MasteryBand {
  if (value >= threshold) return 'MASTERED';
  if (value >= threshold * 0.8) return 'PROFICIENT';
  if (value >= threshold * 0.5) return 'DEVELOPING';
  if (value > 0) return 'STRUGGLING';
  return 'UNKNOWN';
}

export function snapshot(input: {
  value: number;
  confidence: number;
  effective?: number;
  threshold?: number;
}): MasterySnapshot {
  const threshold = input.threshold ?? DEFAULT_MASTERY_THRESHOLD;
  const value = Math.min(1, Math.max(0, input.value));
  const effective = Math.min(1, Math.max(0, input.effective ?? value));
  return {
    value,
    confidence: Math.min(1, Math.max(0, input.confidence)),
    effective,
    band: bandFor(effective, threshold),
    isMastered: effective >= threshold,
  };
}

export const UNKNOWN_MASTERY: MasterySnapshot = Object.freeze({
  value: 0,
  confidence: 0,
  effective: 0,
  band: 'UNKNOWN' as const,
  isMastered: false,
});
