/**
 * Analytics — reporting over evidence other contexts own.
 *
 * Orchestration only, and unusually strictly so: this service loads numbers
 * and hands them to pure functions. It computes no mastery, applies no decay,
 * grades nothing and decides nothing about what a learner should do next.
 *
 * That is not modesty, it is the fix for a specific legacy failure. The old
 * "dashboard service" recomputed mastery on its way to rendering it, using its
 * own formula, and that is how one concept came to show two different
 * masteries on two screens. A report that disagrees with the system it reports
 * on is worse than no report.
 */

import { Errors } from '../../../shared/kernel/errors.js';
import { Err, Ok, type Result } from '../../../shared/kernel/result.js';
import type { Clock } from '../../../shared/kernel/clock.js';
import { DEFAULT_MASTERY_THRESHOLD } from '../../mastery/domain/mastery-level.js';
import {
  distribution,
  summariseActivity,
  summariseConcept,
  summariseLearner,
  weakestConcepts,
  type ActivitySummary,
  type ConceptSummary,
  type Distribution,
  type LearnerStanding,
  type MasteryPoint,
} from '../domain/cohort-analytics.js';
import {
  analyseItem,
  needsAuthorReview,
  type ItemStatistics,
} from '../domain/item-statistics.js';
import { summariseExam, type ExamResults } from '../domain/exam-results.js';
import type {
  AnalyticsReader,
  CohortScope,
  ExamResultsReader,
  ItemAnalyticsReader,
  ItemStatisticsWriter,
} from './ports.js';

export interface CohortReport {
  readonly scope: CohortScope;
  readonly learners: number;
  readonly concepts: readonly ConceptSummary[];
  readonly weakest: readonly ConceptSummary[];
  readonly distribution: Distribution;
  readonly activity: ActivitySummary;
  readonly generatedAt: string;
}

export interface ItemHealthReport {
  readonly questionKey: string;
  readonly statistics: ItemStatistics;
  readonly needsReview: boolean;
}

/**
 * Every (learner, concept) pair, with absent rows marked unassessed.
 *
 * `observations: 0` is the domain's signal for "no evidence", which it counts
 * separately from a low score. The default threshold only applies to rows that
 * do not exist, and those rows are excluded from every average anyway.
 */
function fillGrid(
  learnerKeys: readonly string[],
  conceptKeys: readonly string[],
  points: readonly MasteryPoint[],
): MasteryPoint[] {
  const byPair = new Map(points.map((p) => [`${p.learnerKey}\u0000${p.conceptKey}`, p]));
  const out: MasteryPoint[] = [];

  for (const learnerKey of learnerKeys) {
    for (const conceptKey of conceptKeys) {
      const existing = byPair.get(`${learnerKey}\u0000${conceptKey}`);
      out.push(
        existing ?? {
          learnerKey,
          conceptKey,
          mastery: 0,
          observations: 0,
          threshold: DEFAULT_MASTERY_THRESHOLD,
        },
      );
    }
  }

  return out;
}

export class AnalyticsService {
  constructor(
    private readonly reader: AnalyticsReader,
    private readonly items: ItemAnalyticsReader,
    private readonly clock: Clock,
    private readonly statisticsWriter?: ItemStatisticsWriter,
    private readonly exams?: ExamResultsReader,
  ) {}

  /**
   * How did this class do on this exam?
   *
   * Analytics owns this and not Assessment: Assessment grades ONE attempt and
   * must not grow cohort reporting, which is where the legacy "dashboard
   * service" started before it began recomputing mastery. Every number here is
   * read from what Assessment already stored.
   *
   * Scoped by cohort, so the denominator is "learners the teacher expects to
   * sit it", not "everyone in the country who opened this exam". That is also
   * what makes `notStarted` meaningful.
   */
  async examResults(input: {
    examKey: string;
    scope: CohortScope;
  }): Promise<Result<ExamResults>> {
    if (!this.exams) {
      return Err(
        Errors.unavailable('analytics.exam_results_unavailable', 'Exam results are not wired.'),
      );
    }

    const exam = await this.exams.findExam(input.examKey);
    if (!exam) {
      return Err(
        Errors.notFound('analytics.exam_not_found', 'No such exam.', { examKey: input.examKey }),
      );
    }

    const learners = await this.reader.learnersInScope(input.scope);
    if (learners.length === 0) {
      return Err(
        Errors.notFound('analytics.empty_cohort', 'No learners are enrolled in this scope.', {
          scope: input.scope,
        }),
      );
    }

    // Sequential, not Promise.all: two concurrent queries on a single-connection
    // adapter kill the connection, and the failure surfaces far from here.
    const sittings = await this.exams.sittings({ examKey: input.examKey, learnerKeys: learners });
    const items = await this.exams.itemOutcomes({
      examKey: input.examKey,
      learnerKeys: learners,
    });

    return Ok(
      summariseExam({
        examKey: exam.examKey,
        title: exam.title,
        learnerKeys: learners,
        sittings,
        items,
      }),
    );
  }

