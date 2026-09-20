/**
 * Prisma adapters for the Analytics read ports.
 *
 * Read-only by construction, with one exception (`PrismaItemStatisticsWriter`)
 * that touches exactly the three cached counters the schema reserves for it.
 *
 * The important detail is that mastery is read the SAME way the learner-facing
 * reader reads it: stored value times retrievability, decay projected at read
 * time and never written back. Reading the raw column here instead would make
 * a teacher's dashboard disagree with the learner's own screen — which is
 * precisely the legacy bug this context was rebuilt to avoid.
 */

import { daysBetween } from '../../shared/kernel/clock.js';
import { retrievability } from '../../contexts/mastery/domain/retention.js';
import type {
  AnalyticsReader,
  CohortScope,
  ExamItemOutcome,
  ExamResultsReader,
  ExamSitting,
  ItemAnalyticsReader,
  ItemStatisticsWriter,
  RosterLearner,
} from '../../contexts/analytics/application/ports.js';
import type { MasteryPoint } from '../../contexts/analytics/domain/cohort-analytics.js';
import type {
  ItemResponse,
  LearnerScore,
} from '../../contexts/analytics/domain/item-statistics.js';
import { publishedQuestion } from './published-content.js';
import type { Db } from './prisma.client.js';

export class PrismaAnalyticsReader implements AnalyticsReader {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async learnersInScope(scope: CohortScope): Promise<string[]> {
    const rows = await this.db.enrollment.findMany({
      where: {
        schoolId: scope.schoolId,
        isCurrent: true,
        ...(scope.gradeId ? { gradeId: scope.gradeId } : {}),
        ...(scope.termId ? { termId: scope.termId } : {}),
      },
      select: { learner: { select: { key: true } } },
    });
    return rows.map((r) => r.learner.key);
  }

  /**
   * The same scope as `learnersInScope`, but named and ordered (G3).
   *
   * A separate method rather than a widening: `learnersInScope` feeds every
   * cohort computation and should stay a one-column read. This one joins the
   * user and the grade because a teacher needs to see people, not keys.
   *
   * Ordered by grade then name so the list is stable between loads — a roster
   * that reshuffles on refresh is unusable for taking attendance against.
   */
  async rosterInScope(scope: CohortScope): Promise<readonly RosterLearner[]> {
    const rows = await this.db.enrollment.findMany({
      where: {
        schoolId: scope.schoolId,
        isCurrent: true,
        ...(scope.gradeId ? { gradeId: scope.gradeId } : {}),
        ...(scope.termId ? { termId: scope.termId } : {}),
      },
      select: {
        grade: { select: { id: true, name: true, ordinal: true } },
        learner: { select: { key: true, user: { select: { fullName: true } } } },
      },
      orderBy: [{ grade: { ordinal: 'asc' } }, { learner: { user: { fullName: 'asc' } } }],
    });

    return rows.map((row) => ({
      learnerKey: row.learner.key,
      fullName: row.learner.user.fullName,
      gradeName: row.grade.name,
      gradeId: row.grade.id,
    }));
  }

  /**
   * Current mastery for a cohort, with decay applied.
   *
   * Returns a row per (learner, concept) that has a mastery record. Learners
   * with no record for a concept are absent, and the domain counts them as
   * unassessed — which is a different thing from scoring zero.
   */
  async masteryPoints(input: {
    learnerKeys: readonly string[];
    conceptKeys?: readonly string[];
    textbookKey?: string | null;
  }): Promise<MasteryPoint[]> {
    if (input.learnerKeys.length === 0) return [];

    const rows = await this.db.conceptMastery.findMany({
      where: {
        learner: { key: { in: [...input.learnerKeys] } },
        ...(input.conceptKeys?.length
          ? { concept: { key: { in: [...input.conceptKeys] } } }
          : input.textbookKey
            ? { concept: { lesson: { unit: { textbook: { key: input.textbookKey } } } } }
            : {}),
      },
      select: {
        mastery: true,
        stabilityDays: true,
        lastObservedAt: true,
        attemptsCount: true,
        learner: { select: { key: true } },
        concept: { select: { key: true, masteryThreshold: true } },
      },
    });

    const now = this.now();
    return rows.map((row) => {
      const elapsed = row.lastObservedAt ? Math.max(0, daysBetween(row.lastObservedAt, now)) : 0;
      const recall = retrievability(elapsed, row.stabilityDays);
      return {
        learnerKey: row.learner.key,
        conceptKey: row.concept.key,
        // Effective mastery, matching what the learner's own screen shows.
        mastery: Number((row.mastery * recall).toFixed(6)),
        observations: row.attemptsCount,
        threshold: row.concept.masteryThreshold,
      };
    });
  }

  async attemptCounts(input: {
    learnerKeys: readonly string[];
    since?: Date | null;
  }): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (input.learnerKeys.length === 0) return out;

