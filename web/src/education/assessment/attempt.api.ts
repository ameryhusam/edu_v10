/**
 * Taking an attempt — the write side of assessment.
 *
 * History is delegable; acting is not. This client holds only the calls a
 * learner makes as themselves: open (or resume) an attempt, draw the next
 * item, answer it, close the attempt. Every verdict comes back from the
 * server — nothing here scores, chooses, or decides anything locally.
 *
 * The runner passes the exam's `conceptKeys` back to `next-item` unchanged.
 * The scope arrived from the server in the exam payload; the browser that
 * decided what an exam measures would be a second authoring tool.
 */

import { api } from '../../shared/api/client';

/** A published exam the learner may take, as the catalogue returns it. */
export interface LearnerExam {
  readonly key: string;
  readonly title: string;
  readonly description: string | null;
  readonly isAdaptive: boolean;
  readonly timeLimitMins: number | null;
  readonly passingScore: number;
  readonly textbookKey: string | null;
  readonly itemCount: number;
  /** The exam's concept scope, decided by the server, returned unchanged. */
  readonly conceptKeys: readonly string[];
  /**
   * Never set by the server (exams are exam-scoped). Present so the runner's
   * RunScope can accept a lesson check without a parallel type.
   */
  readonly lessonKey?: string;
}

/**
 * A choice as the learner may see it. No misconception tags, no answer marks —
 * the server strips them before the payload leaves, and this type mirrors what
 * actually arrives.
 */
export interface LearnerChoice {
  readonly id: string;
  readonly text: string;
  readonly orderIndex: number;
}

export interface LearnerQuestion {
  readonly key: string;
  readonly text: string;
  readonly type: string;
  readonly points: number;
  readonly hint?: string;
  readonly choices: readonly LearnerChoice[];
}

/** One draw of the adaptive engine: either the next question, or a stop. */
export interface NextItem {
  readonly finished: boolean;
  readonly reason: string;
  readonly theta: number;
  readonly standardError: number;
  readonly itemsAdministered: number;
  readonly question: LearnerQuestion | null;
}

/** What the server says about an answer. Never the answer key itself. */
export interface AnswerFeedback {
  readonly feedback: {
    readonly verdict: 'CORRECT' | 'INCORRECT' | 'PARTIALLY_CORRECT' | 'UNGRADABLE';
    readonly explanation: string | null;
    readonly misconceptionKey: string | null;
  };
}

/** Closing an attempt: the server derives every total from stored answers. */
export interface SubmitResult {
  readonly totals: {
    readonly score: number;
    readonly maxScore: number;
    readonly percentage: number | null;
    readonly answeredCount: number;
    readonly correctCount: number;
    readonly incorrectCount: number;
    readonly partiallyCorrectCount: number;
    readonly pendingReviewCount: number;
  };
}

export interface StartResult {
  readonly attempt: { readonly key: string };
  readonly resumed: boolean;
}

export const attemptApi = {
  /** My exams: published, for my entitled textbooks, with their scopes. */
  exams: () => api.get<{ exams: readonly LearnerExam[] }>('assessment/exams'),

  /**
   * Open an attempt, resuming an open one on the same scope by default.
   * A lesson check names the lesson; every other kind names the exam.
   */
  start: (input: {
    kind: 'PRACTICE' | 'LESSON_CHECK' | 'EXAM' | 'REVIEW' | 'DIAGNOSTIC';
    examKey?: string;
    lessonKey?: string;
  }) => api.post<StartResult>('assessment/attempts', input),

  /** The next item, or the stop decision. Stateless on the server. */
  nextItem: (attemptKey: string, conceptKeys: readonly string[]) =>
    api.get<NextItem>(`assessment/attempts/${attemptKey}/next-item`, {
      query: { conceptKeys: conceptKeys.join(',') },
    }),

  /** Answer the current question. The server grades; the client shows. */
  answer: (input: { attemptKey: string; questionKey: string; choiceIds: readonly string[] }) =>
    api.post<AnswerFeedback>('assessment/answers', {
      attemptKey: input.attemptKey,
      questionKey: input.questionKey,
      answer: { choiceIds: [...input.choiceIds] },
    }),

  /** Close the attempt. Totals are derived from stored answers, not sent. */
  submit: (attemptKey: string) =>
    api.post<SubmitResult>(`assessment/attempts/${attemptKey}/submit`, {}),
};
