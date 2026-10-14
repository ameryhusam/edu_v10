import type { PrismaClient } from '@prisma/client';
import type { AuthorContext, ContentAuthoringService } from '../../contexts/content/application/authoring.service.js';
import type { ItemBankService } from '../../contexts/content/application/item-bank.service.js';
import type { GeminiContentEngine, ExtractedQuestion } from './gemini-content-engine.js';
import { Errors } from '../../shared/kernel/errors.js';
import { Err, Ok, type Result } from '../../shared/kernel/result.js';

import type {
  ContentEnrichmentPort,
  EnrichedConceptResult,
  EnrichedQuestionResult,
} from '../../contexts/content/application/content-enrichment.port.js';

export class ContentEnrichmentService implements ContentEnrichmentPort {
  constructor(
    private readonly db: PrismaClient,
    private readonly authoring: ContentAuthoringService,
    private readonly itemBank: ItemBankService,
    private readonly geminiEngine: GeminiContentEngine,
  ) {}

  /**
   * Generates curriculum concepts and misconceptions for a specific lesson via AI,
   * then adds them directly into the database via domain services.
   */
  async enrichLessonConcepts(
    ctx: AuthorContext,
    lessonKey: string,
  ): Promise<Result<{ concepts: EnrichedConceptResult[] }>> {
    const lesson = await this.db.lesson.findUnique({
      where: { key: lessonKey },
      include: {
        unit: {
          include: {
            textbook: {
              include: { subject: true, grade: true },
            },
          },
        },
      },
    });

    if (!lesson) {
      return Err(Errors.notFound('lesson.not_found', `Lesson not found: ${lessonKey}`));
    }

    const subjectName = lesson.unit.textbook.subject.name;
    const gradeName = lesson.unit.textbook.grade.name;
    const unitTitle = lesson.unit.name;
    const lessonTitle = lesson.name;

    const extracted = await this.geminiEngine.enrichLessonConcepts(
      lessonTitle,
      unitTitle,
      subjectName,
      gradeName,
    );

    const createdList: EnrichedConceptResult[] = [];

    for (const item of extracted) {
      const conceptRes = await this.authoring.createConcept(ctx, {
        lessonKey,
        name: item.name,
        slug: item.slug,
        description: item.description,
        difficulty: item.difficulty,
        masteryThreshold: item.threshold,
        isCore: true,
      });

      if (!conceptRes.ok) {
        continue;
      }

      const conceptKey = conceptRes.value.key;
      let misCount = 0;

      for (const mis of item.misconceptions ?? []) {
        const misRes = await this.authoring.createMisconception(ctx, {
          conceptKey,
          name: mis.name,
          slug: mis.slug,
          description: mis.description,
          correction: mis.remediation,
        });
        if (misRes.ok) misCount++;
      }

      createdList.push({
        key: conceptKey,
        name: item.name,
        slug: item.slug,
        misconceptionsCount: misCount,
      });
    }

    return Ok({ concepts: createdList });
  }

  /**
   * Generates assessment questions for a specific lesson via AI,
   * associating them with lesson concepts and storing them in the Item Bank.
   */
  async enrichLessonQuestions(
    ctx: AuthorContext,
    lessonKey: string,
    count = 4,
  ): Promise<Result<{ questions: EnrichedQuestionResult[] }>> {
    const lesson = await this.db.lesson.findUnique({
      where: { key: lessonKey },
      include: {
        unit: {
          include: {
            textbook: {
              include: { subject: true, grade: true },
            },
          },
        },
        concepts: {
          where: { isActive: true },
          select: { key: true, name: true, slug: true },
        },
      },
    });

    if (!lesson) {
      return Err(Errors.notFound('lesson.not_found', `Lesson not found: ${lessonKey}`));
    }

    const unitTitle = lesson.unit.name;
    const lessonTitle = lesson.name;
    const concepts = lesson.concepts;

    const extracted = await this.geminiEngine.enrichLessonQuestions(
      lessonTitle,
      unitTitle,
      concepts,
      count,
    );

    const primaryConceptKey = concepts[0]?.key;
    const createdQuestions: EnrichedQuestionResult[] = [];

    for (const q of extracted) {
      const correctChoiceIds = q.choices
        .filter((c: ExtractedQuestion['choices'][number]) => c.correct)
        .map((c: ExtractedQuestion['choices'][number]) => c.id);

      const qRes = await this.itemBank.createQuestion(ctx, {
        lessonKey,
        type: q.type as any,
        text: q.text,
        points: q.points ?? 1,
        difficulty01: q.difficulty01 ?? 0.3,
        hint: q.hint ?? null,
        explanation: q.explanation ?? null,
        origin: 'AI',
        textbookRole: 'EXERCISE',
        choices: q.choices.map((c: ExtractedQuestion['choices'][number], i: number) => ({
          id: c.id || `c${i + 1}`,
          text: c.text,
          misconceptionKey: null,
          feedback: null,
        })),
        answerKey: {
          correctChoiceIds: correctChoiceIds.length > 0 ? correctChoiceIds : ['c1'],
          acceptedTexts: [],
          numericMin: null,
          numericMax: null,
          caseSensitive: false,
          allowPartialCredit: false,
        },
        concepts: primaryConceptKey
          ? [
              {
                conceptKey: primaryConceptKey,
                weight: 1.0,
                isPrimary: true,
              },
            ]
          : [],
      });

      if (qRes.ok) {
        createdQuestions.push({
          key: qRes.value.key,
          text: qRes.value.text,
          type: qRes.value.type,
        });
      }
    }

    return Ok({ questions: createdQuestions });
  }
}
