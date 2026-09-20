/**
 * Analytics routes.
 *
 * Two surfaces with different authorisation shapes:
 *
 *   cohort/bank reports  staff only, scoped to their school.
 *   learner report       learner-scoped, so it goes through the canonical
 *                        learner-access boundary like every other read of a
 *                        learner's data.
 *
 * The learner report is a READ in the strict sense of `learner-access.ts`:
 * delegable to staff and verified guardians, never producing evidence. A
 * parent may see how their child is doing; they may not answer for them.
 */

import { Router } from 'express';
import { z } from 'zod';
import { Errors } from '../../shared/kernel/errors.js';
import { Err, Ok, type Result } from '../../shared/kernel/result.js';
import { hasRole } from '../../contexts/identity/domain/roles.js';
import type { AnalyticsService } from '../../contexts/analytics/application/analytics.service.js';
import type { AnalyticsReader } from '../../contexts/analytics/application/ports.js';
import type { GuardianLinkReader } from '../../contexts/identity/application/ports.js';
import { resolveLearnerKey } from './learner-access.js';
import type { Actor } from './middleware/context.js';
import { handle } from './handler.js';

export interface AnalyticsRouteDeps {
  readonly analytics: AnalyticsService;
  /** Guardian access is verified per request, never inferred from a token. */
  readonly guardianLinks: GuardianLinkReader;
  /** Roster reads (G3) resolve the same cohort scope the reports use. */
  readonly analyticsReader: AnalyticsReader;
}

const STAFF_ROLES = ['SYSTEM_ADMIN', 'SCHOOL_ADMIN', 'TEACHER'] as const;

/** Item health is an authoring concern, so authors see it too. */
const BANK_ROLES = ['SYSTEM_ADMIN', 'SCHOOL_ADMIN', 'CONTENT_AUTHOR'] as const;

function requireRoles(
  actor: Actor | undefined,
  allowed: readonly string[],
  schoolId: string | null = null,
): Result<void> {
  if (!actor) {
    return Err(Errors.unauthenticated('auth.required', 'Authentication is required.'));
  }
  if (!hasRole(actor.roles, allowed as never, schoolId)) {
    return Err(
      Errors.forbidden('analytics.forbidden', 'You may not read these analytics.', {
        required: allowed,
      }),
    );
  }
  return Ok(undefined);
}

/** A roster is identity, not analysis — no textbook or concept filtering. */
const rosterInput = z.object({
  schoolId: z.string().min(1),
  gradeId: z.string().min(1).optional(),
  termId: z.string().min(1).optional(),
});

const cohortInput = z.object({
  schoolId: z.string().min(1),
  gradeId: z.string().min(1).optional(),
  termId: z.string().min(1).optional(),
  textbookKey: z.string().min(1).optional(),
  conceptKeys: z
    .union([z.string(), z.array(z.string())])
    .transform((v) => (typeof v === 'string' ? v.split(',').filter(Boolean) : v))
    .optional(),
  since: z.coerce.date().optional(),
});

const learnerInput = z.object({
  learnerKey: z.string().min(1).optional(),
  textbookKey: z.string().min(1).optional(),
  conceptKeys: z
    .union([z.string(), z.array(z.string())])
    .transform((v) => (typeof v === 'string' ? v.split(',').filter(Boolean) : v))
    .optional(),
});

const questionKeyInput = z.object({ questionKey: z.string().min(1) });
const textbookKeyInput = z.object({ textbookKey: z.string().min(1) });

const examResultsInput = z.object({
  examKey: z.string().min(1),
  schoolId: z.string().min(1),
  gradeId: z.string().min(1).optional(),
  termId: z.string().min(1).optional(),
});

