/**
 * Prisma adapters for the item bank ports.
 *
 * These are the only place in the codebase that writes questions, exams and
 * learning resources, mirroring the rule already in force for the content
 * tree (rule CW1). A second writer is how a publication lock stops meaning
 * anything: the guard lives in the service, and the guard is only reachable if
 * every write comes through here.
 *
 * A question's stored `choices` carry an author-chosen `id`. That id is what
 * the answer key references and what a learner's response records, so it is
 * persisted as given rather than re-generated — regenerating it would break
 * every stored response's link to the option it named.
 */

import type {
  ExamItemRecord,
  ExamListQuery,
  ExamRecord,
  ExamRepository,
  QuestionBankAccess,
  QuestionBankListQuery,
  QuestionBankListPage,
  QuestionRecord,
  QuestionRepository,
  ResourceRecord,
  ResourceRepository,
  FlashcardRecord,
  FlashcardRepository,
} from '../../contexts/content/application/item-bank.ports.js';
import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { PublicationState } from '../../contexts/content/domain/publication.js';
import type {
  QuestionOrigin,
  QuestionType,
  QuestionVisibility,
  TextbookQuestionRole,
} from '../../contexts/content/domain/question-authoring.js';
import { publishedExam, publishedQuestion } from './published-content.js';
import type { Db } from './prisma.client.js';

/**
 * Turn an author's local choice handle into the stored choice id.
 *
 * Authors write options as "a", "b", "c" and their answer key references those
 * handles — that is the vocabulary the domain validates in. The column is a
 * uuid, and the learner's submitted answer records whatever id the API served
 * them, so the two have to be reconciled somewhere. Doing it here, at the
 * persistence boundary, keeps the authoring vocabulary out of the database and
 * the database's identifiers out of the domain.
 *
 * Derived rather than random (this is UUIDv5's construction) so that
 * re-authoring the same question produces the same choice ids: a random id
 * would make every re-import a different option, and every stored response
 * would point at an option that no longer exists.
 */
