/**
 * Ports for the item bank: questions, exams and learning resources.
 *
 * Separate from `ports.ts` because the item bank has a different shape from
 * the content tree. A concept lives at exactly one place in a hierarchy; a
 * question is a free-standing asset that many lessons and exams point at. The
 * tree's parent/child/reorder vocabulary does not fit it, and forcing it to
 * would produce a repository that is vague about both.
 *
 * What they share is the lifecycle, which is why both use `PublicationState`.
 */

import type { PublicationState } from '../domain/publication.js';
import type {
  QuestionOrigin,
  QuestionType,
  QuestionVisibility,
  TextbookQuestionRole,
} from '../domain/question-authoring.js';

export interface QuestionChoiceRecord {
  readonly id: string;
  readonly text: string;
  readonly orderIndex: number;
  readonly misconceptionKey: string | null;
  readonly feedback: string | null;
}

export interface QuestionRecord {
  readonly key: string;
  /** Where the item lives. Always present — placement is mandatory. */
  readonly lessonKey: string;
  readonly type: QuestionType;
  readonly text: string;
  readonly hint: string | null;
  readonly explanation: string | null;
  readonly points: number;
  readonly difficulty01: number;
  /**
   * Calibrated IRT difficulty (logit scale).
   *
   * Carried on the record because exam assembly judges pool coverage with it.
   * Reading it as 0 for every item would make every adaptive pool look
   * perfectly flat and fail the spread check for the wrong reason.
   */
  readonly irtDifficulty: number;
  readonly status: PublicationState;
  readonly origin: QuestionOrigin;
  readonly textbookRole: TextbookQuestionRole | null;
  /** Legacy source reference. Descriptive only, never an identity. */
  readonly sourceRef: string | null;
  /** Present for scoped teacher/private bank items. Official rows usually leave it null. */
  readonly authorUserId?: string | null;
  /** School scope for SCHOOL-visible teacher items. */
  readonly schoolId?: string | null;
  readonly visibility?: QuestionVisibility;
  readonly choices: readonly QuestionChoiceRecord[];
  readonly answerKey: {
    readonly correctChoiceIds: readonly string[];
    readonly acceptedTexts: readonly string[];
    readonly numericMin: number | null;
    readonly numericMax: number | null;
    readonly expectedOrder: readonly string[];
    readonly expectedPairs: Readonly<Record<string, string>> | null;
    readonly caseSensitive: boolean;
    readonly allowPartialCredit: boolean;
    readonly rubric: unknown;
  } | null;
  readonly concepts: ReadonlyArray<{
    conceptKey: string;
    weight: number;
    isPrimary: boolean;
  }>;
}

export interface QuestionBankListQuery {
  readonly search?: string;
  readonly type?: QuestionType;
  readonly origin?: QuestionOrigin;
  readonly status?: PublicationState;
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
  readonly limit: number;
  readonly offset: number;
}

export interface QuestionBankAccess {
  readonly canReadAll: boolean;
  readonly actorUserId?: string;
  readonly schoolIds?: readonly string[];
}

export interface QuestionBankListPage {
  readonly rows: readonly QuestionRecord[];
  readonly total: number;
}

export interface QuestionRepository {
  findQuestion(key: string): Promise<QuestionRecord | null>;

  /**
   * The lesson a question hangs off, for key derivation and scope checks.
   *
   * A question's key is derived from its primary concept's lesson, which is
   * how `EDU-…-L-SETS-Q<fp8>` stays inside the book it belongs to.
   */
  lessonKeyForConcept(conceptKey: string): Promise<string | null>;

  /** The owning textbook's status — questions inherit the book's lock. */
  textbookStatusForConcept(conceptKey: string): Promise<PublicationState | null>;

  /** Does this lesson exist? A question is placed by lesson, so this is asked
   * on every create, including for items that carry no concept yet. */
  lessonExists(lessonKey: string): Promise<boolean>;

  /**
   * Every question filed under a lesson, linked or not.
   *
   * Deliberately not filtered to the unlinked ones: a reviewer re-pointing a
   * bank needs to see an item that is linked to the WRONG concept just as much
   * as one linked to nothing, and only a human can tell those apart.
   */
  questionsForLesson(lessonKey: string): Promise<readonly QuestionRecord[]>;

  /** General item-bank listing, with access policy supplied by the application layer. */
  listQuestions?(
    query: QuestionBankListQuery,
    access: QuestionBankAccess,
  ): Promise<QuestionBankListPage>;

