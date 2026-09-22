/**
 * Seed a textbook from a JSON spec.
 *
 * The math books in seed.ts are inline because they are minimal smoke content.
 * A real book — nine units, thirty lessons, fifty concepts, a hundred
 * questions — is data, and data belongs in prisma/seed/data, not in TypeScript
 * string literals. This loader is the only bridge.
 *
 * Ordering rules it enforces (so the JSON never has to carry numbers):
 *   · units, lessons and concepts are numbered by their array position;
 *   · explicit `prerequisites` are concept slugs resolved within the book;
 *   · in addition, the last concept of each lesson hard-gates the first
 *     concept of the next one, across the whole book. A textbook is a
 *     sequence; the path engine locks what has not been reached, which is
 *     exactly what "pass this lesson, then the next opens" needs.
 *
 * Everything is upserted or replaced wholesale, so re-seeding is idempotent
 * and edits to the JSON are picked up on the next run. Question choices are
 * deleted and recreated because they have no stable identity of their own —
 * the question key is the identity, same policy as the inline math seed.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PrismaClient } from '@prisma/client';
import { unwrap } from '../../src/shared/kernel/result.js';
import { ResourceKind } from '@prisma/client';
import {
  textbookKey,
  unitKey,
  lessonKey,
  conceptKey,
  questionKey,
} from '../../src/shared/kernel/identifiers.js';

const DATA_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'data', 'textbooks');

type ChoiceSpec = { text: string; correct: boolean; misconception?: string };
type QuestionSpec = { text: string; choices: ChoiceSpec[] };
type MisconceptionSpec = {
  slug: string;
  name: string;
  description: string;
  remediation: string;
};
type ConceptSpec = {
  slug: string;
  name: string;
  page: number;
  threshold: number;
  difficulty: number;
  prerequisites: string[];
  misconceptions: MisconceptionSpec[];
  questions: QuestionSpec[];
};
type ResourceSpec = { kind: string; title: string; body?: string; url?: string };
type LessonSpec = {
  slug: string;
  name: string;
  startPage: number;
  endPage: number;
  estimatedMins: number;
  reading: string;
  extraResources: ResourceSpec[];
  concepts: ConceptSpec[];
};
type UnitSpec = {
  slug: string;
  name: string;
  startPage: number;
  endPage: number;
  lessons: LessonSpec[];
};
export interface TextbookSpec {
  subjectKey: string;
  gradeKey: string;
  part: 'PART_1' | 'PART_2' | 'BOTH';
  edition: string;
  title: string;
  issuer?: string;
  totalPages?: number;
  units: UnitSpec[];
  exams?: {
    key: string;
    title: string;
    description: string;
    unitSlug: string;
    isAdaptive: boolean;
    timeLimitMins: number;
    passingScore: number;
  }[];
}

export function readTextbookSpec(file: string): TextbookSpec {
  return JSON.parse(readFileSync(resolve(DATA_DIR, file), 'utf8')) as TextbookSpec;
}

export interface TextbookSeedContext {
  academicYearId: string;
  schoolId: string;
}

export interface TextbookSeedReport {
  textbookKey: string;
  units: number;
  lessons: number;
  concepts: number;
  questions: number;
  misconceptions: number;
  resources: number;
  exams: number;
}

const GATE = { strength: 1.0, requiredMastery: 0.7 } as const;

export async function seedTextbookFromSpec(
  prisma: PrismaClient,
  ctx: TextbookSeedContext,
  spec: TextbookSpec,
): Promise<TextbookSeedReport> {
  const grade = await prisma.grade.findUniqueOrThrow({ where: { key: spec.gradeKey } });
  const subject = await prisma.subject.findUniqueOrThrow({ where: { key: spec.subjectKey } });
  const tbKey = unwrap(
    textbookKey({
      subject: spec.subjectKey,
      grade: Number(spec.gradeKey.replace('G0', '').replace('G', '')),
      part: spec.part,
      edition: spec.edition,
    }),
  );

  const textbook = await prisma.textbook.upsert({
    where: { key: tbKey },
    create: {
      key: tbKey,
      part: spec.part,
      gradeId: grade.id,
      subjectId: subject.id,
      edition: spec.edition,
      title: spec.title,
      issuer: spec.issuer,
      status: 'PUBLISHED',
      publishedAt: new Date(),
      totalPages: spec.totalPages,
    },
    update: { status: 'PUBLISHED', title: spec.title, totalPages: spec.totalPages },
  });

  await prisma.textbookAdoption.upsert({
    where: {
      textbookId_schoolId_academicYearId: {
        textbookId: textbook.id,
        schoolId: ctx.schoolId,
        academicYearId: ctx.academicYearId,
      },
    },
    create: { textbookId: textbook.id, schoolId: ctx.schoolId, academicYearId: ctx.academicYearId },
    update: {},
  });

  // slug → Prisma row, filled as the walk proceeds so explicit prerequisites
  // can only point backwards, the way a reader meets them.
  const conceptBySlug = new Map<string, { id: string; key: string; lessonId: string }>();
  const lessonByKey = new Map<string, { id: string; key: string }>();
  const lessonsInOrder: { key: string; unitSlug: string }[] = [];
  let nLessons = 0;
  let nConcepts = 0;
  let nQuestions = 0;
  let nMisconceptions = 0;
  let nResources = 0;

  for (const [uIdx, unitSpec] of spec.units.entries()) {
    const uSlug = unitSpec.slug || `UNIT-${uIdx + 1}`;
    const uKey = unwrap(unitKey(tbKey, uSlug));
    const unit = await prisma.unit.upsert({
      where: { key: uKey },
      create: {
        key: uKey,
        slug: uSlug,
        textbookId: textbook.id,
        name: unitSpec.name,
        type: 'UNIT',
        orderIndex: uIdx + 1,
        startPage: unitSpec.startPage ?? 1,
        endPage: unitSpec.endPage ?? 20,
      },
      update: {},
    });

    for (const [lIdx, lessonSpec] of unitSpec.lessons.entries()) {
      const lSlug = lessonSpec.slug || `LESSON-${lIdx + 1}`;
      const lKey = unwrap(lessonKey(uKey, lSlug));
      const lesson = await prisma.lesson.upsert({
        where: { key: lKey },
        create: {
          key: lKey,
          slug: lSlug,
          unitId: unit.id,
          name: lessonSpec.name,
          orderIndex: lIdx + 1,
          estimatedMins: lessonSpec.estimatedMins ?? 45,
          startPage: lessonSpec.startPage ?? 1,
          endPage: lessonSpec.endPage ?? 10,
        },
        update: {},
      });
      lessonByKey.set(lKey, { id: lesson.id, key: lKey });
      lessonsInOrder.push({ key: lKey, unitSlug: uSlug });
      nLessons += 1;

      // The lesson's own reading: the text the learner sees first.
      const readingBody = lessonSpec.reading || lessonSpec.name;
      await prisma.learningResource.upsert({
        where: { key: `${lKey}-RES1` },
        create: {
          key: `${lKey}-RES1`,
          slug: 'READING',
          kind: 'READING',
          title: lessonSpec.name,
          body: readingBody,
          lessonId: lesson.id,
          textbookId: textbook.id,
          orderIndex: 1,
          pageStart: lessonSpec.startPage ?? 1,
          pageEnd: lessonSpec.endPage ?? 10,
          estimatedMins: lessonSpec.estimatedMins ?? 45,
        },
        update: { body: readingBody, title: lessonSpec.name, isActive: true },
      });
      nResources += 1;

      // Additional learning options, in authored order after the reading.
      for (const [rIdx, res] of (lessonSpec.extraResources ?? []).entries()) {
        await prisma.learningResource.upsert({
          where: { key: `${lKey}-RES${rIdx + 2}` },
          create: {
            key: `${lKey}-RES${rIdx + 2}`,
            slug: res.kind || `RES-${rIdx + 2}`,
            kind: (res.kind || 'READING') as ResourceKind,
            title: res.title,
            body: res.body ?? null,
            url: res.url ?? null,
            lessonId: lesson.id,
            textbookId: textbook.id,
            orderIndex: rIdx + 2,
          },
          update: { title: res.title, body: res.body ?? null, isActive: true },
        });
        nResources += 1;
      }

      for (const [cIdx, conceptSpec] of (lessonSpec.concepts ?? []).entries()) {
        const cSlug = conceptSpec.slug || `CONCEPT-${cIdx + 1}`;
        const cKey = unwrap(conceptKey(lKey, cSlug));
        const concept = await prisma.concept.upsert({
          where: { key: cKey },
          create: {
            key: cKey,
            slug: cSlug,
            lessonId: lesson.id,
            name: conceptSpec.name,
            orderIndex: cIdx + 1,
            difficulty: conceptSpec.difficulty ?? 0.3,
            importance: 0.9,
            masteryThreshold: conceptSpec.threshold ?? 0.7,
            isCore: true,
            pageNumber: conceptSpec.page ?? 1,
          },
          update: {},
        });
        conceptBySlug.set(cSlug, {
          id: concept.id,
          key: cKey,
          lessonId: lesson.id,
        });
        nConcepts += 1;

        for (const pSlug of (conceptSpec.prerequisites ?? [])) {
          const from = conceptBySlug.get(pSlug);
          if (!from) continue;
          await prisma.conceptPrerequisite.upsert({
            where: {
              conceptId_prerequisiteId: { conceptId: concept.id, prerequisiteId: from.id },
            },
            create: { conceptId: concept.id, prerequisiteId: from.id, ...GATE },
            update: {},
          });
        }

        for (const [mIdx, mis] of (conceptSpec.misconceptions ?? []).entries()) {
          const mSlug = mis.slug || `MIS-${mIdx + 1}`;
          await prisma.misconception.upsert({
            where: { key: `${cKey}-MIS${mIdx + 1}` },
            create: {
              key: `${cKey}-MIS${mIdx + 1}`,
              slug: mSlug,
              conceptId: concept.id,
              name: mis.name,
              description: mis.description,
              remediation: mis.remediation,
            },
            update: { name: mis.name, description: mis.description, remediation: mis.remediation },
          });
          nMisconceptions += 1;
        }

        for (const [qIdx, qSpec] of (conceptSpec.questions ?? []).entries()) {
          const qKey = unwrap(questionKey(lKey, `${cKey}#${qIdx + 1}`));
          const question = await prisma.question.upsert({
            where: { key: qKey },
            create: {
              key: qKey,
              lessonId: lesson.id,
              type: 'MCQ_SINGLE',
              text: qSpec.text,
              points: 1,
              irtDifficulty: (conceptSpec.difficulty ?? 0.5) - 0.6,
              irtDiscrimination: 1.2,
              irtGuessing: 0.25,
              difficulty01: conceptSpec.difficulty ?? 0.5,
              status: 'PUBLISHED',
            },
            update: { status: 'PUBLISHED', text: qSpec.text },
          });

          await prisma.questionConcept.upsert({
            where: { questionId_conceptId: { questionId: question.id, conceptId: concept.id } },
            create: { questionId: question.id, conceptId: concept.id, weight: 1.0, isPrimary: true },
            update: {},
          });

          // Choices are replaced wholesale — see the file header.
          await prisma.questionChoice.deleteMany({ where: { questionId: question.id } });
          const misByKey = new Map<string, { id: string }>();
          for (const [mIdx, mis] of (conceptSpec.misconceptions ?? []).entries()) {
            const row = await prisma.misconception.findUnique({
              where: { key: `${cKey}-MIS${mIdx + 1}` },
            });
            if (row) misByKey.set(mis.slug || `MIS-${mIdx + 1}`, row);
          }
          const created: { id: string }[] = [];
          for (const [chIdx, choice] of (qSpec.choices ?? []).entries()) {
            const tagged = choice.misconception ? misByKey.get(choice.misconception) : undefined;
            created.push(
              await prisma.questionChoice.create({
                data: {
                  questionId: question.id,
                  text: choice.text,
                  orderIndex: chIdx + 1,
                  misconceptionId: tagged?.id ?? null,
                },
              }),
            );
          }
          const correctIds = created.filter((_, i) => qSpec.choices[i]?.correct).map((c) => c.id);
          await prisma.answerKey.upsert({
            where: { questionId: question.id },
            create: { questionId: question.id, correctChoiceIds: correctIds },
            update: { correctChoiceIds: correctIds },
          });
          nQuestions += 1;
        }
      }
    }
  }

  // The lesson chain: last concept of lesson N gates the first of lesson N+1,
  // across units. Applied after the walk so it never depends on authoring
  // order inside the JSON.
  for (let i = 1; i < lessonsInOrder.length; i++) {
    const prev = lessonsInOrder[i - 1]!;
    const curr = lessonsInOrder[i]!;
    const prevConcepts = await prisma.concept.findMany({
      where: { lesson: { key: prev.key } },
      orderBy: { orderIndex: 'desc' },
      take: 1,
    });
    const currConcepts = await prisma.concept.findMany({
      where: { lesson: { key: curr.key } },
      orderBy: { orderIndex: 'asc' },
      take: 1,
    });
    if (prevConcepts.length === 0 || currConcepts.length === 0) continue;
    await prisma.conceptPrerequisite.upsert({
      where: {
        conceptId_prerequisiteId: {
          conceptId: currConcepts[0]!.id,
          prerequisiteId: prevConcepts[0]!.id,
        },
      },
      create: {
        conceptId: currConcepts[0]!.id,
        prerequisiteId: prevConcepts[0]!.id,
        ...GATE,
      },
      update: {},
    });
  }

  // Unit assessments: exam items are the unit's questions, in book order.
  for (const examSpec of (spec.exams ?? [])) {
    const unitSpec = spec.units.find((u) => u.slug === examSpec.unitSlug);
    if (!unitSpec) continue;
    const exam = await prisma.exam.upsert({
      where: { key: examSpec.key },
      create: {
        key: examSpec.key,
        title: examSpec.title,
        description: examSpec.description,
        isAdaptive: examSpec.isAdaptive,
        timeLimitMins: examSpec.timeLimitMins,
        passingScore: examSpec.passingScore,
        textbookId: textbook.id,
        status: 'PUBLISHED',
      },
      update: { status: 'PUBLISHED', textbookId: textbook.id, title: examSpec.title },
    });
    const uKey = unwrap(unitKey(tbKey, unitSpec.slug || `UNIT-1`));
    const items = await prisma.question.findMany({
      where: {
        status: 'PUBLISHED',
        lesson: { unit: { key: uKey } },
      },
      orderBy: [{ lesson: { unit: { orderIndex: 'asc' } } }, { lesson: { orderIndex: 'asc' } }, { key: 'asc' }],
    });
    await prisma.examItem.deleteMany({ where: { examId: exam.id } });
    for (const [i, q] of items.entries()) {
      await prisma.examItem.create({
        data: { examId: exam.id, questionId: q.id, orderIndex: i + 1, points: 1 },
      });
    }
  }

  return {
    textbookKey: tbKey,
    units: spec.units.length,
    lessons: nLessons,
    concepts: nConcepts,
    questions: nQuestions,
    misconceptions: nMisconceptions,
    resources: nResources,
    exams: (spec.exams ?? []).length,
  };
}

