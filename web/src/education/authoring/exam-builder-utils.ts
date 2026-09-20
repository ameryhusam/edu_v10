/** Utilities for criteria-led exam assembly. */

import { QUESTION_TYPES, type QuestionOrigin, type QuestionRecord, type QuestionType } from './question-bank.api';
import type { PublicationStatus } from './question-bank.api';

export type Mode = 'fixed' | 'adaptive';
export type Filters = {
  readonly subjectKey: string;
  readonly gradeKey: string;
  readonly termKey: string;
  readonly type: QuestionType | '';
  readonly origin: QuestionOrigin | '';
  readonly status: PublicationStatus;
  readonly difficultyMin: string;
  readonly difficultyMax: string;
};
export type Settings = {
  readonly passingScore: string;
  readonly timeLimit: string;
  readonly minItems: string;
  readonly maxItems: string;
  readonly targetStandardError: string;
};
export type Targets = { readonly easy: string; readonly medium: string; readonly hard: string };

export const DEFAULT_FILTERS: Filters = {
  subjectKey: '',
  gradeKey: '',
  termKey: '',
  type: '',
  origin: '',
  status: 'PUBLISHED',
  difficultyMin: '',
  difficultyMax: '',
};
export const DEFAULT_SETTINGS: Settings = {
  passingScore: '0.6',
  timeLimit: '',
  minItems: '5',
  maxItems: '20',
  targetStandardError: '0.3',
};
export const DEFAULT_TARGETS: Targets = { easy: '2', medium: '4', hard: '2' };

export const AUTO_GRADABLE: ReadonlySet<QuestionType> = new Set(
  QUESTION_TYPES.filter((type) => type !== 'ESSAY'),
);

export interface QuestionStats {
  readonly total: number;
  readonly autoGradable: number;
  readonly manual: number;
  readonly concepts: number;
  readonly easy: number;
  readonly medium: number;
  readonly hard: number;
}

export function summarizeQuestions(questions: readonly QuestionRecord[]): QuestionStats {
  const conceptKeys = new Set<string>();
  let autoGradable = 0;
  let manual = 0;
  let easy = 0;
  let medium = 0;
  let hard = 0;

  for (const question of questions) {
    if (AUTO_GRADABLE.has(question.type)) autoGradable += 1;
    else manual += 1;
    if (question.difficulty01 < 0.34) easy += 1;
    else if (question.difficulty01 > 0.66) hard += 1;
    else medium += 1;
    for (const link of question.concepts) conceptKeys.add(link.conceptKey);
  }

  return { total: questions.length, autoGradable, manual, concepts: conceptKeys.size, easy, medium, hard };
}

export function assembleByTargets(
  pool: readonly QuestionRecord[],
  targets: Targets,
  conceptKeys: readonly string[],
): readonly QuestionRecord[] {
  const selected = new Map<string, QuestionRecord>();
  const requiredConcepts = new Set(conceptKeys);
  for (const conceptKey of requiredConcepts) {
    const hit = pool.find((question) => question.concepts.some((link) => link.conceptKey === conceptKey));
    if (hit) selected.set(hit.key, hit);
  }

  for (const [band, count] of [
    ['easy', Number(targets.easy) || 0],
    ['medium', Number(targets.medium) || 0],
    ['hard', Number(targets.hard) || 0],
  ] as const) {
    for (const question of pool.filter((entry) => difficultyBand(entry) === band)) {
      const selectedInBand = Array.from(selected.values()).filter((entry) => difficultyBand(entry) === band).length;
      if (selectedInBand >= count) break;
      selected.set(question.key, question);
    }
  }
  return Array.from(selected.values());
}

export function numberOrUndefined(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export function uniqueOptions(
  options: readonly { key: string; name: string }[],
): readonly { key: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const option of options) if (!seen.has(option.key)) seen.set(option.key, option.name);
  return [...seen.entries()].map(([key, name]) => ({ key, name }));
}

function difficultyBand(question: QuestionRecord): 'easy' | 'medium' | 'hard' {
  if (question.difficulty01 < 0.34) return 'easy';
  if (question.difficulty01 > 0.66) return 'hard';
  return 'medium';
}
