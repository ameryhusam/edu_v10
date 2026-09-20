/**
 * Assessment routes.
 *
 * Learner-facing endpoints that produce evidence or spend learner resources
 * resolve the subject with `requireSelfLearner`: these actions are never
 * delegable, not even to staff. Staff-only manual review endpoints are the
 * explicit exception; they turn pending essays into graded evidence.
 */

import { Router } from 'express';
import { z } from 'zod';
import { requireSelfLearner, resolveLearnerKey } from './learner-access.js';
import type { AttemptHistoryReader, LearnerExamCatalog } from '../../contexts/assessment/application/ports.js';
import type { GuardianLinkReader } from '../../contexts/identity/application/ports.js';
import type { SubmitAnswerUseCase } from '../../contexts/assessment/application/submit-answer.use-case.js';
import type { RunAdaptiveExamUseCase } from '../../contexts/assessment/application/run-adaptive-exam.use-case.js';
import type { StartAttemptUseCase } from '../../contexts/assessment/application/start-attempt.use-case.js';
import type { SubmitAttemptUseCase } from '../../contexts/assessment/application/submit-attempt.use-case.js';
import type { ListManualReviewsUseCase } from '../../contexts/assessment/application/list-manual-reviews.use-case.js';
import type { GradeManualAnswerUseCase } from '../../contexts/assessment/application/grade-manual-answer.use-case.js';
import { Errors } from '../../shared/kernel/errors.js';
import { Err, Ok, type Result } from '../../shared/kernel/result.js';
import type { Actor } from './middleware/context.js';
import { handle } from './handler.js';

export interface AssessmentRouteDeps {
  readonly submitAnswer: SubmitAnswerUseCase;
  readonly runAdaptiveExam: RunAdaptiveExamUseCase;
  readonly startAttempt: StartAttemptUseCase;
  readonly submitAttempt: SubmitAttemptUseCase;
  /** History is a READ, so it is delegable — hence the guardian reader. */
  readonly attemptHistory: AttemptHistoryReader;
  /** The learner's published exams, with their concept scopes. */
  readonly examCatalog: LearnerExamCatalog;
  readonly manualReviews: ListManualReviewsUseCase;
  readonly gradeManualAnswer: GradeManualAnswerUseCase;
  readonly guardianLinks: GuardianLinkReader;
}

/**
 * History query (gap G4).
 *
 * `limit` is clamped server-side at 50. A client-supplied page size with no
 * ceiling is how a list endpoint becomes a denial-of-service vector.
 */
const historyInput = z.object({
  learnerKey: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(50).default(20),
  kind: z.enum(['PRACTICE', 'LESSON_CHECK', 'EXAM', 'REVIEW', 'DIAGNOSTIC']).optional(),
});

const submitInput = z.object({
  attemptKey: z.string().min(1),
  questionKey: z.string().min(1),
  answer: z.object({
    choiceIds: z.array(z.string()).optional(),
    text: z.string().nullable().optional(),
    numeric: z.number().nullable().optional(),
    order: z.array(z.string()).optional(),
    pairs: z.record(z.string(), z.string()).optional(),
  }),
  timeSpentSeconds: z.number().int().nonnegative().optional(),
});

const startAttemptInput = z.object({
  kind: z.enum(['PRACTICE', 'LESSON_CHECK', 'EXAM', 'REVIEW', 'DIAGNOSTIC']),
  lessonKey: z.string().min(1).nullish(),
  examKey: z.string().min(1).nullish(),
  resumeExisting: z.boolean().optional(),
});

const attemptKeyInput = z.object({ attemptKey: z.string().min(1) });

const nextItemInput = z.object({
  attemptKey: z.string().min(1),
  conceptKeys: z
    .union([z.string(), z.array(z.string())])
    .transform((v) => (typeof v === 'string' ? v.split(',').filter(Boolean) : v)),
});

