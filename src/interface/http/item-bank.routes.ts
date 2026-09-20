/**
 * Item bank routes — questions, exams and learning resources.
 *
 * A sibling of `content.routes.ts` and governed by the same rule: this file is
 * transport. It carries an intent to the application layer and renders the
 * answer. No gradability rule, no pool rule and no lifecycle rule is decided
 * here, because a rule that lives in a route exists once per client.
 *
 * Authoring roles are shared with the content tree deliberately: authoring a
 * lesson and authoring the questions that assess it are the same job.
 */

import { Router } from 'express';
import { z } from 'zod';
import { Errors } from '../../shared/kernel/errors.js';
import { Err, type Result } from '../../shared/kernel/result.js';
import { hasRole } from '../../contexts/identity/domain/roles.js';
import {
  PUBLICATION_ACTIONS,
  PUBLICATION_STATES,
  type PublicationAction,
} from '../../contexts/content/domain/publication.js';
import {
  QUESTION_ORIGINS,
  QUESTION_TYPES,
  QUESTION_VISIBILITIES,
  TEXTBOOK_QUESTION_ROLES,
} from '../../contexts/content/domain/question-authoring.js';
import type { AuthorContext, ItemBankService } from '../../contexts/content/application/item-bank.service.js';
import type { Actor } from './middleware/context.js';
import { handle } from './handler.js';

export interface ItemBankRouteDeps {
  readonly itemBank: ItemBankService;
}

const AUTHORING_ROLES = ['SYSTEM_ADMIN', 'SCHOOL_ADMIN', 'CONTENT_AUTHOR'] as const;
const EXAM_PLANNER_ROLES = [...AUTHORING_ROLES, 'TEACHER', 'PARENT'] as const;

/** Approving one's own submission is not a review. Same rule as content. */
const APPROVAL_ROLES = ['SYSTEM_ADMIN', 'SCHOOL_ADMIN'] as const;

function officialAuthorContext(actor: Actor): AuthorContext {
  return {
    actorKey: actor.userKey,
    actorUserId: actor.userId,
    schoolIds: actor.roles.flatMap((grant) => (grant.schoolId ? [grant.schoolId] : [])),
    canManageOfficialBank: true,
  };
}

function teacherQuestionContext(actor: Actor): AuthorContext {
  return {
    actorKey: actor.userKey,
    actorUserId: actor.userId,
    schoolIds: actor.roles
      .filter((grant) => grant.role === 'TEACHER')
      .flatMap((grant) => (grant.schoolId ? [grant.schoolId] : [])),
    canManageOfficialBank: false,
  };
}

function privateExamContext(actor: Actor): AuthorContext {
  return {
    actorKey: actor.userKey,
    actorUserId: actor.userId,
    schoolIds: actor.roles.flatMap((grant) => (grant.schoolId ? [grant.schoolId] : [])),
    canManageOfficialBank: false,
  };
}

function requireAuthor(actor: Actor | undefined): Result<AuthorContext> {
  if (!actor) {
    return Err(Errors.unauthenticated('auth.required', 'Authentication is required.'));
  }
  if (!hasRole(actor.roles, AUTHORING_ROLES)) {
    return Err(
      Errors.forbidden('content.authoring_forbidden', 'You may not author content.', {
        required: AUTHORING_ROLES,
      }),
    );
  }
  return { ok: true, value: officialAuthorContext(actor) };
}

function requireQuestionBankReader(actor: Actor | undefined): Result<AuthorContext> {
  if (!actor) {
    return Err(Errors.unauthenticated('auth.required', 'Authentication is required.'));
  }
  if (hasRole(actor.roles, AUTHORING_ROLES)) return { ok: true, value: officialAuthorContext(actor) };
  if (hasRole(actor.roles, ['TEACHER'])) return { ok: true, value: teacherQuestionContext(actor) };
  return Err(
    Errors.forbidden('content.question_bank_forbidden', 'You may not browse the question bank.', {
      required: [...AUTHORING_ROLES, 'TEACHER'],
    }),
  );
}

