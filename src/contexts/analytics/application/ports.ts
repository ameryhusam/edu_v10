/**
 * Ports owned by the Analytics context.
 *
 * Every port here is READ-ONLY, and that is the whole architectural claim of
 * this context. Analytics observes; it does not participate. There is no port
 * to write mastery, no port to write evidence, no port to change a question —
 * so no future edit to this context can quietly become a second writer.
 *
 * The one exception is `ItemStatisticsWriter`, and it is deliberately narrow:
 * it updates the three cached counters on Question that the schema already
 * describes as "updated by the analytics projector, never by hand". It cannot
 * touch the stem, the key, the status or the IRT parameters.
 */

import type { ItemResponse, LearnerScore } from '../domain/item-statistics.js';
import type { MasteryPoint } from '../domain/cohort-analytics.js';

export interface CohortScope {
  readonly schoolId: string;
  readonly gradeId?: string | null;
  readonly termId?: string | null;
}

/**
 * One learner on a teacher's roster (gap G3).
 *
 * Edu7 has no class or section model by decision — "a class is a query" over
 * current enrollments. So a roster is a scope (school + optionally grade and
 * term), not a stored list, and this is the named, ordered projection of it.
 *
 * Deliberately thin: identity plus where they sit. Mastery is NOT on this
 * shape. A roster read that also computed every learner's standing would be a
 * cohort report, and that already exists at `/analytics/cohort` — merging them
 * would make opening a name list pay for a full mastery sweep.
 */
export interface RosterLearner {
  readonly learnerKey: string;
  readonly fullName: string;
  readonly gradeName: string;
  readonly gradeId: string;
}

export interface AnalyticsReader {
  /** Learner keys in a scope. The same "class is a query" resolution. */
  learnersInScope(scope: CohortScope): Promise<string[]>;

  /** Named roster for a scope, ordered for display (G3). */
  rosterInScope(scope: CohortScope): Promise<readonly RosterLearner[]>;

  /** Current mastery for a set of learners, decay already applied. */
  masteryPoints(input: {
    learnerKeys: readonly string[];
    conceptKeys?: readonly string[];
    textbookKey?: string | null;
  }): Promise<MasteryPoint[]>;

  /** Submitted attempt counts per learner, for engagement. */
  attemptCounts(input: {
    learnerKeys: readonly string[];
    since?: Date | null;
  }): Promise<Map<string, number>>;

  /** Concept keys under a textbook, so a report can cover a whole book. */
  conceptKeysInTextbook(textbookKey: string): Promise<string[]>;
}

export interface ItemAnalyticsReader {
  /** Every graded response to one question. */
  responsesForQuestion(questionKey: string): Promise<ItemResponse[]>;

  /**
   * Overall performance for the learners who answered it.
   *
   * Discrimination compares an item against how learners did generally, so
   * this is the "total score" half of the classical statistic.
   */
  overallScores(learnerKeys: readonly string[]): Promise<LearnerScore[]>;

  /** Published questions attached to a textbook, for a bank-wide sweep. */
  questionKeysInTextbook(textbookKey: string): Promise<string[]>;
}

/** One learner's sitting of an exam. Scores are read, never recomputed. */
export interface ExamSitting {
  readonly learnerKey: string;
  readonly attemptKey: string;
  /** Null while still in progress. */
  readonly score: number | null;
  readonly maxScore: number | null;
  readonly correctCount: number | null;
  readonly incorrectCount: number | null;
  /** Answers a human must still mark; a percentage would be a lie until zero. */
  readonly pendingReviewCount: number | null;
  readonly submittedAt: Date | null;
}

/** How one question behaved on one exam. */
export interface ExamItemOutcome {
  readonly questionKey: string;
  readonly orderIndex: number;
  readonly correct: number;
  readonly incorrect: number;
  readonly pending: number;
}

export interface ExamResultsReader {
  /** Exam metadata, or null when no such exam exists. */
  findExam(examKey: string): Promise<{ examKey: string; title: string } | null>;

  /**
   * Every sitting of this exam by the learners in scope.
   *
   * Scoped by learner, not by exam alone: a teacher sees their cohort, not
   * every school that uses the same exam.
   */
  sittings(input: {
    examKey: string;
    learnerKeys: readonly string[];
  }): Promise<ExamSitting[]>;

  /** Per-question outcomes across those same sittings. */
  itemOutcomes(input: {
    examKey: string;
    learnerKeys: readonly string[];
  }): Promise<ExamItemOutcome[]>;
}

/**
 * The only writer in the context, and it writes only cached statistics.
 *
 * These three columns are a projection of the responses. Storing them is a
 * read-performance decision, not a source of truth: deleting them and
 * recomputing from `attempt_items` must produce the same numbers.
 */
export interface ItemStatisticsWriter {
  updateQuestionStatistics(
    questionKey: string,
    stats: {
      timesAdministered: number;
      correctRate: number;
      avgSecondsToAnswer: number;
    },
  ): Promise<void>;
}
