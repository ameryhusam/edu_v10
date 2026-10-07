import type { CanonicalQuestion } from '../canonical';
import type { EvaluationResult } from './index';

export function evaluateTrueFalse(question: CanonicalQuestion, answer: boolean | null): EvaluationResult {
  if (!question.answerData) return { verdict: 'UNGRADABLE', pointsAwarded: 0 };
  const ad: any = question.answerData;
  if (answer === null || answer === undefined) return { verdict: 'SKIPPED', pointsAwarded: 0 };
  const correct = !!ad.value;
  const isCorrect = answer === correct;
  return { verdict: isCorrect ? 'CORRECT' : 'INCORRECT', pointsAwarded: isCorrect ? question.points : 0 };
}
