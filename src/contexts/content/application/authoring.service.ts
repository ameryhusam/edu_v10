/**
 * Authoring — create, edit, reorder, and link content.
 *
 * Orchestration only. Every rule it applies is imported from `domain/`:
 * lifecycle from `publication.ts`, slug and field rules from `authoring.ts`,
 * cycle detection from the learning graph. This service decides what to load
 * and in what order, never what is allowed.
 *
 * One invariant runs through all of it: **the owning textbook's status decides
 * whether a write is permitted**, not the node's own flags. Legacy asked the
 * question at fifteen separate call sites and answered it slightly differently
 * in several of them. Here every write passes through `assertWritable`.
 */

import { Errors } from '../../../shared/kernel/errors.js';
import { Err, Ok, type Result } from '../../../shared/kernel/result.js';
import {
  conceptKey as buildConceptKey,
  misconceptionKey as buildMisconceptionKey,
  learningResourceKey as buildResourceKey,
  lessonResourceKey as buildLessonResourceKey,
  lessonKey as buildLessonKey,
  textbookResourceKey as buildTextbookResourceKey,
  textbookKey as buildTextbookKey,
  unitKey as buildUnitKey,
  type ConceptKey,
  type LessonKey,
  type TextbookKey,
  type UnitKey,
} from '../../../shared/kernel/identifiers.js';
import { detectCycles } from '../../learning/domain/prerequisite-graph.js';
import { IMPORTABLE_RESOURCE_KINDS } from '../domain/export-profile.js';
import {
  checkReorder,
  checkSlugImmutable,
  checkTitleDoesNotRepeatPlacement,
  checkWritableFields,
  resolveSlugAtCreation,
  type ContentNodeKind,
} from '../domain/authoring.js';
import { checkEditable, isStructurallyLocked, type PublicationState } from '../domain/publication.js';
import type { ContentAuditWriter, ContentRepository, CreatedNode, NodeContext } from './ports.js';

export interface AuthorContext {
  /** For the audit trail. Authorisation itself is decided at the HTTP boundary. */
  readonly actorKey: string;
}

export class ContentAuthoringService {
  constructor(
    private readonly repo: ContentRepository,
    private readonly audit?: ContentAuditWriter,
  ) {}

  // ── Guards ────────────────────────────────────────────────────────────────

  /**
   * Load a node and refuse the write if its book is locked.
   *
   * `fields` names what the caller intends to change, so a presentational fix
   * to a published book is allowed while a structural one is not (§1.3 of the
   * gate). Structural operations pass no fields and are refused outright.
   */
  private async assertWritable(
    kind: ContentNodeKind,
    key: string,
    fields: readonly string[] = [],
  ): Promise<Result<NodeContext>> {
    const node = await this.repo.findNode(kind, key);
    if (!node) {
      return Err(Errors.notFound('content.node_not_found', `No ${kind} with this key.`, { key }));
    }

    if (!isStructurallyLocked(node.textbookStatus)) return Ok(node);

    const refused = fields.length > 0 ? checkEditable(node.textbookStatus, fields) : ['structure'];
    if (refused.length === 0) return Ok(node);

    return Err(
      Errors.conflict(
        'content.textbook_locked',
        `This textbook is ${node.textbookStatus.toLowerCase()}; its structure is frozen so that existing mastery stays interpretable.`,
        { textbookKey: node.textbookKey, status: node.textbookStatus, refused },
      ),
    );
  }

  /** A parent must exist and its book must be unlocked before adding a child. */
  private async assertParentAcceptsChildren(
    kind: ContentNodeKind,
    parentKey: string,
  ): Promise<Result<NodeContext>> {
    return this.assertWritable(kind, parentKey);
  }

