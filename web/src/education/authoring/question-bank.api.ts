/**
 * Question-bank client.
 *
 * Type, origin and concept links stay separate because they mean different
 * things: correction method, provenance and mastery impact respectively.
 */

import { api } from '../../shared/api/client';

export const QUESTION_TYPES = [
  'MCQ_SINGLE',
  'MCQ_MULTI',
  'TRUE_FALSE',
  'NUMERIC',
  'SHORT_TEXT',
  'FILL_BLANK',
  'MATCHING',
  'ORDERING',
  'ESSAY',
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const QUESTION_ORIGINS = ['TEXTBOOK', 'TEACHER', 'MINISTERIAL', 'AI', 'UNKNOWN'] as const;
export type QuestionOrigin = (typeof QUESTION_ORIGINS)[number];

export const QUESTION_VISIBILITIES = ['PRIVATE', 'SCHOOL', 'SUBMITTED_FOR_REVIEW', 'GLOBAL'] as const;
export type QuestionVisibility = (typeof QUESTION_VISIBILITIES)[number];

export const PUBLICATION_STATUSES = ['DRAFT', 'IN_REVIEW', 'PUBLISHED', 'ARCHIVED'] as const;
export type PublicationStatus = (typeof PUBLICATION_STATUSES)[number];
export type PublicationAction = 'SUBMIT' | 'APPROVE' | 'REJECT' | 'ARCHIVE' | 'RESTORE';

export const TEXTBOOK_QUESTION_ROLES = ['EXERCISE', 'SELF_TEST', 'REVIEW', 'OTHER'] as const;
export type TextbookQuestionRole = (typeof TEXTBOOK_QUESTION_ROLES)[number];

export interface QuestionChoiceRecord {
  readonly id: string;
  readonly text: string;
  readonly orderIndex: number;
  readonly misconceptionKey: string | null;
  readonly feedback: string | null;
}

export interface ConceptLink {
  readonly conceptKey: string;
  readonly weight: number;
  readonly isPrimary: boolean;
}

export interface QuestionRecord {
  readonly key: string;
  readonly lessonKey: string;
  readonly type: QuestionType;
  readonly text: string;
  readonly hint: string | null;
  readonly explanation: string | null;
  readonly points: number;
  readonly difficulty01: number;
  readonly irtDifficulty: number;
  readonly status: PublicationStatus;
  readonly origin: QuestionOrigin;
  readonly textbookRole: TextbookQuestionRole | null;
  readonly sourceRef: string | null;
  readonly authorUserId?: string | null;
  readonly schoolId?: string | null;
  readonly visibility?: QuestionVisibility;
  readonly choices: readonly QuestionChoiceRecord[];
  readonly answerKey: {
    readonly correctChoiceIds: readonly string[];
    readonly acceptedTexts: readonly string[];
    readonly numericMin: number | null;
    readonly numericMax: number | null;
    readonly expectedOrder: readonly string[];
    readonly expectedPairs: Record<string, string> | null;
    readonly caseSensitive: boolean;
    readonly allowPartialCredit: boolean;
    readonly rubric: unknown;
  } | null;
  readonly concepts: readonly ConceptLink[];
}

export interface QuestionListQuery {
  readonly search?: string;
  readonly type?: QuestionType;
  readonly origin?: QuestionOrigin;
  readonly status?: PublicationStatus;
  readonly visibility?: QuestionVisibility;
  readonly textbookRole?: TextbookQuestionRole;
  readonly textbookKey?: string;
  readonly gradeKey?: string;
  readonly subjectKey?: string;
  readonly lessonKey?: string;
  readonly conceptKey?: string;
  readonly sourceRef?: string;
  readonly difficultyMin?: number;
  readonly difficultyMax?: number;
  readonly limit?: number;
  readonly offset?: number;
}

export interface ExamRecord {
  readonly key: string;
  readonly title: string;
  readonly description: string | null;
  readonly textbookKey: string | null;
  readonly authorUserId: string | null;
  readonly schoolId: string | null;
  readonly visibility: QuestionVisibility;
  readonly isAdaptive: boolean;
  readonly passingScore: number;
  readonly timeLimitMins: number | null;
  readonly minItems: number;
  readonly maxItems: number;
  readonly targetStandardError: number;
  readonly status: PublicationStatus;
  readonly items: readonly { readonly questionKey: string; readonly points: number; readonly questionType?: QuestionType; readonly conceptKeys?: readonly string[] }[];
}

export interface ExamBlueprint {
  readonly totalItems: number;
  readonly totalPoints: number;
  readonly conceptCoverage: ReadonlyArray<{ readonly conceptKey: string; readonly items: number; readonly points: number }>;
  readonly difficultyBands: { readonly easy: number; readonly medium: number; readonly hard: number };
}

export interface CreateQuestionInput {
  readonly type: QuestionType;
  readonly text: string;
  readonly hint?: string | null;
  readonly explanation?: string | null;
  readonly points?: number;
  readonly difficulty01?: number;
  readonly origin?: QuestionOrigin;
  readonly textbookRole?: TextbookQuestionRole | null;
  readonly sourceRef?: string | null;
  readonly visibility?: QuestionVisibility;
  readonly choices?: ReadonlyArray<{ id: string; text: string; misconceptionKey?: string | null; feedback?: string | null }>;
  readonly answerKey?: {
    readonly correctChoiceIds?: readonly string[];
    readonly acceptedTexts?: readonly string[];
    readonly numericMin?: number | null;
    readonly numericMax?: number | null;
    readonly expectedOrder?: readonly string[];
    readonly expectedPairs?: Record<string, string> | null;
    readonly caseSensitive?: boolean;
    readonly allowPartialCredit?: boolean;
    readonly rubric?: unknown;
  };
  readonly lessonKey: string;
  readonly concepts?: readonly ConceptLink[];
}

export const questionBankApi = {
  list: (query: QuestionListQuery) =>
    api.get<{ rows: readonly QuestionRecord[]; total: number }>('content/questions', { query: { ...query } }),
  create: (input: CreateQuestionInput) => api.post<QuestionRecord>('content/questions', input),
  transition: (questionKey: string, action: PublicationAction) =>
    api.post<{ key: string; status: PublicationStatus }>(
      `content/questions/${encodeURIComponent(questionKey)}/transitions`,
      { action },
    ),
  exams: (query: { search?: string; status?: PublicationStatus; textbookKey?: string; isAdaptive?: boolean; limit?: number; offset?: number }) =>
    api.get<{ rows: readonly ExamRecord[]; total: number }>('content/exams', { query }),
  examBlueprint: (examKey: string) =>
    api.get<ExamBlueprint>(`content/exams/${encodeURIComponent(examKey)}/blueprint`),
  createExam: (input: {
    title: string;
    description?: string | null;
    textbookKey?: string | null;
    isAdaptive?: boolean;
    passingScore?: number;
    timeLimitMins?: number | null;
    minItems?: number;
    maxItems?: number;
    targetStandardError?: number;
    visibility?: QuestionVisibility;
  }) => api.post<ExamRecord>('content/exams', input),
  createAdaptiveExam: (input: {
    title: string;
    description?: string | null;
    textbookKey: string;
    lessonKey?: string | null;
    conceptKeys?: readonly string[];
    type?: QuestionType;
    origin?: QuestionOrigin;
    difficultyMin?: number;
    difficultyMax?: number;
    passingScore?: number;
    timeLimitMins?: number | null;
    minItems?: number;
    maxItems?: number;
    targetStandardError?: number;
    visibility?: QuestionVisibility;
  }) => api.post<ExamRecord>('content/exams/adaptive-from-scope', input),
  setExamItems: (examKey: string, items: readonly { questionKey: string; points?: number }[]) =>
    api.put<ExamRecord>(`content/exams/${encodeURIComponent(examKey)}/items`, { items }),
  transitionExam: (examKey: string, action: PublicationAction) =>
    api.post<{ key: string; status: PublicationStatus }>(
      `content/exams/${encodeURIComponent(examKey)}/transitions`,
      { action },
    ),
};
