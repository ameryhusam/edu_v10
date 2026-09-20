/**
 * Answer evaluation — the single grading authority.
 *
 * PURE and VERSIONED. Two properties matter more than the algorithm itself:
 *
 *  1. Every verdict records `evaluatorVersion`. A score produced in March must
 *     still be explainable in December even after the rules change, so scores
 *     are never silently recomputed under a different rulebook.
 *  2. Every verdict records the normalisation steps actually applied. "Wrong"
 *     is not an acceptable answer to a parent; "we compared after trimming
 *     whitespace and unifying Arabic alef forms" is.
 *
 * `UNGRADABLE` and `REQUIRES_MANUAL_REVIEW` are first-class outcomes, not
 * errors. An essay is not a failed MCQ. Crucially they carry NO mastery signal,
 * which is enforced downstream by evidence weight 0.
 */

export type QuestionType =
  | 'MCQ_SINGLE'
  | 'MCQ_MULTI'
  | 'TRUE_FALSE'
  | 'NUMERIC'
  | 'SHORT_TEXT'
  | 'FILL_BLANK'
  | 'MATCHING'
  | 'ORDERING'
  | 'ESSAY';

export type Verdict =
  | 'CORRECT'
  | 'INCORRECT'
  | 'PARTIALLY_CORRECT'
  | 'SKIPPED'
  | 'INVALID'
  | 'UNGRADABLE'
  | 'REQUIRES_MANUAL_REVIEW';

export const EVALUATOR_VERSION = 'canonical-2.0';

export type NormalizationStep =
  | 'TRIM'
  | 'COLLAPSE_WHITESPACE'
  | 'LOWERCASE'
  | 'STRIP_ARABIC_DIACRITICS'
  | 'UNIFY_ARABIC_ALEF'
  | 'UNIFY_ARABIC_YEH'
  | 'UNIFY_ARABIC_TEH_MARBUTA'
  | 'ARABIC_TO_WESTERN_DIGITS'
  | 'STRIP_PUNCTUATION';

export interface AnswerKey {
  readonly type: QuestionType;
  /** Correct choice ids for MCQ/TRUE_FALSE families. */
  readonly correctChoiceIds?: readonly string[];
  /** Accepted literal answers for text families (any match counts). */
  readonly acceptedTexts?: readonly string[];
  /** Inclusive numeric interval for NUMERIC. */
  readonly numericRange?: { readonly min: number; readonly max: number };
  /** Ordered sequence for ORDERING; pair map for MATCHING. */
  readonly expectedOrder?: readonly string[];
  readonly expectedPairs?: Readonly<Record<string, string>>;
  readonly caseSensitive?: boolean;
  /** Award partial credit on MCQ_MULTI / MATCHING / ORDERING. */
  readonly allowPartialCredit?: boolean;
}

export interface SubmittedAnswer {
  readonly choiceIds?: readonly string[];
  readonly text?: string | null;
  readonly numeric?: number | null;
  readonly order?: readonly string[];
  readonly pairs?: Readonly<Record<string, string>>;
}

export interface Evaluation {
  readonly verdict: Verdict;
  /** Points earned; null when the verdict carries no score yet. */
  readonly scoreEarned: number | null;
  readonly scorePossible: number;
  readonly normalizedAnswer: string | null;
  readonly normalizationApplied: readonly NormalizationStep[];
  readonly evaluatorVersion: string;
  /** Machine-readable reason, e.g. `numeric_range_missing_bounds`. */
  readonly note?: string;
}

// ── Normalisation ────────────────────────────────────────────────────────────

