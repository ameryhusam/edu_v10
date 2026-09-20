/**
 * Question ↔ concept linking, as the UI sees it.
 *
 * Types mirror what the server returns. Nothing is derived here — in
 * particular `unlinkedCount` is read, not recomputed, so a list and its badge
 * can never disagree about what "needs attention" means.
 *
 * `education/` rather than `features/`: a question's placement and its
 * diagnosis are domain concepts that outlive whichever screen shows them.
 */

import { api } from '../../shared/api/client';

/** Where a question came from. Descriptive metadata, never a teaching rule. */
export type QuestionOrigin = 'TEXTBOOK' | 'TEACHER' | 'MINISTERIAL' | 'AI' | 'UNKNOWN';

/** What a textbook question was printed as. Null unless origin is TEXTBOOK. */
export type TextbookQuestionRole = 'EXERCISE' | 'SELF_TEST' | 'REVIEW' | 'OTHER';

export interface ConceptLink {
  readonly conceptKey: string;
  readonly weight: number;
  readonly isPrimary: boolean;
}

export interface BankQuestion {
  readonly key: string;
  /** Placement. Always present — a question is filed under a lesson. */
  readonly lessonKey: string;
  readonly text: string;
  readonly status: string;
  readonly origin: QuestionOrigin;
  readonly textbookRole: TextbookQuestionRole | null;
  /** Diagnosis. May be empty: an item can be placed before it is diagnosed. */
  readonly concepts: readonly ConceptLink[];
}

export interface LessonConcept {
  readonly key: string;
  readonly name: string;
}

export interface LessonQuestionBank {
  readonly lessonKey: string;
  /** Computed by the server so every caller agrees on the definition. */
  readonly unlinkedCount: number;
  readonly questions: readonly BankQuestion[];
  /**
   * The concepts taught in this lesson — the only links the server accepts.
   * Sourced from the server rather than assembled in the UI so the screen can
   * never offer a choice that saving would refuse.
   */
  readonly concepts: readonly LessonConcept[];
}

export const questionLinkingApi = {
  /** Every question in the lesson, linked or not. */
  bank: (lessonKey: string) =>
    api.get<LessonQuestionBank>(`/content/lessons/${encodeURIComponent(lessonKey)}/questions`),

  /**
   * Replace a question's concept links.
   *
   * An empty array is a legitimate value and means "unlink": a reviewer who
   * finds a wrong link must be able to detach it without inventing a
   * replacement. The question keeps its lesson.
   */
  setConcepts: (questionKey: string, concepts: readonly ConceptLink[]) =>
    api.put<BankQuestion>(`/content/questions/${encodeURIComponent(questionKey)}/concepts`, {
      concepts,
    }),
};
