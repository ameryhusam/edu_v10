/**
 * Ports owned by the Content context.
 *
 * Content is the only context that WRITES the content tree. Every other
 * context reads it through its own narrow read port (see
 * `learning/application/ports.ts`), which is why those ports have no write
 * methods: the absence is the enforcement.
 *
 * The repository interface is deliberately shaped around authoring operations
 * rather than tables. There is no generic `update(table, id, data)` here,
 * because a generic write is exactly how a lifecycle guard gets bypassed.
 */

import type { PublicationState } from '../domain/publication.js';
import type { ContentNodeKind } from '../domain/authoring.js';
import type { TextbookStructure } from '../domain/structural-validation.js';
import type { ContentAssetType, ContentAssetScope } from '../domain/assets.js';
import type { ContentAssetExport } from '../domain/export-profile.js';

/** Identity and lifecycle facts about a node, plus its owning textbook. */
export interface NodeContext {
  readonly kind: ContentNodeKind;
  readonly key: string;
  readonly slug: string;
  /** The textbook this node belongs to — a textbook is its own owner. */
  readonly textbookKey: string;
  /** The owning textbook's status. Lifecycle is decided by the book, not the node. */
  readonly textbookStatus: PublicationState;
}

export interface CreatedNode {
  readonly kind: ContentNodeKind;
  readonly key: string;
  readonly slug: string;
  readonly name: string;
  readonly orderIndex: number;
}

export interface ContentRepository {
  /** Resolve any node by key, or null. Used before every write. */
  findNode(kind: ContentNodeKind, key: string): Promise<NodeContext | null>;

  /** Does a sibling already own this slug? Keys must be unique per parent. */
  slugTaken(kind: ContentNodeKind, parentKey: string, slug: string): Promise<boolean>;

  /**
   * Next free orderIndex among a parent's children.
   *
   * Appending is the only implicit placement. Anything else is an explicit
   * reorder, so that a create can never silently renumber existing siblings.
   */
  nextOrderIndex(kind: ContentNodeKind, parentKey: string): Promise<number>;

  /**
   * Resolve the three business codes a textbook is keyed by.
   *
   * Takes codes, not UUIDs: `MATH`, `G07`, `2026-2027-T01` are authored values
   * a human can type, and they are what an importer will carry. Returns the
   * ordinals too, because the key is built from them and the caller must not
   * have to parse `G07` itself.
   */
  resolveTextbookCoordinates(input: {
    subjectKey: string;
    gradeKey: string;
    termKey: string;
  }): Promise<{
    subject: { id: string; key: string; name: string } | null;
    grade: { id: string; key: string; ordinal: number; name: string } | null;
    term: { id: string; key: string; ordinal: number; name: string } | null;
  }>;

  /** True when a textbook with this key already exists. */
  textbookExists(key: string): Promise<boolean>;

  createTextbook(input: {
    key: string;
    subjectId: string;
    gradeId: string;
    termId: string;
    title: string;
    edition: string;
    description?: string | null;
    issuer?: string | null;
    isbn?: string | null;
    publishYear?: number | null;
    totalPages?: number | null;
  }): Promise<{ key: string; title: string; edition: string; status: string }>;

  createUnit(input: {
    textbookKey: string;
    parentUnitKey?: string | null;
    key: string;
    slug: string;
    name: string;
    orderIndex: number;
    startPage?: number | null;
    endPage?: number | null;
    sourceRef?: string | null;
  }): Promise<CreatedNode>;

  createLesson(input: {
    unitKey: string;
    key: string;
    slug: string;
    name: string;
    description?: string | null;
    orderIndex: number;
    estimatedMins?: number | null;
    startPage?: number | null;
    endPage?: number | null;
    sourceRef?: string | null;
  }): Promise<CreatedNode>;

  createConcept(input: {
    lessonKey: string;
    key: string;
    slug: string;
    name: string;
    description?: string | null;
    orderIndex: number;
    difficulty?: number;
    importance?: number;
    masteryThreshold?: number;
    isCore?: boolean;
    pageNumber?: number | null;
    sourceRef?: string | null;
    nameEn?: string | null;
    bloomsLevel?: string | null;
  }): Promise<CreatedNode>;