const ARABIC_DIACRITICS = /[\u064B-\u0652\u0670\u0640]/g;
const ARABIC_INDIC_DIGITS = /[\u0660-\u0669\u06F0-\u06F9]/g;
const PUNCTUATION = /[.,;:!?"'()[\]{}«»\u060C\u061B\u061F]/g;

export function normalizeText(
  raw: string,
  opts: { caseSensitive?: boolean; stripPunctuation?: boolean } = {},
): { value: string; steps: NormalizationStep[] } {
  const steps: NormalizationStep[] = [];
  let v = raw;

  const before = v;
  v = v.trim();
  if (v !== before) steps.push('TRIM');

  if (/\s{2,}|\t|\n/.test(v)) {
    v = v.replace(/\s+/g, ' ');
    steps.push('COLLAPSE_WHITESPACE');
  }
  if (ARABIC_DIACRITICS.test(v)) {
    v = v.replace(ARABIC_DIACRITICS, '');
    steps.push('STRIP_ARABIC_DIACRITICS');
  }
  if (/[أإآٱ]/.test(v)) {
    v = v.replace(/[أإآٱ]/g, 'ا');
    steps.push('UNIFY_ARABIC_ALEF');
  }
  if (/ى/.test(v)) {
    v = v.replace(/ى/g, 'ي');
    steps.push('UNIFY_ARABIC_YEH');
  }
  if (/ة/.test(v)) {
    v = v.replace(/ة/g, 'ه');
    steps.push('UNIFY_ARABIC_TEH_MARBUTA');
  }
  if (ARABIC_INDIC_DIGITS.test(v)) {
    v = v.replace(ARABIC_INDIC_DIGITS, (d) => {
      const code = d.charCodeAt(0);
      const base = code >= 0x06f0 ? 0x06f0 : 0x0660;
      return String(code - base);
    });
    steps.push('ARABIC_TO_WESTERN_DIGITS');
  }
  if (opts.stripPunctuation && PUNCTUATION.test(v)) {
    v = v.replace(PUNCTUATION, '');
    steps.push('STRIP_PUNCTUATION');
  }
  if (!opts.caseSensitive && v !== v.toLowerCase()) {
    v = v.toLowerCase();
    steps.push('LOWERCASE');
  }

  return { value: v, steps };
}

// ── Evaluation ───────────────────────────────────────────────────────────────

const isBlank = (a: SubmittedAnswer): boolean =>
  (a.choiceIds?.length ?? 0) === 0 &&
  (a.text == null || a.text.trim() === '') &&
  a.numeric == null &&
  (a.order?.length ?? 0) === 0 &&
  Object.keys(a.pairs ?? {}).length === 0;

function verdictFor(ratio: number, allowPartial: boolean): Verdict {
  if (ratio >= 1) return 'CORRECT';
  if (ratio <= 0) return 'INCORRECT';
  return allowPartial ? 'PARTIALLY_CORRECT' : 'INCORRECT';
}

export function evaluateAnswer(
  key: AnswerKey,
  answer: SubmittedAnswer,
  pointsPossible = 1,
): Evaluation {
  const base = {
    scorePossible: pointsPossible,
    evaluatorVersion: EVALUATOR_VERSION,
    normalizationApplied: [] as NormalizationStep[],
    normalizedAnswer: null as string | null,
  };

  if (isBlank(answer)) {
    return { ...base, verdict: 'SKIPPED', scoreEarned: 0 };
  }

  if (key.type === 'ESSAY') {
    const norm = normalizeText(answer.text ?? '', { caseSensitive: true });
    return {
      ...base,
      verdict: 'REQUIRES_MANUAL_REVIEW',
      scoreEarned: null,
      normalizedAnswer: norm.value,
      normalizationApplied: norm.steps,
      note: 'essay_requires_human_or_ai_rubric',
    };
  }

  switch (key.type) {
    case 'MCQ_SINGLE':
    case 'TRUE_FALSE': {
      const expected = key.correctChoiceIds ?? [];
      if (expected.length === 0) {
        return { ...base, verdict: 'UNGRADABLE', scoreEarned: null, note: 'answer_key_missing' };
      }
      const given = answer.choiceIds ?? [];
      if (given.length > 1) {
        return { ...base, verdict: 'INVALID', scoreEarned: 0, note: 'multiple_choices_for_single_answer' };
      }
      const correct = given.length === 1 && expected.includes(given[0]!);
      return {
        ...base,
        verdict: correct ? 'CORRECT' : 'INCORRECT',
        scoreEarned: correct ? pointsPossible : 0,
        normalizedAnswer: given[0] ?? null,
      };
    }

    case 'MCQ_MULTI': {
      const expected = new Set(key.correctChoiceIds ?? []);
      if (expected.size === 0) {
        return { ...base, verdict: 'UNGRADABLE', scoreEarned: null, note: 'answer_key_missing' };
      }
      const given = new Set(answer.choiceIds ?? []);
      let hits = 0;
      let falsePositives = 0;
      for (const id of given) (expected.has(id) ? hits++ : falsePositives++);
      // Penalise over-selection so ticking everything cannot score.
      const ratio = Math.max(0, (hits - falsePositives) / expected.size);
      return {
        ...base,
        verdict: verdictFor(ratio, key.allowPartialCredit ?? true),
        scoreEarned: Number((ratio * pointsPossible).toFixed(4)),
        normalizedAnswer: [...given].sort().join(','),
      };
    }

    case 'NUMERIC': {
      if (!key.numericRange) {
        return { ...base, verdict: 'UNGRADABLE', scoreEarned: null, note: 'numeric_range_missing_bounds' };
      }
      const norm = answer.text != null ? normalizeText(answer.text) : null;
      const raw = answer.numeric ?? (norm ? Number(norm.value) : Number.NaN);
      if (!Number.isFinite(raw)) {
        return {
          ...base,
          verdict: 'INVALID',
          scoreEarned: 0,
          normalizedAnswer: norm?.value ?? null,
          normalizationApplied: norm?.steps ?? [],
          note: 'not_a_number',
        };
      }
      const inRange = raw >= key.numericRange.min && raw <= key.numericRange.max;
      return {
        ...base,
        verdict: inRange ? 'CORRECT' : 'INCORRECT',
        scoreEarned: inRange ? pointsPossible : 0,
        normalizedAnswer: String(raw),
        normalizationApplied: norm?.steps ?? [],
      };
    }

    case 'SHORT_TEXT':
    case 'FILL_BLANK': {
      const accepted = key.acceptedTexts ?? [];
      if (accepted.length === 0) {
        return { ...base, verdict: 'UNGRADABLE', scoreEarned: null, note: 'answer_key_missing' };
      }
      const opts = { caseSensitive: key.caseSensitive ?? false, stripPunctuation: true };
      const norm = normalizeText(answer.text ?? '', opts);
      const match = accepted.some((a) => normalizeText(a, opts).value === norm.value);
      return {
        ...base,
        verdict: match ? 'CORRECT' : 'INCORRECT',
        scoreEarned: match ? pointsPossible : 0,
        normalizedAnswer: norm.value,
        normalizationApplied: norm.steps,
      };
    }

    case 'ORDERING': {
      const expected = key.expectedOrder ?? [];
      if (expected.length === 0) {
        return { ...base, verdict: 'UNGRADABLE', scoreEarned: null, note: 'answer_key_missing' };
      }
      const given = answer.order ?? [];
      const hits = expected.reduce((n, id, i) => (given[i] === id ? n + 1 : n), 0);
      const ratio = hits / expected.length;
      return {
        ...base,
        verdict: verdictFor(ratio, key.allowPartialCredit ?? true),
        scoreEarned: Number((ratio * pointsPossible).toFixed(4)),
        normalizedAnswer: given.join('>'),
      };
    }

    case 'MATCHING': {
      const expected = key.expectedPairs ?? {};
      const keys = Object.keys(expected);
      if (keys.length === 0) {
        return { ...base, verdict: 'UNGRADABLE', scoreEarned: null, note: 'answer_key_missing' };
      }
      const given = answer.pairs ?? {};
      const hits = keys.reduce((n, k) => (given[k] === expected[k] ? n + 1 : n), 0);
      const ratio = hits / keys.length;
      return {
        ...base,
        verdict: verdictFor(ratio, key.allowPartialCredit ?? true),
        scoreEarned: Number((ratio * pointsPossible).toFixed(4)),
        normalizedAnswer: JSON.stringify(given),
      };
    }

    default:
      return { ...base, verdict: 'UNGRADABLE', scoreEarned: null, note: 'unsupported_question_type' };
  }
}