  /** The same lock as above, reached through the lesson. */
  textbookStatusForLesson(lessonKey: string): Promise<PublicationState | null>;

  /**
   * The concepts taught in a lesson — the only legal link targets for a
   * question filed there.
   *
   * Returned alongside the bank so a re-linking screen offers exactly the set
   * the service would accept. Letting the UI source candidates from anywhere
   * else invites offering a choice that `concept_outside_lesson` then refuses,
   * which reads to the author as the product breaking rather than as a rule.
   */
  conceptsForLesson(lessonKey: string): Promise<ReadonlyArray<{ key: string; name: string }>>;

  createQuestion(input: {
    key: string;
    lessonKey: string;
    type: QuestionType;
    text: string;
    hint: string | null;
    explanation: string | null;
    points: number;
    difficulty01: number;
    origin: QuestionOrigin;
    textbookRole: TextbookQuestionRole | null;
    sourceRef?: string | null;
    authorUserId?: string | null;
    schoolId?: string | null;
    visibility?: QuestionVisibility;
    choices: ReadonlyArray<{
      id: string;
      text: string;
      orderIndex: number;
      misconceptionKey: string | null;
      feedback: string | null;
    }>;
    answerKey: {
      correctChoiceIds: readonly string[];
      acceptedTexts: readonly string[];
      numericMin: number | null;
      numericMax: number | null;
      expectedOrder: readonly string[];
      expectedPairs: Readonly<Record<string, string>> | null;
      caseSensitive: boolean;
      allowPartialCredit: boolean;
      rubric: unknown;
    };
    concepts: ReadonlyArray<{ conceptKey: string; weight: number; isPrimary: boolean }>;
  }): Promise<QuestionRecord>;

  /**
   * Replace a draft question's content wholesale.
   *
   * Whole-object replacement rather than a patch because a question's stem,
   * options and key are one thing: patching the stem of an MCQ without its
   * options can leave a key referencing an option that no longer exists.
   */
  replaceQuestionContent(
    key: string,
    input: {
      text: string;
      hint: string | null;
      explanation: string | null;
      points: number;
      difficulty01: number;
      choices: ReadonlyArray<{
        id: string;
        text: string;
        orderIndex: number;
        misconceptionKey: string | null;
        feedback: string | null;
      }>;
      answerKey: {
        correctChoiceIds: readonly string[];
        acceptedTexts: readonly string[];
        numericMin: number | null;
        numericMax: number | null;
        expectedOrder: readonly string[];
        expectedPairs: Readonly<Record<string, string>> | null;
        caseSensitive: boolean;
        allowPartialCredit: boolean;
        rubric: unknown;
      };
    },
  ): Promise<void>;

  setQuestionConcepts(
    key: string,
    concepts: ReadonlyArray<{ conceptKey: string; weight: number; isPrimary: boolean }>,
  ): Promise<void>;

  setQuestionStatus(key: string, status: PublicationState): Promise<void>;

  updateQuestionMetadata?(
    key: string,
    fields: {
      origin?: QuestionOrigin;
      textbookRole?: TextbookQuestionRole | null;
      sourceRef?: string | null;
      visibility?: QuestionVisibility;
      schoolId?: string | null;
    },
  ): Promise<void>;

  /** Has anyone answered this question? Evidence freezes its content. */
  questionHasResponses(key: string): Promise<boolean>;

  /** Do these concept keys all exist, and are they in the same textbook? */
  resolveConcepts(
    conceptKeys: readonly string[],
  ): Promise<Array<{ conceptKey: string; textbookKey: string }>>;

  /**
   * Which of these misconception keys exist in the catalogue?
   *
   * Exists so the service can REFUSE an unknown key. The adapter resolves
   * `misconceptionKey` → `misconceptionId` and previously fell back to `null`
   * when the lookup missed, which stored the choice with no misconception
   * attached and returned 201. The whole diagnosis chain — distractor →
   * evidence → mastery recompute → learner_misconceptions → remediation —
   * then produced nothing, silently, for that question.
   */
  resolveMisconceptions(keys: readonly string[]): Promise<string[]>;
}

export interface ExamItemRecord {
  readonly questionKey: string;
  readonly orderIndex: number;
  readonly points: number;
  readonly questionStatus: PublicationState;
  readonly questionType: QuestionType;
  readonly irtDifficulty: number;
  readonly conceptKeys: readonly string[];
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
  readonly status: PublicationState;
  readonly items: readonly ExamItemRecord[];
}