  /**
   * Attach a named misconception to a concept.
   *
   * Returns `null` when the key already exists. Import must be idempotent, and
   * "already there" is a normal outcome of re-running a package, not a
   * failure — so it is reported as absence rather than thrown.
   */
  createMisconception(input: {
    conceptKey: string;
    key: string;
    slug: string;
    name: string;
    description: string;
    remediation?: string | null;
  }): Promise<{ key: string } | null>;

  /** Same idempotency contract as `createMisconception`. */
  createLearningResource(input: {
    textbookKey?: string | null;
    lessonKey?: string | null;
    conceptKey?: string | null;
    key: string;
    slug: string;
    kind: string;
    title: string;
    body?: string | null;
    url?: string | null;
    orderIndex?: number;
    pageStart?: number | null;
    pageEnd?: number | null;
    estimatedMins?: number | null;
  }): Promise<{ key: string } | null>;

  /** Patch already-validated fields. Never receives `slug` or `key`. */
  updateNode(
    kind: ContentNodeKind,
    key: string,
    fields: Readonly<Record<string, unknown>>,
  ): Promise<void>;

  /** Sibling keys of a parent's children, in current order. */
  siblingKeys(kind: ContentNodeKind, parentKey: string): Promise<string[]>;

  /**
   * Apply a complete sibling ordering in one transaction.
   *
   * Atomic because `@@unique([parentId, orderIndex])` makes a partially
   * applied reorder a constraint violation, and a half-reordered book is
   * worse than a failed request.
   */
  reorderSiblings(
    kind: ContentNodeKind,
    parentKey: string,
    orderedKeys: readonly string[],
  ): Promise<void>;

  /** Everything `validateStructure` needs, in one read. */
  loadStructure(textbookKey: string): Promise<TextbookStructure | null>;

  /** Current lifecycle state of a textbook, or null if it does not exist. */
  textbookStatus(textbookKey: string): Promise<PublicationState | null>;

  /** Persist a lifecycle transition. `publishedAt` is set on first activation. */
  setTextbookStatus(
    textbookKey: string,
    status: PublicationState,
    publishedAt?: Date,
  ): Promise<void>;

  linkPrerequisite(input: {
    conceptKey: string;
    prerequisiteKey: string;
    strength: number;
    requiredMastery: number;
  }): Promise<void>;

  unlinkPrerequisite(conceptKey: string, prerequisiteKey: string): Promise<void>;

  /** Existing edges for a textbook — needed to test a new edge for cycles. */
  prerequisitesInTextbook(textbookKey: string): Promise<
    Array<{
      conceptKey: string;
      prerequisiteKey: string;
      strength: number;
      requiredMastery: number;
    }>
  >;
}

/**
 * Records who changed what.
 *
 * Making content available has consequences for every learner using the book,
 * so it is not enough to know the current state — someone will ask who
 * released it inside Edu7. (Not who approved the textbook: that decision is
 * the publisher's and was made before the book reached this system.)
 * Best-effort: an audit miss must not fail an author's write.
 */
/**
 * Reads a whole textbook for export.
 *
 * Deliberately separate from `loadStructure`, which returns keys, order and
 * thresholds but no names, slugs or descriptions: it exists to validate
 * publication readiness, and widening it would turn a validation query into a
 * reporting query that readiness checks then pay for. Two different questions,
 * two different reads.
 */
export interface ContentExportReader {
  /** Everything a content package needs, or null when the book is unknown. */
  readExportable(textbookKey: string): Promise<ExportableTextbook | null>;
}

