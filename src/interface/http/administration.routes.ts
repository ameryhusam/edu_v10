/**
 * Administration routes — the platform overview.
 *
 * One read-only endpoint. The dashboard needs a single answer to "what is in
 * this installation", and assembling that in the browser from six list calls
 * would mean the definition of the summary lives in the client, where nothing
 * can test it and every consumer reinvents it.
 *
 * There are deliberately no write routes here. Administrators create and edit
 * through `/provisioning` (people) and `/catalogue` (structure), each of which
 * enforces its own invariants. A generic "update any table" endpoint would be
 * a documented way around those rules, and the first thing it would break is
 * the one it cannot see — a role grant written without the checks that make
 * role grants safe.
 */

import { Router } from 'express';
import { z } from 'zod';

import { Errors } from '../../shared/kernel/errors.js';
import { Err, type Result } from '../../shared/kernel/result.js';
import { hasRole } from '../../contexts/identity/domain/roles.js';
import type { AdministrationService } from '../../contexts/administration/application/administration.service.js';
import type { Actor } from './middleware/context.js';
import { handle } from './handler.js';

export interface AdministrationRouteDeps {
  readonly administration: AdministrationService;
}

/**
 * Both administrator roles may read the overview.
 *
 * Unlike catalogue writes, reading how many users and textbooks exist does not
 * cross a school boundary in a way that matters: the counts are platform-wide
 * facts a SCHOOL_ADMIN already sees pieces of through their own screens. The
 * split that matters is on writes, and those live elsewhere.
 */
const ADMIN_ROLES = ['SYSTEM_ADMIN', 'SCHOOL_ADMIN'] as const;

function requireAdmin(actor: Actor | undefined): Result<Actor> {
  if (!actor) {
    return Err(Errors.unauthenticated('auth.required', 'Authentication is required.'));
  }
  if (!hasRole(actor.roles, ADMIN_ROLES)) {
    return Err(
      Errors.forbidden(
        'administration.forbidden',
        'Only an administrator may view the platform overview.',
        { required: ADMIN_ROLES },
      ),
    );
  }
  return { ok: true, value: actor };
}

const noInput = z.object({});

export function administrationRoutes(deps: AdministrationRouteDeps): Router {
  const router = Router();

  router.get(
    '/overview',
    handle({
      input: noInput,
      requireAuth: true,
      execute: async ({ actor }) => {
        const admin = requireAdmin(actor);
        if (!admin.ok) return admin;
        return deps.administration.overview();
      },
    }),
  );

  /**
   * The audit trail, newest first. Every entry was written by a canonical
   * service (provisioning, authoring); this is a read of the record, not a
   * new kind of activity. Bounded and indexed — see the repository.
   */
  router.get(
    '/activity',
    handle({
      input: z.object({ limit: z.coerce.number().int().positive().max(50).optional() }),
      requireAuth: true,
      execute: async ({ actor, input }) => {
        const admin = requireAdmin(actor);
        if (!admin.ok) return admin;
        return deps.administration.activity(input.limit);
      },
    }),
  );

  return router;
}
