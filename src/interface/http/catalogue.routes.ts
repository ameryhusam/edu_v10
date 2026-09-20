/**
 * Catalogue routes — the admin surface for the academic structure.
 *
 * Until now the only way to add a subject, a grade, a term or a school was to
 * edit the seed and re-run it, which made the seed load-bearing infrastructure
 * and left the frontend with no way to complete a setup workflow. These are the
 * endpoints that close that gap.
 *
 * **Reads are open to any authenticated user; writes are administrators only.**
 * That split is deliberate: a teacher's textbook filter and a student's subject
 * label both need the catalogue, and forcing those reads through an admin role
 * would mean every consumer needs elevated rights just to render a dropdown.
 *
 * Writes distinguish SYSTEM_ADMIN from SCHOOL_ADMIN where the distinction is
 * real — see `requireSystemAdmin` below.
 */

import { Router } from 'express';
import { z } from 'zod';

import { Errors } from '../../shared/kernel/errors.js';
import { Err, type Result } from '../../shared/kernel/result.js';
import { hasRole } from '../../contexts/identity/domain/roles.js';
import type { CatalogueService } from '../../contexts/catalogue/application/catalogue.service.js';
import type { Actor } from './middleware/context.js';
import { handle } from './handler.js';

export interface CatalogueRouteDeps {
  readonly catalogue: CatalogueService;
}

function requireAuth(actor: Actor | undefined): Result<Actor> {
  if (!actor) {
    return Err(Errors.unauthenticated('auth.required', 'Authentication is required.'));
  }
  return { ok: true, value: actor };
}

/**
 * Who may change the academic structure.
 *
 * SYSTEM_ADMIN only — and this is the clearest place where SYSTEM_ADMIN and
 * SCHOOL_ADMIN genuinely differ. The subject catalogue, the grade ladder and
 * the academic calendar are platform-wide: they are shared by every school, so
 * one school's administrator editing them would silently change what every
 * other school sees. A SCHOOL_ADMIN administers people and enrolments within
 * one school; that authority does not extend to the structure those schools
 * are defined against.
 */
const STRUCTURE_ROLES = ['SYSTEM_ADMIN'] as const;

function requireSystemAdmin(actor: Actor | undefined): Result<Actor> {
  const authed = requireAuth(actor);
  if (!authed.ok) return authed;
  if (!hasRole(authed.value.roles, STRUCTURE_ROLES)) {
    return Err(
      Errors.forbidden(
        'catalogue.structure_forbidden',
        'Only a system administrator may change the academic structure.',
        { required: STRUCTURE_ROLES },
      ),
    );
  }
  return authed;
}

const keyParam = z.object({});
const name = z.string().trim().min(1).max(120);

const subjectInput = z.object({
  key: z.string().min(1).max(24),
  name,
  nameEn: z.string().max(120).nullish(),
});

const subjectPatch = z.object({
  name: name.optional(),
  nameEn: z.string().max(120).nullish(),
  isActive: z.boolean().optional(),
});

const gradeInput = z.object({
  key: z.string().min(1).max(8),
  ordinal: z.coerce.number().int(),
  name,
  stage: z.string().max(40).nullish(),
});

const gradePatch = z.object({
  name: name.optional(),
  stage: z.string().max(40).nullish(),
  isActive: z.boolean().optional(),
});

/**
 * Dates arrive as `YYYY-MM-DD`, not as full timestamps: an academic year starts
 * on a day, and accepting an instant would invite a timezone to decide which
 * day that is.
 */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.')
  .transform((s) => new Date(`${s}T00:00:00.000Z`));

const yearInput = z.object({
  key: z.string().min(1).max(16),
  startsOn: isoDate,
  endsOn: isoDate,
});

const termInput = z.object({
  key: z.string().min(1).max(32),
  academicYearKey: z.string().min(1).max(16),
  ordinal: z.coerce.number().int(),
  name,
});

const termPatch = z.object({ name: name.optional() });

const termQuery = z.object({ academicYearKey: z.string().min(1).max(16).optional() });

const schoolInput = z.object({
  key: z.string().min(1).max(32),
  name,
  city: z.string().max(80).nullish(),
});

const schoolPatch = z.object({
  name: name.optional(),
  city: z.string().max(80).nullish(),
  isActive: z.boolean().optional(),
});

const matrixCellInput = z.object({
  gradeKey: z.string().min(1).max(16),
  subjectKey: z.string().min(1).max(16),
  isActive: z.boolean(),
});

const matrixSaveInput = z.object({
  changes: z.array(matrixCellInput).min(1).max(2000),
});

const matrixFillInput = z.object({
  apply: z.boolean(),
  /** Scope to one grade — the grades table's per-row action. */
  gradeKey: z.string().min(1).max(16).optional(),
});

const matrixRestoreInput = z.object({ apply: z.boolean() });