/** Row shapes carrying business identifiers, not ids. */
export interface ExportableTextbook {
  readonly textbook: {
    key: string;
    subjectKey: string;
    gradeKey: string;
    termKey: string;
    title: string;
    edition: string;
    description: string | null;
    issuer: string | null;
    isbn: string | null;
    publishYear: number | null;
    totalPages: number | null;
    status: string;
  };
  readonly units: ReadonlyArray<{
    key: string;
    slug: string;
    parentUnitSlug: string | null;
    name: string;
    orderIndex: number;
    startPage: number | null;
    endPage: number | null;
    isActive: boolean;
    sourceRef: string | null;
  }>;
  readonly lessons: ReadonlyArray<{
    key: string;
    slug: string;
    unitSlug: string;
    name: string;
    description: string | null;
    orderIndex: number;
    estimatedMins: number | null;
    startPage: number | null;
    endPage: number | null;
    isActive: boolean;
    sourceRef: string | null;
  }>;
  readonly concepts: ReadonlyArray<{
    key: string;
    slug: string;
    lessonSlug: string;
    unitSlug: string;
    name: string;
    description: string | null;
    orderIndex: number;
    difficulty: number;
    importance: number;
    masteryThreshold: number;
    isCore: boolean;
    isActive: boolean;
    pageNumber: number | null;
    sourceRef: string | null;
    nameEn: string | null;
    bloomsLevel: string | null;
  }>;
  readonly prerequisites: ReadonlyArray<{
    conceptKey: string;
    prerequisiteKey: string;
    strength: number;
    requiredMastery: number;
  }>;
  readonly misconceptions: ReadonlyArray<{
    slug: string;
    unitSlug: string;
    lessonSlug: string;
    conceptSlug: string;
    name: string;
    description: string;
    correction: string | null;
  }>;
  readonly learningResources: ReadonlyArray<{
    slug: string;
    scope?: 'TEXTBOOK' | 'LESSON' | 'CONCEPT';
    unitSlug?: string | null;
    lessonSlug?: string | null;
    conceptSlug?: string | null;
    kind: string;
    title: string;
    body: string | null;
    url: string | null;
    orderIndex: number;
    pageStart: number | null;
    pageEnd: number | null;
    estimatedMins: number | null;
  }>;
  readonly assets?: ReadonlyArray<ContentAssetExport>;
  readonly questions: ReadonlyArray<{
    key: string;
    unitSlug: string;
    lessonSlug: string;
    type: string;
    text: string;
    hint: string | null;
    explanation: string | null;
    points: number;
    difficulty01: number;
    origin: string;
    textbookRole: string | null;
    sourceRef: string | null;
    choices: ReadonlyArray<{
      /** The author's local handle, recovered from order, not the stored uuid. */
      id: string;
      text: string;
      orderIndex: number;
      misconceptionKey: string | null;
      feedback: string | null;
    }>;
    answerKey: {
      correctChoiceIds: readonly string[];
      acceptedTexts: readonly string[];
      numericMin: number | null;
      numericMax: number | null;
      caseSensitive: boolean;
      allowPartialCredit: boolean;
    };
    concepts: ReadonlyArray<{
      unitSlug: string;
      lessonSlug: string;
      conceptSlug: string;
      weight: number;
      isPrimary: boolean;
    }>;
    status: string;
  }>;
}

export interface ContentAuditWriter {
  record(entry: {
    actorKey: string;
    action: string;
    targetKey: string;
    details?: Readonly<Record<string, unknown>>;
  }): Promise<void>;
}

/**
 * Announces that concepts have stopped being teachable.
 *
 * Content does not know, and must not know, who cares. What it knows is that
 * archiving a book retires its concepts, and that anything downstream holding
 * a claim about those concepts is now holding a claim about nothing.
 *
 * The concrete case is remediation: a learner with an open gap on an archived
 * concept would otherwise be chased forever for a lesson that no longer
 * exists, and the gap can never close on evidence because no evidence can be
 * produced. Closing it as RESOLVED would be a lie — the learner never learned
 * it — so the listener supersedes instead.
 *
 * Best-effort by the same argument as the audit writer: a downstream failure
 * must not prevent an editor from archiving a book.
 */
export interface ConceptRetirementNotifier {
  conceptsRetired(conceptKeys: readonly string[]): Promise<void>;
}

// ─── Textbook administration ───────────────────────────────────────────────
//
// The admin surface over the textbook catalogue and its deployment to schools.
// Reads assemble what an administrator needs to triage the catalogue; writes
// record deployment facts (adoptions) that the seed was previously the only
// writer of — which made learner entitlement depend on a seed script.

/** One textbook as the administration browses it. */
export interface TextbookSummary {
  readonly key: string;
  readonly title: string;
  readonly subjectKey: string;
  readonly subjectName: string;
  readonly gradeKey: string;
  readonly gradeName: string;
  readonly termKey: string;
  readonly termName: string;
  readonly edition: string;
  readonly status: string;
  /** How many schools have adopted this book (any year). */
  readonly adoptionCount: number;
  readonly unitCount: number;
  readonly questionCount: number;
  readonly updatedAt: Date;
}

export interface TextbookListQuery {
  /** Matches title, case-insensitive substring. */
  readonly search?: string | undefined;
  readonly subjectKey?: string | undefined;
  readonly gradeKey?: string | undefined;
  readonly termKey?: string | undefined;
  readonly status?: string | undefined;
  readonly limit: number;
  readonly offset: number;
}