const manualReviewListInput = z.object({
  learnerKey: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(100).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

const manualGradeInput = z.object({
  attemptKey: z.string().min(1),
  questionKey: z.string().min(1),
  scoreEarned: z.coerce.number().nonnegative(),
  feedback: z.string().trim().max(2000).nullish(),
});

const MANUAL_GRADING_ROLES = ['SYSTEM_ADMIN', 'SCHOOL_ADMIN', 'TEACHER'] as const;

interface ManualReviewScope {
  readonly reviewerUserId: string;
  readonly schoolIds?: readonly string[] | undefined;
}

function requireManualReviewScope(actor: Actor | undefined): Result<ManualReviewScope> {
  if (!actor) return Err(Errors.unauthenticated('auth.required', 'Authentication is required.'));
  const grants = actor.roles.filter((grant) => MANUAL_GRADING_ROLES.includes(grant.role as never));
  if (grants.length === 0) {
    return Err(
      Errors.forbidden('assessment.manual_review_forbidden', 'You may not grade learner answers.'),
    );
  }
  if (grants.some((grant) => grant.role === 'SYSTEM_ADMIN' || grant.schoolId === null)) {
    return Ok({ reviewerUserId: actor.userId });
  }
  const schoolIds = [...new Set(grants.map((grant) => grant.schoolId).filter(Boolean))] as string[];
  return Ok({ reviewerUserId: actor.userId, schoolIds });
}

export function assessmentRoutes(deps: AssessmentRouteDeps): Router {
  const router = Router();

  /**
   * My exams: the published exams of the textbooks I am entitled to.
   *
   * Self only, even though it is a read: the list is the launch pad for the
   * self-only attempt endpoints below, and a guardian browsing a child's
   * exam list here could not act on it anyway.
   */
  router.get(
    '/exams',
    handle({
      input: z.object({}),
      requireAuth: true,
      execute: async ({ actor }) => {
        const learner = await requireSelfLearner(actor);
        if (!learner.ok) return learner;
        const exams = await deps.examCatalog.examsFor(learner.value);
        return Ok({ exams });
      },
    }),
  );

  router.post(
    '/answers',
    handle({
      input: submitInput,
      requireAuth: true,
      successStatus: 201,
      execute: async ({ input, actor }) => {
        const learner = await requireSelfLearner(actor);
        if (!learner.ok) return learner;
        return deps.submitAnswer.execute({
          attemptKey: input.attemptKey,
          learnerKey: learner.value,
          questionKey: input.questionKey,
          answer: input.answer,
          ...(input.timeSpentSeconds != null ? { timeSpentSeconds: input.timeSpentSeconds } : {}),
        });
      },
    }),
  );

  /**
   * Open (or resume) an attempt. Resuming is the default, so a dropped
   * connection returns the learner to the same attempt instead of forking
   * their evidence across two records.
   */
  router.post(
    '/attempts',
    handle({
      input: startAttemptInput,
      requireAuth: true,
      successStatus: 201,
      execute: async ({ input, actor }) => {
        const learner = await requireSelfLearner(actor);
        if (!learner.ok) return learner;
        return deps.startAttempt.execute({
          learnerKey: learner.value,
          kind: input.kind,
          lessonKey: input.lessonKey ?? null,
          examKey: input.examKey ?? null,
          ...(input.resumeExisting != null ? { resumeExisting: input.resumeExisting } : {}),
        });
      },
    }),
  );

  /** Close an attempt. Totals are derived server-side from stored answers. */
  router.post(
    '/attempts/:attemptKey/submit',
    handle({
      input: attemptKeyInput,
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const learner = await requireSelfLearner(actor);
        if (!learner.ok) return learner;
        return deps.submitAttempt.execute({
          attemptKey: input.attemptKey,
          learnerKey: learner.value,
        });
      },
    }),
  );

  /**
   * My assessment history (gap G4).
   *
   * A READ, so `resolveLearnerKey` applies the same delegation rule the rest
   * of the product uses: a learner sees their own, a verified guardian sees
   * their child's, staff see a learner in their school. Acting is never
   * delegable, and nothing here can start or change an attempt.
   */
  router.get(
    '/attempts',
    handle({
      input: historyInput,
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const learner = await resolveLearnerKey(actor, input.learnerKey, deps.guardianLinks);
        if (!learner.ok) return learner;

        const attempts = await deps.attemptHistory.listForLearner(learner.value, {
          limit: input.limit,
          ...(input.kind ? { kind: input.kind } : {}),
        });
        return Ok({ attempts });
      },
    }),
  );

  /** Staff queue for essay answers that are waiting on a human mark. */
  router.get(
    '/manual-reviews',
    handle({
      input: manualReviewListInput,
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const scope = requireManualReviewScope(actor);
        if (!scope.ok) return scope;
        const page = await deps.manualReviews.execute({
          limit: input.limit,
          offset: input.offset,
          ...(scope.value.schoolIds ? { schoolIds: scope.value.schoolIds } : {}),
          ...(input.learnerKey ? { learnerKey: input.learnerKey } : {}),
        });
        return Ok(page);
      },
    }),
  );

  /** Human score for one pending review item; this is the only essay mastery path. */
  router.post(
    '/manual-reviews/:attemptKey/:questionKey/grade',
    handle({
      input: manualGradeInput,
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const scope = requireManualReviewScope(actor);
        if (!scope.ok) return scope;
        return deps.gradeManualAnswer.execute({
          attemptKey: input.attemptKey,
          questionKey: input.questionKey,
          reviewerUserId: scope.value.reviewerUserId,
          ...(scope.value.schoolIds ? { allowedSchoolIds: scope.value.schoolIds } : {}),
          scoreEarned: input.scoreEarned,
          feedback: input.feedback ?? null,
        });
      },
    }),
  );

  /** Next adaptive item. Stateless: recomputed from stored responses. */
  router.get(
    '/attempts/:attemptKey/next-item',
    handle({
      input: nextItemInput,
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const learner = await requireSelfLearner(actor);
        if (!learner.ok) return learner;
        return deps.runAdaptiveExam.execute({
          attemptKey: input.attemptKey,
          learnerKey: learner.value,
          conceptKeys: input.conceptKeys,
        });
      },
    }),
  );

  return router;
}
