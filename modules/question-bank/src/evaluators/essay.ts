import type { CanonicalQuestion } from '../canonical';
import type { EvaluationResult } from './index';

export function evaluateEssay(_question: CanonicalQuestion, _answerText: string | null): EvaluationResult {
  return { verdict: 'REQUIRES_MANUAL_REVIEW', pointsAwarded: 0 };
}