function choiceIdFor(questionKey: string, localId: string): string {
  const hash = createHash('sha1').update(`${questionKey}:${localId}`).digest('hex');
  const bytes = hash.slice(0, 32).split('');
  // Stamp version 5 and the RFC 4122 variant so the value is a well-formed uuid.
  bytes[12] = '5';
  bytes[16] = ((parseInt(bytes[16]!, 16) & 0x3) | 0x8).toString(16);
  const hex = bytes.join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

const questionSelect = {
  key: true,
  lesson: { select: { key: true } },
  type: true,
  text: true,
  hint: true,
  explanation: true,
  points: true,
  difficulty01: true,
  irtDifficulty: true,
  status: true,
  origin: true,
  textbookRole: true,
  sourceRef: true,
  authorUserId: true,
  schoolId: true,
  visibility: true,
  choices: {
    select: {
      id: true,
      text: true,
      orderIndex: true,
      feedback: true,
      misconception: { select: { key: true } },
    },
    orderBy: { orderIndex: 'asc' },
  },
  answerKey: {
    select: {
      correctChoiceIds: true,
      acceptedTexts: true,
      numericMin: true,
      numericMax: true,
      expectedOrder: true,
      expectedPairs: true,
      caseSensitive: true,
      allowPartialCredit: true,
      rubric: true,
    },
  },
  concepts: {
    select: { weight: true, isPrimary: true, concept: { select: { key: true } } },
  },
} as const;

type QuestionRow = {
  key: string;
  lesson: { key: string };
  type: string;
  text: string;
  hint: string | null;
  explanation: string | null;
  points: number;
  difficulty01: number;
  irtDifficulty: number;
  status: string;
  origin: QuestionOrigin;
  textbookRole: TextbookQuestionRole | null;
  sourceRef: string | null;
  authorUserId: string | null;
  schoolId: string | null;
  visibility: QuestionVisibility;
  choices: Array<{
    id: string;
    text: string;
    orderIndex: number;
    feedback: string | null;
    misconception: { key: string } | null;
  }>;
  answerKey: {
    correctChoiceIds: string[];
    acceptedTexts: string[];
    numericMin: number | null;
    numericMax: number | null;
    expectedOrder: string[];
    expectedPairs: unknown;
    caseSensitive: boolean;
    allowPartialCredit: boolean;
    rubric: unknown;
  } | null;
  concepts: Array<{ weight: number; isPrimary: boolean; concept: { key: string } }>;
};

function toQuestion(row: QuestionRow): QuestionRecord {
  return {
    key: row.key,
    lessonKey: row.lesson.key,
    type: row.type as QuestionType,
    text: row.text,
    hint: row.hint,
    explanation: row.explanation,
    points: row.points,
    difficulty01: row.difficulty01,
    irtDifficulty: row.irtDifficulty,
    status: row.status as PublicationState,
    origin: row.origin,
    textbookRole: row.textbookRole,
    sourceRef: row.sourceRef,
    authorUserId: row.authorUserId,
    schoolId: row.schoolId,
    visibility: row.visibility,
    choices: row.choices.map((c) => ({
      id: c.id,
      text: c.text,
      orderIndex: c.orderIndex,
      misconceptionKey: c.misconception?.key ?? null,
      feedback: c.feedback,
    })),
    answerKey: row.answerKey
      ? {
          correctChoiceIds: row.answerKey.correctChoiceIds,
          acceptedTexts: row.answerKey.acceptedTexts,
          numericMin: row.answerKey.numericMin,
          numericMax: row.answerKey.numericMax,
          expectedOrder: row.answerKey.expectedOrder,
          expectedPairs:
            (row.answerKey.expectedPairs as Record<string, string> | null) ?? null,
          caseSensitive: row.answerKey.caseSensitive,
          allowPartialCredit: row.answerKey.allowPartialCredit,
          rubric: row.answerKey.rubric,
        }
      : null,
    concepts: row.concepts.map((c) => ({
      conceptKey: c.concept.key,
      weight: c.weight,
      isPrimary: c.isPrimary,
    })),
  };
}

function buildQuestionListWhere(
  query: QuestionBankListQuery,
  access: QuestionBankAccess,
): Prisma.QuestionWhereInput {
  const filters: Array<Record<string, unknown>> = [];

  if (query.search) filters.push({ text: { contains: query.search, mode: 'insensitive' } });
  if (query.type) filters.push({ type: query.type });
  if (query.origin) filters.push({ origin: query.origin });
  if (query.status) filters.push({ status: query.status });
  if (query.visibility) filters.push({ visibility: query.visibility });
  if (query.textbookRole) filters.push({ textbookRole: query.textbookRole });
  if (query.sourceRef) filters.push({ sourceRef: { contains: query.sourceRef, mode: 'insensitive' } });
  if (query.difficultyMin !== undefined || query.difficultyMax !== undefined) {
    filters.push({
      difficulty01: {
        ...(query.difficultyMin !== undefined ? { gte: query.difficultyMin } : {}),
        ...(query.difficultyMax !== undefined ? { lte: query.difficultyMax } : {}),
      },
    });
  }
  if (query.lessonKey) filters.push({ lesson: { key: query.lessonKey } });
  if (query.conceptKey) filters.push({ concepts: { some: { concept: { key: query.conceptKey } } } });

  if (query.textbookKey || query.gradeKey || query.subjectKey) {
    filters.push({
      lesson: {
        unit: {
          textbook: {
            ...(query.textbookKey ? { key: query.textbookKey } : {}),
            ...(query.gradeKey ? { grade: { key: query.gradeKey } } : {}),
            ...(query.subjectKey ? { subject: { key: query.subjectKey } } : {}),
          },
        },
      },
    });
  }

  const accessFilter: Record<string, unknown> | null = access.canReadAll
    ? null
    : {
        OR: [
          // Official bank visible to teachers only once published.
          { visibility: 'GLOBAL', ...publishedQuestion },
          ...(access.actorUserId ? [{ origin: 'TEACHER' as const, authorUserId: access.actorUserId }] : []),
          ...((access.schoolIds?.length ?? 0) > 0
            ? [
                {
                  origin: 'TEACHER' as const,
                  schoolId: { in: [...(access.schoolIds ?? [])] },
                  visibility: { in: ['SCHOOL' as const, 'SUBMITTED_FOR_REVIEW' as const] },
                },
              ]
            : []),
        ],
      };

  return {
    ...(filters.length > 0 || accessFilter
      ? { AND: [...(accessFilter ? [accessFilter] : []), ...filters] }
      : {}),
  } as Prisma.QuestionWhereInput;
}

function buildExamListWhere(
  query: ExamListQuery,
  access: QuestionBankAccess,
): Prisma.ExamWhereInput {
  const filters: Array<Record<string, unknown>> = [];
  if (query.search) filters.push({ title: { contains: query.search, mode: 'insensitive' } });
  if (query.status) filters.push({ status: query.status });
  if (query.textbookKey) filters.push({ textbook: { key: query.textbookKey } });
  if (query.isAdaptive !== undefined) filters.push({ isAdaptive: query.isAdaptive });

  const accessFilter: Record<string, unknown> | null = access.canReadAll
    ? null
    : {
        OR: [
          { visibility: 'GLOBAL', ...publishedExam },
          ...(access.actorUserId ? [{ authorUserId: access.actorUserId }] : []),
          ...((access.schoolIds?.length ?? 0) > 0
            ? [{ schoolId: { in: [...(access.schoolIds ?? [])] }, visibility: 'SCHOOL' }]
            : []),
        ],
      };

  return {
    ...(filters.length > 0 || accessFilter
      ? { AND: [...(accessFilter ? [accessFilter] : []), ...filters] }
      : {}),
  } as Prisma.ExamWhereInput;
}

export class PrismaQuestionAuthoringRepository implements QuestionRepository {
  constructor(private readonly db: Db) {}

  async findQuestion(key: string): Promise<QuestionRecord | null> {
    const row = await this.db.question.findUnique({ where: { key }, select: questionSelect });
    return row ? toQuestion(row as QuestionRow) : null;
  }

  async lessonKeyForConcept(conceptKey: string): Promise<string | null> {
    const row = await this.db.concept.findUnique({
      where: { key: conceptKey },
      select: { lesson: { select: { key: true } } },
    });
    return row?.lesson.key ?? null;
  }

  async textbookStatusForConcept(conceptKey: string): Promise<PublicationState | null> {
    const row = await this.db.concept.findUnique({
      where: { key: conceptKey },
      select: { lesson: { select: { unit: { select: { textbook: { select: { status: true } } } } } } },
    });
    return (row?.lesson.unit.textbook.status as PublicationState | undefined) ?? null;
  }

  async lessonExists(lessonKey: string): Promise<boolean> {
    const row = await this.db.lesson.findUnique({
      where: { key: lessonKey },
      select: { id: true },
    });
    return row !== null;
  }

  async questionsForLesson(lessonKey: string): Promise<readonly QuestionRecord[]> {
    const rows = await this.db.question.findMany({
      where: { lesson: { key: lessonKey } },
      select: questionSelect,
      orderBy: { key: 'asc' },
    });
    return rows.map((row) => toQuestion(row as QuestionRow));
  }

  async listQuestions(
    query: QuestionBankListQuery,
    access: QuestionBankAccess,
  ): Promise<QuestionBankListPage> {
    const where = buildQuestionListWhere(query, access);
    const total = await this.db.question.count({ where });
    const rows = await this.db.question.findMany({
      where,
      select: questionSelect,
      orderBy: [{ updatedAt: 'desc' }, { key: 'asc' }],
      skip: query.offset,
      take: query.limit,
    });
    return { rows: rows.map((row) => toQuestion(row as QuestionRow)), total };
  }

  async conceptsForLesson(
    lessonKey: string,
  ): Promise<ReadonlyArray<{ key: string; name: string }>> {
    return this.db.concept.findMany({
      where: { lesson: { key: lessonKey } },
      select: { key: true, name: true },
      orderBy: { orderIndex: 'asc' },
    });
  }

  async textbookStatusForLesson(lessonKey: string): Promise<PublicationState | null> {
    const row = await this.db.lesson.findUnique({
      where: { key: lessonKey },
      select: { unit: { select: { textbook: { select: { status: true } } } } },
    });
    return (row?.unit.textbook.status as PublicationState | undefined) ?? null;
  }

  /**
   * Create the question, its options, its key and its concept links together.
   *
   * One transaction because a question without an answer key is an
   * `UNGRADABLE` waiting to happen, and a question without concept links
   * updates nobody's mastery. A partial write here would produce exactly the
   * broken rows the domain layer exists to prevent.
   */
  async createQuestion(
    input: Parameters<QuestionRepository['createQuestion']>[0],
  ): Promise<QuestionRecord> {
    const [lesson, concepts, misconceptions] = await Promise.all([
      this.db.lesson.findUniqueOrThrow({
        where: { key: input.lessonKey },
        select: { id: true },
      }),
      this.db.concept.findMany({
        where: { key: { in: input.concepts.map((c) => c.conceptKey) } },
        select: { id: true, key: true },
      }),
      this.db.misconception.findMany({
        where: {
          key: {
            in: input.choices.flatMap((c) => (c.misconceptionKey ? [c.misconceptionKey] : [])),
          },
        },
        select: { id: true, key: true },
      }),
    ]);
    const conceptId = new Map(concepts.map((c) => [c.key, c.id]));
    const misconceptionId = new Map(misconceptions.map((m) => [m.key, m.id]));

    await this.db.$transaction(async (tx) => {
      const question = await tx.question.create({
        data: {
          key: input.key,
          lessonId: lesson.id,
          type: input.type,
          text: input.text,
          hint: input.hint,
          explanation: input.explanation,
          points: input.points,
          difficulty01: input.difficulty01,
          origin: input.origin,
          textbookRole: input.textbookRole,
          sourceRef: input.sourceRef ?? null,
          authorUserId: input.authorUserId ?? null,
          schoolId: input.schoolId ?? null,
          visibility: input.visibility ?? 'GLOBAL',
        } as never,
        select: { id: true },
      });

      if (input.choices.length > 0) {
        await tx.questionChoice.createMany({
          data: input.choices.map((c) => ({
            id: choiceIdFor(input.key, c.id),
            questionId: question.id,
            text: c.text,
            orderIndex: c.orderIndex,
            misconceptionId: c.misconceptionKey
              ? (misconceptionId.get(c.misconceptionKey) ?? null)
              : null,
            feedback: c.feedback,
          })),
        });
      }

      await tx.answerKey.create({
        data: {
          questionId: question.id,
          // Remapped with the choices: a key still naming "a" would reference
          // an option the learner is never served.
          ...toAnswerKeyData(input.answerKey, (local) => choiceIdFor(input.key, local)),
        },
      });

      await tx.questionConcept.createMany({
        data: input.concepts.flatMap((c) => {
          const id = conceptId.get(c.conceptKey);
          return id
            ? [{ questionId: question.id, conceptId: id, weight: c.weight, isPrimary: c.isPrimary }]
            : [];
        }),
      });
    });

    const created = await this.findQuestion(input.key);
    if (!created) throw new Error(`question ${input.key} vanished after creation`);
    return created;
  }

  /**
   * Replace the question's content wholesale.
   *
   * Options are deleted and re-created rather than diffed. That is safe only
   * because the service refuses this call once any response exists — with
   * evidence present, deleting an option would orphan the response that named
   * it.
   */
  async replaceQuestionContent(
    key: string,
    input: Parameters<QuestionRepository['replaceQuestionContent']>[1],
  ): Promise<void> {
    const question = await this.db.question.findUniqueOrThrow({
      where: { key },
      select: { id: true },
    });

    const misconceptions = await this.db.misconception.findMany({
      where: {
        key: { in: input.choices.flatMap((c) => (c.misconceptionKey ? [c.misconceptionKey] : [])) },
      },
      select: { id: true, key: true },
    });
    const misconceptionId = new Map(misconceptions.map((m) => [m.key, m.id]));

    await this.db.$transaction(async (tx) => {
      await tx.question.update({
        where: { id: question.id },
        data: {
          text: input.text,
          hint: input.hint,
          explanation: input.explanation,
          points: input.points,
          difficulty01: input.difficulty01,
        },
      });

      await tx.questionChoice.deleteMany({ where: { questionId: question.id } });
      if (input.choices.length > 0) {
        await tx.questionChoice.createMany({
          data: input.choices.map((c) => ({
            id: choiceIdFor(key, c.id),
            questionId: question.id,
            text: c.text,
            orderIndex: c.orderIndex,
            misconceptionId: c.misconceptionKey
              ? (misconceptionId.get(c.misconceptionKey) ?? null)
              : null,
            feedback: c.feedback,
          })),
        });
      }

      const answerKeyData = toAnswerKeyData(input.answerKey, (local) =>
        choiceIdFor(key, local),
      );
      await tx.answerKey.upsert({
        where: { questionId: question.id },
        create: { questionId: question.id, ...answerKeyData },
        update: answerKeyData,
      });
    });
  }

  async setQuestionConcepts(
    key: string,
    links: ReadonlyArray<{ conceptKey: string; weight: number; isPrimary: boolean }>,
  ): Promise<void> {
    const question = await this.db.question.findUniqueOrThrow({
      where: { key },
      select: { id: true },
    });
    const concepts = await this.db.concept.findMany({
      where: { key: { in: links.map((l) => l.conceptKey) } },
      select: { id: true, key: true },
    });
    const conceptId = new Map(concepts.map((c) => [c.key, c.id]));

    await this.db.$transaction(async (tx) => {
      await tx.questionConcept.deleteMany({ where: { questionId: question.id } });
      await tx.questionConcept.createMany({
        data: links.flatMap((l) => {
          const id = conceptId.get(l.conceptKey);
          return id
            ? [{ questionId: question.id, conceptId: id, weight: l.weight, isPrimary: l.isPrimary }]
            : [];
        }),
      });
    });
  }

  async setQuestionStatus(key: string, status: PublicationState): Promise<void> {
    await this.db.question.update({ where: { key }, data: { status } });
  }

  async updateQuestionMetadata(
    key: string,
    fields: Parameters<NonNullable<QuestionRepository['updateQuestionMetadata']>>[1],
  ): Promise<void> {
    await this.db.question.update({ where: { key }, data: fields as never });
  }

  async questionHasResponses(key: string): Promise<boolean> {
    const count = await this.db.attemptItem.count({ where: { question: { key } } });
    return count > 0;
  }

  async resolveConcepts(
    conceptKeys: readonly string[],
  ): Promise<Array<{ conceptKey: string; textbookKey: string }>> {
    const rows = await this.db.concept.findMany({
      where: { key: { in: [...conceptKeys] } },
      select: {
        key: true,
        lesson: { select: { unit: { select: { textbook: { select: { key: true } } } } } },
      },
    });
    return rows.map((r) => ({ conceptKey: r.key, textbookKey: r.lesson.unit.textbook.key }));
  }

  async resolveMisconceptions(keys: readonly string[]): Promise<string[]> {
    if (keys.length === 0) return [];
    const rows = await this.db.misconception.findMany({
      where: { key: { in: [...keys] } },
      select: { key: true },
    });
    return rows.map((r) => r.key);
  }
}

function toAnswerKeyData(
  key: {
  correctChoiceIds: readonly string[];
  acceptedTexts: readonly string[];
  numericMin: number | null;
  numericMax: number | null;
  expectedOrder: readonly string[];
  expectedPairs: Readonly<Record<string, string>> | null;
  caseSensitive: boolean;
  allowPartialCredit: boolean;
  rubric: unknown;
  },
  mapChoiceId: (localId: string) => string,
) {
  return {
    correctChoiceIds: key.correctChoiceIds.map(mapChoiceId),
    acceptedTexts: [...key.acceptedTexts],
    numericMin: key.numericMin,
    numericMax: key.numericMax,
    expectedOrder: [...key.expectedOrder],
    expectedPairs: (key.expectedPairs ?? undefined) as never,
    caseSensitive: key.caseSensitive,
    allowPartialCredit: key.allowPartialCredit,
    rubric: (key.rubric ?? undefined) as never,
  };
}

const examSelect = {
  key: true,
  title: true,
  description: true,
  authorUserId: true,
  schoolId: true,
  visibility: true,
  isAdaptive: true,
  passingScore: true,
  timeLimitMins: true,
  minItems: true,
  maxItems: true,
  targetStandardError: true,
  status: true,
  textbook: { select: { key: true } },
  items: {
    select: {
      orderIndex: true,
      points: true,
      question: {
        select: {
          key: true,
          type: true,
          status: true,
          irtDifficulty: true,
          concepts: { select: { concept: { select: { key: true } } } },
        },
      },
    },
    orderBy: { orderIndex: 'asc' },
  },
} as const;

type ExamRow = {
  key: string;
  title: string;
  description: string | null;
  authorUserId: string | null;
  schoolId: string | null;
  visibility: QuestionVisibility;
  isAdaptive: boolean;
  passingScore: number;
  timeLimitMins: number | null;
  minItems: number;
  maxItems: number;
  targetStandardError: number;
  status: string;
  textbook: { key: string } | null;
  items: Array<{
    orderIndex: number;
    points: number;
    question: {
      key: string;
      type: string;
      status: string;
      irtDifficulty: number;
      concepts: Array<{ concept: { key: string } }>;
    };
  }>;
};

function toExam(row: ExamRow): ExamRecord {
  const items: ExamItemRecord[] = row.items.map((i) => ({
    questionKey: i.question.key,
    orderIndex: i.orderIndex,
    points: i.points,
    questionStatus: i.question.status as PublicationState,
    questionType: i.question.type as QuestionType,
    irtDifficulty: i.question.irtDifficulty,
    conceptKeys: i.question.concepts.map((c) => c.concept.key),
  }));

  return {
    key: row.key,
    title: row.title,
    description: row.description,
    textbookKey: row.textbook?.key ?? null,
    authorUserId: row.authorUserId,
    schoolId: row.schoolId,
    visibility: row.visibility,
    isAdaptive: row.isAdaptive,
    passingScore: row.passingScore,
    timeLimitMins: row.timeLimitMins,
    minItems: row.minItems,
    maxItems: row.maxItems,
    targetStandardError: row.targetStandardError,
    status: row.status as PublicationState,
    items,
  };
}

export class PrismaExamRepository implements ExamRepository {
  constructor(private readonly db: Db) {}

  async findExam(key: string): Promise<ExamRecord | null> {
    const row = await this.db.exam.findUnique({ where: { key }, select: examSelect });
    return row ? toExam(row as ExamRow) : null;
  }

  async listExams(query: ExamListQuery, access: QuestionBankAccess) {
    const where = buildExamListWhere(query, access);
    const total = await this.db.exam.count({ where });
    const rows = await this.db.exam.findMany({
      where,
      select: examSelect,
      orderBy: [{ updatedAt: 'desc' }, { key: 'asc' }],
      skip: query.offset,
      take: query.limit,
    });
    return { rows: rows.map((row) => toExam(row as ExamRow)), total };
  }

  async createExam(input: Parameters<ExamRepository['createExam']>[0]): Promise<ExamRecord> {
    const textbook = input.textbookKey
      ? await this.db.textbook.findUnique({
          where: { key: input.textbookKey },
          select: { id: true },
        })
      : null;

    const row = await this.db.exam.create({
      data: {
        key: input.key,
        title: input.title,
        description: input.description,
        textbookId: textbook?.id ?? null,
        authorUserId: input.authorUserId,
        schoolId: input.schoolId,
        visibility: input.visibility,
        isAdaptive: input.isAdaptive,
        passingScore: input.passingScore,
        timeLimitMins: input.timeLimitMins,
        minItems: input.minItems,
        maxItems: input.maxItems,
        targetStandardError: input.targetStandardError,
      },
      select: examSelect,
    });
    return toExam(row as ExamRow);
  }

  async updateExam(key: string, fields: Readonly<Record<string, unknown>>): Promise<void> {
    await this.db.exam.update({ where: { key }, data: fields as Record<string, never> });
  }

  async setExamStatus(
    key: string,
    status: PublicationState,
    publishedAt?: Date,
  ): Promise<void> {
    await this.db.exam.update({
      where: { key },
      data: { status, ...(publishedAt ? { publishedAt } : {}) },
    });
  }

  /**
   * Replace the item list atomically.
   *
   * Delete-then-insert inside a transaction, because `@@unique([examId,
   * questionId])` rejects the intermediate states of an incremental update
   * when items are reordered or swapped.
   */
  async setExamItems(
    key: string,
    items: ReadonlyArray<{ questionKey: string; orderIndex: number; points: number }>,
  ): Promise<void> {
    const exam = await this.db.exam.findUniqueOrThrow({ where: { key }, select: { id: true } });
    const questions = await this.db.question.findMany({
      where: { key: { in: items.map((i) => i.questionKey) } },
      select: { id: true, key: true },
    });
    const questionId = new Map(questions.map((q) => [q.key, q.id]));

    await this.db.$transaction(async (tx) => {
      await tx.examItem.deleteMany({ where: { examId: exam.id } });
      if (items.length === 0) return;
      await tx.examItem.createMany({
        data: items.flatMap((i) => {
          const id = questionId.get(i.questionKey);
          return id
            ? [{ examId: exam.id, questionId: id, orderIndex: i.orderIndex, points: i.points }]
            : [];
        }),
      });
    });
  }

  async examHasAttempts(key: string): Promise<boolean> {
    const count = await this.db.attempt.count({ where: { exam: { key } } });
    return count > 0;
  }
}

const resourceSelect = {
  key: true,
  slug: true,
  kind: true,
  title: true,
  url: true,
  body: true,
  orderIndex: true,
  pageStart: true,
  pageEnd: true,
  estimatedMins: true,
  isActive: true,
  textbook: { select: { key: true } },
  lesson: { select: { key: true } },
  concept: { select: { key: true } },
} as const;

type ResourceRow = {
  key: string;
  slug: string | null;
  kind: string;
  title: string;
  url: string | null;
  body: string | null;
  orderIndex: number;
  pageStart: number | null;
  pageEnd: number | null;
  estimatedMins: number | null;
  isActive: boolean;
  textbook: { key: string } | null;
  lesson: { key: string } | null;
  concept: { key: string } | null;
};

function toResource(row: ResourceRow): ResourceRecord {
  return {
    key: row.key,
    kind: row.kind,
    title: row.title,
    url: row.url,
    body: row.body,
    textbookKey: row.textbook?.key ?? null,
    lessonKey: row.lesson?.key ?? null,
    conceptKey: row.concept?.key ?? null,
    slug: row.slug,
    orderIndex: row.orderIndex,
    pageStart: row.pageStart,
    pageEnd: row.pageEnd,
    estimatedMins: row.estimatedMins,
    isActive: row.isActive,
  };
}

export class PrismaResourceRepository implements ResourceRepository {
  constructor(private readonly db: Db) {}

  async findResource(key: string): Promise<ResourceRecord | null> {
    const row = await this.db.learningResource.findUnique({
      where: { key },
      select: resourceSelect,
    });
    return row ? toResource(row as ResourceRow) : null;
  }

  async createResource(
    input: Parameters<ResourceRepository['createResource']>[0],
  ): Promise<ResourceRecord> {
    const [textbook, lesson, concept] = await Promise.all([
      input.textbookKey
        ? this.db.textbook.findUnique({ where: { key: input.textbookKey }, select: { id: true } })
        : null,
      input.lessonKey
        ? this.db.lesson.findUnique({
            where: { key: input.lessonKey },
            select: { id: true, unit: { select: { textbookId: true } } },
          })
        : null,
      input.conceptKey
        ? this.db.concept.findUnique({
            where: { key: input.conceptKey },
            select: { id: true, lesson: { select: { unit: { select: { textbookId: true } } } } },
          })
        : null,
    ]);

    const textbookId =
      concept?.lesson.unit.textbookId ?? lesson?.unit.textbookId ?? textbook?.id ?? null;

    const row = await this.db.learningResource.create({
      data: {
        key: input.key,
        slug: input.slug,
        kind: input.kind as never,
        title: input.title,
        url: input.url,
        body: input.body,
        textbookId,
        lessonId: lesson?.id ?? null,
        conceptId: concept?.id ?? null,
        orderIndex: input.orderIndex,
        pageStart: input.pageStart,
        pageEnd: input.pageEnd,
        estimatedMins: input.estimatedMins,
      },
      select: resourceSelect,
    });
    return toResource(row as ResourceRow);
  }

  async updateResource(key: string, fields: Readonly<Record<string, unknown>>): Promise<void> {
    await this.db.learningResource.update({
      where: { key },
      data: fields as Record<string, never>,
    });
  }

  async setResourceActive(key: string, isActive: boolean): Promise<void> {
    await this.db.learningResource.update({ where: { key }, data: { isActive } });
  }

  async listForConcept(conceptKey: string): Promise<ResourceRecord[]> {
    const rows = await this.db.learningResource.findMany({
      where: { concept: { key: conceptKey } },
      select: resourceSelect,
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => toResource(r as ResourceRow));
  }

  /**
   * Book-wide resources: rows whose `textbookId` is this book and which are
   * NOT also parented on a lesson or concept — those already surface through
   * `lessonMaterials`, and listing them here too would show the same PDF
   * twice under two different screens.
   */
  async listForTextbook(textbookKey: string): Promise<ResourceRecord[] | null> {
    const textbook = await this.db.textbook.findUnique({
      where: { key: textbookKey },
      select: { id: true },
    });
    if (!textbook) return null;

    const rows = await this.db.learningResource.findMany({
      where: { textbookId: textbook.id, lessonId: null, conceptId: null },
      select: resourceSelect,
      orderBy: [{ orderIndex: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((r) => toResource(r as ResourceRow));
  }

  /**
   * The lifecycle a resource inherits.
   *
   * A concept-attached resource follows its concept's book; a book-attached
   * one follows the book directly. Returning null means the target does not
   * exist, which the service reports separately from a lock refusal — an
   * author who mistyped a key should not be told the textbook is published.
   */
  async textbookStatusForResource(input: {
    textbookKey?: string | null;
    lessonKey?: string | null;
    conceptKey?: string | null;
  }): Promise<PublicationState | null> {
    if (input.conceptKey) {
      const row = await this.db.concept.findUnique({
        where: { key: input.conceptKey },
        select: {
          lesson: { select: { unit: { select: { textbook: { select: { status: true } } } } } },
        },
      });
      return (row?.lesson.unit.textbook.status as PublicationState | undefined) ?? null;
    }

    if (input.lessonKey) {
      const row = await this.db.lesson.findUnique({
        where: { key: input.lessonKey },
        select: { unit: { select: { textbook: { select: { status: true } } } } },
      });
      return (row?.unit.textbook.status as PublicationState | undefined) ?? null;
    }

    if (input.textbookKey) {
      const row = await this.db.textbook.findUnique({
        where: { key: input.textbookKey },
        select: { status: true },
      });
      return (row?.status as PublicationState | undefined) ?? null;
    }

    return null;
  }
}

/**
 * Authored flashcards.
 *
 * The single writer of `flashcards`, guarded by rule FW1. Cards are retired,
 * never deleted, for the same reason resources are: a deck a learner studied
 * last week must still be explicable next week.
 */
export class PrismaFlashcardRepository implements FlashcardRepository {
  constructor(private readonly db: Db) {}

  async findCard(key: string): Promise<FlashcardRecord | null> {
    const row = await this.db.flashcard.findUnique({
      where: { key },
      select: flashcardSelect,
    });
    return row ? toFlashcard(row) : null;
  }

  async createCard(
    input: Parameters<FlashcardRepository['createCard']>[0],
  ): Promise<FlashcardRecord> {
    const concept = await this.db.concept.findUnique({
      where: { key: input.conceptKey },
      select: { id: true },
    });
    if (!concept) {
      // Unreachable through the service, which checks the concept first. Kept
      // because an adapter that silently wrote a null foreign key would fail
      // far away from the cause.
      throw new Error(`flashcard: unknown concept ${input.conceptKey}`);
    }

    const row = await this.db.flashcard.create({
      data: {
        key: input.key,
        conceptId: concept.id,
        front: input.front,
        back: input.back,
        reviewPriority: input.reviewPriority,
        difficulty: input.difficulty,
      },
      select: flashcardSelect,
    });
    return toFlashcard(row);
  }

  async updateCard(key: string, fields: Readonly<Record<string, unknown>>): Promise<void> {
    await this.db.flashcard.update({ where: { key }, data: fields });
  }

  async setCardActive(key: string, isActive: boolean): Promise<void> {
    await this.db.flashcard.update({ where: { key }, data: { isActive } });
  }

  async listForConcept(conceptKey: string): Promise<FlashcardRecord[]> {
    const rows = await this.db.flashcard.findMany({
      where: { concept: { key: conceptKey } },
      select: flashcardSelect,
      orderBy: { key: 'asc' },
    });
    return rows.map(toFlashcard);
  }

  async textbookStatusForConcept(conceptKey: string): Promise<PublicationState | null> {
    const row = await this.db.concept.findUnique({
      where: { key: conceptKey },
      select: {
        lesson: { select: { unit: { select: { textbook: { select: { status: true } } } } } },
      },
    });
    return (row?.lesson.unit.textbook.status as PublicationState | undefined) ?? null;
  }
}

const flashcardSelect = {
  key: true,
  front: true,
  back: true,
  reviewPriority: true,
  difficulty: true,
  isActive: true,
  concept: { select: { key: true } },
} as const;

function toFlashcard(row: {
  key: string;
  front: string;
  back: string;
  reviewPriority: number;
  difficulty: number;
  isActive: boolean;
  concept: { key: string };
}): FlashcardRecord {
  return {
    key: row.key,
    conceptKey: row.concept.key,
    front: row.front,
    back: row.back,
    reviewPriority: row.reviewPriority,
    difficulty: row.difficulty,
    isActive: row.isActive,
  };
}
