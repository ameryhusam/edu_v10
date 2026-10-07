import type { CanonicalQuestion } from '../canonical';
import type { EvaluationResult } from './index';

export function evaluateMatching(question: CanonicalQuestion, pairs: { leftId: string; rightId: string }[] | null): EvaluationResult {
  if (!question.answerData) return { verdict: 'UNGRADABLE', pointsAwarded: 0 };
  const ad: any = question.answerData;
  if (!pairs || pairs.length === 0) return { verdict: 'SKIPPED', pointsAwarded: 0 };
  const correctPairs: Record<string, string> = {};
  for (const p of (ad.pairs ?? [])) correctPairs[p.leftId] = p.rightId;
  let correctCount = 0;
  for (const p of pairs) {
    if (correctPairs[p.leftId] === p.rightId) correctCount++;
  }
  const total = (ad.pairs ?? []).length || 0;
  const pointsPer = total > 0 ? question.points / total : 0;
  const pointsAwarded = Math.round(pointsPer * correctCount);
  const verdict = correctCount === total ? 'CORRECT' : (correctCount === 0 ? 'INCORRECT' : 'PARTIALLY_CORRECT');
  return { verdict: verdict as EvaluationResult['verdict'], pointsAwarded };
}
