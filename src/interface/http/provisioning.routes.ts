/**
 * Provisioning routes — the admin surface for people.
 *
 * These are the endpoints that make an admin UI possible. Until now the only
 * way to create a user, grant a role, enrol a learner or link a parent was to
 * edit `seed.ts` and re-seed, which meant the seed was load-bearing production
 * infrastructure and no frontend could complete an onboarding workflow.
 *
 * Authorization is decided here, in one place, and nothing else: this router
 * carries intent to the application layer and renders the answer. It holds no
 * rule about what a coherent user is.
 */

import { Router } from 'express';
import { z } from 'zod';

import { Errors } from '../../shared/kernel/errors.js';
import { Err, type Result } from '../../shared/kernel/result.js';
import { hasRole } from '../../contexts/identity/domain/roles.js';
import { USER_STATUSES } from '../../contexts/identity/domain/provisioning.js';
import type { ProvisioningService } from '../../contexts/identity/application/provisioning.service.js';
import type { Actor } from './middleware/context.js';
import { handle } from './handler.js';

export interface ProvisioningRouteDeps {
  readonly provisioning: ProvisioningService;
}

/**
 * Who may provision people.
 *
 * Administrators only. TEACHER is deliberately absent: teaching a cohort is not
 * the authority to create accounts, grant roles or decide who may see a child's
 * record. CONTENT_AUTHOR is absent for the same reason — authoring books says
 * nothing about managing people.
 */
const ADMIN_ROLES = ['SYSTEM_ADMIN', 'SCHOOL_ADMIN'] as const;

function requireAdmin(actor: Actor | undefined): Result<{ actorId: string; actorKey: string }> {
  if (!actor) {
    return Err(Errors.unauthenticated('auth.required', 'Authentication is required.'));
  }
  if (!hasRole(actor.roles, ADMIN_ROLES)) {
    return Err(
      Errors.forbidden('identity.provisioning_forbidden', 'You may not manage users.', {
        required: ADMIN_ROLES,
      }),
    );
  }
  return { ok: true, value: { actorId: actor.userId, actorKey: actor.userKey } };
}

/**
 * No `key` field anywhere in these schemas.
 *
 * Keys for a user, learner profile, guardian profile and enrolment are all
 * derived by the domain. A caller describes a person; it does not name one.
 */
const provisionUserInput = z.object({
  username: z.string().min(1).max(60),
  fullName: z.string().min(1).max(200),
  password: z.string().min(1).max(200),
  email: z.string().max(200).nullish(),
  phone: z.string().max(40).nullish(),
  roles: z.array(z.string().min(1)).min(1),
  schoolKey: z.string().min(1).nullish(),
});

const updateUserInput = z.object({
  userKey: z.string().min(1),
  fullName: z.string().max(200).optional(),
  email: z.string().max(200).nullish(),
  phone: z.string().max(40).nullish(),
});

const statusInput = z.object({
  userKey: z.string().min(1),
  status: z.enum(USER_STATUSES),
});

const roleInput = z.object({
  userKey: z.string().min(1),
  role: z.string().min(1),
  schoolKey: z.string().min(1).nullish(),
});

const enrolInput = z.object({
  learnerKey: z.string().min(1),
  schoolKey: z.string().min(1),
  academicYearKey: z.string().min(1),
  termKey: z.string().min(1),
  gradeKey: z.string().min(1),
  isCurrent: z.boolean().optional(),
});

const enrollmentKeyInput = z.object({ enrollmentKey: z.string().min(1) });

const guardianLinkInput = z.object({
  guardianKey: z.string().min(1),
  learnerKey: z.string().min(1),
  relation: z.string().max(40).nullish(),
});

/**
 * Directory query. `limit` is capped at the schema *and* clamped again in the
 * service — the route protects the wire, the service protects every caller.
 */
const directoryInput = z.object({
  search: z.string().trim().min(1).max(80).optional(),
  role: z
    .enum(['SYSTEM_ADMIN', 'SCHOOL_ADMIN', 'TEACHER', 'STUDENT', 'PARENT', 'CONTENT_AUTHOR'])
    .optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'INVITED', 'ARCHIVED']).optional(),
  schoolKey: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

/**
 * The enrolment browser. Every filter is a business key, matching every other
 * read on this router — the admin UI never learns a uuid.
 */
