/**
 * Prisma adapters for the Learning read ports.
 *
 * Every method here is a READ. Learning is a consumer context: it must not be
 * able to write content, mastery or evidence, and the absence of write methods
 * is how that is enforced structurally rather than by convention.
 */

import { daysBetween } from '../../shared/kernel/clock.js';
import { retrievability } from '../../contexts/mastery/domain/retention.js';
import type {
  ConceptDescriptor,
  ContentReader,
  DecisionLogWriter,
  LessonResourceView,
  LessonShelfItem,
  LessonView,
  LearnerEntitlementReader,
  LearnerTextbook,
  LearningResource,
  MasteryReader,
  MisconceptionReader,
  ResourceReader,
} from '../../contexts/learning/application/ports.js';
import type { ActivityType } from '../../contexts/learning/domain/next-activity.js';
import type { PrerequisiteEdge } from '../../contexts/learning/domain/prerequisite-graph.js';
import type { FlashcardReader } from '../../contexts/learning/application/flashcard.ports.js';
import type { AuthoredFlashcard } from '../../contexts/learning/application/flashcard.ports.js';
import type { Db } from './prisma.client.js';
import {
  publishedConcept,
  publishedLesson,
  publishedTextbook,
} from './published-content.js';

/**
 * What a learner is entitled to study (gap G1).
 *
 * The chain is: current enrollment → school + academic year + grade + term →
 * the school's textbook adoptions for that year → published books matching the
 * learner's grade and term.
 *
 * Adoption is the reason this is not simply "textbooks for grade 7". Two
 * schools in the same year can teach different editions of the same subject,
 * and the adoption table is what records that choice. Filtering by grade alone
 * would show a learner a book their school does not use.
 */
export class PrismaLearnerEntitlementReader implements LearnerEntitlementReader {
  constructor(private readonly db: Db) {}

  async textbooksFor(learnerKey: string): Promise<LearnerTextbook[]> {
    const enrollment = await this.db.enrollment.findFirst({
      where: { learner: { key: learnerKey }, isCurrent: true },
      select: {
        schoolId: true,
        academicYearId: true,
        gradeId: true,
        termId: true,
        academicYear: { select: { key: true } },
      },
    });

    // No current enrollment means no entitlement. An empty list is the honest
    // answer; inventing a fallback would show content the learner is not
    // enrolled for.
    if (!enrollment) return [];

    const rows = await this.db.textbook.findMany({
      where: {
        ...publishedTextbook,
        gradeId: enrollment.gradeId,
        termId: enrollment.termId,
        adoptions: {
          some: {
            schoolId: enrollment.schoolId,
            academicYearId: enrollment.academicYearId,
          },
        },
      },
      select: {
        key: true,
        title: true,
        edition: true,
        totalPages: true,
        subject: { select: { key: true, name: true } },
        grade: { select: { key: true, name: true } },
        term: { select: { key: true, name: true } },
      },
      orderBy: [{ subject: { key: 'asc' } }, { key: 'asc' }],
    });

    return rows.map((row) => ({
      key: row.key,
      title: row.title,
      subjectKey: row.subject.key,
      subjectName: row.subject.name,
      gradeKey: row.grade.key,
      gradeName: row.grade.name,
      termKey: row.term.key,
      termName: row.term.name,
      academicYearKey: enrollment.academicYear.key,
      edition: row.edition,
      totalPages: row.totalPages,
    }));
  }
}

export class PrismaContentReader implements ContentReader {
  constructor(private readonly db: Db) {}

  async conceptsInLesson(lessonKey: string): Promise<ConceptDescriptor[]> {
    const rows = await this.db.concept.findMany({
      where: { lesson: { key: lessonKey, ...publishedLesson }, isActive: true },
      select: conceptSelect,
      orderBy: { orderIndex: 'asc' },
    });
    return rows.map(toDescriptor);
  }

  async conceptsInTextbook(textbookKey: string): Promise<ConceptDescriptor[]> {
    const rows = await this.db.concept.findMany({
      where: {
        isActive: true,
        lesson: {
          isActive: true,
          unit: { isActive: true, textbook: { key: textbookKey, ...publishedTextbook } },
        },
      },
      select: conceptSelect,
      // Textbook order across the whole book: unit, then lesson, then concept.
      orderBy: [
        { lesson: { unit: { orderIndex: 'asc' } } },
        { lesson: { orderIndex: 'asc' } },
        { orderIndex: 'asc' },
      ],
    });
    return rows.map(toDescriptor);
  }

