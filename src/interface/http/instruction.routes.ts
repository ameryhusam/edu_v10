/**
 * Instruction routes — assigning work, and seeing whether it was done.
 *
 * Two audiences share this file because they share one model: teachers author
 * and monitor plans, learners read their own obligations. They are separated
 * by which authorisation helper each route calls, not by which context they
 * live in.
 *
 * The endpoint that legacy had and this does not: there is no
 * `PATCH /assignments/:key { masteryAchieved }`. A learner's obligation status
 * is derived from evidence on read, so there is nothing here to PATCH.
 */

import { Router } from 'express';
import { z } from 'zod';
import { Errors } from '../../shared/kernel/errors.js';
import { Err, Ok, type Result } from '../../shared/kernel/result.js';
import { hasRole } from '../../contexts/identity/domain/roles.js';
import {
  INSTRUCTIONAL_ACTIVITY_TYPES,
  PLAN_ACTIONS,
} from '../../contexts/instruction/domain/plan.js';
import type {
  AssignmentService,
  InstructorContext,
} from '../../contexts/instruction/application/assignment.service.js';
import type { DueWorkService } from '../../contexts/instruction/application/due-work.service.js';
import type {
  GuardianContext,
  ParentTaskService,
} from '../../contexts/instruction/application/parent-task.service.js';
import type { GuardianLinkReader } from '../../contexts/identity/application/ports.js';
import { resolveLearnerKey } from './learner-access.js';
import type { Actor } from './middleware/context.js';
import { handle } from './handler.js';

export interface InstructionRouteDeps {
  readonly assignments: AssignmentService;
  readonly dueWork: DueWorkService;
  readonly parentTasks: ParentTaskService;
  /** Guardian access is verified per request, never inferred from a token. */
  readonly guardianLinks: GuardianLinkReader;
}

/**
 * Who may assign work.
 *
 * TEACHER is the point of this capability. PARENT is absent for now: the gate
 * left "may a parent-authored obligation gate anything" open, and issuing a
 * parent surface before that is answered would be deciding it by accident.
 */
const INSTRUCTOR_ROLES = ['SYSTEM_ADMIN', 'SCHOOL_ADMIN', 'TEACHER'] as const;

/**
 * Build the actor's instructing scope from their role grants.
 *
 * A teacher's reach is exactly the schools they hold a grant in — the service
 * refuses anything else. `schoolId: null` on a non-admin grant means a
 * single-school deployment, which is treated as platform-wide because there is
 * nothing to cross into.
 */
function requireInstructor(actor: Actor | undefined): Result<InstructorContext> {
  if (!actor) {
    return Err(Errors.unauthenticated('auth.required', 'Authentication is required.'));
  }
  if (!hasRole(actor.roles, INSTRUCTOR_ROLES)) {
    return Err(
      Errors.forbidden('instruction.assigning_forbidden', 'You may not assign work.', {
        required: INSTRUCTOR_ROLES,
      }),
    );
  }

  const relevant = actor.roles.filter((g) => INSTRUCTOR_ROLES.includes(g.role as never));
  const isPlatformAdmin = relevant.some(
    (g) => g.role === 'SYSTEM_ADMIN' || g.schoolId === null,
  );

  return Ok({
    actorKey: actor.userKey,
    schoolIds: relevant.flatMap((g) => (g.schoolId ? [g.schoolId] : [])),
    isPlatformAdmin,
  });
}

/**
 * Build a guardian context.
 *
 * Note it carries no roles and no school scope — guardianship is proven per
 * request against the verified-link table inside the service, not asserted by
 * a role grant here. A PARENT role claim in a token grants nothing on its own.
 */
function requireGuardian(actor: Actor | undefined): Result<GuardianContext> {
  if (!actor) {
    return Err(Errors.unauthenticated('auth.required', 'Authentication is required.'));
  }
  return Ok({ userId: actor.userId, userKey: actor.userKey });
}

const scopeInput = z.object({
  schoolId: z.string().min(1),
  gradeId: z.string().min(1).nullish(),
  termId: z.string().min(1).nullish(),
});