  /** Support resources may be added to an active book; only archives refuse. */
  private async assertResourceTargetExists(
    kind: ContentNodeKind,
    key: string,
  ): Promise<Result<NodeContext>> {
    const node = await this.repo.findNode(kind, key);
    if (!node) {
      return Err(Errors.notFound('content.node_not_found', `No ${kind} with this key.`, { key }));
    }
    if (node.textbookStatus === 'ARCHIVED') {
      return Err(
        Errors.conflict('content.textbook_archived', 'This textbook is archived.', {
          textbookKey: node.textbookKey,
          status: node.textbookStatus,
        }),
      );
    }
    return Ok(node);
  }

  // ── Create ────────────────────────────────────────────────────────────────

  /**
   * Create a textbook.
   *
   * This was the last content entity with no write path in the application:
   * the seed and a raw-SQL test helper were the only things that had ever
   * inserted one, which meant the first step of every authoring workflow
   * happened outside the system that owns authoring.
   *
   * The caller supplies business codes, never ids and never a key. `MATH`,
   * `G07` and `2026-2027-T01` are values a human types and an importer
   * carries; the key is derived from the subject, grade, term ordinal and
   * printed edition, exactly as `KEY-IDENTITY-AUDIT.md` requires. A caller
   * cannot name a textbook, only describe it.
   */
  async createTextbook(
    ctx: AuthorContext,
    input: {
      subjectKey: string;
      gradeKey: string;
      termKey: string;
      title: string;
      edition: string;
      description?: string | null;
      issuer?: string | null;
      isbn?: string | null;
      publishYear?: number | null;
      totalPages?: number | null;
    },
  ): Promise<Result<{ key: string; title: string; edition: string; status: string }>> {
    const title = input.title?.trim() ?? '';
    if (!title) {
      return Err(
        Errors.validation('content.title_required', 'A textbook needs a title.', {
          subjectKey: input.subjectKey,
        }),
      );
    }

    const resolved = await this.repo.resolveTextbookCoordinates({
      subjectKey: input.subjectKey,
      gradeKey: input.gradeKey,
      termKey: input.termKey,
    });

    // Each missing reference is named. "Invalid input" would make an importer
    // report a whole row as bad when one cell is wrong.
    const missing: string[] = [];
    if (!resolved.subject) missing.push('subjectKey');
    if (!resolved.grade) missing.push('gradeKey');
    if (!resolved.term) missing.push('termKey');
    if (missing.length > 0) {
      return Err(
        Errors.notFound('content.coordinate_not_found', 'One or more references do not exist.', {
          missing,
          subjectKey: input.subjectKey,
          gradeKey: input.gradeKey,
          termKey: input.termKey,
        }),
      );
    }

    const subject = resolved.subject!;
    const grade = resolved.grade!;
    const term = resolved.term!;

    // §2.2 of the production plan: every screen that shows a textbook appends
    // `gradeName`/`termName` after `title` unconditionally, so a hand-typed
    // title that already contains "الصف السابع الفصل الأول" doubles it on
    // screen. Refusing it here, once, at the single write path, is cheaper
    // than trying to clean it up in eight display components later.
    const placementCheck = checkTitleDoesNotRepeatPlacement(title, {
      gradeName: grade.name,
      termName: term.name,
    });
    if (!placementCheck.ok) return placementCheck;

    // The key is derived, never supplied. Edition is part of identity: a new
    // printing is a new textbook, not a revision of this one.
    const key = buildTextbookKey({
      subject: subject.key,
      grade: grade.ordinal,
      term: term.ordinal,
      edition: input.edition,
    });
    if (!key.ok) return key;

    if (await this.repo.textbookExists(key.value)) {
      return Err(
        Errors.conflict(
          'content.textbook_exists',
          'A textbook already exists for this subject, grade, term and edition.',
          { textbookKey: key.value },
        ),
      );
    }

    const created = await this.repo.createTextbook({
      key: key.value,
      subjectId: subject.id,
      gradeId: grade.id,
      termId: term.id,
      title,
      edition: input.edition,
      description: input.description ?? null,
      issuer: input.issuer ?? null,
      isbn: input.isbn ?? null,
      publishYear: input.publishYear ?? null,
      totalPages: input.totalPages ?? null,
    });

    await this.log(ctx, 'content.textbook_created', created.key);
    return Ok(created);
  }

