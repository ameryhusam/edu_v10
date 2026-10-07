import type { CanonicalQuestion } from '../canonical';
import type { EvaluationResult } from './index';

export function evaluateFillBlank(question: CanonicalQuestion, answers: (string | null)[] | null): EvaluationResult {
  if (!question.answerData) return { verdict: 'UNGRADABLE', pointsAwarded: 0 };
  const ad: any = question.answerData;
  const blanks: any[] = ad.blanks ?? [];
  if (!answers || answers.length === 0) return { verdict: 'SKIPPED', pointsAwarded: 0 };
  let total = blanks.length;
  if (total === 0) return { verdict: 'UNGRADABLE', pointsAwarded: 0 };
  let correctCount = 0;
  for (let i = 0; i < blanks.length; i++) {
    const accepted: string[] = blanks[i].accepted ?? [];
    const ans = answers[i] ?? '';
    if (accepted.map((a) => a.trim().toLowerCase()).includes(ans.trim().toLowerCase())) correctCount++;
  }
  const pointsPer = question.points / total;
  const pointsAwarded = Math.round(pointsPer * correctCount);
  const verdict = correctCount === total ? 'CORRECT' : (correctCount === 0 ? 'INCORRECT' : 'PARTIALLY_CORRECT');
  return { verdict: verdict as EvaluationResult['verdict'], pointsAwarded };
}