export function catalogueRoutes(deps: CatalogueRouteDeps): Router {
  const router = Router();

  // ── Subjects ──────────────────────────────────────────────────────────────

  router.get(
    '/subjects',
    handle({
      input: keyParam,
      requireAuth: true,
      execute: async ({ actor }) => {
        const authed = requireAuth(actor);
        if (!authed.ok) return authed;
        return deps.catalogue.listSubjects();
      },
    }),
  );

  router.post(
    '/subjects',
    handle({
      input: subjectInput,
      requireAuth: true,
      successStatus: 201,
      execute: async ({ input, actor }) => {
        const admin = requireSystemAdmin(actor);
        if (!admin.ok) return admin;
        return deps.catalogue.saveSubject({
          key: input.key,
          name: input.name,
          nameEn: input.nameEn ?? null,
        });
      },
    }),
  );

  router.patch(
    '/subjects/:key',
    handle({
      input: subjectPatch,
      requireAuth: true,
      execute: async ({ input, actor, req }) => {
        const admin = requireSystemAdmin(actor);
        if (!admin.ok) return admin;
        return deps.catalogue.updateSubject(String(req.params.key), {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.nameEn !== undefined ? { nameEn: input.nameEn ?? null } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        });
      },
    }),
  );

  router.delete(
    '/subjects/:key',
    handle({
      input: keyParam,
      requireAuth: true,
      execute: async ({ actor, req }) => {
        const admin = requireSystemAdmin(actor);
        if (!admin.ok) return admin;
        return deps.catalogue.deleteSubject(String(req.params.key));
      },
    }),
  );

  // ── Grades ────────────────────────────────────────────────────────────────

  router.get(
    '/grades',
    handle({
      input: keyParam,
      requireAuth: true,
      execute: async ({ actor }) => {
        const authed = requireAuth(actor);
        if (!authed.ok) return authed;
        return deps.catalogue.listGrades();
      },
    }),
  );

  router.post(
    '/grades',
    handle({
      input: gradeInput,
      requireAuth: true,
      successStatus: 201,
      execute: async ({ input, actor }) => {
        const admin = requireSystemAdmin(actor);
        if (!admin.ok) return admin;
        return deps.catalogue.saveGrade({
          key: input.key,
          ordinal: input.ordinal,
          name: input.name,
          stage: input.stage ?? null,
        });
      },
    }),
  );

  router.patch(
    '/grades/:key',
    handle({
      input: gradePatch,
      requireAuth: true,
      execute: async ({ input, actor, req }) => {
        const admin = requireSystemAdmin(actor);
        if (!admin.ok) return admin;
        return deps.catalogue.updateGrade(String(req.params.key), {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.stage !== undefined ? { stage: input.stage ?? null } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        });
      },
    }),
  );

  router.delete(
    '/grades/:key',
    handle({
      input: keyParam,
      requireAuth: true,
      execute: async ({ actor, req }) => {
        const admin = requireSystemAdmin(actor);
        if (!admin.ok) return admin;
        return deps.catalogue.deleteGrade(String(req.params.key));
      },
    }),
  );

  // ── Academic years ────────────────────────────────────────────────────────

  router.get(
    '/academic-years',
    handle({
      input: keyParam,
      requireAuth: true,
      execute: async ({ actor }) => {
        const authed = requireAuth(actor);
        if (!authed.ok) return authed;
        return deps.catalogue.listAcademicYears();
      },
    }),
  );

  router.post(
    '/academic-years',
    handle({
      input: yearInput,
      requireAuth: true,
      successStatus: 201,
      execute: async ({ input, actor }) => {
        const admin = requireSystemAdmin(actor);
        if (!admin.ok) return admin;
        return deps.catalogue.saveAcademicYear(input);
      },
    }),
  );

  /**
   * Making a year current is its own endpoint, not a PATCH field, because the
   * write is "clear every flag, then set one". A generic field update would
   * let two years be current at once.
   */
  router.post(
    '/academic-years/:key/current',
    handle({
      input: keyParam,
      requireAuth: true,
      execute: async ({ actor, req }) => {
        const admin = requireSystemAdmin(actor);
        if (!admin.ok) return admin;
        return deps.catalogue.setCurrentAcademicYear(String(req.params.key));
      },
    }),
  );

  router.delete(
    '/academic-years/:key',
    handle({
      input: keyParam,
      requireAuth: true,
      execute: async ({ actor, req }) => {
        const admin = requireSystemAdmin(actor);
        if (!admin.ok) return admin;
        return deps.catalogue.deleteAcademicYear(String(req.params.key));
      },
    }),
  );

  // ── Terms ─────────────────────────────────────────────────────────────────

  router.get(
    '/terms',
    handle({
      input: termQuery,
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const authed = requireAuth(actor);
        if (!authed.ok) return authed;
        return deps.catalogue.listTerms(input.academicYearKey);
      },
    }),
  );

  router.post(
    '/terms',
    handle({
      input: termInput,
      requireAuth: true,
      successStatus: 201,
      execute: async ({ input, actor }) => {
        const admin = requireSystemAdmin(actor);
        if (!admin.ok) return admin;
        return deps.catalogue.saveTerm(input);
      },
    }),
  );

  router.patch(
    '/terms/:key',
    handle({
      input: termPatch,
      requireAuth: true,
      execute: async ({ input, actor, req }) => {
        const admin = requireSystemAdmin(actor);
        if (!admin.ok) return admin;
        return deps.catalogue.updateTerm(String(req.params.key), {
          ...(input.name !== undefined ? { name: input.name } : {}),
        });
      },
    }),
  );

  router.delete(
    '/terms/:key',
    handle({
      input: keyParam,
      requireAuth: true,
      execute: async ({ actor, req }) => {
        const admin = requireSystemAdmin(actor);
        if (!admin.ok) return admin;
        return deps.catalogue.deleteTerm(String(req.params.key));
      },
    }),
  );

  // ── The curriculum matrix (توزيع المواد على الصفوف) ────────────────────────

  /**
   * The grade × subject matrix with each subject's standard policy. A read
   * for any authenticated staff member (a teacher browsing the offer is a
   * reader, not an editor).
   */
  router.get(
    '/grade-subjects',
    handle({
      input: keyParam,
      requireAuth: true,
      execute: async ({ actor }) => {
        const authed = requireAuth(actor);
        if (!authed.ok) return authed;
        return deps.catalogue.gradeSubjectMatrix();
      },
    }),
  );

  /**
   * Save the administrator's cells, wholesale — the batch is the unit, in the
   * legacy studio's spirit: nothing is written until the save.
   */
  router.post(
    '/grade-subjects',
    handle({
      input: matrixSaveInput,
      requireAuth: true,
      successStatus: 201,
      execute: async ({ input, actor }) => {
        const admin = requireSystemAdmin(actor);
        if (!admin.ok) return admin;
        return deps.catalogue.applyGradeSubjectCells(input.changes);
      },
    }),
  );

  /**
   * Fill the matrix from the subjects' standard policy. `apply: false` is the
   * mandatory preview: it returns exactly what would change and writes
   * nothing. The write is a separate, confirmed call.
   */
  router.post(
    '/grade-subjects/fill',
    handle({
      input: matrixFillInput,
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const admin = requireSystemAdmin(actor);
        if (!admin.ok) return admin;
        return deps.catalogue.fillGradeSubjectsFromPolicy({
          apply: input.apply,
          ...(input.gradeKey ? { gradeKey: input.gradeKey } : {}),
        });
      },
    }),
  );

  /**
   * Restore the default distribution — the state the seed installed. Unlike a
   * fill, "no claimed policy" means "off": a restore undoes the manual
   * experiments too. Preview-first like every other bulk write.
   */
  router.post(
    '/grade-subjects/restore',
    handle({
      input: matrixRestoreInput,
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const admin = requireSystemAdmin(actor);
        if (!admin.ok) return admin;
        return deps.catalogue.restoreDefaultDistribution({ apply: input.apply });
      },
    }),
  );

  // ── Schools ───────────────────────────────────────────────────────────────

  router.get(
    '/schools',
    handle({
      input: keyParam,
      requireAuth: true,
      execute: async ({ actor }) => {
        const authed = requireAuth(actor);
        if (!authed.ok) return authed;
        return deps.catalogue.listSchools();
      },
    }),
  );

  router.post(
    '/schools',
    handle({
      input: schoolInput,
      requireAuth: true,
      successStatus: 201,
      execute: async ({ input, actor }) => {
        const admin = requireSystemAdmin(actor);
        if (!admin.ok) return admin;
        return deps.catalogue.saveSchool({
          key: input.key,
          name: input.name,
          city: input.city ?? null,
        });
      },
    }),
  );

  /**
   * A school's own details are the one thing a SCHOOL_ADMIN may edit here —
   * but only their own school, which the service cannot know. Kept at
   * SYSTEM_ADMIN until school-scoped authorization is wired through, because
   * an over-permissive write is far worse than a missing one.
   */
  router.patch(
    '/schools/:key',
    handle({
      input: schoolPatch,
      requireAuth: true,
      execute: async ({ input, actor, req }) => {
        const admin = requireSystemAdmin(actor);
        if (!admin.ok) return admin;
        return deps.catalogue.updateSchool(String(req.params.key), {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.city !== undefined ? { city: input.city ?? null } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        });
      },
    }),
  );

  router.delete(
    '/schools/:key',
    handle({
      input: keyParam,
      requireAuth: true,
      execute: async ({ actor, req }) => {
        const admin = requireSystemAdmin(actor);
        if (!admin.ok) return admin;
        return deps.catalogue.deleteSchool(String(req.params.key));
      },
    }),
  );

  return router;
}
