import type { CanonicalQuestion } from '../canonical';
import type { EvaluationResult } from './index';

function normalizeText(s: string, caseSensitive = false): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return caseSensitive ? t : t.toLowerCase();
}

export function evaluateShortText(question: CanonicalQuestion, text: string | null): EvaluationResult {
  if (!question.answerData) return { verdict: 'UNGRADABLE', pointsAwarded: 0 };
  const ad: any = question.answerData;
  if (!text) return { verdict: 'SKIPPED', pointsAwarded: 0 };
  const accepted: string[] = ad.accepted ?? [];
  const caseSensitive = !!ad.caseSensitive;
  const norm = normalizeText(text, caseSensitive);
  for (const a of accepted) {
    if (normalizeText(a, caseSensitive) === norm) return { verdict: 'CORRECT', pointsAwarded: question.points };
  }
  return { verdict: 'INCORRECT', pointsAwarded: 0 };
}