  async createUnit(
    ctx: AuthorContext,
    input: {
      textbookKey: string;
      parentUnitKey?: string | null;
      name: string;
      slug?: string | null;
      startPage?: number | null;
      endPage?: number | null;
      sourceRef?: string | null;
    },
  ): Promise<Result<CreatedNode>> {
    const parentKind: ContentNodeKind = input.parentUnitKey ? 'unit' : 'textbook';
    const parentKey = input.parentUnitKey ?? input.textbookKey;

    const parent = await this.assertParentAcceptsChildren(parentKind, parentKey);
    if (!parent.ok) return parent;

    const slug = resolveSlugAtCreation(input.name, input.slug);
    if (!slug.ok) return slug;

    // A nested unit still keys off the textbook: nesting is presentation, and
    // a key that encoded depth would change if a section were promoted.
    const key = buildUnitKey(input.textbookKey as TextbookKey, slug.value);
    if (!key.ok) return key;

    const taken = await this.repo.slugTaken('unit', parentKey, slug.value);
    if (taken) return slugConflict('unit', slug.value, parentKey);

    const orderIndex = await this.repo.nextOrderIndex('unit', parentKey);
    const created = await this.repo.createUnit({
      textbookKey: input.textbookKey,
      parentUnitKey: input.parentUnitKey ?? null,
      key: key.value,
      slug: slug.value,
      name: input.name,
      orderIndex,
      startPage: input.startPage ?? null,
      endPage: input.endPage ?? null,
      sourceRef: input.sourceRef ?? null,
    });

    await this.log(ctx, 'content.unit_created', created.key);
    return Ok(created);
  }

  async createLesson(
    ctx: AuthorContext,
    input: {
      unitKey: string;
      name: string;
      slug?: string | null;
      description?: string | null;
      estimatedMins?: number | null;
      startPage?: number | null;
      endPage?: number | null;
      sourceRef?: string | null;
    },
  ): Promise<Result<CreatedNode>> {
    const parent = await this.assertParentAcceptsChildren('unit', input.unitKey);
    if (!parent.ok) return parent;

    const slug = resolveSlugAtCreation(input.name, input.slug);
    if (!slug.ok) return slug;

    const key = buildLessonKey(input.unitKey as UnitKey, slug.value);
    if (!key.ok) return key;

    if (await this.repo.slugTaken('lesson', input.unitKey, slug.value)) {
      return slugConflict('lesson', slug.value, input.unitKey);
    }

    const orderIndex = await this.repo.nextOrderIndex('lesson', input.unitKey);
    const created = await this.repo.createLesson({
      unitKey: input.unitKey,
      key: key.value,
      slug: slug.value,
      name: input.name,
      description: input.description ?? null,
      orderIndex,
      estimatedMins: input.estimatedMins ?? null,
      startPage: input.startPage ?? null,
      endPage: input.endPage ?? null,
      sourceRef: input.sourceRef ?? null,
    });

    await this.log(ctx, 'content.lesson_created', created.key);
    return Ok(created);
  }

