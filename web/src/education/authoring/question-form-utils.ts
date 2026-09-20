import type {
  ConceptLink,
  CreateQuestionInput,
  PublicationAction,
  PublicationStatus,
  QuestionOrigin,
  QuestionType,
  QuestionVisibility,
  TextbookQuestionRole,
} from './question-bank.api';

export const CHOICE_TYPES = new Set<QuestionType>(['MCQ_SINGLE', 'MCQ_MULTI', 'TRUE_FALSE']);

export interface QuestionFormState {
  readonly lessonKey: string;
  readonly conceptLinks: string;
  readonly questionType: QuestionType;
  readonly origin: QuestionOrigin;
  readonly visibility: QuestionVisibility;
  readonly textbookRole: TextbookQuestionRole | '';
  readonly sourceRef: string;
  readonly text: string;
  readonly hint: string;
  readonly explanation: string;
  readonly points: string;
  readonly difficulty: string;
  readonly choices: string;
  readonly correct: string;
  readonly acceptedTexts: string;
  readonly numericMin: string;
  readonly numericMax: string;
  readonly expectedOrder: string;
  readonly expectedPairs: string;
  readonly rubric: string;
}

export const initialQuestionForm: QuestionFormState = {
  lessonKey: '',
  conceptLinks: '',
  questionType: 'MCQ_SINGLE',
  origin: 'TEXTBOOK',
  visibility: 'GLOBAL',
  textbookRole: 'EXERCISE',
  sourceRef: '',
  text: '',
  hint: '',
  explanation: '',
  points: '1',
  difficulty: '0.5',
  choices: 'a|First option\nb|Second option\nc|Third option',
  correct: 'a',
  acceptedTexts: '',
  numericMin: '',
  numericMax: '',
  expectedOrder: '',
  expectedPairs: '',
  rubric: '',
};

type MutableAnswerKey = {
  correctChoiceIds?: string[];
  acceptedTexts?: string[];
  numericMin?: number | null;
  numericMax?: number | null;
  expectedOrder?: string[];
  expectedPairs?: Record<string, string> | null;
  caseSensitive?: boolean;
  allowPartialCredit?: boolean;
  rubric?: unknown;
};

export function buildQuestionInput(input: QuestionFormState): CreateQuestionInput {
  const answerKey: MutableAnswerKey = {};
  if (input.questionType === 'MCQ_SINGLE' || input.questionType === 'MCQ_MULTI' || input.questionType === 'TRUE_FALSE') {
    answerKey.correctChoiceIds = splitList(input.correct);
  } else if (input.questionType === 'NUMERIC') {
    answerKey.numericMin = Number(input.numericMin);
    answerKey.numericMax = Number(input.numericMax);
  } else if (input.questionType === 'SHORT_TEXT' || input.questionType === 'FILL_BLANK') {
    answerKey.acceptedTexts = splitList(input.acceptedTexts);
  } else if (input.questionType === 'ORDERING') {
    answerKey.expectedOrder = splitList(input.expectedOrder);
  } else if (input.questionType === 'MATCHING') {
    answerKey.expectedPairs = parsePairs(input.expectedPairs);
  } else if (input.questionType === 'ESSAY') {
    answerKey.rubric = input.rubric.trim() ? { rubric: input.rubric.trim() } : null;
  }

  return {
    type: input.questionType,
    text: input.text.trim(),
    lessonKey: input.lessonKey.trim(),
    hint: input.hint.trim() ? input.hint.trim() : null,
    explanation: input.explanation.trim() ? input.explanation.trim() : null,
    points: Number(input.points) || 1,
    difficulty01: Number(input.difficulty) || 0.5,
    origin: input.origin,
    visibility: input.visibility,
    textbookRole: input.origin === 'TEXTBOOK' && input.textbookRole ? input.textbookRole : null,
    sourceRef: input.sourceRef.trim() ? input.sourceRef.trim() : null,
    choices: CHOICE_TYPES.has(input.questionType) ? parseChoices(input.choices) : [],
    answerKey,
    concepts: parseConceptLinks(input.conceptLinks),
  };
}