  async prerequisitesFor(conceptKeys: readonly string[]): Promise<PrerequisiteEdge[]> {
    if (conceptKeys.length === 0) return [];
    const rows = await this.db.conceptPrerequisite.findMany({
      where: {
        concept: { key: { in: [...conceptKeys] }, ...publishedConcept },
        prerequisite: publishedConcept,
      },
      select: {
        strength: true,
        requiredMastery: true,
        concept: { select: { key: true } },
        prerequisite: { select: { key: true } },
      },
    });
    return rows.map((r) => ({
      conceptKey: r.concept.key,
      prerequisiteKey: r.prerequisite.key,
      strength: r.strength,
      requiredMastery: r.requiredMastery,
    }));
  }

  /** "Exists" means "exists and is visible to a learner" — an unpublished lesson is not found. */
  async lessonExists(lessonKey: string): Promise<boolean> {
    const row = await this.db.lesson.findFirst({
      where: { key: lessonKey, ...publishedLesson },
      select: { id: true },
    });
    return row != null;
  }

  async lessonShelf(textbookKey: string): Promise<LessonShelfItem[]> {
    const rows = await this.db.lesson.findMany({
      where: {
        isActive: true,
        unit: { isActive: true, textbook: { key: textbookKey, ...publishedTextbook } },
      },
      select: {
        key: true,
        name: true,
        startPage: true,
        endPage: true,
        estimatedMins: true,
        unit: { select: { key: true, name: true } },
      },
      orderBy: [
        { unit: { orderIndex: 'asc' } },
        { orderIndex: 'asc' },
      ],
    });
    return rows.map((row) => ({
      lessonKey: row.key,
      lessonName: row.name,
      unitKey: row.unit.key,
      unitName: row.unit.name,
      startPage: row.startPage,
      endPage: row.endPage,
      estimatedMins: row.estimatedMins,
    }));
  }

  /**
   * One lesson, opened. The concepts come pre-ordered (unit→lesson→concept
   * does not apply within one lesson, but concept order does), and the
   * resources in authored order — the reading first, the extras after, the
   * order the author chose being content (see the schema note on
   * `LearningResource.orderIndex`).
   */
  async lessonView(lessonKey: string): Promise<LessonView | null> {
    const lesson = await this.db.lesson.findFirst({
      where: { key: lessonKey, ...publishedLesson },
      select: {
        key: true,
        name: true,
        startPage: true,
        endPage: true,
        estimatedMins: true,
        unit: {
          select: { key: true, name: true, textbook: { select: { key: true, title: true } } },
        },
      },
    });
    if (!lesson) return null;

    const concepts = await this.conceptsInLesson(lessonKey);

    const resourceRows = await this.db.learningResource.findMany({
      where: { lesson: { key: lessonKey }, isActive: true },
      select: {
        key: true,
        kind: true,
        title: true,
        body: true,
        url: true,
        orderIndex: true,
        estimatedMins: true,
      },
      orderBy: { orderIndex: 'asc' },
    });
    const resources: LessonResourceView[] = resourceRows.map((r) => ({
      key: r.key,
      kind: r.kind,
      title: r.title,
      body: r.body,
      url: r.url,
      orderIndex: r.orderIndex,
      estimatedMins: r.estimatedMins,
    }));

    return {
      key: lesson.key,
      name: lesson.name,
      startPage: lesson.startPage,
      endPage: lesson.endPage,
      estimatedMins: lesson.estimatedMins,
      unitKey: lesson.unit.key,
      unitName: lesson.unit.name,
      textbookKey: lesson.unit.textbook.key,
      textbookTitle: lesson.unit.textbook.title,
      concepts,
      resources,
    };
  }
}

export class PrismaMasteryReader implements MasteryReader {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async profileFor(learnerKey: string, conceptKeys: readonly string[]) {
    const out = new Map<
      string,
      {
        mastery: number;
        effectiveMastery: number;
        confidence: number;
        retrievability: number;
        attemptsCount: number;
      }
    >();
    if (conceptKeys.length === 0) return out;

    const rows = await this.db.conceptMastery.findMany({
      where: { learner: { key: learnerKey }, concept: { key: { in: [...conceptKeys] } } },
      include: { concept: { select: { key: true } } },
    });

    const now = this.now();
    for (const r of rows) {
      // Decay is projected at read time — the stored value is never mutated.
      const elapsed = r.lastObservedAt ? Math.max(0, daysBetween(r.lastObservedAt, now)) : 0;
      const recall = retrievability(elapsed, r.stabilityDays);
      out.set(r.concept.key, {
        mastery: r.mastery,
        effectiveMastery: Number((r.mastery * recall).toFixed(6)),
        confidence: r.confidence,
        retrievability: recall,
        attemptsCount: r.attemptsCount,
      });
    }
    return out;
  }
}

export class PrismaMisconceptionReader implements MisconceptionReader {
  constructor(private readonly db: Db) {}

  async openForLearner(
    learnerKey: string,
    conceptKeys: readonly string[],
  ): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    if (conceptKeys.length === 0) return out;

