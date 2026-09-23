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
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PrismaClient } from '@prisma/client';
import { unwrap } from '../../src/shared/kernel/result.js';
import { unitKey, type TextbookKey } from '../../src/shared/kernel/identifiers.js';
import { loadEnv } from '../../src/shared/config/env.js';
import { buildContainer } from '../../src/composition/container.js';
import { normalizeOrConvertPackage } from '../../src/contexts/content/application/content-import.service.js';

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
  part: 'PART_1' | 'PART_2';
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
  const spec = JSON.parse(readFileSync(resolve(DATA_DIR, file), 'utf8')) as any;
  if (!spec.part && spec.term) {
    spec.part = spec.term === 1 || spec.term === '1' || spec.term === 'PART_1' || spec.term === 'P1'
      ? 'PART_1'
      : 'PART_2';
  }
  return spec as TextbookSpec;
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
  const container = buildContainer(loadEnv(), { db: prisma });
  const contentImport = container.useCases.contentImport;
  const contentAuthoring = container.useCases.contentAuthoring;

  const pkg = normalizeOrConvertPackage(spec, { dryRun: false });
  const authorCtx = { actorKey: 'usr_seed_admin' };
  const importResult = await contentImport.importPackage(authorCtx, pkg, {
    dryRun: false,
    mode: 'APPEND_DEDUP',
  });

  if (!importResult.ok) {
    throw new Error(
      `ContentImportService failed during seed: ${importResult.error.code}: ${importResult.error.message}`,
    );
  }

  const tbKey = importResult.value.textbookKey;
  const textbook = await prisma.textbook.findUniqueOrThrow({ where: { key: tbKey } });

  // Update status to PUBLISHED so seed content is immediately usable by learners
  await prisma.textbook.update({
    where: { id: textbook.id },
    data: { status: 'PUBLISHED', publishedAt: new Date() },
  });

  // Also publish questions in the textbook so they appear in exams and practice
  await prisma.question.updateMany({
    where: { lesson: { unit: { textbookId: textbook.id } } },
    data: { status: 'PUBLISHED' },
  });

  const termOrdinal = spec.part === 'PART_1' ? 1 : 2;
  const term = await prisma.term.findFirstOrThrow({
    where: { academicYearId: ctx.academicYearId, ordinal: termOrdinal },
  });

  await prisma.textbookAdoption.upsert({
    where: {
      textbookId_schoolId_academicYearId: {
        textbookId: textbook.id,
        schoolId: ctx.schoolId,
        academicYearId: ctx.academicYearId,
      },
    },
    create: {
      textbookId: textbook.id,
      schoolId: ctx.schoolId,
      academicYearId: ctx.academicYearId,
      termId: term.id,
    },
    update: {},
  });

  // Inter-lesson sequential progression gates via canonical linkPrerequisite
  const allLessons = await prisma.lesson.findMany({
    where: { unit: { textbookId: textbook.id } },
    orderBy: [{ unit: { orderIndex: 'asc' } }, { orderIndex: 'asc' }],
    select: { key: true, concepts: { orderBy: { orderIndex: 'asc' }, select: { key: true } } },
  });
  for (let i = 1; i < allLessons.length; i++) {
    const prev = allLessons[i - 1]!;
    const curr = allLessons[i]!;
    if (prev.concepts.length === 0 || curr.concepts.length === 0) continue;
    const prevConceptKey = prev.concepts[prev.concepts.length - 1]!.key;
    const currConceptKey = curr.concepts[0]!.key;
    await contentAuthoring.linkPrerequisite(authorCtx, {
      conceptKey: currConceptKey,
      prerequisiteKey: prevConceptKey,
      strength: 1.0,
      requiredMastery: 0.7,
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
    const uKey = unwrap(unitKey(tbKey as TextbookKey, unitSpec.slug || `UNIT-1`));
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

  const created = importResult.value.created;
  const unchanged = importResult.value.unchanged;

  return {
    textbookKey: tbKey,
    units: created.units + unchanged.units,
    lessons: created.lessons + unchanged.lessons,
    concepts: created.concepts + unchanged.concepts,
    questions: created.questions + unchanged.questions,
    misconceptions: created.misconceptions + unchanged.misconceptions,
    resources: created.learningResources + unchanged.learningResources,
    exams: (spec.exams ?? []).length,
  };
}

