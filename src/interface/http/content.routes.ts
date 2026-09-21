/**
 * Content authoring routes.
 *
 * These are the endpoints an Admin UI calls. Note what is NOT here: no rule
 * about when publishing is allowed, no cycle check, no slug policy. The UI and
 * this router are both transport — they carry an intent to the application
 * layer and render the answer. Deciding here would mean the rules exist twice,
 * and the web and mobile clients would eventually disagree about them.
 *
 * Every route is authoring, so every route requires an authoring role. There
 * is no learner-facing endpoint in this file and therefore no call to
 * `learner-access.ts`: this surface is not learner-scoped at all.
 */

import express, { Router } from 'express';
import { z } from 'zod';
import { Errors } from '../../shared/kernel/errors.js';
import { Err, Ok, type Result } from '../../shared/kernel/result.js';
import { hasRole } from '../../contexts/identity/domain/roles.js';
import {
  PUBLICATION_ACTIONS,
  PUBLICATION_STATES,
  type PublicationAction,
} from '../../contexts/content/domain/publication.js';
import { CONTENT_NODE_KINDS } from '../../contexts/content/domain/authoring.js';
import {
  CONTENT_ASSET_TYPES,
  CONTENT_ASSET_SCOPES,
} from '../../contexts/content/domain/assets.js';
import type { ContentAuthoringService } from '../../contexts/content/application/authoring.service.js';
import type { PublishingService } from '../../contexts/content/application/publishing.service.js';
import type { ContentExportService } from '../../contexts/content/application/content-export.service.js';
import type { ContentImportService } from '../../contexts/content/application/content-import.service.js';
import type { ContentAssetService } from '../../contexts/content/application/content-asset.service.js';
import type { WorkspaceImporterService } from '../../contexts/content/application/workspace-importer.service.js';
import type { TextbookAdministrationService } from '../../contexts/content/application/textbook-administration.service.js';
import type { Actor } from './middleware/context.js';
import { handle } from './handler.js';

export interface ContentRouteDeps {
  readonly contentAuthoring: ContentAuthoringService;
  readonly publishing: PublishingService;
  readonly contentExport: ContentExportService;
  readonly contentImport: ContentImportService;
  readonly textbookAdministration: TextbookAdministrationService;
  readonly contentAsset?: ContentAssetService;
  readonly workspaceImporter?: WorkspaceImporterService;
  readonly contentUploadMaxBytes?: number;
}

/**
 * Who may author content.
 *
 * CONTENT_AUTHOR is the role that exists for this; admins are included because
 * a deployment with one person must not be locked out of its own content.
 * TEACHER is deliberately absent — teaching a book is not editing it.
 */
const AUTHORING_ROLES = ['SYSTEM_ADMIN', 'SCHOOL_ADMIN', 'CONTENT_AUTHOR'] as const;

/**
 * Approving one's own submission is not a review.
 *
 * Separating SUBMIT from APPROVE only means something if a different person
 * can be required to do the second. Enforcing that properly needs to compare
 * the approver against the submitter, which is recorded in the audit trail —
 * until that comparison exists, approval is limited to admins so the two acts
 * are at least separated by privilege.
 */
const APPROVAL_ROLES = ['SYSTEM_ADMIN', 'SCHOOL_ADMIN'] as const;

/**
 * A staff read of curriculum content: the same outline and materials for the
 * administrator triaging the catalogue, the author preparing a book, and the
 * teacher preparing class material. Curriculum content is not learner data;
 * the entitlement that guards a learner's shelf does not apply here.
 */
const STAFF_READ_ROLES = ['SYSTEM_ADMIN', 'SCHOOL_ADMIN', 'CONTENT_AUTHOR', 'TEACHER'] as const;

function requireStaffReader(actor: Actor | undefined): Result<{ actorKey: string }> {
  if (!actor) {
    return Err(Errors.unauthenticated('auth.required', 'Authentication is required.'));
  }
  if (!hasRole(actor.roles, STAFF_READ_ROLES)) {
    return Err(
      Errors.forbidden('content.staff_read_forbidden', 'You may not browse this content.', {
        required: STAFF_READ_ROLES,
      }),
    );
  }
  return { ok: true, value: { actorKey: actor.userKey } };
}

