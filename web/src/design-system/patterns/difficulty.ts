/**
 * The one place that turns an authored difficulty (0..1) into a tier.
 *
 * Thresholds match `exam-builder-utils.ts`'s `summarizeQuestions()`, which
 * pre-dates this file: a question sitting at 0.5 must never read as "easy" on
 * a bar and "medium" in a stats ribbon two components apart.
 */
export type DifficultyTier = 'easy' | 'medium' | 'hard';

export function difficultyTier(difficulty01: number): DifficultyTier {
  if (difficulty01 < 0.34) return 'easy';
  if (difficulty01 > 0.66) return 'hard';
  return 'medium';
}