export interface TextbookListPage {
  readonly rows: readonly TextbookSummary[];
  readonly total: number;
}

/**
 * An adoption addressed by business keys. The model's uniqueness is the
 * triple (textbook, school, academicYear) — that triple IS the adoption's
 * identity, which is why the API names it rather than exposing a uuid.
 */
export interface AdoptionRow {
  readonly textbookKey: string;
  readonly textbookTitle: string;
  readonly textbookStatus: string;
  readonly schoolKey: string;
  readonly schoolName: string;
  readonly academicYearKey: string;
  readonly adoptedAt: Date;
}

export interface AdoptionListQuery {
  readonly textbookKey?: string | undefined;
  readonly schoolKey?: string | undefined;
  readonly academicYearKey?: string | undefined;
  readonly limit: number;
  readonly offset: number;
}

export interface AdoptionListPage {
  readonly rows: readonly AdoptionRow[];
  readonly total: number;
}

/** A unit with its lessons, for the content-setup browse. */
export interface OutlineUnit {
  readonly key: string;
  readonly name: string;
  readonly orderIndex: number;
  readonly lessons: ReadonlyArray<{
    readonly key: string;
    readonly name: string;
    readonly orderIndex: number;
    readonly conceptCount: number;
    readonly concepts?: ReadonlyArray<{ readonly key: string; readonly name: string; readonly orderIndex: number }>;
    readonly resourceCount: number;
    readonly estimatedMins: number | null;
  }>;
}

/** The materials a lesson offers, with their real kinds. */
export interface LessonMaterial {
  readonly key: string;
  readonly kind: string;
  readonly title: string;
  readonly url: string | null;
  readonly body: string | null;
  readonly estimatedMins: number | null;
  readonly scope: 'LESSON' | 'CONCEPT';
  readonly conceptKey: string | null;
  readonly conceptName: string | null;
}

export interface GradeSubjectSeed {
  readonly gradeKey: string;
  readonly gradeName: string;
  readonly subjectKey: string;
  readonly subjectName: string;
}

export interface TextbookCoordinateMatch {
  readonly key: string;
  readonly title: string;
  readonly edition: string;
}

/**
 * One concept's authoring detail: its misconceptions and its prerequisite
 * edges in both directions.
 *
 * This is a read model built specifically for the concept detail drawer, not
 * a general-purpose concept fetch — the same "one screen, one shape" rule
 * `OutlineUnit` follows. `requires`/`requiredBy` are separated because a
 * prerequisite edge is directional: an author linking a new prerequisite
 * needs to see both what this concept still needs and what already depends
 * on it, or a cycle looks the same as a normal edge until the write is
 * refused.
 */
export interface ConceptDetail {
  readonly key: string;
  readonly name: string;
  readonly lessonKey: string;
  readonly lessonName: string;
  readonly textbookKey: string;
  readonly textbookStatus: PublicationState;
  readonly misconceptions: ReadonlyArray<{
    readonly key: string;
    readonly name: string;
    readonly description: string;
    readonly remediation: string | null;
  }>;
  readonly requires: ReadonlyArray<{
    readonly conceptKey: string;
    readonly conceptName: string;
    readonly textbookKey: string;
    readonly textbookTitle: string;
    readonly strength: number;
    readonly requiredMastery: number;
  }>;
  readonly requiredBy: ReadonlyArray<{
    readonly conceptKey: string;
    readonly conceptName: string;
    readonly strength: number;
    readonly requiredMastery: number;
  }>;
}