    const rows = await this.db.attempt.groupBy({
      by: ['learnerId'],
      where: {
        learner: { key: { in: [...input.learnerKeys] } },
        status: 'SUBMITTED',
        ...(input.since ? { submittedAt: { gte: input.since } } : {}),
      },
      _count: { _all: true },
    });

    const learners = await this.db.learnerProfile.findMany({
      where: { id: { in: rows.map((r) => r.learnerId) } },
      select: { id: true, key: true },
    });
    const keyById = new Map(learners.map((l) => [l.id, l.key]));

    for (const row of rows) {
      const key = keyById.get(row.learnerId);
      if (key) out.set(key, row._count._all);
    }
    return out;
  }

  async conceptKeysInTextbook(textbookKey: string): Promise<string[]> {
    const rows = await this.db.concept.findMany({
      where: { lesson: { unit: { textbook: { key: textbookKey } } }, isActive: true },
      select: { key: true },
      orderBy: { key: 'asc' },
    });
    return rows.map((r) => r.key);
  }
}

export class PrismaItemAnalyticsReader implements ItemAnalyticsReader {
  constructor(private readonly db: Db) {}

  /**
   * Every graded response to a question.
   *
   * SKIPPED, INVALID and REQUIRES_MANUAL_REVIEW are excluded: an item analysis
   * asks "of the people who answered, who got it right", and a skipped item
   * carries no information about that. Counting a skip as incorrect would make
   * every question at the end of a timed paper look badly written.
   */
  async responsesForQuestion(questionKey: string): Promise<ItemResponse[]> {
    const rows = await this.db.attemptItem.findMany({
      where: {
        question: { key: questionKey },
        verdict: { in: ['CORRECT', 'INCORRECT', 'PARTIALLY_CORRECT'] },
      },
      select: {
        verdict: true,
        rawAnswer: true,
        timeSpentSeconds: true,
        attempt: { select: { learner: { select: { key: true } } } },
      },
    });

    return rows.map((row) => ({
      learnerKey: row.attempt.learner.key,
      // Partial credit is not full credit: for a classical item analysis the
      // question is binary, and treating "half right" as right would flatten
      // the contrast the statistic depends on.
      correct: row.verdict === 'CORRECT',
      chosenOptionId: firstChoiceId(row.rawAnswer),
      timeSpentSeconds: row.timeSpentSeconds,
    }));
  }

  /**
   * How each learner did overall, across every graded response.
   *
   * The denominator is all their graded answers rather than a single paper,
   * because the item bank is shared: a question can appear on a practice
   * attempt and an exam, and the ability estimate should not depend on which.
   */
  async overallScores(learnerKeys: readonly string[]): Promise<LearnerScore[]> {
    const unique = [...new Set(learnerKeys)];
    if (unique.length === 0) return [];

    const rows = await this.db.attemptItem.groupBy({
      by: ['attemptId'],
      where: {
        attempt: { learner: { key: { in: unique } } },
        verdict: { in: ['CORRECT', 'INCORRECT', 'PARTIALLY_CORRECT'] },
      },
      _count: { _all: true },
    });
    if (rows.length === 0) return [];

    // Resolve attempts to learners, then fold. Prisma cannot group by a
    // relation field, so the join happens here rather than in SQL.
    const attempts = await this.db.attempt.findMany({
      where: { id: { in: rows.map((r) => r.attemptId) } },
      select: {
        id: true,
        learner: { select: { key: true } },
        items: {
          where: { verdict: { in: ['CORRECT', 'INCORRECT', 'PARTIALLY_CORRECT'] } },
          select: { verdict: true },
        },
      },
    });

    const tally = new Map<string, { correct: number; total: number }>();
    for (const attempt of attempts) {
      const entry = tally.get(attempt.learner.key) ?? { correct: 0, total: 0 };
      for (const item of attempt.items) {
        entry.total += 1;
        if (item.verdict === 'CORRECT') entry.correct += 1;
      }
      tally.set(attempt.learner.key, entry);
    }

    return [...tally.entries()].map(([learnerKey, t]) => ({
      learnerKey,
      proportionCorrect: t.total === 0 ? 0 : t.correct / t.total,
    }));
  }

  async questionKeysInTextbook(textbookKey: string): Promise<string[]> {
    const rows = await this.db.question.findMany({
      where: {
        // The shared filter, not a literal: an item-health sweep must cover
        // exactly the questions learners can actually be served.
        ...publishedQuestion,
        concepts: {
          some: { concept: { lesson: { unit: { textbook: { key: textbookKey } } } } },
        },
      },
      select: { key: true },
      orderBy: { key: 'asc' },
    });
    return rows.map((r) => r.key);
  }
}