    const rows = await this.db.learnerMisconception.findMany({
      where: {
        learner: { key: learnerKey },
        isResolved: false,
        concept: { key: { in: [...conceptKeys] } },
      },
      select: {
        concept: { select: { key: true } },
        misconception: { select: { key: true } },
      },
    });

    for (const r of rows) {
      const key = r.concept.key;
      const list = out.get(key) ?? [];
      list.push(r.misconception?.key ?? `${key}-UNCLASSIFIED`);
      out.set(key, list);
    }
    return out;
  }
}

export class PrismaResourceReader implements ResourceReader {
  constructor(private readonly db: Db) {}

  async forConcept(
    conceptKey: string,
    kinds?: readonly LearningResource['kind'][],
  ): Promise<LearningResource[]> {
    const rows = await this.db.learningResource.findMany({
      where: {
        isActive: true,
        concept: { key: conceptKey, ...publishedConcept },
        ...(kinds?.length ? { kind: { in: [...kinds] } } : {}),
      },
      select: {
        key: true,
        title: true,
        kind: true,
        url: true,
        pageStart: true,
        pageEnd: true,
        estimatedMins: true,
      },
      take: 10,
    });

    return rows.map((r) => ({
      resourceKey: r.key,
      title: r.title,
      kind: r.kind as LearningResource['kind'],
      conceptKey,
      url: r.url,
      pageRange: r.pageStart != null ? { start: r.pageStart, end: r.pageEnd ?? r.pageStart } : null,
      estimatedMinutes: r.estimatedMins,
    }));
  }
}

/**
 * Append-only record of what the platform decided and why.
 *
 * Unknown learners are skipped rather than throwing: this writer runs on a
 * best-effort path and must not convert an audit miss into a failed request.
 */
export class PrismaDecisionLogWriter implements DecisionLogWriter {
  constructor(private readonly db: Db) {}

  async record(entry: {
    learnerKey: string;
    activity: ActivityType;
    conceptKey: string | null;
    rule: string;
    rationale: string;
    evidence: Readonly<Record<string, unknown>>;
  }): Promise<void> {
    const learner = await this.db.learnerProfile.findUnique({
      where: { key: entry.learnerKey },
      select: { id: true },
    });
    if (!learner) return;

    await this.db.learningDecisionLog.create({
      data: {
        learnerId: learner.id,
        activity: entry.activity,
        conceptKey: entry.conceptKey,
        rule: entry.rule,
        rationale: entry.rationale,
        evidence: entry.evidence as object,
      },
    });
  }
}

const conceptSelect = {
  key: true,
  name: true,
  orderIndex: true,
  masteryThreshold: true,
  isCore: true,
  lesson: {
    select: { key: true, name: true, unit: { select: { key: true, name: true } } },
  },
} as const;

type ConceptRow = {
  key: string;
  name: string;
  orderIndex: number;
  masteryThreshold: number;
  isCore: boolean;
  lesson: { key: string; name: string; unit: { key: string; name: string } };
};

function toDescriptor(row: ConceptRow): ConceptDescriptor {
  return {
    conceptKey: row.key,
    name: row.name,
    lessonKey: row.lesson.key,
    unitKey: row.lesson.unit.key,
    orderIndex: row.orderIndex,
    masteryThreshold: row.masteryThreshold,
    isCore: row.isCore,
    lessonName: row.lesson.name,
    unitName: row.lesson.unit.name,
  };
}

/**
 * Flashcards as Learning sees them: published, active, read-only.
 *
 * The published filter is the same one every other learner-facing read uses,
 * so a draft card can never reach a learner through the deck endpoint.
 */
export class PrismaFlashcardReader implements FlashcardReader {
  constructor(private readonly db: Db) {}

  async forLesson(lessonKey: string): Promise<AuthoredFlashcard[]> {
    return this.load({ lesson: { key: lessonKey, ...publishedLesson } });
  }

  async forConcept(conceptKey: string): Promise<AuthoredFlashcard[]> {
    return this.load({ key: conceptKey, ...publishedConcept });
  }

  private async load(conceptWhere: Record<string, unknown>): Promise<AuthoredFlashcard[]> {
    const rows = await this.db.flashcard.findMany({
      where: { isActive: true, concept: conceptWhere },
      select: {
        key: true,
        reviewPriority: true,
        difficulty: true,
        front: true,
        back: true,
        concept: { select: { key: true } },
      },
      // A hard cap: a deck is a study session, not a database dump. The
      // service trims further, but an unbounded query here would be the one
      // that falls over on a big book.
      take: 200,
    });

    return rows.map((row) => ({
      cardKey: row.key,
      conceptKey: row.concept.key,
      reviewPriority: row.reviewPriority,
      difficulty: row.difficulty,
      front: row.front,
      back: row.back,
    }));
  }
}