function requireQuestionWriter(actor: Actor | undefined): Result<AuthorContext> {
  return requireQuestionBankReader(actor);
}

function requireExamPlanner(actor: Actor | undefined): Result<AuthorContext> {
  if (!actor) {
    return Err(Errors.unauthenticated('auth.required', 'Authentication is required.'));
  }
  if (hasRole(actor.roles, AUTHORING_ROLES)) return { ok: true, value: officialAuthorContext(actor) };
  if (hasRole(actor.roles, ['TEACHER', 'PARENT'])) return { ok: true, value: privateExamContext(actor) };
  return Err(
    Errors.forbidden('content.exam_planning_forbidden', 'You may not create or manage exams.', {
      required: EXAM_PLANNER_ROLES,
    }),
  );
}

function requireApprover(actor: Actor | undefined, action: PublicationAction): Result<void> {
  if (action !== 'APPROVE') return { ok: true, value: undefined };
  if (actor && hasRole(actor.roles, APPROVAL_ROLES)) return { ok: true, value: undefined };
  return Err(
    Errors.forbidden(
      'content.approval_forbidden',
      'Making content available requires an administrator; an author cannot approve their own submission.',
      { required: APPROVAL_ROLES },
    ),
  );
}

const choiceInput = z.object({
  id: z.string().min(1),
  text: z.string(),
  misconceptionKey: z.string().min(1).nullish(),
  feedback: z.string().nullish(),
});

/**
 * The answer key, shaped exactly as the domain expects.
 *
 * Not passthrough: unlike a content patch, every field here is known and a
 * typo'd key field would be a silently missing answer key — the precise
 * failure this capability exists to prevent.
 */
const answerKeyInput = z.object({
  correctChoiceIds: z.array(z.string()).optional(),
  acceptedTexts: z.array(z.string()).optional(),
  numericMin: z.number().nullish(),
  numericMax: z.number().nullish(),
  expectedOrder: z.array(z.string()).optional(),
  expectedPairs: z.record(z.string(), z.string()).nullish(),
  caseSensitive: z.boolean().optional(),
  allowPartialCredit: z.boolean().optional(),
  rubric: z.unknown().optional(),
});

const conceptLinkInput = z.object({
  conceptKey: z.string().min(1),
  weight: z.number(),
  isPrimary: z.boolean(),
});

const createQuestionInput = z.object({
  type: z.enum(QUESTION_TYPES),
  text: z.string().min(1),
  hint: z.string().nullish(),
  explanation: z.string().nullish(),
  points: z.number().optional(),
  difficulty01: z.number().optional(),
  origin: z.enum(QUESTION_ORIGINS).optional(),
  textbookRole: z.enum(TEXTBOOK_QUESTION_ROLES).nullish(),
  sourceRef: z.string().max(200).nullish(),
  visibility: z.enum(QUESTION_VISIBILITIES).optional(),
  choices: z.array(choiceInput).optional(),
  answerKey: answerKeyInput.optional(),
  /** Where the item lives. Mandatory. */
  lessonKey: z.string().min(1),
  /**
   * What it measures. Optional, and an empty array is a legitimate value: an
   * item may be filed before it has been diagnosed. The publish gate, not this
   * schema, is what refuses to make an unlinked item live.
   */
  concepts: z.array(conceptLinkInput).optional(),
});

const updateQuestionInput = z.object({
  questionKey: z.string().min(1),
  text: z.string().min(1).optional(),
  hint: z.string().nullish(),
  explanation: z.string().nullish(),
  points: z.number().optional(),
  difficulty01: z.number().optional(),
  origin: z.enum(QUESTION_ORIGINS).optional(),
  textbookRole: z.enum(TEXTBOOK_QUESTION_ROLES).nullish(),
  sourceRef: z.string().max(200).nullish(),
  visibility: z.enum(QUESTION_VISIBILITIES).optional(),
  choices: z.array(choiceInput).optional(),
  answerKey: answerKeyInput.optional(),
});