export function analyticsRoutes(deps: AnalyticsRouteDeps): Router {
  const router = Router();

  /**
   * Who am I teaching? (gap G3)
   *
   * Edu7 has no class or section model by decision — a class is a query over
   * current enrollments. So a roster is a scope, and this endpoint names it.
   *
   * `requireRoles(..., input.schoolId)` is the whole authorization: roles are
   * school-scoped (`UserRole.schoolId`), so a TEACHER at school A asking for
   * school B's roster is refused by the same gate the cohort report uses. The
   * school is a parameter rather than inferred, because staff legitimately
   * hold roles at more than one school and the server verifies the claim
   * either way.
   *
   * KNOWN LIMIT, stated rather than hidden: this is school-and-grade scoped,
   * not teacher-and-subject scoped. Every teacher at a school sees the same
   * grade roster. Narrowing it needs a teaching-assignment model that does not
   * exist yet; inventing one here would put a schema decision in a route.
   */
  router.get(
    '/roster',
    handle({
      input: rosterInput,
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const allowed = requireRoles(actor, STAFF_ROLES, input.schoolId);
        if (!allowed.ok) return allowed;

        const learners = await deps.analyticsReader.rosterInScope({
          schoolId: input.schoolId,
          gradeId: input.gradeId ?? null,
          termId: input.termId ?? null,
        });
        return Ok({ learners });
      },
    }),
  );

  /** How is this class doing? Scoped to a school the actor works in. */
  router.get(
    '/cohort',
    handle({
      input: cohortInput,
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const allowed = requireRoles(actor, STAFF_ROLES, input.schoolId);
        if (!allowed.ok) return allowed;

        return deps.analytics.cohortReport({
          scope: {
            schoolId: input.schoolId,
            gradeId: input.gradeId ?? null,
            termId: input.termId ?? null,
          },
          textbookKey: input.textbookKey ?? null,
          ...(input.conceptKeys?.length ? { conceptKeys: input.conceptKeys } : {}),
          since: input.since ?? null,
        });
      },
    }),
  );

  /**
   * How did this class do on one exam?
   *
   * Staff only, scoped to the school: this is a cohort read, and the same
   * `requireRoles` gate the cohort report uses. Deliberately NOT available to
   * guardians — a parent sees their own child, not the class distribution.
   */
  router.get(
    '/exams/:examKey/results',
    handle({
      input: examResultsInput,
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const allowed = requireRoles(actor, STAFF_ROLES, input.schoolId);
        if (!allowed.ok) return allowed;

        return deps.analytics.examResults({
          examKey: input.examKey,
          scope: {
            schoolId: input.schoolId,
            gradeId: input.gradeId ?? null,
            termId: input.termId ?? null,
          },
        });
      },
    }),
  );

  /** One learner's standing. A READ, so guardians and staff may delegate. */
  router.get(
    '/learner',
    handle({
      input: learnerInput,
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const learner = await resolveLearnerKey(actor, input.learnerKey, deps.guardianLinks);
        if (!learner.ok) return learner;

        return deps.analytics.learnerReport({
          learnerKey: learner.value,
          textbookKey: input.textbookKey ?? null,
          ...(input.conceptKeys?.length ? { conceptKeys: input.conceptKeys } : {}),
        });
      },
    }),
  );

  /**
   * How is this question behaving?
   *
   * The report that can catch a wrong answer key — the one failure authoring
   * validation cannot see, because a miskeyed item grades perfectly well.
   */
  router.get(
    '/items/:questionKey',
    handle({
      input: questionKeyInput,
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const allowed = requireRoles(actor, BANK_ROLES);
        if (!allowed.ok) return allowed;
        return deps.analytics.itemHealth(input.questionKey);
      },
    }),
  );

  /** Sweep a book's bank; returns only the items that need attention. */
  router.get(
    '/textbooks/:textbookKey/item-health',
    handle({
      input: textbookKeyInput,
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const allowed = requireRoles(actor, BANK_ROLES);
        if (!allowed.ok) return allowed;
        return deps.analytics.bankHealth(input.textbookKey);
      },
    }),
  );

  /**
   * Recompute a question's cached counters.
   *
   * Idempotent by construction: the numbers are recomputed from the responses
   * rather than incremented, so running it twice changes nothing.
   */
  router.post(
    '/items/:questionKey/refresh',
    handle({
      input: questionKeyInput,
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const allowed = requireRoles(actor, BANK_ROLES);
        if (!allowed.ok) return allowed;
        const result = await deps.analytics.refreshQuestionStatistics(input.questionKey);
        return result.ok ? Ok({ questionKey: input.questionKey, refreshed: true }) : result;
      },
    }),
  );

  return router;
}