  async createConcept(
    ctx: AuthorContext,
    input: {
      lessonKey: string;
      name: string;
      slug?: string | null;
      description?: string | null;
      difficulty?: number;
      importance?: number;
      masteryThreshold?: number;
      isCore?: boolean;
      pageNumber?: number | null;
      sourceRef?: string | null;
      nameEn?: string | null;
      bloomsLevel?: string | null;
    },
  ): Promise<Result<CreatedNode>> {
    const parent = await this.assertParentAcceptsChildren('lesson', input.lessonKey);
    if (!parent.ok) return parent;

    const slug = resolveSlugAtCreation(input.name, input.slug);
    if (!slug.ok) return slug;

    const key = buildConceptKey(input.lessonKey as LessonKey, slug.value);
    if (!key.ok) return key;

    if (await this.repo.slugTaken('concept', input.lessonKey, slug.value)) {
      return slugConflict('concept', slug.value, input.lessonKey);
    }

    const ranges = checkConceptRanges(input);
    if (!ranges.ok) return ranges;

    const orderIndex = await this.repo.nextOrderIndex('concept', input.lessonKey);
    const created = await this.repo.createConcept({
      lessonKey: input.lessonKey,
      key: key.value,
      slug: slug.value,
      name: input.name,
      description: input.description ?? null,
      orderIndex,
      ...(input.difficulty != null ? { difficulty: input.difficulty } : {}),
      ...(input.importance != null ? { importance: input.importance } : {}),
      ...(input.masteryThreshold != null ? { masteryThreshold: input.masteryThreshold } : {}),
      ...(input.isCore != null ? { isCore: input.isCore } : {}),
      pageNumber: input.pageNumber ?? null,
      sourceRef: input.sourceRef ?? null,
      nameEn: input.nameEn ?? null,
      bloomsLevel: input.bloomsLevel ?? null,
    });

    await this.log(ctx, 'content.concept_created', created.key);
    return Ok(created);
  }

  /**
   * Does this textbook exist?
   *
   * Exposed so the importer can refuse a package that targets a missing book
   * without reaching past this service into the repository. The importer must
   * go through the canonical write path, and that rule is worth nothing if it
   * takes a private read path.
   */
  async textbookExists(key: string): Promise<boolean> {
    return this.repo.textbookExists(key);
  }

  // ── Concept attachments ───────────────────────────────────────────────────

  /**
   * Name an error learners actually make on this concept.
   *
   * Goes through the same write lock as structure: a misconception is what a
   * distractor is diagnosed against and what a remediation episode is opened
   * on, so adding one to a published book changes how existing evidence is
   * interpreted.
   *
   * Returns the existing key unchanged when it is already present. Re-running
   * an import must not fail and must not duplicate, and the derived key makes
   * "same concept, same slug" mean "same misconception".
   */
  async createMisconception(
    ctx: AuthorContext,
    input: {
      conceptKey: string;
      slug: string;
      name: string;
      description: string;
      correction?: string | null;
    },
  ): Promise<Result<{ key: string; created: boolean }>> {
    const parent = await this.assertParentAcceptsChildren('concept', input.conceptKey);
    if (!parent.ok) return parent;

    const slug = resolveSlugAtCreation(input.name, input.slug);
    if (!slug.ok) return slug;

    const key = buildMisconceptionKey(input.conceptKey as ConceptKey, slug.value);
    if (!key.ok) return key;

    const created = await this.repo.createMisconception({
      conceptKey: input.conceptKey,
      key: key.value,
      slug: slug.value,
      name: input.name,
      description: input.description,
      remediation: input.correction ?? null,
    });

    if (!created) return Ok({ key: key.value, created: false });

    await this.log(ctx, 'content.misconception_created', key.value);
    return Ok({ key: key.value, created: true });
  }

