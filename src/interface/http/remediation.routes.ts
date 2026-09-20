/**
 * Remediation routes.
 *
 * Note what is absent: there is no endpoint to close, dismiss or override an
 * episode. That is the whole point of the capability — legacy exposed
 * `PATCH { masteryAchieved }` and turned "did remediation work?" into an
 * assertion. Here the only write is `refresh`, which re-derives everything from
 * evidence, so the worst a caller can do is ask the question again.
 *
 * Learner-scoped reads go through the canonical learner-access boundary, so a
 * guardian can see their child's gaps and a teacher their students', without
 * either being able to act as the learner.
 */

import { Router } from 'express';
import { z } from 'zod';
import { Errors } from '../../shared/kernel/errors.js';
import { Err, Ok, type Result } from '../../shared/kernel/result.js';
import { hasRole } from '../../contexts/identity/domain/roles.js';
import type { RemediationService } from '../../contexts/learning/application/remediation.service.js';
import type { AnalyticsReader } from '../../contexts/analytics/application/ports.js';
import type { GuardianLinkReader } from '../../contexts/identity/application/ports.js';
import { resolveLearnerKey } from './learner-access.js';
import type { Actor } from './middleware/context.js';
import { handle } from './handler.js';

export interface RemediationRouteDeps {
  readonly remediation: RemediationService;
  /** Resolves a cohort the same way analytics does — class is a query. */
  readonly analyticsReader: AnalyticsReader;
  readonly guardianLinks: GuardianLinkReader;
}

const STAFF_ROLES = ['SYSTEM_ADMIN', 'SCHOOL_ADMIN', 'TEACHER'] as const;

function requireStaff(actor: Actor | undefined, schoolId: string | null = null): Result<void> {
  if (!actor) {
    return Err(Errors.unauthenticated('auth.required', 'Authentication is required.'));
  }
  if (!hasRole(actor.roles, STAFF_ROLES, schoolId)) {
    return Err(
      Errors.forbidden('remediation.forbidden', 'You may not read this tracker.', {
        required: STAFF_ROLES,
      }),
    );
  }
  return Ok(undefined);
}

const learnerScopedInput = z.object({
  learnerKey: z.string().min(1).optional(),
  textbookKey: z.string().min(1).optional(),
});

const trackerInput = z.object({
  schoolId: z.string().min(1),
  gradeId: z.string().min(1).optional(),
  termId: z.string().min(1).optional(),
  staleAfterDays: z.coerce.number().int().positive().optional(),
});

export function remediationRoutes(deps: RemediationRouteDeps): Router {
  const router = Router();

  /** Open gaps, each with what to do about them. */
  router.get(
    '/episodes',
    handle({
      input: learnerScopedInput,
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const learner = await resolveLearnerKey(actor, input.learnerKey, deps.guardianLinks);
        if (!learner.ok) return learner;
        return deps.remediation.openEpisodes({ learnerKey: learner.value });
      },
    }),
  );

  /** Everything on record, including closed episodes and how long they took. */
  router.get(
    '/episodes/history',
    handle({
      input: learnerScopedInput,
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const learner = await resolveLearnerKey(actor, input.learnerKey, deps.guardianLinks);
        if (!learner.ok) return learner;
        return deps.remediation.history(learner.value);
      },
    }),
  );

  /**
   * Re-derive this learner's episodes from current evidence.
   *
   * A POST because it writes, but it is not a command in the usual sense:
   * there is no payload describing a desired outcome, and calling it twice
   * changes nothing. The caller asks the system to look again, and the
   * evidence decides.
   */
  router.post(
    '/refresh',
    handle({
      input: learnerScopedInput,
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const learner = await resolveLearnerKey(actor, input.learnerKey, deps.guardianLinks);
        if (!learner.ok) return learner;
        return deps.remediation.refresh({
          learnerKey: learner.value,
          textbookKey: input.textbookKey ?? null,
        });
      },
    }),
  );

  /**
   * The teacher's tracker — the legacy `remedial-tracker` screen, rebuilt.
   *
   * Legacy listed assignments flagged REMEDIAL. This lists gaps, whether or
   * not anyone has issued a task for them, which is the difference between
   * tracking work and tracking learning.
   */
  router.get(
    '/tracker',
    handle({
      input: trackerInput,
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const allowed = requireStaff(actor, input.schoolId);
        if (!allowed.ok) return allowed;

        const learnerKeys = await deps.analyticsReader.learnersInScope({
          schoolId: input.schoolId,
          gradeId: input.gradeId ?? null,
          termId: input.termId ?? null,
        });

        return deps.remediation.cohortTracker({
          learnerKeys,
          ...(input.staleAfterDays !== undefined ? { staleAfterDays: input.staleAfterDays } : {}),
        });
      },
    }),
  );

  return router;
}