const enrollmentBrowserInput = z.object({
  schoolKey: z.string().min(1).optional(),
  academicYearKey: z.string().min(1).optional(),
  termKey: z.string().min(1).optional(),
  gradeKey: z.string().min(1).optional(),
  learnerKey: z.string().min(1).optional(),
  current: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const educatorDirectoryInput = z.object({
  search: z.string().trim().min(1).max(80).optional(),
  schoolKey: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const guardianVerifyInput = z.object({
  guardianKey: z.string().min(1),
  learnerKey: z.string().min(1),
  isVerified: z.boolean(),
});

export function provisioningRoutes(deps: ProvisioningRouteDeps): Router {
  const router = Router();

  // ── Users ────────────────────────────────────────────────────────────────

  router.post(
    '/users',
    handle({
      input: provisionUserInput,
      requireAuth: true,
      successStatus: 201,
      execute: async ({ input, actor }) => {
        const admin = requireAdmin(actor);
        if (!admin.ok) return admin;
        return deps.provisioning.provisionUser(admin.value, {
          username: input.username,
          fullName: input.fullName,
          password: input.password,
          email: input.email ?? null,
          phone: input.phone ?? null,
          roles: input.roles,
          schoolKey: input.schoolKey ?? null,
        });
      },
    }),
  );

  /**
   * The user directory (gap G6).
   *
   * Registered before `/users/:userKey` because Express matches in order and
   * a bare `/users` would otherwise never be reached — `:userKey` does not
   * match an empty segment, but keeping the specific route first makes the
   * intent explicit rather than accidental.
   */
  router.get(
    '/users',
    handle({
      input: directoryInput,
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const admin = requireAdmin(actor);
        if (!admin.ok) return admin;
        return deps.provisioning.listUsers(input);
      },
    }),
  );

  router.get(
    '/users/:userKey',
    handle({
      input: z.object({}),
      requireAuth: true,
      execute: async ({ req, actor }) => {
        const admin = requireAdmin(actor);
        if (!admin.ok) return admin;
        return deps.provisioning.getUser(String(req.params.userKey));
      },
    }),
  );

  router.patch(
    '/users',
    handle({
      input: updateUserInput,
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const admin = requireAdmin(actor);
        if (!admin.ok) return admin;
        const { userKey, ...patch } = input;
        return deps.provisioning.updateUser(admin.value, userKey, {
          ...(patch.fullName !== undefined ? { fullName: patch.fullName } : {}),
          ...(patch.email !== undefined ? { email: patch.email ?? null } : {}),
          ...(patch.phone !== undefined ? { phone: patch.phone ?? null } : {}),
        });
      },
    }),
  );

  /**
   * Suspend, reinstate or archive. There is no DELETE on this router: a person
   * who has answered a question is part of the evidence record.
   */
  router.post(
    '/users/status',
    handle({
      input: statusInput,
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const admin = requireAdmin(actor);
        if (!admin.ok) return admin;
        return deps.provisioning.changeUserStatus(admin.value, input.userKey, input.status);
      },
    }),
  );

  // ── Roles ────────────────────────────────────────────────────────────────

  router.post(
    '/roles',
    handle({
      input: roleInput,
      requireAuth: true,
      successStatus: 201,
      execute: async ({ input, actor }) => {
        const admin = requireAdmin(actor);
        if (!admin.ok) return admin;
        return deps.provisioning.grantRole(admin.value, {
          userKey: input.userKey,
          role: input.role,
          schoolKey: input.schoolKey ?? null,
        });
      },
    }),
  );

  router.post(
    '/roles/revoke',
    handle({
      input: roleInput,
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const admin = requireAdmin(actor);
        if (!admin.ok) return admin;
        return deps.provisioning.revokeRole(admin.value, {
          userKey: input.userKey,
          role: input.role,
          schoolKey: input.schoolKey ?? null,
        });
      },
    }),
  );

  // ── Enrolment ────────────────────────────────────────────────────────────

  router.post(
    '/enrollments',
    handle({
      input: enrolInput,
      requireAuth: true,
      successStatus: 201,
      execute: async ({ input, actor }) => {
        const admin = requireAdmin(actor);
        if (!admin.ok) return admin;
        return deps.provisioning.enrolLearner(admin.value, input);
      },
    }),
  );

  router.get(
    '/learners/:learnerKey/enrollments',
    handle({
      input: z.object({}),
      requireAuth: true,
      execute: async ({ req, actor }) => {
        const admin = requireAdmin(actor);
        if (!admin.ok) return admin;
        return deps.provisioning.listEnrollments(String(req.params.learnerKey));
      },
    }),
  );

  /**
   * The enrolment browser: every placement, filtered server-side. Registered
   * after the learner-scoped reads it generalises and before the actions, so
   * the router reads people → browse → act.
   */
  router.get(
    '/enrollments',
    handle({
      input: enrollmentBrowserInput,
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const admin = requireAdmin(actor);
        if (!admin.ok) return admin;
        return deps.provisioning.browseEnrollments(input);
      },
    }),
  );

  /**
   * Hire a teacher: user + TEACHER grant at a school + the staff profile the
   * grant implies, in one act. A username-only call would leave the profile
   * missing and the educators screen blind to its own row.
   */
  router.post(
    '/educators',
    handle({
      input: provisionUserInput.extend({
        schoolKey: z.string().min(1).max(32),
        employeeCode: z.string().min(1).max(40).optional(),
        specialty: z.string().min(1).max(80).optional(),
        subjectKeys: z.array(z.string().min(1).max(32)).optional(),
        roles: z.literal(['TEACHER']).optional(),
      }),
      requireAuth: true,
      successStatus: 201,
      execute: async ({ input, actor }) => {
        const admin = requireAdmin(actor);
        if (!admin.ok) return admin;
        return deps.provisioning.provisionUser(admin.value, {
          username: input.username,
          fullName: input.fullName,
          password: input.password,
          email: input.email ?? null,
          phone: input.phone ?? null,
          roles: ['TEACHER'],
          schoolKey: input.schoolKey,
          employeeCode: input.employeeCode ?? null,
          specialty: input.specialty ?? null,
          subjectKeys: input.subjectKeys ?? [],
        });
      },
    }),
  );

  /**
   * The teacher's school link and staff fields. Linking moves the TEACHER
   * grant — one school at a time, never two.
   */
  router.patch(
    '/educators',
    handle({
      input: z.object({
        userKey: z.string().min(1).max(40),
        schoolKey: z.string().min(1).max(32).optional(),
        employeeCode: z.string().min(1).max(40).nullish(),
        specialty: z.string().min(1).max(80).nullish(),
        subjectKeys: z.array(z.string().min(1).max(32)).optional(),
      }),
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const admin = requireAdmin(actor);
        if (!admin.ok) return admin;
        return deps.provisioning.updateEducator(admin.value, {
          userKey: input.userKey,
          ...(input.schoolKey !== undefined ? { schoolKey: input.schoolKey } : {}),
          ...(input.employeeCode !== undefined ? { employeeCode: input.employeeCode ?? null } : {}),
          ...(input.specialty !== undefined ? { specialty: input.specialty ?? null } : {}),
          ...(input.subjectKeys !== undefined ? { subjectKeys: input.subjectKeys } : {}),
        });
      },
    }),
  );

  /** The teacher directory: identity, staff profile, school scope. */
  router.get(
    '/educators',
    handle({
      input: educatorDirectoryInput,
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const admin = requireAdmin(actor);
        if (!admin.ok) return admin;
        return deps.provisioning.listEducators(input);
      },
    }),
  );

  /**
   * Cohorts at a school: current enrolments grouped by grade. This IS the
   * class roster, as the domain defines it — a query, never a stored entity.
   */
  router.get(
    '/enrollments/cohorts',
    handle({
      input: z.object({
        schoolKey: z.string().min(1).max(32),
        academicYearKey: z.string().min(1).max(16).optional(),
      }),
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const admin = requireAdmin(actor);
        if (!admin.ok) return admin;
        return deps.provisioning.cohorts(input.schoolKey, input.academicYearKey);
      },
    }),
  );

  router.post(
    '/enrollments/make-current',
    handle({
      input: enrollmentKeyInput,
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const admin = requireAdmin(actor);
        if (!admin.ok) return admin;
        return deps.provisioning.makeEnrollmentCurrent(admin.value, input.enrollmentKey);
      },
    }),
  );

  router.post(
    '/enrollments/end',
    handle({
      input: enrollmentKeyInput,
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const admin = requireAdmin(actor);
        if (!admin.ok) return admin;
        return deps.provisioning.endEnrollment(admin.value, input.enrollmentKey);
      },
    }),
  );

  // ── Guardianship ─────────────────────────────────────────────────────────
  //
  // Linking and verifying are separate acts. A link is a claim; verification is
  // what actually opens a child's record to another account, and
  // `learner-access.ts` reads only the verified ones.

  router.post(
    '/guardian-links',
    handle({
      input: guardianLinkInput,
      requireAuth: true,
      successStatus: 201,
      execute: async ({ input, actor }) => {
        const admin = requireAdmin(actor);
        if (!admin.ok) return admin;
        return deps.provisioning.linkGuardian(admin.value, {
          guardianKey: input.guardianKey,
          learnerKey: input.learnerKey,
          relation: input.relation ?? null,
        });
      },
    }),
  );

  router.post(
    '/guardian-links/verification',
    handle({
      input: guardianVerifyInput,
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const admin = requireAdmin(actor);
        if (!admin.ok) return admin;
        return deps.provisioning.setGuardianLinkVerified(admin.value, input);
      },
    }),
  );

  router.post(
    '/guardian-links/remove',
    handle({
      input: z.object({ guardianKey: z.string().min(1), learnerKey: z.string().min(1) }),
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const admin = requireAdmin(actor);
        if (!admin.ok) return admin;
        return deps.provisioning.unlinkGuardian(admin.value, input);
      },
    }),
  );

  router.get(
    '/learners/:learnerKey/guardians',
    handle({
      input: z.object({}),
      requireAuth: true,
      execute: async ({ req, actor }) => {
        const admin = requireAdmin(actor);
        if (!admin.ok) return admin;
        return deps.provisioning.listGuardiansOf(String(req.params.learnerKey));
      },
    }),
  );

  router.get(
    '/guardians/:guardianKey/children',
    handle({
      input: z.object({}),
      requireAuth: true,
      execute: async ({ req, actor }) => {
        const admin = requireAdmin(actor);
        if (!admin.ok) return admin;
        return deps.provisioning.listChildrenOf(String(req.params.guardianKey));
      },
    }),
  );

  return router;
}