  /**
   * The teacher's view of a class.
   *
   * One report rather than five endpoints because the numbers have to agree
   * with each other: computing the distribution from one query and the
   * concept table from another taken a second later produces a report whose
   * halves contradict each other, and a teacher has no way to tell which half
   * is right.
   */
  async cohortReport(input: {
    scope: CohortScope;
    textbookKey?: string | null;
    conceptKeys?: readonly string[];
    since?: Date | null;
  }): Promise<Result<CohortReport>> {
    const learners = await this.reader.learnersInScope(input.scope);
    if (learners.length === 0) {
      return Err(
        Errors.notFound('analytics.empty_cohort', 'No learners are enrolled in this scope.', {
          scope: input.scope,
        }),
      );
    }

    const conceptKeys = input.conceptKeys?.length
      ? [...input.conceptKeys]
      : input.textbookKey
        ? await this.reader.conceptKeysInTextbook(input.textbookKey)
        : [];

    const [points, attempts] = await Promise.all([
      this.reader.masteryPoints({
        learnerKeys: learners,
        ...(conceptKeys.length ? { conceptKeys } : {}),
        textbookKey: input.textbookKey ?? null,
      }),
      this.reader.attemptCounts({ learnerKeys: learners, since: input.since ?? null }),
    ]);

    // Every concept in scope gets a row, including ones nobody has touched.
    // Omitting them would make an untaught topic invisible rather than
    // visibly unstarted.
    const covered = conceptKeys.length
      ? conceptKeys
      : [...new Set(points.map((p) => p.conceptKey))];

    // Fill the learner x concept grid before summarising.
    //
    // The repository returns only mastery rows that EXIST, so a learner who
    // has never touched a concept is simply absent. The domain is built to
    // count those learners as unassessed and keep them out of the averages —
    // but it can only do that if it is told they exist. Without this, a class
    // where two of thirty learners have started a topic reports as a class
    // averaging those two, and the other twenty-eight vanish from the report
    // entirely.
    const complete = fillGrid(learners, covered, points);

    const concepts = covered.map((conceptKey) => summariseConcept(conceptKey, complete));

    return Ok({
      scope: input.scope,
      learners: learners.length,
      concepts,
      weakest: weakestConcepts(concepts),
      distribution: distribution(complete),
      activity: summariseActivity(learners, attempts),
      generatedAt: this.clock.now().toISOString(),
    });
  }

  /** One learner's standing. Reported, never used to decide anything. */
  async learnerReport(input: {
    learnerKey: string;
    textbookKey?: string | null;
    conceptKeys?: readonly string[];
  }): Promise<Result<LearnerStanding>> {
    const conceptKeys = input.conceptKeys?.length
      ? [...input.conceptKeys]
      : input.textbookKey
        ? await this.reader.conceptKeysInTextbook(input.textbookKey)
        : [];

    const points = await this.reader.masteryPoints({
      learnerKeys: [input.learnerKey],
      ...(conceptKeys.length ? { conceptKeys } : {}),
      textbookKey: input.textbookKey ?? null,
    });

    return Ok(summariseLearner(input.learnerKey, points));
  }

  /**
   * How is this question behaving in the wild?
   *
   * The one report that can find a wrong answer key. Authoring validation
   * proves an item is gradable; only the responses can show it is being graded
   * the wrong way round.
   */
  async itemHealth(questionKey: string): Promise<Result<ItemHealthReport>> {
    const responses = await this.items.responsesForQuestion(questionKey);
    const scores = await this.items.overallScores(responses.map((r) => r.learnerKey));

    const statistics = analyseItem(responses, scores);

    return Ok({
      questionKey,
      statistics,
      needsReview: needsAuthorReview(statistics),
    });
  }

  /**
   * Sweep a textbook's question bank and return only what needs attention.
   *
   * Returns the flagged items rather than all of them: a report listing every
   * question is a report nobody opens, and the miskeyed item stays live.
   */
  async bankHealth(textbookKey: string): Promise<Result<{
    scanned: number;
    analysable: number;
    flagged: readonly ItemHealthReport[];
  }>> {
    const questionKeys = await this.items.questionKeysInTextbook(textbookKey);

    const reports: ItemHealthReport[] = [];
    for (const questionKey of questionKeys) {
      const report = await this.itemHealth(questionKey);
      if (report.ok) reports.push(report.value);
    }

    const analysable = reports.filter(
      (r) => !r.statistics.flags.includes('INSUFFICIENT_DATA'),
    );

    return Ok({
      scanned: reports.length,
      analysable: analysable.length,
      flagged: analysable.filter((r) => r.statistics.flags.length > 0),
    });
  }

  /**
   * Refresh the cached counters on a question.
   *
   * A projection, not a source of truth: deleting these columns and running
   * this again must produce the same numbers, which is why they are computed
   * from the responses every time rather than incremented in place. An
   * increment would drift the moment one write is retried.
   */
  async refreshQuestionStatistics(questionKey: string): Promise<Result<void>> {
    if (!this.statisticsWriter) {
      return Err(
        Errors.conflict(
          'analytics.projector_unavailable',
          'This deployment has no statistics writer configured.',
        ),
      );
    }

    const responses = await this.items.responsesForQuestion(questionKey);
    if (responses.length === 0) {
      await this.statisticsWriter.updateQuestionStatistics(questionKey, {
        timesAdministered: 0,
        correctRate: 0,
        avgSecondsToAnswer: 0,
      });
      return Ok(undefined);
    }

    const timed = responses.flatMap((r) =>
      r.timeSpentSeconds == null ? [] : [r.timeSpentSeconds],
    );

    await this.statisticsWriter.updateQuestionStatistics(questionKey, {
      timesAdministered: responses.length,
      correctRate: responses.filter((r) => r.correct).length / responses.length,
      avgSecondsToAnswer:
        timed.length === 0 ? 0 : timed.reduce((a, b) => a + b, 0) / timed.length,
    });

    return Ok(undefined);
  }
}
