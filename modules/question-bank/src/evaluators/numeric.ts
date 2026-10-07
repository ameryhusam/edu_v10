import type { CanonicalQuestion } from '../canonical';
import type { EvaluationResult } from './index';

export function evaluateNumeric(question: CanonicalQuestion, value: number | null): EvaluationResult {
  if (!question.answerData) return { verdict: 'UNGRADABLE', pointsAwarded: 0 };
  const ad: any = question.answerData;
  if (value === null || value === undefined || Number.isNaN(value)) return { verdict: 'SKIPPED', pointsAwarded: 0 };
  const min = typeof ad.min === 'number' ? ad.min : null;
  const max = typeof ad.max === 'number' ? ad.max : null;
  let ok = true;
  if (min !== null && value < min) ok = false;
  if (max !== null && value > max) ok = false;
  return { verdict: ok ? 'CORRECT' : 'INCORRECT', pointsAwarded: ok ? question.points : 0 };
}
