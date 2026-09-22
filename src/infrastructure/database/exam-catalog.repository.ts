/**
 * The learner's exam catalogue.
 *
 * A READ model, and deliberately narrow: the published exams of the textbooks
 * a learner is currently entitled to, each with the concept scope its
 * adaptive engine will draw from. It cannot see drafts, other schools' books,
 * unassigned private exams, or exams outside the entitlement — the same boundary `textbooksFor` draws,
 * because an exam a learner cannot study for is not theirs to take.
 *
 * Concept scope: the distinct concepts the exam's own items measure, falling
 * back to every concept of the textbook when a blueprint has no items yet
 * (an adaptive exam may be scoped by textbook rather than itemised). The
 * scope is returned, not inferred by the client — the runner passes it back
 * to `next-item` unchanged, so the browser never decides what an exam
 * measures.
 */

import type { LearnerExamView } from '../../contexts/assessment/application/ports.js';
import type { Db } from './prisma.client.js';
import {
  publishedConcept,
  publishedExam,
  publishedLesson,
  publishedTextbook,
  publishedUnit,
} from './published-content.js';

export class PrismaLearnerExamCatalog {
  constructor(private readonly db: Db) {}

  async examsFor(learnerKey: string): Promise<LearnerExamView[]> {
    // The entitlement half mirrors PrismaLearnerEntitlementReader: the current
    // enrolment names the school, year, grade and term, and only books the
    // school adopted for that cohort are the learner's.
    const enrollment = await this.db.enrollment.findFirst({
      where: { learner: { key: learnerKey }, isCurrent: true },
      select: { schoolId: true, academicYearId: true, gradeId: true, termId: true },
    });
    if (!enrollment) return [];

    const textbooks = await this.db.textbook.findMany({
      where: {
        ...publishedTextbook,
        gradeId: enrollment.gradeId,
        adoptions: {
          some: {
            schoolId: enrollment.schoolId,
            academicYearId: enrollment.academicYearId,
            termId: enrollment.termId,
          },
        },
      },
      select: {
        id: true,
        key: true,
        // The fallback scope: every published concept of the book. The
        // ancestor filters come from published-content, so a deactivated
        // unit hides its lessons here exactly as it does everywhere else.
        units: {
          where: publishedUnit,
          select: {
            lessons: {
              where: publishedLesson,
              select: {
                concepts: { where: publishedConcept, select: { key: true } },
              },
            },
          },
        },
      },
    });

    const textbookIds = textbooks.map((book) => book.id);
    if (textbookIds.length === 0) return [];

    const assignedExamRows = await this.db.instructionalPlan.findMany({
      where: {
        status: 'PUBLISHED',
        activityType: 'EXAM',
        obligations: { some: { learner: { key: learnerKey } } },
      },
      select: { activityKey: true },
    });
    const assignedExamKeys = [...new Set(assignedExamRows.map((row) => row.activityKey))];

    const exams = await this.db.exam.findMany({
      where: {
        ...publishedExam,
        textbookId: { in: textbookIds },
        OR: [
          { visibility: 'GLOBAL' },
          { visibility: 'SCHOOL', schoolId: enrollment.schoolId },
          ...(assignedExamKeys.length > 0 ? [{ key: { in: assignedExamKeys } }] : []),
        ],
      },
      select: {
        key: true,
        title: true,
        description: true,
        isAdaptive: true,
        timeLimitMins: true,
        passingScore: true,
        textbookId: true,
        // Items carry the blueprint: each question's concept links name what
        // the exam measures.
        items: {
          select: {
            question: {
              select: {
                concepts: { select: { concept: { select: { key: true } } } },
              },
            },
          },
        },
      },
      orderBy: { title: 'asc' },
    });

    const bookKeyOf = new Map(textbooks.map((book) => [book.id, book.key]));
    const bookConcepts = (bookId: string): readonly string[] => {
      const book = textbooks.find((entry) => entry.id === bookId);
      if (!book) return [];
      const keys = new Set<string>();
      for (const unit of book.units) {
        for (const lesson of unit.lessons) {
          for (const concept of lesson.concepts) keys.add(concept.key);
        }
      }
      return [...keys];
    };

    return exams.map((exam) => {
      // The blueprint's own concepts when items exist; the book's otherwise.
      const blueprint = [
        ...new Set(
          exam.items.flatMap((item) =>
            item.question.concepts.map((link) => link.concept.key),
          ),
        ),
      ];
      const conceptKeys = blueprint.length > 0 ? blueprint : bookConcepts(exam.textbookId ?? '');

      return {
        key: exam.key,
        title: exam.title,
        description: exam.description,
        isAdaptive: exam.isAdaptive,
        timeLimitMins: exam.timeLimitMins,
        passingScore: exam.passingScore,
        textbookKey: bookKeyOf.get(exam.textbookId ?? '') ?? null,
        itemCount: exam.items.length,
        conceptKeys,
      };
    });
  }
}

export type { LearnerExamView };
