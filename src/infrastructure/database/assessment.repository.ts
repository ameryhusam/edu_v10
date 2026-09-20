/**
 * Prisma adapters for the Assessment ports.
 */

import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';

import type {
  AttemptHistoryReader,
  AttemptItemRecord,
  AttemptKind,
  AttemptRecord,
  AttemptRepository,
  AttemptSummary,
  EvidenceWriter,
  ManualReviewListPage,
  ManualReviewListQuery,
  ManualReviewQueueItem,
  QuestionRepository,
  QuestionView,
} from '../../contexts/assessment/application/ports.js';
import type { AnswerKey } from '../../contexts/assessment/domain/evaluation.js';
import type { Evidence } from '../../contexts/assessment/domain/evidence.js';
import type { Db } from './prisma.client.js';
import { publishedConcept } from './published-content.js';

/** Shape used for every question read, so learner and author paths cannot drift. */
const questionSelect = {
  id: true,
  key: true,
  text: true,
  type: true,
  points: true,
  hint: true,
  irtDiscrimination: true,
  irtDifficulty: true,
  irtGuessing: true,
  choices: {
    select: {
      id: true,
      text: true,
      orderIndex: true,
      misconception: { select: { key: true } },
    },
    orderBy: { orderIndex: 'asc' },
  },
  concepts: {
    select: { weight: true, isPrimary: true, concept: { select: { key: true } } },
  },
} as const;

export class PrismaQuestionRepository implements QuestionRepository {
  constructor(private readonly db: Db) {}

  async findByKey(key: string): Promise<QuestionView | null> {
    const row = await this.db.question.findUnique({ where: { key }, select: questionSelect });
    return row ? toQuestionView(row) : null;
  }

  async findPoolByConcepts(conceptKeys: readonly string[], limit = 200): Promise<QuestionView[]> {
    if (conceptKeys.length === 0) return [];
    const rows = await this.db.question.findMany({
      where: {
        status: 'PUBLISHED',
        // Adaptive selection can only administer immediately gradable items.
        // Essays remain available in lessons/exams, but they enter mastery only
        // through the manual grading queue after a reviewer marks them.
        type: { not: 'ESSAY' },
        // The question being published is not enough: its concept, lesson,
        // unit and textbook must all be visible too. Legacy checked only this
        // first condition, which is how draft books stayed teachable.
        concepts: { some: { concept: { key: { in: [...conceptKeys] }, ...publishedConcept } } },
      },
      select: questionSelect,
      take: limit,
    });
    return rows.map(toQuestionView);
  }

  /**
   * Loaded through a dedicated method, never joined into the learner payload.
   * Keeping answer keys in a separate table AND a separate call means leaking
   * one requires a deliberate mistake rather than a forgotten `select`.
   */
  async findAnswerKey(questionKey: string): Promise<AnswerKey | null> {
    const row = await this.db.answerKey.findFirst({
      where: { question: { key: questionKey } },
      include: { question: { select: { type: true } } },
    });
    if (!row) return null;

    return {
      type: row.question.type,
      correctChoiceIds: row.correctChoiceIds,
      acceptedTexts: row.acceptedTexts,
      ...(row.numericMin != null && row.numericMax != null
        ? { numericRange: { min: row.numericMin, max: row.numericMax } }
        : {}),
      expectedOrder: row.expectedOrder,
      ...(row.expectedPairs ? { expectedPairs: row.expectedPairs as Record<string, string> } : {}),
      caseSensitive: row.caseSensitive,
      allowPartialCredit: row.allowPartialCredit,
    };
  }
}

/**
 * A learner's finished attempts, newest first (gap G4).
 *
 * Reads the stored totals rather than recomputing them from `AttemptItem`
 * rows: the score written at submission is the canonical result, and summing
 * items here would be a second grading implementation that silently diverges
 * the day partial credit or pending review changes.
 *
 * IN_PROGRESS attempts are excluded. An attempt still being sat is not
 * history, and showing it with a null score reads as a failed one.
 */
export class PrismaAttemptHistoryReader implements AttemptHistoryReader {
  constructor(private readonly db: Db) {}