export interface TextbookAdministrationRepository {
  listTextbooks(query: TextbookListQuery): Promise<TextbookListPage>;
  /** Exact lookup by the textbook identity coordinates; avoids paged-list guessing. */
  findTextbookByCoordinates(input: {
    subjectKey: string;
    gradeKey: string;
    termKey: string;
    edition: string;
  }): Promise<TextbookCoordinateMatch | null>;
  /** Active subjects the catalogue says this grade teaches. */
  activeGradeSubjects(gradeKey: string): Promise<readonly GradeSubjectSeed[] | null>;
  /**
   * Every textbook that exists for a grade, across every subject and term
   * (or one term when given). Feeds bulk accreditation: naming a grade means
   * naming every book it has, not one coordinate at a time.
   */
  textbooksForGrade(input: {
    gradeKey: string;
    termKey?: string | undefined;
  }): Promise<readonly TextbookCoordinateMatch[]>;
  listAdoptions(query: AdoptionListQuery): Promise<AdoptionListPage>;
  /** The unit→lesson outline of a book, or null when the book is unknown. */
  textbookOutline(textbookKey: string): Promise<OutlineUnit[] | null>;
  /** One lesson's materials. Null when the lesson is unknown. */
  lessonMaterials(lessonKey: string): Promise<LessonMaterial[] | null>;
  /** A concept's misconceptions and prerequisite edges. Null when unknown. */
  conceptDetail(conceptKey: string): Promise<ConceptDetail | null>;
  /** Null when the textbook, school or academic year does not exist. */
  findAdoption(input: {
    textbookKey: string;
    schoolKey: string;
    academicYearKey: string;
  }): Promise<AdoptionRow | null>;
  createAdoption(input: {
    textbookKey: string;
    schoolKey: string;
    academicYearKey: string;
  }): Promise<AdoptionRow>;
  deleteAdoption(input: {
    textbookKey: string;
    schoolKey: string;
    academicYearKey: string;
  }): Promise<void>;
  /** Coordinate existence, resolved by business key. */
  textbookExists(textbookKey: string): Promise<boolean>;
  schoolExists(schoolKey: string): Promise<boolean>;
  academicYearExists(academicYearKey: string): Promise<boolean>;
}

export interface ContentAssetRecord {
  readonly id: string;
  readonly key: string;
  readonly assetType: ContentAssetType;
  readonly originalName: string;
  readonly relativePath: string;
  readonly storageKey: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly version: number;
  readonly isActive: boolean;
  readonly scope: ContentAssetScope;
  readonly textbookId: string;
  readonly textbookKey: string;
  readonly unitId?: string | null;
  readonly unitKey?: string | null;
  readonly lessonId?: string | null;
  readonly lessonKey?: string | null;
  readonly conceptId?: string | null;
  readonly conceptKey?: string | null;
  readonly pageStart?: number | null;
  readonly pageEnd?: number | null;
  readonly title?: string | null;
  readonly altText?: string | null;
  readonly caption?: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CreateAssetInput {
  readonly key: string;
  readonly assetType: ContentAssetType;
  readonly originalName: string;
  readonly relativePath: string;
  readonly storageKey: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly version?: number;
  readonly scope: ContentAssetScope;
  readonly textbookKey: string;
  readonly unitKey?: string | null;
  readonly lessonKey?: string | null;
  readonly conceptKey?: string | null;
  readonly pageStart?: number | null;
  readonly pageEnd?: number | null;
  readonly title?: string | null;
  readonly altText?: string | null;
  readonly caption?: string | null;
}

export interface ContentAssetRepository {
  findAssetByKey(key: string): Promise<ContentAssetRecord | null>;
  findAssetByStorageKey(storageKey: string): Promise<ContentAssetRecord | null>;
  findAssetByChecksum(textbookKey: string, sha256: string): Promise<ContentAssetRecord | null>;
  findAssetByRelativePath(textbookKey: string, relativePath: string): Promise<ContentAssetRecord | null>;
  listAssetsForTextbook(
    textbookKey: string,
    options?: { scope?: ContentAssetScope; assetType?: ContentAssetType },
  ): Promise<readonly ContentAssetRecord[]>;
  listAssetsForNode(input: {
    scope: ContentAssetScope;
    nodeKey: string;
  }): Promise<readonly ContentAssetRecord[]>;
  createAsset(input: CreateAssetInput): Promise<ContentAssetRecord>;
  updateAssetMetadata(key: string, input: Partial<CreateAssetInput>): Promise<ContentAssetRecord>;
  deactivateAsset(key: string): Promise<void>;
}

export interface ContentStorage {
  exists(storageKey: string): Promise<boolean>;
  readStream(storageKey: string, range?: { start?: number; end?: number }): Promise<NodeJS.ReadableStream | null>;
  writeStream(
    storageKey: string,
    stream: NodeJS.ReadableStream,
    mimeType: string,
  ): Promise<{ sizeBytes: number; sha256: string }>;
  writeBuffer(
    storageKey: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<{ sizeBytes: number; sha256: string }>;
  getMetadata(
    storageKey: string,
  ): Promise<{ sizeBytes: number; mimeType: string; updatedAt: Date } | null>;
  delete(storageKey: string): Promise<void>;
  getPublicUrl(storageKey: string): Promise<string | null>;
}