const createPlanInput = z.object({
  title: z.string().min(1).max(200),
  instructions: z.string().max(4000).nullish(),
  activityType: z.enum(INSTRUCTIONAL_ACTIVITY_TYPES),
  activityKey: z.string().min(1),
  scope: scopeInput,
  targetLearnerKey: z.string().min(1).nullish(),
  availableAt: z.coerce.date().nullish(),
  dueAt: z.coerce.date().nullish(),
});

/**
 * The editable surface of a draft, spelled out.
 *
 * `activityKey`, `scope` and `origin` are absent on purpose: changing what was
 * assigned, or to whom, is a different assignment. Letting it be edited in
 * place would silently rewrite history for learners who already saw it.
 */
const updatePlanInput = z.object({
  title: z.string().min(1).max(200).optional(),
  instructions: z.string().max(4000).nullish(),
  availableAt: z.coerce.date().nullish(),
  dueAt: z.coerce.date().nullish(),
});

const planKeyInput = z.object({ planKey: z.string().min(1) });

const transitionInput = z.object({
  planKey: z.string().min(1),
  action: z.enum(PLAN_ACTIONS),
});

const waiveInput = z.object({
  obligationKey: z.string().min(1),
  reason: z.string().min(1).max(500),
});

const myObligationsInput = z.object({ learnerKey: z.string().min(1).optional() });

const parentTaskInput = z.object({
  learnerKey: z.string().min(1),
  title: z.string().min(1).max(200),
  instructions: z.string().max(4000).nullish(),
  activityType: z.enum(INSTRUCTIONAL_ACTIVITY_TYPES),
  activityKey: z.string().min(1),
  availableAt: z.coerce.date().nullish(),
  dueAt: z.coerce.date().nullish(),
});

const overdueAlertsInput = z.object({
  learnerKeys: z.array(z.string().min(1)).min(1).max(500),
  threshold: z.number().int().min(1).max(100).optional(),
});