  /**
   * Attach supporting material to a textbook, lesson or concept.
   *
   * The schema permits all three targets and the content package can now carry
   * all three. The service still insists on exactly one target and one derived
   * key, so import, API and UI writes all pass through the same lifecycle and
   * identity rules.
   */
  async createLearningResource(
    ctx: AuthorContext,
    input: {
      textbookKey?: string | null;
      lessonKey?: string | null;
      conceptKey?: string | null;
      slug: string;
      kind: string;
      title: string;
      body?: string | null;
      url?: string | null;
      orderIndex?: number;
      pageStart?: number | null;
      pageEnd?: number | null;
      estimatedMins?: number | null;
    },
  ): Promise<Result<{ key: string; created: boolean }>> {
    const targets = [
      input.textbookKey ? { kind: 'textbook' as const, key: input.textbookKey } : null,
      input.lessonKey ? { kind: 'lesson' as const, key: input.lessonKey } : null,
      input.conceptKey ? { kind: 'concept' as const, key: input.conceptKey } : null,
    ].filter((target): target is { kind: 'textbook' | 'lesson' | 'concept'; key: string } => target !== null);

    if (targets.length === 0) {
      return Err(
        Errors.validation(
          'content.resource_target_required',
          'A resource must be attached to one textbook, lesson or concept.',
        ),
      );
    }
    if (targets.length > 1) {
      return Err(
        Errors.validation(
          'content.resource_target_ambiguous',
          'Choose exactly one target for a learning resource.',
          { targets: targets.map((target) => target.kind) },
        ),
      );
    }

    const target = targets[0]!;
    const parent = await this.assertResourceTargetExists(target.kind, target.key);
    if (!parent.ok) return parent;

    if (!(IMPORTABLE_RESOURCE_KINDS as readonly string[]).includes(input.kind)) {
      return Err(
        Errors.validation('content.unknown_resource_kind', 'Unknown learning resource kind.', {
          kind: input.kind,
          allowed: IMPORTABLE_RESOURCE_KINDS,
        }),
      );
    }

    if (!input.title.trim()) {
      return Err(Errors.validation('content.resource_title_required', 'A resource needs a title.'));
    }
    if (!input.url && !input.body) {
      return Err(Errors.validation('content.resource_empty', 'A resource needs either a URL or a body.'));
    }
    if (
      input.pageStart != null &&
      input.pageEnd != null &&
      input.pageStart > input.pageEnd
    ) {
      return Err(
        Errors.validation('content.resource_page_range_inverted', 'The first page is after the last page.', {
          pageStart: input.pageStart,
          pageEnd: input.pageEnd,
        }),
      );
    }

    const slug = resolveSlugAtCreation(input.title, input.slug);
    if (!slug.ok) return slug;

    const key =
      target.kind === 'concept'
        ? buildResourceKey(target.key as ConceptKey, slug.value)
        : target.kind === 'lesson'
          ? buildLessonResourceKey(target.key as LessonKey, slug.value)
          : buildTextbookResourceKey(target.key as TextbookKey, slug.value);
    if (!key.ok) return key;

    const created = await this.repo.createLearningResource({
      textbookKey: target.kind === 'textbook' ? target.key : null,
      lessonKey: target.kind === 'lesson' ? target.key : null,
      conceptKey: target.kind === 'concept' ? target.key : null,
      key: key.value,
      slug: slug.value,
      kind: input.kind,
      title: input.title,
      body: input.body ?? null,
      url: input.url ?? null,
      orderIndex: input.orderIndex ?? 0,
      pageStart: input.pageStart ?? null,
      pageEnd: input.pageEnd ?? null,
      estimatedMins: input.estimatedMins ?? null,
    });

    if (!created) return Ok({ key: key.value, created: false });

    await this.log(ctx, 'content.resource_created', key.value, { target: target.kind });
    return Ok({ key: key.value, created: true });
  }

  // ── Update ────────────────────────────────────────────────────────────────

