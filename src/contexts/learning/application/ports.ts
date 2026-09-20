/**
 * Ports owned by the Learning context.
 *
 * Learning is a CONSUMER context: it reads canonical content, canonical
 * mastery and canonical evidence, then decides. It owns no copy of any of them.
 * These read-only ports make that non-negotiable at the type level.
 */

import type { PrerequisiteEdge } from '../domain/prerequisite-graph.js';
import type { ActivityType, Decision } from '../domain/next-activity.js';

export interface ConceptDescriptor {
  readonly conceptKey: string;
  readonly name: string;
  readonly lessonKey: string;
  /**
   * The unit the concept's lesson belongs to.
   *
   * Carried on the descriptor rather than re-derived by string-slicing the
   * canonical key. The key format is a rendering of the hierarchy, not the
   * source of it: parsing it here would silently break the day a key format
   * changes, and KEY-IDENTITY-AUDIT froze the format precisely so that nothing
   * would depend on its internal structure.
   */
  readonly unitKey: string;
  readonly orderIndex: number;
  readonly masteryThreshold: number;
  readonly isCore: boolean;
  /**
   * The lesson's and unit's display names. Carried for the same reason as
   * `unitKey`: the path renders "Lesson 3 of unit تركيب المادة", and a client
   * that had to fetch names separately would render the path in two round
   * trips with two chances to disagree about ordering.
   */
  readonly lessonName: string;
  readonly unitName: string;
}

/** A learning resource as the learner may see it. Content only — no progress. */
export interface LessonResourceView {
  readonly key: string;
  readonly kind: string;
  readonly title: string;
  readonly body: string | null;
  readonly url: string | null;
  readonly orderIndex: number;
  readonly estimatedMins: number | null;
}

/** A lesson's shelf data, in book order. */
export interface LessonShelfItem {
  readonly lessonKey: string;
  readonly lessonName: string;
  readonly unitKey: string;
  readonly unitName: string;
  readonly startPage: number | null;
  readonly endPage: number | null;
  readonly estimatedMins: number | null;
}

/** One lesson, opened: its shelf data, its concepts, its resources. */
export interface LessonView {
  readonly key: string;
  readonly name: string;
  readonly startPage: number | null;
  readonly endPage: number | null;
  readonly estimatedMins: number | null;
  readonly unitKey: string;
  readonly unitName: string;
  readonly textbookKey: string;
  readonly textbookTitle: string;
  readonly concepts: readonly ConceptDescriptor[];
  readonly resources: readonly LessonResourceView[];
}

/** Read-only window into the Content context. */
export interface ContentReader {
  conceptsInLesson(lessonKey: string): Promise<ConceptDescriptor[]>;
  conceptsInTextbook(textbookKey: string): Promise<ConceptDescriptor[]>;
  prerequisitesFor(conceptKeys: readonly string[]): Promise<PrerequisiteEdge[]>;
  lessonExists(lessonKey: string): Promise<boolean>;
  /** The lesson with everything a lesson screen shows. Null = no such lesson. */
  lessonView(lessonKey: string): Promise<LessonView | null>;
  /**
   * Every lesson of the book in reading order, with its shelf data. The
   * journey uses this to expose the book's structure — see `LessonStop`.
   */
  lessonShelf(textbookKey: string): Promise<LessonShelfItem[]>;
}

/**
 * One textbook this learner is entitled to study.
 *
 * `subject` and `grade` are carried because every caller needs them to label
 * the book, and a second round trip per book to fetch a name is the classic
 * shape of a list endpoint that becomes unusable at thirty rows.
 */
export interface LearnerTextbook {
  readonly key: string;
  readonly title: string;
  readonly subjectKey: string;
  readonly subjectName: string;
  readonly gradeKey: string;
  readonly gradeName: string;
  readonly termKey: string;
  readonly termName: string;
  readonly academicYearKey: string;
  readonly edition: string;
  readonly totalPages: number | null;
}

/**
 * What may this learner study?
 *
 * Gap G1: every learner endpoint took a textbook key and nothing returned one,
 * so the only way to reach content was to already know a key. The seed hid this
 * by hardcoding one.
 *
 * Entitlement is derived, never stored on the learner: current enrollment gives
 * school, academic year, term and grade; the school's adoptions for that year
 * give the books; the publication gate decides which are visible. A learner
 * with no current enrollment is entitled to nothing, which is correct and is
 * why the list can legitimately be empty.
 */
export interface LearnerEntitlementReader {
  textbooksFor(learnerKey: string): Promise<LearnerTextbook[]>;
}

/** Read-only window into the Mastery context. */
export interface MasteryReader {
  profileFor(
    learnerKey: string,
    conceptKeys: readonly string[],
  ): Promise<
    Map<
      string,
      {
        mastery: number;
        effectiveMastery: number;
        confidence: number;
        retrievability: number;
        attemptsCount: number;
      }
    >
  >;
}

/** Read-only window into diagnosed misconceptions. */
export interface MisconceptionReader {
  openForLearner(
    learnerKey: string,
    conceptKeys: readonly string[],
  ): Promise<Map<string, string[]>>;
}

export interface LearningResource {
  readonly resourceKey: string;
  readonly title: string;
  readonly kind: 'READING' | 'VIDEO' | 'WORKED_EXAMPLE' | 'FLASHCARD_DECK' | 'REMEDIAL';
  readonly conceptKey: string;
  readonly url?: string | null;
  readonly pageRange?: { start: number; end: number } | null;
  readonly estimatedMinutes: number | null;
}

export interface ResourceReader {
  forConcept(conceptKey: string, kinds?: readonly LearningResource['kind'][]): Promise<LearningResource[]>;
}

/**
 * Records why the platform proposed an activity.
 *
 * This exists so a decision stays explainable long after the mastery numbers
 * that produced it have moved on. Without it, "why did my student get this?"
 * is unanswerable a week later. Logging must never fail the request: a lost
 * audit line is bad, a learner blocked from studying is worse.
 */
export interface DecisionLogWriter {
  record(entry: {
    learnerKey: string;
    activity: ActivityType;
    conceptKey: string | null;
    rule: string;
    rationale: string;
    evidence: Readonly<Record<string, unknown>>;
  }): Promise<void>;
}

/** The learner-facing plan produced by the decision engine. */
export interface LearningStep {
  readonly activity: ActivityType;
  readonly conceptKey: string | null;
  readonly conceptName: string | null;
  readonly rule: string;
  readonly rationale: string;
  readonly resources: readonly LearningResource[];
  readonly targetDifficulty: number | null;
}

export interface NextStepResult {
  readonly step: LearningStep;
  readonly decision: Decision;
  readonly progress: {
    readonly totalConcepts: number;
    readonly masteredConcepts: number;
    readonly percentComplete: number;
  };
}