export function instructionRoutes(deps: InstructionRouteDeps): Router {
  const router = Router();

  // ── Teacher surface ───────────────────────────────────────────────────────

  router.post(
    '/plans',
    handle({
      input: createPlanInput,
      requireAuth: true,
      successStatus: 201,
      execute: async ({ input, actor }) => {
        const ctx = requireInstructor(actor);
        if (!ctx.ok) return ctx;

        return deps.assignments.createPlan(ctx.value, {
          title: input.title,
          instructions: input.instructions ?? null,
          activityType: input.activityType,
          activityKey: input.activityKey,
          scope: {
            schoolId: input.scope.schoolId,
            gradeId: input.scope.gradeId ?? null,
            termId: input.scope.termId ?? null,
          },
          targetLearnerKey: input.targetLearnerKey ?? null,
          availableAt: input.availableAt ?? null,
          dueAt: input.dueAt ?? null,
        });
      },
    }),
  );

  router.patch(
    '/plans/:planKey',
    handle({
      input: updatePlanInput.and(planKeyInput),
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const ctx = requireInstructor(actor);
        if (!ctx.ok) return ctx;

        const { planKey, ...patch } = input;
        return deps.assignments.updatePlan(ctx.value, planKey, patch);
      },
    }),
  );

  /** PUBLISH or CANCEL. The transition names the intent; the domain decides. */
  router.post(
    '/plans/:planKey/transitions',
    handle({
      input: transitionInput,
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const ctx = requireInstructor(actor);
        if (!ctx.ok) return ctx;
        return deps.assignments.transition(ctx.value, input.planKey, input.action);
      },
    }),
  );

  /** Catch up a published plan with learners who enrolled after it went out. */
  router.post(
    '/plans/:planKey/materialise',
    handle({
      input: planKeyInput,
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const ctx = requireInstructor(actor);
        if (!ctx.ok) return ctx;
        return deps.assignments.materialise(ctx.value, input.planKey);
      },
    }),
  );

  /** Cohort progress. Statuses are recomputed from evidence as they are read. */
  router.get(
    '/plans/:planKey/progress',
    handle({
      input: planKeyInput,
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const ctx = requireInstructor(actor);
        if (!ctx.ok) return ctx;
        return deps.assignments.planProgress(ctx.value, input.planKey);
      },
    }),
  );

  /**
   * Excuse a learner.
   *
   * The only endpoint in the system that asserts an obligation status, which
   * is why it demands a reason and writes an audit entry.
   */
  router.post(
    '/obligations/:obligationKey/waiver',
    handle({
      input: waiveInput,
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const ctx = requireInstructor(actor);
        if (!ctx.ok) return ctx;
        return deps.assignments.waive(ctx.value, input.obligationKey, input.reason);
      },
    }),
  );

  /**
   * Undo a waiver. Same authority as granting one, and the same audit
   * requirement: a human override must explain itself in both directions.
   */
  router.post(
    '/obligations/:obligationKey/reopen',
    handle({
      input: waiveInput,
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const ctx = requireInstructor(actor);
        if (!ctx.ok) return ctx;
        return deps.assignments.reopen(ctx.value, input.obligationKey, input.reason);
      },
    }),
  );

  // ── Learner surface ───────────────────────────────────────────────────────

  /**
   * What have I been asked to do?
   *
   * A READ, so it goes through the canonical boundary: a learner sees their
   * own, staff and verified guardians may name someone else, and nobody reads
   * `actor.learnerKey` here.
   */
  router.get(
    '/obligations',
    handle({
      input: myObligationsInput,
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const learner = await resolveLearnerKey(actor, input.learnerKey, deps.guardianLinks);
        if (!learner.ok) return learner;
        return deps.assignments.listForLearner(learner.value);
      },
    }),
  );

  /**
   * Due Work — what is owed and what is late.
   *
   * Deliberately NOT part of `GET /learning/next-step`. Next-step answers "what
   * should I learn next?" from mastery alone; this answers "what do I owe?".
   * Merging them would let lateness leak into a pedagogical recommendation,
   * which the owner ruled out explicitly.
   *
   * The response keeps academic and advisory work in separate arrays so a
   * client cannot total a mixed list by accident.
   */
  router.get(
    '/due-work',
    handle({
      input: myObligationsInput,
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const learner = await resolveLearnerKey(actor, input.learnerKey, deps.guardianLinks);
        if (!learner.ok) return learner;
        return deps.dueWork.forLearner(learner.value);
      },
    }),
  );

  /**
   * Staff alert: who has accumulated overdue academic work.
   *
   * Instructor-only, because it reports on other people's children. The
   * threshold is a caller parameter rather than a hidden constant so a school
   * can tune it without a deploy — but note what the response does NOT contain:
   * any statement about what the learner knows. Overdue work means a human
   * should look, not that mastery has dropped.
   */
  router.post(
    '/due-work/alerts',
    handle({
      input: overdueAlertsInput,
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const instructor = requireInstructor(actor);
        if (!instructor.ok) return instructor;
        return deps.dueWork.overdueAlerts({
          learnerKeys: input.learnerKeys,
          threshold: input.threshold,
        });
      },
    }),
  );

  // ── Parent surface (advisory only) ────────────────────────────────────────

  /**
   * A parent sets a task for their own child.
   *
   * There is no `origin` field in the input schema. A parent cannot request
   * TEACHER origin because there is no parameter through which to ask — the
   * service hard-codes PARENT. That is the enforcement point the owner asked
   * for: it holds regardless of what any client sends.
   */
  router.post(
    '/parent-tasks',
    handle({
      input: parentTaskInput,
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const guardian = requireGuardian(actor);
        if (!guardian.ok) return guardian;
        return deps.parentTasks.create(guardian.value, input);
      },
    }),
  );

  /** Cancel a task this parent set. Never deletes: the child may have seen it. */
  router.post(
    '/parent-tasks/cancel',
    handle({
      input: planKeyInput,
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const guardian = requireGuardian(actor);
        if (!guardian.ok) return guardian;
        return deps.parentTasks.cancel(guardian.value, input.planKey);
      },
    }),
  );

  /** The parent's view of one child's tasks, academic and advisory labelled. */
  router.get(
    '/parent-tasks',
    handle({
      input: z.object({ learnerKey: z.string().min(1) }),
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const guardian = requireGuardian(actor);
        if (!guardian.ok) return guardian;
        return deps.parentTasks.childTasks(guardian.value, input.learnerKey);
      },
    }),
  );

  return router;
}
