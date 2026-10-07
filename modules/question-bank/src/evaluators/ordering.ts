import type { CanonicalQuestion } from '../canonical';
import type { EvaluationResult } from './index';

export function evaluateOrdering(question: CanonicalQuestion, orderedItemIds: string[] | null): EvaluationResult {
  if (!question.answerData) return { verdict: 'UNGRADABLE', pointsAwarded: 0 };
  const ad: any = question.answerData;
  if (!orderedItemIds || orderedItemIds.length === 0) return { verdict: 'SKIPPED', pointsAwarded: 0 };
  const correctOrder: string[] = ad.correctOrder ?? [];
  if (orderedItemIds.length !== correctOrder.length) return { verdict: 'INCORRECT', pointsAwarded: 0 };
  let correctPositions = 0;
  for (let i = 0; i < correctOrder.length; i++) if (orderedItemIds[i] === correctOrder[i]) correctPositions++;
  const pointsPer = question.points / correctOrder.length;
  const pointsAwarded = Math.round(pointsPer * correctPositions);
  const verdict = correctPositions === correctOrder.length ? 'CORRECT' : (correctPositions === 0 ? 'INCORRECT' : 'PARTIALLY_CORRECT');
  return { verdict: verdict as EvaluationResult['verdict'], pointsAwarded };
}