export function parseChoices(raw: string): Array<{ id: string; text: string }> {
  return raw
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const [maybeId, ...rest] = line.split('|');
      const id = rest.length > 0 ? maybeId!.trim() : String.fromCharCode(97 + index);
      const text = rest.length > 0 ? rest.join('|').trim() : maybeId!.trim();
      return { id, text };
    });
}

export function splitList(raw: string): string[] {
  return raw
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseConceptLinks(raw: string): ConceptLink[] {
  return splitList(raw).map((key, index) => ({ conceptKey: key, weight: 1, isPrimary: index === 0 }));
}

function parsePairs(raw: string): Record<string, string> {
  const pairs: Record<string, string> = {};
  for (const line of raw.split(/\n+/)) {
    const [left, ...rest] = line.split('|');
    if (!left || rest.length === 0) continue;
    pairs[left.trim()] = rest.join('|').trim();
  }
  return pairs;
}

export interface MinisterialImportState {
  readonly lessonKey: string;
  readonly conceptLinks: string;
  readonly country: string;
  readonly authority: string;
  readonly academicYear: string;
  readonly grade: string;
  readonly subject: string;
  readonly session: string;
  readonly raw: string;
}

export const initialMinisterialImport: MinisterialImportState = {
  lessonKey: '',
  conceptLinks: '',
  country: 'YE',
  authority: 'MOE',
  academicYear: '',
  grade: '',
  subject: '',
  session: '',
  raw: '',
};

export interface MinisterialRow {
  readonly number: string | null;
  readonly text: string;
  readonly choices: Array<{ id: string; text: string }>;
  readonly correctChoiceId: string;
}

export function sourcePrefixFor(input: MinisterialImportState): string {
  return [input.authority, input.country, input.academicYear, input.grade, input.subject, input.session]
    .map((part) => part.trim())
    .filter(Boolean)
    .join('-');
}

export function parseMinisterialRows(raw: string): MinisterialRow[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) return parsed.flatMap((item, index) => normaliseMinisterialObject(item, index));
  } catch {
    // Not JSON; parse delimited rows below.
  }
  return trimmed
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line, index) => normaliseMinisterialParts(splitDelimited(line), index));
}

function normaliseMinisterialObject(item: unknown, index: number): MinisterialRow[] {
  if (!item || typeof item !== 'object') return [];
  const record = item as Record<string, unknown>;
  const text = typeof record.text === 'string' ? record.text.trim() : '';
  const correct = typeof record.answer === 'string' ? record.answer.trim() : 'a';
  const choices = Array.isArray(record.choices)
    ? record.choices.map((choice, choiceIndex) => ({
        id: String.fromCharCode(97 + choiceIndex),
        text: String(choice),
      }))
    : [];
  if (!text || choices.length < 2) return [];
  return [{ number: String(record.number ?? index + 1), text, choices, correctChoiceId: correct }];
}

function normaliseMinisterialParts(parts: readonly string[], index: number): MinisterialRow[] {
  if (parts.length < 5) return [];
  const [numberOrText, maybeText, ...rest] = parts;
  const hasExplicitNumber = /^\d+/.test(numberOrText ?? '') && rest.length >= 4;
  const number = hasExplicitNumber ? numberOrText!.trim() : String(index + 1);
  const text = (hasExplicitNumber ? maybeText : numberOrText)?.trim() ?? '';
  const answer = rest.at(-1)?.trim().toLowerCase() || 'a';
  const optionTexts = (hasExplicitNumber ? rest.slice(0, -1) : [maybeText, ...rest.slice(0, -1)]).filter(
    (value): value is string => Boolean(value && value.trim()),
  );
  const choices = optionTexts.map((option, choiceIndex) => ({
    id: String.fromCharCode(97 + choiceIndex),
    text: option.trim(),
  }));
  if (!text || choices.length < 2) return [];
  const correctChoiceId = /^[a-z]$/.test(answer) ? answer : choices[0]!.id;
  return [{ number, text, choices, correctChoiceId }];
}

function splitDelimited(line: string): string[] {
  return line.includes('|') ? line.split('|') : line.split(',');
}

export function actionsFor(status: PublicationStatus): PublicationAction[] {
  if (status === 'DRAFT') return ['SUBMIT'];
  if (status === 'IN_REVIEW') return ['APPROVE', 'REJECT'];
  if (status === 'PUBLISHED') return ['ARCHIVE'];
  return ['RESTORE'];
}