  async listForLearner(
    learnerKey: string,
    options: { readonly limit: number; readonly kind?: AttemptKind | undefined },
  ): Promise<readonly AttemptSummary[]> {
    const learner = await this.db.learnerProfile.findUnique({
      where: { key: learnerKey },
      select: { id: true },
    });
    // No profile is an empty history, not an error: the caller already proved
    // it may read this learner.
    if (!learner) return [];

    const rows = await this.db.attempt.findMany({
      where: {
        learnerId: learner.id,
        status: { not: 'IN_PROGRESS' },
        ...(options.kind ? { kind: options.kind } : {}),
      },
      // Submitted-at first, because that is the date shown; started-at breaks
      // the tie for attempts that ended without being submitted.
      orderBy: [{ submittedAt: 'desc' }, { startedAt: 'desc' }],
      take: options.limit,
      select: {
        key: true,
        kind: true,
        status: true,
        lessonKey: true,
        score: true,
        maxScore: true,
        correctCount: true,
        incorrectCount: true,
        startedAt: true,
        submittedAt: true,
        exam: { select: { key: true } },
      },
    });

    return rows.map((row) => ({
      key: row.key,
      kind: row.kind,
      status: row.status,
      lessonKey: row.lessonKey,
      examKey: row.exam?.key ?? null,
      score: row.score,
      maxScore: row.maxScore,
      correctCount: row.correctCount,
      incorrectCount: row.incorrectCount,
      startedAt: row.startedAt,
      submittedAt: row.submittedAt,
    }));
  }
}

export class PrismaAttemptRepository implements AttemptRepository {
  constructor(private readonly db: Db) {}