  /**
   * Patch a node.
   *
   * Order matters. Slug immutability is checked FIRST, before the lifecycle
   * guard, so that an attempt to re-identify content is reported as what it is
   * rather than as "the book is published" — the second message would suggest
   * the rename becomes possible once the book is a draft again, which is never
   * true.
   */
  async updateNode(
    ctx: AuthorContext,
    kind: ContentNodeKind,
    key: string,
    patch: Readonly<Record<string, unknown>>,
  ): Promise<Result<{ key: string; updated: readonly string[] }>> {
    const fields = Object.keys(patch);
    if (fields.length === 0) {
      return Err(Errors.validation('content.empty_update', 'No fields to update.'));
    }

    const node = await this.repo.findNode(kind, key);
    if (!node) {
      return Err(Errors.notFound('content.node_not_found', `No ${kind} with this key.`, { key }));
    }

    if ('slug' in patch) {
      const frozen = checkSlugImmutable(node.slug, patch['slug'] as string | undefined);
      if (!frozen.ok) return frozen;
    }
    if ('key' in patch) {
      return Err(
        Errors.conflict('content.key_immutable', 'A content key is derived and cannot be set.', {
          key,
        }),
      );
    }

    // Re-PUTting an unchanged slug is accepted above, then dropped here so the
    // allow-list never sees it.
    const writable = Object.fromEntries(
      Object.entries(patch).filter(([f]) => f !== 'slug'),
    );
    const writableFields = Object.keys(writable);
    if (writableFields.length === 0) return Ok({ key, updated: [] });

    const allowed = checkWritableFields(kind, writableFields);
    if (!allowed.ok) return allowed;

    if (kind === 'concept') {
      const ranges = checkConceptRanges(writable);
      if (!ranges.ok) return ranges;
    }

    const guard = await this.assertWritable(kind, key, writableFields);
    if (!guard.ok) return guard;

    await this.repo.updateNode(kind, key, writable);
    await this.log(ctx, 'content.node_updated', key, { fields: writableFields });
    return Ok({ key, updated: writableFields });
  }

  // ── Reorder ───────────────────────────────────────────────────────────────

  /** Reordering is structural: refused outright on a published book. */
  async reorder(
    ctx: AuthorContext,
    kind: ContentNodeKind,
    parentKey: string,
    orderedKeys: readonly string[],
  ): Promise<Result<{ parentKey: string; count: number }>> {
    const parentKind: ContentNodeKind =
      kind === 'unit' ? 'textbook' : kind === 'lesson' ? 'unit' : 'lesson';

    const guard = await this.assertWritable(parentKind, parentKey);
    if (!guard.ok) return guard;

    const current = await this.repo.siblingKeys(kind, parentKey);
    const check = checkReorder(current, orderedKeys);
    if (!check.ok) return check;

    await this.repo.reorderSiblings(kind, parentKey, orderedKeys);
    await this.log(ctx, 'content.reordered', parentKey, { kind, count: orderedKeys.length });
    return Ok({ parentKey, count: orderedKeys.length });
  }

  // ── Prerequisites ─────────────────────────────────────────────────────────

  /**
   * Link a prerequisite, refusing an edge that would create a cycle.
   *
   * The check runs against the graph *including* the proposed edge, before
   * writing. Validating after the fact would leave a book that cannot be
   * traversed until someone notices.
   */
  async linkPrerequisite(
    ctx: AuthorContext,
    input: {
      conceptKey: string;
      prerequisiteKey: string;
      strength?: number;
      requiredMastery?: number;
    },
  ): Promise<Result<{ conceptKey: string; prerequisiteKey: string }>> {
    if (input.conceptKey === input.prerequisiteKey) {
      return Err(
        Errors.validation('content.self_prerequisite', 'A concept cannot be its own prerequisite.', {
          conceptKey: input.conceptKey,
        }),
      );
    }

    const strength = input.strength ?? 1;
    const requiredMastery = input.requiredMastery ?? 0.7;
    const ranges = checkUnitInterval({ strength, requiredMastery });
    if (!ranges.ok) return ranges;

    const concept = await this.assertWritable('concept', input.conceptKey);
    if (!concept.ok) return concept;

    const prerequisite = await this.repo.findNode('concept', input.prerequisiteKey);
    if (!prerequisite) {
      return Err(
        Errors.notFound('content.node_not_found', 'The prerequisite concept does not exist.', {
          key: input.prerequisiteKey,
        }),
      );
    }

    // Legacy rule LD-2: a prerequisite must live in the same book, or a
    // learner could be gated behind content they have no way to reach.
    if (prerequisite.textbookKey !== concept.value.textbookKey) {
      return Err(
        Errors.validation(
          'content.prerequisite_out_of_scope',
          'A prerequisite must belong to the same textbook.',
          {
            conceptTextbook: concept.value.textbookKey,
            prerequisiteTextbook: prerequisite.textbookKey,
          },
        ),
      );
    }

    const existing = await this.repo.prerequisitesInTextbook(concept.value.textbookKey);
    const proposed = [
      ...existing.map((e) => ({ ...e })),
      { conceptKey: input.conceptKey, prerequisiteKey: input.prerequisiteKey, strength, requiredMastery },
    ];

    const cycles = detectCycles(proposed);
    if (cycles.length > 0) {
      return Err(
        Errors.conflict(
          'content.prerequisite_cycle',
          'This link would create a prerequisite cycle, which no learner could ever enter.',
          { cycle: cycles[0] },
        ),
      );
    }

    await this.repo.linkPrerequisite({
      conceptKey: input.conceptKey,
      prerequisiteKey: input.prerequisiteKey,
      strength,
      requiredMastery,
    });
    await this.log(ctx, 'content.prerequisite_linked', input.conceptKey, {
      prerequisiteKey: input.prerequisiteKey,
    });
    return Ok({ conceptKey: input.conceptKey, prerequisiteKey: input.prerequisiteKey });
  }