const questionConceptsInput = z.object({
  questionKey: z.string().min(1),
  /**
   * The complete new set of links, replacing whatever is there.
   *
   * An empty array is allowed and means "unlink": a reviewer who finds an item
   * attached to the wrong concept must be able to detach it without inventing
   * a replacement on the spot. The item stays placed in its lesson.
   */
  concepts: z.array(conceptLinkInput),
});

const questionTransitionInput = z.object({
  questionKey: z.string().min(1),
  action: z.enum(PUBLICATION_ACTIONS),
});

const questionListInput = z.object({
  search: z.string().trim().min(1).max(120).optional(),
  type: z.enum(QUESTION_TYPES).optional(),
  origin: z.enum(QUESTION_ORIGINS).optional(),
  status: z.enum(['DRAFT', 'IN_REVIEW', 'PUBLISHED', 'ARCHIVED']).optional(),
  visibility: z.enum(QUESTION_VISIBILITIES).optional(),
  textbookRole: z.enum(TEXTBOOK_QUESTION_ROLES).optional(),
  textbookKey: z.string().min(1).optional(),
  gradeKey: z.string().min(1).optional(),
  subjectKey: z.string().min(1).optional(),
  lessonKey: z.string().min(1).optional(),
  conceptKey: z.string().min(1).optional(),
  sourceRef: z.string().trim().min(1).max(200).optional(),
  difficultyMin: z.coerce.number().min(0).max(1).optional(),
  difficultyMax: z.coerce.number().min(0).max(1).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const createExamInput = z.object({
  title: z.string().min(1),
  description: z.string().nullish(),
  textbookKey: z.string().min(1).nullish(),
  isAdaptive: z.boolean().optional(),
  passingScore: z.number().optional(),
  timeLimitMins: z.number().int().nullish(),
  minItems: z.number().int().optional(),
  maxItems: z.number().int().optional(),
  targetStandardError: z.number().optional(),
  visibility: z.enum(QUESTION_VISIBILITIES).optional(),
});

const adaptiveExamInput = createExamInput.extend({
  textbookKey: z.string().min(1),
  lessonKey: z.string().min(1).nullish(),
  conceptKeys: z.array(z.string().min(1)).optional(),
  type: z.enum(QUESTION_TYPES).optional(),
  origin: z.enum(QUESTION_ORIGINS).optional(),
  difficultyMin: z.coerce.number().min(0).max(1).optional(),
  difficultyMax: z.coerce.number().min(0).max(1).optional(),
});

const examItemsInput = z.object({
  examKey: z.string().min(1),
  items: z.array(z.object({ questionKey: z.string().min(1), points: z.number().int().optional() })),
});

const examListInput = z.object({
  search: z.string().trim().min(1).max(120).optional(),
  status: z.enum(PUBLICATION_STATES).optional(),
  textbookKey: z.string().min(1).optional(),
  isAdaptive: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const examKeyInput = z.object({ examKey: z.string().min(1) });

const examTransitionInput = z.object({
  examKey: z.string().min(1),
  action: z.enum(PUBLICATION_ACTIONS),
});

const createResourceInput = z.object({
  kind: z.enum(['READING', 'VIDEO', 'WORKED_EXAMPLE', 'FLASHCARD_DECK', 'REMEDIAL', 'TEXTBOOK_PAGE']),
  title: z.string().min(1),
  slug: z.string().min(1).nullish(),
  url: z.string().nullish(),
  body: z.string().nullish(),
  textbookKey: z.string().min(1).nullish(),
  lessonKey: z.string().min(1).nullish(),
  conceptKey: z.string().min(1).nullish(),
  orderIndex: z.number().int().nullish(),
  pageStart: z.number().int().nullish(),
  pageEnd: z.number().int().nullish(),
  estimatedMins: z.number().int().nullish(),
});

const updateResourceInput = z.object({
  resourceKey: z.string().min(1),
  title: z.string().min(1).optional(),
  url: z.string().nullish(),
  body: z.string().nullish(),
  pageStart: z.number().int().nullish(),
  pageEnd: z.number().int().nullish(),
  estimatedMins: z.number().int().nullish(),
});

const resourceKeyInput = z.object({ resourceKey: z.string().min(1) });
const conceptKeyInput = z.object({ conceptKey: z.string().min(1) });
const textbookKeyInput = z.object({ textbookKey: z.string().min(1) });

const createFlashcardInput = z.object({
  conceptKey: z.string().min(1),
  front: z.string().min(1),
  back: z.string().min(1),
  reviewPriority: z.number().optional(),
  difficulty: z.number().optional(),
});

const updateFlashcardInput = z.object({
  cardKey: z.string().min(1),
  front: z.string().min(1).optional(),
  back: z.string().min(1).optional(),
  reviewPriority: z.number().optional(),
  difficulty: z.number().optional(),
});

const cardKeyInput = z.object({ cardKey: z.string().min(1) });

export function itemBankRoutes(deps: ItemBankRouteDeps): Router {
  const router = Router();

  // ── Questions ─────────────────────────────────────────────────────────────

  router.get(
    '/questions',
    handle({
      input: questionListInput,
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const reader = requireQuestionBankReader(actor);
        if (!reader.ok) return reader;
        return deps.itemBank.listQuestions(reader.value, input);
      },
    }),
  );

  router.post(
    '/questions',
    handle({
      input: createQuestionInput,
      requireAuth: true,
      successStatus: 201,
      execute: async ({ input, actor }) => {
        const author = requireQuestionWriter(actor);
        if (!author.ok) return author;
        return deps.itemBank.createQuestion(author.value, {
          type: input.type,
          text: input.text,
          hint: input.hint ?? null,
          explanation: input.explanation ?? null,
          ...(input.points !== undefined ? { points: input.points } : {}),
          ...(input.difficulty01 !== undefined ? { difficulty01: input.difficulty01 } : {}),
          ...(input.origin ? { origin: input.origin } : {}),
          ...(input.textbookRole !== undefined ? { textbookRole: input.textbookRole } : {}),
          ...(input.sourceRef !== undefined ? { sourceRef: input.sourceRef } : {}),
          ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
          choices: input.choices ?? [],
          answerKey: input.answerKey ?? {},
          lessonKey: input.lessonKey,
          concepts: input.concepts ?? [],
        });
      },
    }),
  );

  router.patch(
    '/questions/:questionKey',
    handle({
      input: updateQuestionInput,
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const author = requireQuestionWriter(actor);
        if (!author.ok) return author;
        const { questionKey, ...patch } = input;
        return deps.itemBank.updateQuestion(author.value, questionKey, patch);
      },
    }),
  );

  // Before `/questions/:questionKey`-style params so the literal segment wins.
  router.get(
    '/lessons/:lessonKey/questions',
    handle({
      input: z.object({}),
      requireAuth: true,
      execute: async ({ actor, req }) => {
        const reader = requireQuestionBankReader(actor);
        if (!reader.ok) return reader;
        return deps.itemBank.lessonQuestionBank(reader.value, String(req.params.lessonKey));
      },
    }),
  );

  router.put(
    '/questions/:questionKey/concepts',
    handle({
      input: questionConceptsInput,
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const author = requireQuestionWriter(actor);
        if (!author.ok) return author;
        return deps.itemBank.setQuestionConcepts(author.value, input.questionKey, input.concepts);
      },
    }),
  );

  router.post(
    '/questions/:questionKey/transitions',
    handle({
      input: questionTransitionInput,
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const author = requireAuthor(actor);
        if (!author.ok) return author;
        const approver = requireApprover(actor, input.action);
        if (!approver.ok) return approver;
        return deps.itemBank.transitionQuestion(author.value, input.questionKey, input.action);
      },
    }),
  );

  // ── Exams ─────────────────────────────────────────────────────────────────

  router.get(
    '/exams',
    handle({
      input: examListInput,
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const reader = requireExamPlanner(actor);
        if (!reader.ok) return reader;
        return deps.itemBank.listExams(reader.value, input);
      },
    }),
  );

  router.post(
    '/exams/adaptive-from-scope',
    handle({
      input: adaptiveExamInput,
      requireAuth: true,
      successStatus: 201,
      execute: async ({ input, actor }) => {
        const author = requireExamPlanner(actor);
        if (!author.ok) return author;
        return deps.itemBank.createAdaptiveExamFromScope(author.value, {
          title: input.title,
          description: input.description ?? null,
          textbookKey: input.textbookKey,
          lessonKey: input.lessonKey ?? null,
          conceptKeys: input.conceptKeys ?? [],
          ...(input.type !== undefined ? { type: input.type } : {}),
          ...(input.origin !== undefined ? { origin: input.origin } : {}),
          ...(input.difficultyMin !== undefined ? { difficultyMin: input.difficultyMin } : {}),
          ...(input.difficultyMax !== undefined ? { difficultyMax: input.difficultyMax } : {}),
          ...(input.passingScore !== undefined ? { passingScore: input.passingScore } : {}),
          timeLimitMins: input.timeLimitMins ?? null,
          ...(input.minItems !== undefined ? { minItems: input.minItems } : {}),
          ...(input.maxItems !== undefined ? { maxItems: input.maxItems } : {}),
          ...(input.targetStandardError !== undefined
            ? { targetStandardError: input.targetStandardError }
            : {}),
          ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
        });
      },
    }),
  );

  router.post(
    '/exams',
    handle({
      input: createExamInput,
      requireAuth: true,
      successStatus: 201,
      execute: async ({ input, actor }) => {
        const author = requireExamPlanner(actor);
        if (!author.ok) return author;
        return deps.itemBank.createExam(author.value, {
          title: input.title,
          description: input.description ?? null,
          textbookKey: input.textbookKey ?? null,
          ...(input.isAdaptive !== undefined ? { isAdaptive: input.isAdaptive } : {}),
          ...(input.passingScore !== undefined ? { passingScore: input.passingScore } : {}),
          timeLimitMins: input.timeLimitMins ?? null,
          ...(input.minItems !== undefined ? { minItems: input.minItems } : {}),
          ...(input.maxItems !== undefined ? { maxItems: input.maxItems } : {}),
          ...(input.targetStandardError !== undefined
            ? { targetStandardError: input.targetStandardError }
            : {}),
          ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
        });
      },
    }),
  );

  /** PUT, not PATCH: an exam's item list is validated as a whole. */
  router.put(
    '/exams/:examKey/items',
    handle({
      input: examItemsInput,
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const author = requireQuestionWriter(actor);
        if (!author.ok) return author;
        return deps.itemBank.setExamItems(author.value, input.examKey, input.items);
      },
    }),
  );

  /** What the exam measures — coverage and difficulty spread. */
  router.get(
    '/exams/:examKey/blueprint',
    handle({
      input: examKeyInput,
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const reader = requireQuestionBankReader(actor);
        if (!reader.ok) return reader;
        return deps.itemBank.examBlueprint(input.examKey);
      },
    }),
  );

  router.post(
    '/exams/:examKey/transitions',
    handle({
      input: examTransitionInput,
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const author = requireExamPlanner(actor);
        if (!author.ok) return author;
        return deps.itemBank.transitionExam(author.value, input.examKey, input.action);
      },
    }),
  );

  // ── Learning resources ────────────────────────────────────────────────────

  router.post(
    '/resources',
    handle({
      input: createResourceInput,
      requireAuth: true,
      successStatus: 201,
      execute: async ({ input, actor }) => {
        const author = requireQuestionWriter(actor);
        if (!author.ok) return author;
        return deps.itemBank.createResource(author.value, {
          kind: input.kind,
          title: input.title,
          slug: input.slug ?? null,
          url: input.url ?? null,
          body: input.body ?? null,
          textbookKey: input.textbookKey ?? null,
          lessonKey: input.lessonKey ?? null,
          conceptKey: input.conceptKey ?? null,
          orderIndex: input.orderIndex ?? undefined,
          pageStart: input.pageStart ?? null,
          pageEnd: input.pageEnd ?? null,
          estimatedMins: input.estimatedMins ?? null,
        });
      },
    }),
  );

  router.patch(
    '/resources/:resourceKey',
    handle({
      input: updateResourceInput,
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const author = requireQuestionWriter(actor);
        if (!author.ok) return author;
        const { resourceKey, ...patch } = input;
        return deps.itemBank.updateResource(author.value, resourceKey, patch);
      },
    }),
  );

  /** DELETE retires. The row stays, because decision logs point at it. */
  router.delete(
    '/resources/:resourceKey',
    handle({
      input: resourceKeyInput,
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const author = requireQuestionWriter(actor);
        if (!author.ok) return author;
        return deps.itemBank.retireResource(author.value, input.resourceKey);
      },
    }),
  );

  router.get(
    '/concepts/:conceptKey/resources',
    handle({
      input: conceptKeyInput,
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const author = requireQuestionBankReader(actor);
        if (!author.ok) return author;
        return deps.itemBank.listResourcesForConcept(input.conceptKey);
      },
    }),
  );

  /** The book-wide shelf — resources attached to the textbook, not one lesson. */
  router.get(
    '/textbooks/:textbookKey/resources',
    handle({
      input: textbookKeyInput,
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const author = requireQuestionBankReader(actor);
        if (!author.ok) return author;
        return deps.itemBank.listResourcesForTextbook(input.textbookKey);
      },
    }),
  );

  // ── Flashcards ────────────────────────────────────────────────────────────
  //
  // Authoring only. The learner-facing deck lives at
  // `GET /learning/flashcards`, because ordering is a Learning decision and
  // the two must not be reachable through the same surface.

  router.post(
    '/flashcards',
    handle({
      input: createFlashcardInput,
      requireAuth: true,
      successStatus: 201,
      execute: async ({ input, actor }) => {
        const author = requireAuthor(actor);
        if (!author.ok) return author;
        return deps.itemBank.createFlashcard(author.value, {
          conceptKey: input.conceptKey,
          front: input.front,
          back: input.back,
          ...(input.reviewPriority !== undefined
            ? { reviewPriority: input.reviewPriority }
            : {}),
          ...(input.difficulty !== undefined ? { difficulty: input.difficulty } : {}),
        });
      },
    }),
  );

  router.patch(
    '/flashcards/:cardKey',
    handle({
      input: updateFlashcardInput,
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const author = requireAuthor(actor);
        if (!author.ok) return author;
        const { cardKey, ...patch } = input;
        return deps.itemBank.updateFlashcard(author.value, cardKey, patch);
      },
    }),
  );

  /** DELETE retires, like resources: a studied deck stays explicable. */
  router.delete(
    '/flashcards/:cardKey',
    handle({
      input: cardKeyInput,
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const author = requireAuthor(actor);
        if (!author.ok) return author;
        return deps.itemBank.retireFlashcard(author.value, input.cardKey);
      },
    }),
  );

  router.get(
    '/concepts/:conceptKey/flashcards',
    handle({
      input: conceptKeyInput,
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const author = requireAuthor(actor);
        if (!author.ok) return author;
        return deps.itemBank.listFlashcardsForConcept(input.conceptKey);
      },
    }),
  );

  return router;
}