export interface ExamListQuery {
  readonly search?: string;
  readonly status?: PublicationState;
  readonly textbookKey?: string;
  readonly isAdaptive?: boolean;
  readonly limit: number;
  readonly offset: number;
}

export interface ExamListPage {
  readonly rows: readonly ExamRecord[];
  readonly total: number;
}

export interface ExamRepository {
  findExam(key: string): Promise<ExamRecord | null>;

  listExams?(query: ExamListQuery, access: QuestionBankAccess): Promise<ExamListPage>;

  createExam(input: {
    key: string;
    title: string;
    description: string | null;
    textbookKey: string | null;
    authorUserId: string | null;
    schoolId: string | null;
    visibility: QuestionVisibility;
    isAdaptive: boolean;
    passingScore: number;
    timeLimitMins: number | null;
    minItems: number;
    maxItems: number;
    targetStandardError: number;
  }): Promise<ExamRecord>;

  updateExam(key: string, fields: Readonly<Record<string, unknown>>): Promise<void>;

  setExamStatus(key: string, status: PublicationState, publishedAt?: Date): Promise<void>;

  /** Replace the whole item list. Composition is all-or-nothing. */
  setExamItems(
    key: string,
    items: ReadonlyArray<{ questionKey: string; orderIndex: number; points: number }>,
  ): Promise<void>;

  /** Has anyone sat this exam? Attempts freeze its composition. */
  examHasAttempts(key: string): Promise<boolean>;
}

export interface ResourceRecord {
  readonly key: string;
  readonly kind: string;
  readonly title: string;
  readonly url: string | null;
  readonly body: string | null;
  readonly textbookKey: string | null;
  readonly lessonKey: string | null;
  readonly conceptKey: string | null;
  readonly slug: string | null;
  readonly orderIndex: number;
  readonly pageStart: number | null;
  readonly pageEnd: number | null;
  readonly estimatedMins: number | null;
  readonly isActive: boolean;
}

export interface FlashcardRecord {
  readonly key: string;
  readonly conceptKey: string;
  readonly front: string;
  readonly back: string;
  readonly reviewPriority: number;
  readonly difficulty: number;
  readonly isActive: boolean;
}

/**
 * Authored flashcards.
 *
 * Like resources, cards are retired rather than deleted: a deck a learner
 * studied last week should still be explicable next week.
 */
export interface FlashcardRepository {
  findCard(key: string): Promise<FlashcardRecord | null>;

  createCard(input: {
    key: string;
    conceptKey: string;
    front: string;
    back: string;
    reviewPriority: number;
    difficulty: number;
  }): Promise<FlashcardRecord>;

  updateCard(key: string, fields: Readonly<Record<string, unknown>>): Promise<void>;

  setCardActive(key: string, isActive: boolean): Promise<void>;

  listForConcept(conceptKey: string): Promise<FlashcardRecord[]>;

  /** The owning textbook's status — a card inherits its lock. */
  textbookStatusForConcept(conceptKey: string): Promise<PublicationState | null>;
}

export interface ResourceRepository {
  findResource(key: string): Promise<ResourceRecord | null>;

  createResource(input: {
    key: string;
    kind: string;
    title: string;
    url: string | null;
    body: string | null;
    textbookKey: string | null;
    lessonKey: string | null;
    conceptKey: string | null;
    slug: string | null;
    orderIndex: number;
    pageStart: number | null;
    pageEnd: number | null;
    estimatedMins: number | null;
  }): Promise<ResourceRecord>;

  updateResource(key: string, fields: Readonly<Record<string, unknown>>): Promise<void>;

  /**
   * Resources are retired, never deleted.
   *
   * A decision log line says "we showed this learner this resource"; deleting
   * the row would make that history unreadable.
   */
  setResourceActive(key: string, isActive: boolean): Promise<void>;

  listForConcept(conceptKey: string): Promise<ResourceRecord[]>;

  /**
   * Resources attached directly to a textbook (never to one of its lessons
   * or concepts) — the book-wide shelf: a full-book PDF, a teacher's guide,
   * a reference the whole book shares rather than one lesson.
   */
  listForTextbook(textbookKey: string): Promise<ResourceRecord[] | null>;

  /** The owning textbook's status — a resource inherits its lock. */
  textbookStatusForResource(input: {
    textbookKey?: string | null;
    lessonKey?: string | null;
    conceptKey?: string | null;
  }): Promise<PublicationState | null>;
}