  nextKey(): string {
    // Random rather than sequential: an attempt key appears in URLs, and a
    // guessable one would let a learner probe for other learners' attempts.
    return `att_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
  }

  async findOpenByScope(
    learnerKey: string,
    scope: { lessonKey: string | null; examKey: string | null },
  ): Promise<AttemptRecord | null> {
    const learner = await this.db.learnerProfile.findUnique({
      where: { key: learnerKey },
      select: { id: true },
    });
    if (!learner) return null;

    const exam = scope.examKey
      ? await this.db.exam.findUnique({ where: { key: scope.examKey }, select: { id: true } })
      : null;
    if (scope.examKey && !exam) return null;

    const row = await this.db.attempt.findFirst({
      where: {
        learnerId: learner.id,
        status: 'IN_PROGRESS',
        lessonKey: scope.lessonKey,
        examId: exam?.id ?? null,
      },
      // Newest wins: if duplicates ever exist, the learner is working on the
      // most recent one.
      orderBy: { startedAt: 'desc' },
      include: attemptInclude,
    });
    return row ? toAttemptRecord(row) : null;
  }

  async create(input: {
    key: string;
    learnerKey: string;
    kind: AttemptRecord['kind'];
    lessonKey?: string | null;
    examKey?: string | null;
    startedAt: Date;
  }): Promise<AttemptRecord> {
    const learner = await this.db.learnerProfile.findUniqueOrThrow({
      where: { key: input.learnerKey },
      select: { id: true },
    });
    const lesson = input.lessonKey
      ? await this.db.lesson.findUnique({ where: { key: input.lessonKey }, select: { id: true } })
      : null;
    const exam = input.examKey
      ? await this.db.exam.findUnique({ where: { key: input.examKey }, select: { id: true } })
      : null;

    const row = await this.db.attempt.create({
      data: {
        key: input.key,
        learnerId: learner.id,
        kind: input.kind,
        status: 'IN_PROGRESS',
        lessonKey: input.lessonKey ?? null,
        lessonId: lesson?.id ?? null,
        examId: exam?.id ?? null,
        startedAt: input.startedAt,
      },
      include: attemptInclude,
    });
    return toAttemptRecord(row);
  }

  async findByKey(key: string): Promise<AttemptRecord | null> {
    const row = await this.db.attempt.findUnique({ where: { key }, include: attemptInclude });
    return row ? toAttemptRecord(row) : null;
  }

  async appendItem(attemptKey: string, item: AttemptItemRecord): Promise<void> {
    const attempt = await this.db.attempt.findUniqueOrThrow({
      where: { key: attemptKey },
      select: { id: true },
    });
    const question = await this.db.question.findUniqueOrThrow({
      where: { key: item.questionKey },
      select: { id: true },
    });

    await this.db.attemptItem.create({
      data: {
        attemptId: attempt.id,
        questionId: question.id,
        rawAnswer: item.rawAnswer as object,
        verdict: item.evaluation.verdict,
        scoreEarned: item.evaluation.scoreEarned,
        scorePossible: item.evaluation.scorePossible,
        normalizedAnswer: item.evaluation.normalizedAnswer,
        normalizationApplied: [...item.evaluation.normalizationApplied],
        evaluatorVersion: item.evaluation.evaluatorVersion,
        evaluationNote: item.evaluation.note ?? null,
        timeSpentSeconds: item.timeSpentSeconds,
        answeredAt: item.answeredAt,
      },
    });
  }

  async submit(
    attemptKey: string,
    submittedAt: Date,
    totals: {
      score: number;
      maxScore: number;
      correctCount: number;
      incorrectCount: number;
      pendingReviewCount: number;
    },
  ): Promise<AttemptRecord> {
    const row = await this.db.attempt.update({
      where: { key: attemptKey },
      data: {
        status: 'SUBMITTED',
        submittedAt,
        score: totals.score,
        maxScore: totals.maxScore,
        correctCount: totals.correctCount,
        incorrectCount: totals.incorrectCount,
        pendingReviewCount: totals.pendingReviewCount,
      },
      include: attemptInclude,
    });
    return toAttemptRecord(row);
  }

  async listPendingManualReviews(query: ManualReviewListQuery): Promise<ManualReviewListPage> {
    if (query.schoolIds && query.schoolIds.length === 0) return { rows: [], total: 0 };
    const where = manualReviewWhere(query);
    const total = await this.db.attemptItem.count({ where });
    const rows = await this.db.attemptItem.findMany({
      where,
      select: manualReviewSelect,
      orderBy: { answeredAt: 'asc' },
      skip: query.offset,
      take: query.limit,
    });
    return { rows: rows.map(toManualReviewQueueItem), total };
  }

  async findPendingManualReview(
    attemptKey: string,
    questionKey: string,
  ): Promise<ManualReviewQueueItem | null> {
    const row = await this.db.attemptItem.findFirst({
      where: {
        verdict: 'REQUIRES_MANUAL_REVIEW',
        attempt: { key: attemptKey },
        question: { key: questionKey },
      },
      select: manualReviewSelect,
    });
    return row ? toManualReviewQueueItem(row) : null;
  }

  async replaceItemEvaluation(input: {
    attemptKey: string;
    questionKey: string;
    evaluation: AttemptItemRecord['evaluation'];
    reviewedByUserId: string;
    reviewedAt: Date;
    feedback?: string | null;
  }): Promise<AttemptRecord> {
    await this.db.attemptItem.updateMany({
      where: {
        verdict: 'REQUIRES_MANUAL_REVIEW',
        attempt: { key: input.attemptKey },
        question: { key: input.questionKey },
      },
      data: {
        verdict: input.evaluation.verdict,
        scoreEarned: input.evaluation.scoreEarned,
        scorePossible: input.evaluation.scorePossible,
        normalizedAnswer: input.evaluation.normalizedAnswer,
        normalizationApplied: [...input.evaluation.normalizationApplied],
        evaluatorVersion: input.evaluation.evaluatorVersion,
        evaluationNote: input.evaluation.note ?? null,
        manualGradedByUserId: input.reviewedByUserId,
        manualGradedAt: input.reviewedAt,
        manualFeedback: input.feedback ?? null,
      } as never,
    });

    const row = await this.db.attempt.findUniqueOrThrow({
      where: { key: input.attemptKey },
      include: attemptInclude,
    });
    return toAttemptRecord(row);
  }

  async updateTotals(attemptKey: string, totals: {
    score: number;
    maxScore: number;
    correctCount: number;
    incorrectCount: number;
    pendingReviewCount: number;
  }): Promise<AttemptRecord> {
    const row = await this.db.attempt.update({
      where: { key: attemptKey },
      data: {
        score: totals.score,
        maxScore: totals.maxScore,
        correctCount: totals.correctCount,
        incorrectCount: totals.incorrectCount,
        pendingReviewCount: totals.pendingReviewCount,
      },
      include: attemptInclude,
    });
    return toAttemptRecord(row);
  }
}

export class PrismaEvidenceWriter implements EvidenceWriter {
  constructor(private readonly db: Db) {}

  async append(learnerKey: string, evidence: readonly Evidence[]): Promise<void> {
    if (evidence.length === 0) return;

    const conceptKeys = [...new Set(evidence.map((e) => e.conceptKey))];
    const concepts = await this.db.concept.findMany({
      where: { key: { in: conceptKeys } },
      select: { id: true, key: true },
    });
    const conceptIdByKey = new Map(concepts.map((c) => [c.key, c.id]));

    const learner = await this.db.learnerProfile.findUniqueOrThrow({
      where: { key: learnerKey },
      select: { id: true },
    });

    await this.db.masteryEvidence.createMany({
      data: evidence
        .filter((e) => conceptIdByKey.has(e.conceptKey))
        .map((e) => ({
          learnerId: learner.id,
          conceptId: conceptIdByKey.get(e.conceptKey)!,
          questionKey: e.questionKey,
          isCorrect: e.isCorrect,
          weight: e.weight,
          verdict: e.verdict,
          misconceptionKey: e.misconceptionKey ?? null,
          observedAt: e.observedAt,
        })),
    });
  }
}

const attemptInclude = {
  learner: { select: { key: true } },
  exam: { select: { key: true } },
  items: {
    include: { question: { select: { key: true } } },
    orderBy: { answeredAt: 'asc' },
  },
} as const;

const manualReviewSelect = {
  rawAnswer: true,
  answeredAt: true,
  scorePossible: true,
  evaluationNote: true,
  attempt: {
    select: {
      key: true,
      status: true,
      submittedAt: true,
      learner: {
        select: {
          key: true,
          user: { select: { fullName: true } },
          enrollments: {
            where: { isCurrent: true },
            select: { schoolId: true },
            take: 1,
          },
        },
      },
    },
  },
  question: { select: { key: true, text: true } },
} as const;

type ManualReviewRow = {
  rawAnswer: unknown;
  answeredAt: Date;
  scorePossible: number;
  evaluationNote: string | null;
  attempt: {
    key: string;
    status: AttemptRecord['status'];
    submittedAt: Date | null;
    learner: {
      key: string;
      user: { fullName: string };
      enrollments: Array<{ schoolId: string }>;
    };
  };
  question: { key: string; text: string };
};

function manualReviewWhere(query: ManualReviewListQuery): Prisma.AttemptItemWhereInput {
  return {
    verdict: 'REQUIRES_MANUAL_REVIEW',
    ...(query.learnerKey ? { attempt: { learner: { key: query.learnerKey } } } : {}),
    ...(query.schoolIds
      ? {
          attempt: {
            learner: {
              ...(query.learnerKey ? { key: query.learnerKey } : {}),
              enrollments: { some: { isCurrent: true, schoolId: { in: [...query.schoolIds] } } },
            },
          },
        }
      : {}),
  };
}

function toManualReviewQueueItem(row: ManualReviewRow): ManualReviewQueueItem {
  return {
    attemptKey: row.attempt.key,
    attemptStatus: row.attempt.status,
    learnerKey: row.attempt.learner.key,
    learnerName: row.attempt.learner.user.fullName,
    schoolId: row.attempt.learner.enrollments[0]?.schoolId ?? null,
    questionKey: row.question.key,
    questionText: row.question.text,
    rawAnswer: (row.rawAnswer ?? {}) as Record<string, unknown>,
    answeredAt: row.answeredAt,
    submittedAt: row.attempt.submittedAt,
    scorePossible: row.scorePossible,
    note: row.evaluationNote,
  };
}

function toQuestionView(row: {
  key: string;
  text: string;
  type: QuestionView['type'];
  points: number;
  hint: string | null;
  irtDiscrimination: number;
  irtDifficulty: number;
  irtGuessing: number;
  choices: { id: string; text: string; orderIndex: number; misconception: { key: string } | null }[];
  concepts: { weight: number; isPrimary: boolean; concept: { key: string } }[];
}): QuestionView {
  return {
    key: row.key,
    text: row.text,
    type: row.type,
    points: row.points,
    hint: row.hint,
    choices: row.choices.map((c) => ({
      id: c.id,
      text: c.text,
      orderIndex: c.orderIndex,
      ...(c.misconception ? { misconceptionKey: c.misconception.key } : {}),
    })),
    conceptLinks: row.concepts.map((c) => ({
      conceptKey: c.concept.key,
      weight: c.weight,
      isPrimary: c.isPrimary,
    })),
    irt: {
      id: row.key,
      a: row.irtDiscrimination,
      b: row.irtDifficulty,
      c: row.irtGuessing,
    },
  };
}

function toAttemptRecord(row: {
  key: string;
  kind: AttemptRecord['kind'];
  status: AttemptRecord['status'];
  lessonKey: string | null;
  startedAt: Date;
  submittedAt: Date | null;
  learner: { key: string };
  exam: { key: string } | null;
  items: {
    question: { key: string };
    verdict: AttemptItemRecord['evaluation']['verdict'];
    scoreEarned: number | null;
    scorePossible: number;
    normalizedAnswer: string | null;
    normalizationApplied: string[];
    evaluatorVersion: string;
    evaluationNote: string | null;
    answeredAt: Date;
    timeSpentSeconds: number | null;
    rawAnswer: unknown;
  }[];
}): AttemptRecord {
  return {
    key: row.key,
    learnerKey: row.learner.key,
    kind: row.kind,
    lessonKey: row.lessonKey,
    examKey: row.exam?.key ?? null,
    status: row.status,
    startedAt: row.startedAt,
    submittedAt: row.submittedAt,
    items: row.items.map((i) => ({
      questionKey: i.question.key,
      evaluation: {
        verdict: i.verdict,
        scoreEarned: i.scoreEarned,
        scorePossible: i.scorePossible,
        normalizedAnswer: i.normalizedAnswer,
        normalizationApplied: i.normalizationApplied as never,
        evaluatorVersion: i.evaluatorVersion,
        ...(i.evaluationNote ? { note: i.evaluationNote } : {}),
      },
      answeredAt: i.answeredAt,
      timeSpentSeconds: i.timeSpentSeconds,
      rawAnswer: (i.rawAnswer ?? {}) as Record<string, unknown>,
    })),
  };
}
