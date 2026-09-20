/**
 * Engagement routes — XP, streaks, levels, leaderboard.
 *
 * There is no endpoint that awards XP. Points are a consequence of a graded
 * answer, issued inside the submission path, and the only thing exposed here is
 * the reading of them. Legacy had `POST /intelligence/xp` taking `streakCount`
 * and `isCorrect` straight from the body, which let any caller mint points at
 * double rate.
 */

import { Router } from 'express';
import { z } from 'zod';
import { Errors } from '../../shared/kernel/errors.js';
import { Err, Ok, type Result } from '../../shared/kernel/result.js';
import { hasRole } from '../../contexts/identity/domain/roles.js';
import type { EngagementService } from '../../contexts/engagement/application/engagement.service.js';
import type { AnalyticsReader } from '../../contexts/analytics/application/ports.js';
import type { GuardianLinkReader } from '../../contexts/identity/application/ports.js';
import { resolveLearnerKey } from './learner-access.js';
import type { Actor } from './middleware/context.js';
import { handle } from './handler.js';

export interface EngagementRouteDeps {
  readonly engagement: EngagementService;
  readonly analyticsReader: AnalyticsReader;
  readonly guardianLinks: GuardianLinkReader;
}

const summaryInput = z.object({
  learnerKey: z.string().min(1).optional(),
});

const leaderboardInput = z.object({
  schoolId: z.string().min(1),
  gradeId: z.string().min(1).optional(),
  termId: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

const STAFF_ROLES = ['SYSTEM_ADMIN', 'SCHOOL_ADMIN', 'TEACHER'] as const;

function requireStaff(actor: Actor | undefined, schoolId: string): Result<void> {
  if (!actor) {
    return Err(Errors.unauthenticated('auth.required', 'Authentication is required.'));
  }
  if (!hasRole(actor.roles, STAFF_ROLES, schoolId)) {
    return Err(
      Errors.forbidden('engagement.forbidden', 'You may not read this leaderboard.', {
        required: STAFF_ROLES,
      }),
    );
  }
  return Ok(undefined);
}

export function engagementRoutes(deps: EngagementRouteDeps): Router {
  const router = Router();

  /** My XP: total, level, streak, and the last few awards. */
  router.get(
    '/xp',
    handle({
      input: summaryInput,
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const learner = await resolveLearnerKey(actor, input.learnerKey, deps.guardianLinks);
        if (!learner.ok) return learner;
        return deps.engagement.summaryFor(learner.value);
      },
    }),
  );

  /**
   * A leaderboard over one cohort.
   *
   * Staff-only and always scoped to a school. A global top-N would expose one
   * school's learners to another — a motivation feature turned into a data leak.
   */
  router.get(
    '/leaderboard',
    handle({
      input: leaderboardInput,
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const allowed = requireStaff(actor, input.schoolId);
        if (!allowed.ok) return allowed;

        const learnerKeys = await deps.analyticsReader.learnersInScope({
          schoolId: input.schoolId,
          gradeId: input.gradeId ?? null,
          termId: input.termId ?? null,
        });

        return deps.engagement.leaderboard({
          learnerKeys,
          ...(input.limit !== undefined ? { limit: input.limit } : {}),
        });
      },
    }),
  );

  return router;
}