function requireAuthor(actor: Actor | undefined): Result<{ actorKey: string }> {
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
  return { ok: true, value: { actorKey: actor.userKey } };
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

/**
 * Who may decide which school teaches which book. Deploying content to a
 * school changes what its learners are entitled to, which is an
 * administrative act, not an authoring one — the same split the people and
 * structure surfaces use.
 */
const ADOPTION_ROLES = ['SYSTEM_ADMIN', 'SCHOOL_ADMIN'] as const;

function requireAdoptionAdmin(
  actor: Actor | undefined,
): Result<{ actorKey: string }> {
  if (!actor) {
    return Err(Errors.unauthenticated('auth.required', 'Authentication is required.'));
  }
  if (!hasRole(actor.roles, ADOPTION_ROLES)) {
    return Err(
      Errors.forbidden('content.adoption_forbidden', 'You may not manage textbook adoptions.', {
        required: ADOPTION_ROLES,
      }),
    );
  }
  return { ok: true, value: { actorKey: actor.userKey } };
}

/**
 * No `key` and no `textbookKey` field: the key is derived from the
 * coordinates. A caller describes a textbook; it does not name one.
 */
const createTextbookInput = z.object({
  subjectKey: z.string().min(1),
  gradeKey: z.string().min(1),
  termKey: z.string().min(1),
  title: z.string().min(1).max(300),
  edition: z.string().min(1).max(40).optional(),
  description: z.string().max(4000).nullish(),
  issuer: z.string().max(200).nullish(),
  isbn: z.string().max(40).nullish(),
  publishYear: z.number().int().min(1900).max(2200).nullish(),
  totalPages: z.number().int().min(1).max(10000).nullish(),
});

const createUnitInput = z.object({
  textbookKey: z.string().min(1),
  parentUnitKey: z.string().min(1).nullish(),
  name: z.string().min(1),
  slug: z.string().min(1).nullish(),
});

const createLessonInput = z.object({
  unitKey: z.string().min(1),
  name: z.string().min(1),
  slug: z.string().min(1).nullish(),
  description: z.string().nullish(),
});

const createMisconceptionInput = z.object({
  conceptKey: z.string().min(1),
  slug: z.string().min(1).nullish(),
  name: z.string().min(1),
  description: z.string().min(1),
  correction: z.string().nullish(),
});

const createConceptInput = z.object({
  lessonKey: z.string().min(1),
  name: z.string().min(1),
  slug: z.string().min(1).nullish(),
  description: z.string().nullish(),
  difficulty: z.number().optional(),
  importance: z.number().optional(),
  masteryThreshold: z.number().optional(),
  isCore: z.boolean().optional(),
});

/**
 * The patch body is passthrough on purpose.
 *
 * Zod stripping unknown keys would silently discard a field the author
 * believed they were setting. The application layer's allow-list rejects it
 * loudly instead, which is the behaviour an author can actually debug.
 */
const updateInput = z.object({
  kind: z.enum(CONTENT_NODE_KINDS),
  key: z.string().min(1),
  patch: z.looseObject({}),
});

const reorderInput = z.object({
  kind: z.enum(['unit', 'lesson', 'concept']),
  parentKey: z.string().min(1),
  orderedKeys: z.array(z.string().min(1)).min(1),
});

const prerequisiteInput = z.object({
  conceptKey: z.string().min(1),
  prerequisiteKey: z.string().min(1),
  strength: z.number().optional(),
  requiredMastery: z.number().optional(),
});

const transitionInput = z.object({
  textbookKey: z.string().min(1),
  action: z.enum(PUBLICATION_ACTIONS),
});

const textbookKeyInput = z.object({ textbookKey: z.string().min(1) });

const ensureTextbooksInput = z.object({
  gradeKey: z.string().min(1).max(8),
  termKey: z.string().min(1).max(32),
  edition: z.string().min(1).max(40),
  issuer: z.string().max(200).nullish(),
  publishYear: z.number().int().min(1900).max(2200).nullish(),
  adopt: z
    .object({
      schoolKey: z.string().min(1).max(32),
      academicYearKey: z.string().min(1).max(16),
    })
    .nullish(),
});

const textbookListInput = z.object({
  search: z.string().trim().min(1).max(120).optional(),
  subjectKey: z.string().min(1).max(24).optional(),
  gradeKey: z.string().min(1).max(8).optional(),
  termKey: z.string().min(1).max(32).optional(),
  status: z.enum(PUBLICATION_STATES).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

/**
 * An adoption is addressed by the triple that makes it unique — there is no
 * business key column on the model, and inventing an address for a row whose
 * identity is already (textbook, school, year) would be a second identity.
 */
const adoptionInput = z.object({
  textbookKey: z.string().min(1),
  schoolKey: z.string().min(1).max(32),
  academicYearKey: z.string().min(1).max(16),
});

/**
 * Grade accreditation: one book (`textbookKey` given) or every book the
 * grade has (`textbookKey` omitted) — the hierarchical alternative to naming
 * a single (textbook, school, year) triple over and over.
 */
const gradeAdoptionInput = z.object({
  gradeKey: z.string().min(1).max(8),
  termKey: z.string().min(1).max(32).optional(),
  textbookKey: z.string().min(1).optional(),
  schoolKey: z.string().min(1).max(32),
  academicYearKey: z.string().min(1).max(16),
});

const adoptionListInput = z.object({
  textbookKey: z.string().min(1).optional(),
  schoolKey: z.string().min(1).max(32).optional(),
  academicYearKey: z.string().min(1).max(16).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export function contentRoutes(deps: ContentRouteDeps): Router {
  const router = Router();

  // ── Authoring ─────────────────────────────────────────────────────────────

  router.post(
    '/textbooks',
    handle({
      input: createTextbookInput,
      requireAuth: true,
      successStatus: 201,
      execute: async ({ input, actor }) => {
        const author = requireAuthor(actor);
        if (!author.ok) return author;
        return deps.contentAuthoring.createTextbook(author.value, input);
      },
    }),
  );

  router.post(
    '/textbooks/ensure-for-grade',
    handle({
      input: ensureTextbooksInput,
      requireAuth: true,
      successStatus: 201,
      execute: async ({ input, actor }) => {
        const admin = requireAdoptionAdmin(actor);
        if (!admin.ok) return admin;
        return deps.textbookAdministration.ensureTextbooksForGrade(admin.value, {
          gradeKey: input.gradeKey,
          termKey: input.termKey,
          edition: input.edition,
          issuer: input.issuer ?? null,
          publishYear: input.publishYear ?? null,
          adopt: input.adopt ?? null,
        });
      },
    }),
  );

  router.post(
    '/units',
    handle({
      input: createUnitInput,
      requireAuth: true,
      successStatus: 201,
      execute: async ({ input, actor }) => {
        const author = requireAuthor(actor);
        if (!author.ok) return author;
        return deps.contentAuthoring.createUnit(author.value, {
          textbookKey: input.textbookKey,
          parentUnitKey: input.parentUnitKey ?? null,
          name: input.name,
          slug: input.slug ?? null,
        });
      },
    }),
  );

  router.post(
    '/lessons',
    handle({
      input: createLessonInput,
      requireAuth: true,
      successStatus: 201,
      execute: async ({ input, actor }) => {
        const author = requireAuthor(actor);
        if (!author.ok) return author;
        return deps.contentAuthoring.createLesson(author.value, {
          unitKey: input.unitKey,
          name: input.name,
          slug: input.slug ?? null,
          description: input.description ?? null,
        });
      },
    }),
  );

  router.post(
    '/concepts',
    handle({
      input: createConceptInput,
      requireAuth: true,
      successStatus: 201,
      execute: async ({ input, actor }) => {
        const author = requireAuthor(actor);
        if (!author.ok) return author;
        const { lessonKey, name, slug, description, ...rest } = input;
        return deps.contentAuthoring.createConcept(author.value, {
          lessonKey,
          name,
          slug: slug ?? null,
          description: description ?? null,
          ...rest,
        });
      },
    }),
  );

  /**
   * Name an error learners actually make on this concept. Same authoring
   * role as everything else here — a misconception is content, not a
   * separate governance surface.
   */
  router.post(
    '/misconceptions',
    handle({
      input: createMisconceptionInput,
      requireAuth: true,
      successStatus: 201,
      execute: async ({ input, actor }) => {
        const author = requireAuthor(actor);
        if (!author.ok) return author;
        return deps.contentAuthoring.createMisconception(author.value, {
          conceptKey: input.conceptKey,
          slug: input.slug ?? input.name,
          name: input.name,
          description: input.description,
          correction: input.correction ?? null,
        });
      },
    }),
  );

  router.patch(
    '/nodes',
    handle({
      input: updateInput,
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const author = requireAuthor(actor);
        if (!author.ok) return author;
        return deps.contentAuthoring.updateNode(
          author.value,
          input.kind,
          input.key,
          input.patch as Record<string, unknown>,
        );
      },
    }),
  );

  router.post(
    '/reorder',
    handle({
      input: reorderInput,
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const author = requireAuthor(actor);
        if (!author.ok) return author;
        return deps.contentAuthoring.reorder(
          author.value,
          input.kind,
          input.parentKey,
          input.orderedKeys,
        );
      },
    }),
  );

  // ── Prerequisites ─────────────────────────────────────────────────────────

  router.post(
    '/prerequisites',
    handle({
      input: prerequisiteInput,
      requireAuth: true,
      successStatus: 201,
      execute: async ({ input, actor }) => {
        const author = requireAuthor(actor);
        if (!author.ok) return author;
        return deps.contentAuthoring.linkPrerequisite(author.value, input);
      },
    }),
  );

  router.delete(
    '/prerequisites',
    handle({
      input: prerequisiteInput,
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const author = requireAuthor(actor);
        if (!author.ok) return author;
        return deps.contentAuthoring.unlinkPrerequisite(
          author.value,
          input.conceptKey,
          input.prerequisiteKey,
        );
      },
    }),
  );

  // ── Publishing ────────────────────────────────────────────────────────────

  /** Dry run: every structural problem at once, while there is still time. */
  /**
   * Export a textbook as a content package.
   *
   * Staff-only and read-only. The response is the public profile declared in
   * domain/export-profile.ts -- business field names, no ids, no internal
   * timestamps -- so it is a contract, not a database dump.
   */
  /**
   * Import a content package.
   *
   * `dryRun` defaults to TRUE. Importing is destructive-adjacent and a caller
   * who forgets the flag should get a preview, not a write -- the safe default
   * is the one you get by accident.
   *
   * The body is the package itself, validated structurally here and
   * semantically by the service. Parsing XLSX/CSV into this shape is a
   * separate, later concern; JSON is the machine contract.
   */
  router.post(
    '/textbooks/import',
    handle({
      input: z.object({
        dryRun: z.boolean().optional(),
        targetTextbookKey: z.string().optional(),
        selectedUnits: z.array(z.string()).optional(),
        selectedLessons: z.array(z.string()).optional(),
        selectedConcepts: z.array(z.string()).optional(),
        includeResources: z.boolean().optional(),
        includeMisconceptions: z.boolean().optional(),
        includeQuestions: z.boolean().optional(),
        package: z.looseObject({}),
      }),
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const author = requireAuthor(actor);
        if (!author.ok) return author;
        return deps.contentImport.importPackage(
          author.value,
          input.package as never,
          {
            dryRun: input.dryRun !== false,
            targetTextbookKey: input.targetTextbookKey,
            selectedUnits: input.selectedUnits,
            selectedLessons: input.selectedLessons,
            selectedConcepts: input.selectedConcepts,
            includeResources: input.includeResources,
            includeMisconceptions: input.includeMisconceptions,
            includeQuestions: input.includeQuestions,
          },
        );
      },
    }),
  );

  router.get(
    '/textbooks/:textbookKey/export',
    handle({
      input: z.object({ textbookKey: z.string().min(1) }),
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const author = requireAuthor(actor);
        if (!author.ok) return author;
        return deps.contentExport.exportTextbook(author.value, input.textbookKey);
      },
    }),
  );

  router.get(
    '/readiness',
    handle({
      input: textbookKeyInput,
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const author = requireAuthor(actor);
        if (!author.ok) return author;
        return deps.publishing.checkReadiness(input.textbookKey);
      },
    }),
  );

  router.post(
    '/transitions',
    handle({
      input: transitionInput,
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const author = requireAuthor(actor);
        if (!author.ok) return author;
        const approver = requireApprover(actor, input.action);
        if (!approver.ok) return approver;
        return deps.publishing.apply(author.value, input.textbookKey, input.action);
      },
    }),
  );

  // ── Catalogue administration ──────────────────────────────────────────────
  //
  // The admin surface over the same domain: browse the textbooks that exist
  // and record which school teaches which book in which year. Reads share the
  // authoring roles (an administrator and an author both triage the
  // catalogue); adoption writes are administrators only, matching the
  // people/structure split every other admin surface uses.

  /**
   * The content browse: a book's unit→lesson outline with honest counts.
   * Staff-read gated — an administrator triages the catalogue, an author
   * prepares a book, a teacher prepares material, all from the same facts.
   */
  router.get(
    '/textbooks/:textbookKey/outline',
    handle({
      input: z.object({ textbookKey: z.string().min(1) }),
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const reader = requireStaffReader(actor);
        if (!reader.ok) return reader;
        return deps.textbookAdministration.outline(input.textbookKey);
      },
    }),
  );

  /** One lesson's materials — the educational and remedial reading list. */
  router.get(
    '/lessons/:lessonKey/materials',
    handle({
      input: z.object({ lessonKey: z.string().min(1) }),
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const reader = requireStaffReader(actor);
        if (!reader.ok) return reader;
        return deps.textbookAdministration.lessonMaterials(input.lessonKey);
      },
    }),
  );

  /** One concept's misconceptions and prerequisite graph. */
  router.get(
    '/concepts/:conceptKey',
    handle({
      input: z.object({ conceptKey: z.string().min(1) }),
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const reader = requireStaffReader(actor);
        if (!reader.ok) return reader;
        return deps.textbookAdministration.conceptDetail(input.conceptKey);
      },
    }),
  );

  router.get(
    '/textbooks',
    handle({
      input: textbookListInput,
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const reader = requireStaffReader(actor);
        if (!reader.ok) return reader;
        return deps.textbookAdministration.listTextbooks(input);
      },
    }),
  );

  router.get(
    '/adoptions',
    handle({
      input: adoptionListInput,
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const author = requireAuthor(actor);
        if (!author.ok) return author;
        return deps.textbookAdministration.listAdoptions(input);
      },
    }),
  );

  router.post(
    '/adoptions',
    handle({
      input: adoptionInput,
      requireAuth: true,
      successStatus: 201,
      execute: async ({ input, actor }) => {
        const admin = requireAdoptionAdmin(actor);
        if (!admin.ok) return admin;
        return deps.textbookAdministration.adopt(admin.value, input);
      },
    }),
  );

  router.delete(
    '/adoptions',
    handle({
      input: adoptionInput,
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const admin = requireAdoptionAdmin(actor);
        if (!admin.ok) return admin;
        return deps.textbookAdministration.unadopt(admin.value, input);
      },
    }),
  );

  /**
   * Accredit a grade's textbooks for a school in one call — one book or the
   * whole grade. Same role and idempotency contract as `/adoptions`; this is
   * the hierarchical entry point, not a second write path.
   */
  router.post(
    '/adoptions/grade',
    handle({
      input: gradeAdoptionInput,
      requireAuth: true,
      successStatus: 201,
      execute: async ({ input, actor }) => {
        const admin = requireAdoptionAdmin(actor);
        if (!admin.ok) return admin;
        return deps.textbookAdministration.adoptGrade(admin.value, input);
      },
    }),
  );

  const uploadTextbookSourceInput = z.object({
    term: z.string().min(1),
    grade: z.string().min(1),
    subject: z.string().min(1),
    edition: z.string().optional(),
    title: z.string().optional(),
    pdfBase64: z.string().min(1),
  });

  router.post(
    '/workspace/prepare-upload',
    express.raw({
      type: ['application/pdf', 'application/octet-stream'],
      limit: deps.contentUploadMaxBytes ?? 250 * 1024 * 1024,
    }),
    handle({
      input: z.instanceof(Buffer),
      rawBody: true,
      requireAuth: true,
      successStatus: 201,
      execute: async ({ input, actor, req }) => {
        const author = requireAuthor(actor);
        if (!author.ok) return author;
        if (!deps.workspaceImporter) {
          return Err(Errors.internal('workspace.importer_unavailable', 'Workspace importer is not enabled.'));
        }
        const query = z.object({
          term: z.string().min(1),
          grade: z.string().min(1),
          subject: z.string().min(1),
          edition: z.string().optional(),
          title: z.string().optional(),
          autoSegment: z.coerce.boolean().optional(),
        }).safeParse(req.query);
        if (!query.success) {
          return Err(Errors.validation('request.invalid_input', 'Book coordinates are invalid.', {
            issues: query.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
          }));
        }
        if (input.length === 0) {
          return Err(Errors.validation('content.empty_pdf', 'The uploaded PDF is empty.'));
        }
        const result = await deps.workspaceImporter.prepareWorkspace({
          term: query.data.term,
          grade: query.data.grade,
          subject: query.data.subject,
          edition: query.data.edition,
          title: query.data.title,
          pdfBuffer: input,
          autoSegment: query.data.autoSegment,
        });
        return Ok(result);
      },
    }),
  );

  router.post(
    '/textbooks/upload-source',
    handle({
      input: uploadTextbookSourceInput,
      requireAuth: true,
      successStatus: 201,
      execute: async ({ input, actor }) => {
        const author = requireAuthor(actor);
        if (!author.ok) return author;
        if (!deps.contentAsset) {
          return Err(Errors.internal('asset.service_unavailable', 'Content asset service is not enabled.'));
        }
        const buffer = Buffer.from(input.pdfBase64, 'base64');
        const res = await deps.contentAsset.uploadTextbookSource({
          term: input.term,
          grade: input.grade,
          subject: input.subject,
          edition: input.edition,
          title: input.title,
          buffer,
        });
        return Ok(res);
      },
    }),
  );

  const uploadAssetInput = z.object({
    textbookKey: z.string().min(1),
    relativePath: z.string().min(1),
    assetType: z.enum(CONTENT_ASSET_TYPES),
    scope: z.enum(CONTENT_ASSET_SCOPES),
    bufferBase64: z.string().min(1),
    unitKey: z.string().optional(),
    lessonKey: z.string().optional(),
    conceptKey: z.string().optional(),
    mimeType: z.string().optional(),
    originalName: z.string().optional(),
    pageStart: z.number().int().optional(),
    pageEnd: z.number().int().optional(),
    title: z.string().optional(),
    altText: z.string().optional(),
    caption: z.string().optional(),
  });

  router.post(
    '/assets/upload',
    handle({
      input: uploadAssetInput,
      requireAuth: true,
      successStatus: 201,
      execute: async ({ input, actor }) => {
        const author = requireAuthor(actor);
        if (!author.ok) return author;
        if (!deps.contentAsset) {
          return Err(Errors.internal('asset.service_unavailable', 'Content asset service is not enabled.'));
        }
        const buffer = Buffer.from(input.bufferBase64, 'base64');
        const res = await deps.contentAsset.uploadAsset({
          textbookKey: input.textbookKey,
          relativePath: input.relativePath,
          buffer,
          assetType: input.assetType,
          scope: input.scope,
          unitKey: input.unitKey,
          lessonKey: input.lessonKey,
          conceptKey: input.conceptKey,
          mimeType: input.mimeType,
          originalName: input.originalName,
          pageStart: input.pageStart,
          pageEnd: input.pageEnd,
          title: input.title,
          altText: input.altText,
          caption: input.caption,
        });
        return Ok(res);
      },
    }),
  );

  const workspaceImportInput = z.object({
    workspaceDir: z.string().min(1),
    dryRun: z.boolean().optional(),
    syncAssets: z.boolean().optional(),
  });

  const workspacePrepareInput = z.object({
    term: z.string().min(1),
    grade: z.string().min(1),
    subject: z.string().min(1),
    edition: z.string().optional(),
    title: z.string().optional(),
    pdfBase64: z.string().optional(),
    autoSegment: z.boolean().optional(),
    units: z.array(z.any()).optional(),
  });

  const workspaceSegmentInput = z.object({
    workspaceDir: z.string().min(1),
    units: z.array(z.any()).optional(),
  });

  router.post(
    '/workspace/prepare',
    handle({
      input: workspacePrepareInput,
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const author = requireAuthor(actor);
        if (!author.ok) return author;
        if (!deps.workspaceImporter) {
          return Err(Errors.internal('workspace.importer_unavailable', 'Workspace importer is not enabled.'));
        }
        const pdfBuffer = input.pdfBase64 ? Buffer.from(input.pdfBase64, 'base64') : undefined;
        const res = await deps.workspaceImporter.prepareWorkspace({
          term: input.term,
          grade: input.grade,
          subject: input.subject,
          edition: input.edition,
          title: input.title,
          pdfBuffer,
          autoSegment: input.autoSegment,
          units: input.units,
        });
        return Ok(res);
      },
    }),
  );

  router.get(
    '/workspaces',
    handle({
      requireAuth: true,
      execute: async ({ actor }) => {
        const reader = requireStaffReader(actor);
        if (!reader.ok) return reader;
        if (!deps.workspaceImporter) {
          return Err(Errors.internal('workspace.importer_unavailable', 'Workspace importer is not enabled.'));
        }
        const list = await deps.workspaceImporter.listWorkspaces();
        return Ok(list);
      },
    }),
  );

  router.get(
    '/workspace/inspect',
    handle({
      input: z.object({ workspaceDir: z.string().min(1) }),
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const reader = requireStaffReader(actor);
        if (!reader.ok) return reader;
        if (!deps.workspaceImporter) {
          return Err(Errors.internal('workspace.importer_unavailable', 'Workspace importer is not enabled.'));
        }
        const details = await deps.workspaceImporter.inspectWorkspace(input.workspaceDir);
        return Ok(details);
      },
    }),
  );

  router.post(
    '/workspace/segment',
    handle({
      input: workspaceSegmentInput,
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const author = requireAuthor(actor);
        if (!author.ok) return author;
        if (!deps.workspaceImporter) {
          return Err(Errors.internal('workspace.importer_unavailable', 'Workspace importer is not enabled.'));
        }
        const res = await deps.workspaceImporter.segmentWorkspace(input.workspaceDir);
        return Ok(res);
      },
    }),
  );

  router.post(
    '/workspace/import',
    handle({
      input: workspaceImportInput,
      requireAuth: true,
      execute: async ({ input, actor }) => {
        const author = requireAuthor(actor);
        if (!author.ok) return author;
        if (!deps.workspaceImporter) {
          return Err(Errors.internal('workspace.importer_unavailable', 'Workspace importer is not enabled.'));
        }
        const res = await deps.workspaceImporter.importFromWorkspace(input.workspaceDir, {
          dryRun: input.dryRun,
          syncAssets: input.syncAssets,
          actorKey: author.value.actorKey,
        });
        return Ok(res);
      },
    }),
  );

  router.get('/assets/:assetKey/stream', async (req, res, next) => {
    try {
      if (!deps.contentAsset) {
        res.status(501).json(Errors.internal('asset.storage_not_configured', 'Asset service not configured.'));
        return;
      }
      const assetKey = req.params.assetKey;
      const rangeHeader = req.headers.range;

      let range: { start?: number; end?: number } | undefined;
      if (rangeHeader && rangeHeader.startsWith('bytes=')) {
        const parts = rangeHeader.replace('bytes=', '').split('-');
        range = {
          start: parts[0] ? parseInt(parts[0], 10) : undefined,
          end: parts[1] ? parseInt(parts[1], 10) : undefined,
        };
      }

      const streamResult = await deps.contentAsset.getAssetStream(assetKey, range);
      if (!streamResult) {
        res.status(404).json(Errors.notFound('asset.not_found', `Asset not found: ${assetKey}`));
        return;
      }

      const { stream, asset } = streamResult;
      res.setHeader('Content-Type', asset.mimeType);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('ETag', `"${asset.sha256}"`);
      res.setHeader('Cache-Control', 'public, max-age=86400');

      if (range && range.start !== undefined) {
        const start = range.start;
        const end = range.end !== undefined ? range.end : asset.sizeBytes - 1;
        const chunksize = end - start + 1;
        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${asset.sizeBytes}`);
        res.setHeader('Content-Length', chunksize);
      } else {
        res.setHeader('Content-Length', asset.sizeBytes);
      }

      stream.pipe(res);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
