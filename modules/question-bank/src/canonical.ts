// Canonical Question Model types used across the module

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

export type Difficulty = 'EASY' | 'MEDIUM' | 'HARD' | 'UNKNOWN';

export interface SubjectRef { id: string; key?: string; name?: string }
export interface GradeRef { id: string; key?: string; name?: string }
export interface UnitRef { id: string; key?: string; title?: string }
export interface LessonRef { id: string; key?: string; title?: string }

export interface MediaRef { id?: string; url: string; mime?: string }

export interface MCQOption { id: string; text: string; media?: MediaRef[] }

export interface MatchingPair { leftId: string; rightId: string }

export interface AnswerDataBase { }

export interface MCQAnswerData extends AnswerDataBase {
  options: MCQOption[];
  correctOptions: string[]; // option ids
}

export interface TrueFalseAnswerData extends AnswerDataBase {
  value: boolean;
}

export interface NumericAnswerData extends AnswerDataBase {
  min?: number;
  max?: number;
}

export interface ShortTextAnswerData extends AnswerDataBase {
  accepted: string[];
  caseSensitive?: boolean;
}

export interface MatchingAnswerData extends AnswerDataBase {
  left: { id: string; text: string }[];
  right: { id: string; text: string }[];
  pairs: MatchingPair[];
}

export interface OrderingAnswerData extends AnswerDataBase {
  items: { id: string; text: string }[];
  correctOrder: string[];
}

export interface EssayAnswerData extends AnswerDataBase {
  rubric?: any;
}

export type AnswerData =
  | MCQAnswerData
  | TrueFalseAnswerData
  | NumericAnswerData
  | ShortTextAnswerData
  | MatchingAnswerData
  | OrderingAnswerData
  | EssayAnswerData;

export interface CanonicalQuestion {
  id?: string;
  key?: string | null;
  subject: SubjectRef;
  grade: GradeRef;
  unit: UnitRef;
  lesson: LessonRef;
  type: QuestionType;
  text: string;
  media?: MediaRef[];
  points: number;
  difficulty?: Difficulty;
  hint?: string | null;
  explanation?: string | null; // NOT returned during exam in progress
  answerData: AnswerData | null;
  metadata?: Record<string, unknown>;
  status?: 'DRAFT' | 'READY' | 'PUBLISHED' | 'ARCHIVED';
  createdAt?: string;
  updatedAt?: string;
}