/**
 * Which option did the learner pick?
 *
 * Only meaningful for choice-based items; everything else yields null and the
 * domain reports no distractors. Multi-select deliberately returns just the
 * first: distractor analysis is about single-choice pull, and summing partial
 * selections would produce shares that do not add to 1.
 */
function firstChoiceId(rawAnswer: unknown): string | null {
  if (typeof rawAnswer !== 'object' || rawAnswer === null) return null;
  const choiceIds = (rawAnswer as { choiceIds?: unknown }).choiceIds;
  if (!Array.isArray(choiceIds) || choiceIds.length !== 1) return null;
  return typeof choiceIds[0] === 'string' ? choiceIds[0] : null;
}

/**
 * The only writer in Analytics.
 *
 * Restricted to the three cached counters the schema reserves for it. It
 * cannot reach the stem, the answer key, the status or the IRT parameters —
 * the method signature is the enforcement, and rule AW1 keeps it that way.
 */
export class PrismaItemStatisticsWriter implements ItemStatisticsWriter {
  constructor(private readonly db: Db) {}

  async updateQuestionStatistics(
    questionKey: string,
    stats: { timesAdministered: number; correctRate: number; avgSecondsToAnswer: number },
  ): Promise<void> {
    await this.db.question.update({
      where: { key: questionKey },
      data: {
        timesAdministered: stats.timesAdministered,
        correctRate: stats.correctRate,
        avgSecondsToAnswer: stats.avgSecondsToAnswer,
      },
    });
  }
}

/**
 * Exam results. READ ONLY — every number already exists on `attempts` and
 * `attempt_items`, written by Assessment when the attempt was submitted.
 *
 * Nothing here re-grades. `score`, `maxScore` and the verdict counts are
 * selected as stored; the adapter's whole job is to scope them to the cohort
 * and shape them for the pure summariser.
 */
export class PrismaExamResultsReader implements ExamResultsReader {
  constructor(private readonly db: Db) {}

  async findExam(examKey: string): Promise<{ examKey: string; title: string } | null> {
    const row = await this.db.exam.findUnique({
      where: { key: examKey },
      select: { key: true, title: true },
    });
    return row ? { examKey: row.key, title: row.title } : null;
  }

  async sittings(input: {
    examKey: string;
    learnerKeys: readonly string[];
  }): Promise<ExamSitting[]> {
    if (input.learnerKeys.length === 0) return [];
    const rows = await this.db.attempt.findMany({
      where: {
        exam: { key: input.examKey },
        learner: { key: { in: [...input.learnerKeys] } },
      },
      select: {
        key: true,
        score: true,
        maxScore: true,
        correctCount: true,
        incorrectCount: true,
        pendingReviewCount: true,
        submittedAt: true,
        learner: { select: { key: true } },
      },
    });
    return rows.map((r) => ({
      learnerKey: r.learner.key,
      attemptKey: r.key,
      score: r.score,
      maxScore: r.maxScore,
      correctCount: r.correctCount,
      incorrectCount: r.incorrectCount,
      pendingReviewCount: r.pendingReviewCount,
      submittedAt: r.submittedAt,
    }));
  }

  async itemOutcomes(input: {
    examKey: string;
    learnerKeys: readonly string[];
  }): Promise<ExamItemOutcome[]> {
    if (input.learnerKeys.length === 0) return [];

    // Order comes from the exam's own item list, not from the responses: a
    // question nobody answered must still appear, in its printed position.
    const examItems = await this.db.examItem.findMany({
      where: { exam: { key: input.examKey } },
      select: { orderIndex: true, question: { select: { key: true } } },
      orderBy: { orderIndex: 'asc' },
    });
    if (examItems.length === 0) return [];

    const responses = await this.db.attemptItem.findMany({
      where: {
        attempt: {
          exam: { key: input.examKey },
          learner: { key: { in: [...input.learnerKeys] } },
        },
      },
      select: { verdict: true, question: { select: { key: true } } },
    });

    const tally = new Map<string, { correct: number; incorrect: number; pending: number }>();
    for (const item of examItems) {
      tally.set(item.question.key, { correct: 0, incorrect: 0, pending: 0 });
    }
    for (const r of responses) {
      const row = tally.get(r.question.key);
      if (!row) continue;
      // PARTIALLY_CORRECT counts as incorrect for the per-item rate: this table
      // answers "who got it right", and partial credit already lives in the
      // learner's score. UNGRADABLE/INVALID are equally "not right".
      if (r.verdict === 'CORRECT') row.correct += 1;
      else if (r.verdict === 'REQUIRES_MANUAL_REVIEW') row.pending += 1;
      else row.incorrect += 1;
    }

    return examItems.map((item) => {
      const t = tally.get(item.question.key)!;
      return {
        questionKey: item.question.key,
        orderIndex: item.orderIndex,
        correct: t.correct,
        incorrect: t.incorrect,
        pending: t.pending,
      };
    });
  }
}
