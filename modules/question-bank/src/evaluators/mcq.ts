import type { CanonicalQuestion, MCQAnswerData } from '../canonical';

export type Verdict = 'CORRECT' | 'INCORRECT' | 'PARTIALLY_CORRECT' | 'SKIPPED' | 'INVALID' | 'UNGRADABLE' | 'REQUIRES_MANUAL_REVIEW';

export interface EvaluationResult {
  verdict: Verdict;
  pointsAwarded: number;
  meta?: Record<string, unknown>;
}

/**
 * Evaluate MCQ (single or multi). Baseline: full-credit only for exact set match on MCQ_MULTI.
 */
export function evaluateMCQ(question: CanonicalQuestion, selectedOptionIds: string[] | string): EvaluationResult {
  if (!question.answerData) {
    return { verdict: 'UNGRADABLE', pointsAwarded: 0 };
  }
  const ad = question.answerData as MCQAnswerData;
  const correct = ad.correctOptions ?? [];

  const selected = Array.isArray(selectedOptionIds) ? selectedOptionIds : [selectedOptionIds];

  // normalize sets
  const setCorrect = new Set(correct.map((s) => String(s)));
  const setSelected = new Set(selected.map((s) => String(s)));

  // MCQ_SINGLE
  if (question.type === 'MCQ_SINGLE' || question.type === 'TRUE_FALSE') {
    const sel = selected[0];
    if (!sel) return { verdict: 'SKIPPED', pointsAwarded: 0 };
    const isCorrect = setCorrect.has(sel);
    return { verdict: isCorrect ? 'CORRECT' : 'INCORRECT', pointsAwarded: isCorrect ? question.points : 0 };
  }

  // MCQ_MULTI baseline: exact set match
  if (question.type === 'MCQ_MULTI') {
    if (setSelected.size === 0) return { verdict: 'SKIPPED', pointsAwarded: 0 };
    let allMatch = setSelected.size === setCorrect.size;
    if (allMatch) {
      for (const c of setCorrect) if (!setSelected.has(c)) { allMatch = false; break; }
    }

    return { verdict: allMatch ? 'CORRECT' : 'INCORRECT', pointsAwarded: allMatch ? question.points : 0 };
  }

  return { verdict: 'INVALID', pointsAwarded: 0 };
}
