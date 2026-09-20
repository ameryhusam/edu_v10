/**
 * The single definition of "content a learner is allowed to see".
 *
 * Every learner-facing content read composes these fragments. There is one
 * definition rather than a `status: 'PUBLISHED'` repeated at each query
 * because the repeated form is what failed in legacy: the check existed on
 * questions (assessment.repository.ts:56) and nowhere else, so an unpublished
 * textbook was fully teachable while looking correctly guarded at a glance.
 *
 * The visible-state list is derived from the domain predicate instead of being
 * restated here, so a future lifecycle change cannot leave reads behind.
 */

import type { Prisma } from '@prisma/client';
import {
  PUBLICATION_STATES,
  isVisibleToLearners,
  type PublicationState,
} from '../../contexts/content/domain/publication.js';

/** Exactly the states `isVisibleToLearners` accepts — currently `['PUBLISHED']`. */
export const LEARNER_VISIBLE_STATES: readonly PublicationState[] =
  PUBLICATION_STATES.filter(isVisibleToLearners);

/** Matches a textbook row a learner may be served. */
export const publishedTextbook: Prisma.TextbookWhereInput = {
  status: { in: [...LEARNER_VISIBLE_STATES] },
};

/**
 * Reaches the owning textbook from a Unit, and from a Lesson or Concept via
 * their parents. Content is only visible when its whole ancestor chain is
 * active AND the book itself is published; a published book does not make a
 * deactivated unit visible.
 */
export const publishedUnit: Prisma.UnitWhereInput = {
  isActive: true,
  textbook: publishedTextbook,
};
export const publishedLesson: Prisma.LessonWhereInput = {
  isActive: true,
  unit: publishedUnit,
};
export const publishedConcept: Prisma.ConceptWhereInput = {
  isActive: true,
  lesson: publishedLesson,
};

/** An exam a learner may take: the terminal published state, nothing softer. */
export const publishedExam: Prisma.ExamWhereInput = {
  status: 'PUBLISHED',
};

/**
 * Matches a question a learner may be served.
 *
 * A question carries its own lifecycle rather than inheriting one from a
 * parent — it is a free-standing asset shared across lessons and exams — so it
 * needs its own fragment rather than a composition of the ones above. Same
 * rule, same single definition: no query restates the literal.
 */
export const publishedQuestion: Prisma.QuestionWhereInput = {
  status: { in: [...LEARNER_VISIBLE_STATES] },
};