  async unlinkPrerequisite(
    ctx: AuthorContext,
    conceptKey: string,
    prerequisiteKey: string,
  ): Promise<Result<{ conceptKey: string; prerequisiteKey: string }>> {
    const concept = await this.assertWritable('concept', conceptKey);
    if (!concept.ok) return concept;

    await this.repo.unlinkPrerequisite(conceptKey, prerequisiteKey);
    await this.log(ctx, 'content.prerequisite_unlinked', conceptKey, { prerequisiteKey });
    return Ok({ conceptKey, prerequisiteKey });
  }

  // ── Audit ─────────────────────────────────────────────────────────────────

  private async log(
    ctx: AuthorContext,
    action: string,
    targetKey: string,
    details?: Record<string, unknown>,
  ): Promise<void> {
    if (!this.audit) return;
    try {
      await this.audit.record({
        actorKey: ctx.actorKey,
        action,
        targetKey,
        ...(details ? { details } : {}),
      });
    } catch {
      // Best-effort. A lost audit line must not fail an author's save.
    }
  }
}

function slugConflict(kind: ContentNodeKind, slug: string, parentKey: string): Result<never> {
  return Err(
    Errors.conflict(
      'content.slug_taken',
      `Another ${kind} in this parent already uses this slug.`,
      { slug, parentKey },
    ),
  );
}

/** Shared [0,1] validation for the pedagogical weights. */
function checkUnitInterval(values: Readonly<Record<string, unknown>>): Result<void> {
  const bad = Object.entries(values).filter(
    ([, v]) => v != null && (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1),
  );
  if (bad.length === 0) return Ok(undefined);
  return Err(
    Errors.validation('content.value_out_of_range', 'These values must be between 0 and 1.', {
      fields: bad.map(([k]) => k),
    }),
  );
}

function checkConceptRanges(input: Readonly<Record<string, unknown>>): Result<void> {
  const subject: Record<string, unknown> = {};
  for (const field of ['difficulty', 'importance', 'masteryThreshold'] as const) {
    if (input[field] != null) subject[field] = input[field];
  }
  const ranged = checkUnitInterval(subject);
  if (!ranged.ok) return ranged;

  // A threshold of 0 would mark every concept mastered before any evidence.
  if (input['masteryThreshold'] != null && (input['masteryThreshold'] as number) <= 0) {
    return Err(
      Errors.validation(
        'content.mastery_threshold_out_of_range',
        'Mastery threshold must be greater than 0.',
        { masteryThreshold: input['masteryThreshold'] },
      ),
    );
  }
  return Ok(undefined);
}
