/**
 * The public contract for content exchange.
 *
 * This module is the single definition of what a textbook package looks like
 * from outside Edu7. Export writes it, import will read it, and the template
 * generator will describe it — one declaration, not three that drift.
 *
 * Three rules shape everything here, and all three come from the audit rather
 * than from taste (`NEXT-WAVE-REVIEW.md` §9.4, §10.1):
 *
 * **1. Business field names, never database columns.** A consumer never sees
 * `textbookId`, `unitId` or a UUID. They see `subjectKey`, `parentUnitSlug`,
 * `title`. Prisma can be refactored without breaking a published contract.
 *
 * **2. Keys are derived, so they are output-only.** A unit key is
 * `<textbookKey>-U-<slug>`; the domain owns it. The package therefore carries
 * `slug` as the stable identifier a human authors, and reports `key` as
 * informational. Import will read the slug and ignore the key, which is what
 * stops a spreadsheet from naming something the domain is responsible for
 * naming.
 *
 * **3. Derived state is not content.** Mastery, evidence, attempts, XP and
 * completion never appear in a package, in either direction. They are computed
 * from evidence or they are fabricated.
 */

/**
 * Bumped when the shape changes in a way a consumer must notice.
 *
 * A package declares this so an importer can refuse a format it does not
 * understand instead of silently misreading it.
 */
export const CONTENT_PROFILE_VERSION = '1.1';

/** Profile identifiers. One per exchangeable domain. */
export const CONTENT_PROFILE = 'edu7.textbook-content';

/**
 * Whether a package is the whole book or a filtered view.
 *
 * Stated explicitly because the difference matters to an importer: a FULL
 * package is a complete picture of the hierarchy, a FILTERED one is not and
 * must never be treated as authoritative about what is absent.
 */
export const EXPORT_SCOPES = ['FULL', 'FILTERED'] as const;
export type ExportScope = (typeof EXPORT_SCOPES)[number];

export interface ExportMeta {
  readonly profile: typeof CONTENT_PROFILE;
  readonly profileVersion: string;
  readonly scope: ExportScope;
  readonly exportedAt: string;
  /** Included only when the export was filtered, so the filter is auditable. */
  readonly filter?: Readonly<Record<string, unknown>>;
}

/**
 * The textbook header.
 *
 * `subjectKey`/`gradeKey`/`part` are the same physical textbook coordinates
 * `createTextbook` accepts, so a package round-trips through the canonical
 * write path with no translation table.
 *
 * `key` and `status` are reported but are not inputs: the key is derived, and
 * publication is a two-actor workflow that an import must not shortcut.
 */
export interface TextbookExport {
  /** Derived. Informational on import. */
  readonly key: string;
  readonly subjectKey: string;
  readonly gradeKey: string;
  readonly part: 'PART_1' | 'PART_2' | 'BOTH';
  readonly title: string;
  readonly edition: string;
  readonly description: string | null;
  readonly issuer: string | null;
  readonly isbn: string | null;
  readonly publishYear: number | null;
  readonly totalPages: number | null;
  /** Reported, never importable. Publication is a reviewed transition. */
  readonly status: string;
}

export interface UnitExport {
  readonly key: string;
  readonly slug: string;
  /** Null for a top-level unit. Nesting is by slug, not by id. */
  readonly parentUnitSlug: string | null;
  readonly name: string;
  readonly orderIndex: number;
  readonly startPage: number | null;
  readonly endPage: number | null;
  readonly isActive: boolean;
  /**
   * Where this row came from in a previous system. Descriptive only.
   *
   * Carried through export and import so a migrated book can still be traced
   * back to the printed curriculum, but never used to resolve anything: the
   * legacy maths export reuses one question reference across several distinct
   * questions, so it is not an identity and must not be treated as one.
   */
  readonly sourceRef?: string | null;
}

export interface LessonExport {
  readonly key: string;
  readonly slug: string;
  readonly unitSlug: string;
  readonly name: string;
  readonly description: string | null;
  readonly orderIndex: number;
  readonly estimatedMins: number | null;
  readonly startPage: number | null;
  readonly endPage: number | null;
  readonly isActive: boolean;
  /**
   * Where this row came from in a previous system. Descriptive only.
   *
   * Carried through export and import so a migrated book can still be traced
   * back to the printed curriculum, but never used to resolve anything: the
   * legacy maths export reuses one question reference across several distinct
   * questions, so it is not an identity and must not be treated as one.
   */
  readonly sourceRef?: string | null;
}

export interface ConceptExport {
  readonly key: string;
  readonly slug: string;
  readonly lessonSlug: string;
  /** Carried because a lesson slug is only unique within its unit. */
  readonly unitSlug: string;
  readonly name: string;
  readonly description: string | null;
  readonly orderIndex: number;
  readonly difficulty: number;
  readonly importance: number;
  readonly masteryThreshold: number;
  readonly isCore: boolean;
  readonly isActive: boolean;
  readonly pageNumber: number | null;
  /**
   * Where this row came from in a previous system. Descriptive only.
   *
   * Carried through export and import so a migrated book can still be traced
   * back to the printed curriculum, but never used to resolve anything: the
   * legacy maths export reuses one question reference across several distinct
   * questions, so it is not an identity and must not be treated as one.
   */
  readonly sourceRef?: string | null;
  /** The concept's name in English, when the curriculum supplies one. */
  readonly nameEn?: string | null;
  /** Bloom's level as authored. Free text: the curriculum is the authority. */
  readonly bloomsLevel?: string | null;
}

/**
 * A prerequisite edge.
 *
 * Referenced by concept KEY rather than slug: a prerequisite may live in
 * another textbook entirely (cross-grade prerequisites are a real case), and a
 * slug has no meaning outside its own lesson.
 */
export interface PrerequisiteExport {
  readonly conceptKey: string;
  readonly prerequisiteKey: string;
  readonly strength: number;
  readonly requiredMastery: number;
}

/**
 * One option of a multiple-choice question.
 *
 * `id` is the author's local handle ("a", "b", or a positional "c1"), not the
 * stored identifier. The database keeps a derived uuid per choice, computed
 * from the question key and this local id, and a learner's recorded answer
 * points at that uuid. Publishing the uuid would put a persistence detail in a
 * public contract and would be useless to an importer anyway: a question
 * imported into another book derives different uuids. The local id is what
 * `answerKey.correctChoiceIds` references, so the package stays internally
 * consistent wherever it is imported.
 */
export interface QuestionChoiceExport {
  readonly id: string;
  readonly text: string;
  readonly orderIndex: number;
  /** The error this option represents, when it is a diagnostic distractor. */
  readonly misconceptionKey: string | null;
  readonly feedback: string | null;
}

/**
 * The answer key, in the author's vocabulary.
 *
 * Only the fields a given question type uses are meaningful; the rest are
 * carried as nulls rather than omitted so the shape is predictable to a
 * spreadsheet or a strongly-typed consumer.
 */
export interface AnswerKeyExport {
  readonly correctChoiceIds: readonly string[];
  readonly acceptedTexts: readonly string[];
  readonly numericMin: number | null;
  readonly numericMax: number | null;
  readonly caseSensitive: boolean;
  readonly allowPartialCredit: boolean;
}

/**
 * What a question measures.
 *
 * Referenced by slug rather than by concept key — unlike a prerequisite edge.
 * The difference is a real domain rule, not an inconsistency: a prerequisite
 * may point into another textbook, but a question's concepts are refused if
 * they span textbooks (`question.concepts_span_textbooks`). Since every link is
 * inside this book, slugs are the portable choice, and a package retargeted at
 * a new edition needs no key rewriting.
 */
export interface QuestionConceptExport {
  readonly unitSlug: string;
  readonly lessonSlug: string;
  readonly conceptSlug: string;
  readonly weight: number;
  readonly isPrimary: boolean;
}

/**
 * A question in the item bank.
 *
 * There is no slug: a question's identity is derived from its text against its
 * lesson, so the text *is* the stable identifier. That is also why re-importing
 * an unchanged package is idempotent, and why editing the text of an existing
 * question is an insert rather than an update — a rewritten stem is a different
 * question, and the old one may already carry learner evidence.
 *
 * `status` is reported but never importable: a question is published by SUBMIT
 * then APPROVE, by two different actors, and an import must not shortcut a
 * review.
 *
 * `origin` and `textbookRole` are the provenance claim. They are descriptive
 * metadata and must never be read as a pedagogical rule by adaptive selection
 * or mastery.
 */
export interface QuestionExport {
  /** Derived from lesson + text. Informational on import. */
  readonly key: string;
  readonly unitSlug: string;
  readonly lessonSlug: string;
  readonly type: string;
  readonly text: string;
  readonly hint: string | null;
  readonly explanation: string | null;
  readonly points: number;
  readonly difficulty01: number;
  /** Where this item came from: TEXTBOOK | TEACHER | AI | UNKNOWN. */
  readonly origin: string;
  /** What it was printed as. Only ever set when origin is TEXTBOOK. */
  readonly textbookRole: string | null;
  readonly choices: readonly QuestionChoiceExport[];
  readonly answerKey: AnswerKeyExport;
  readonly concepts: readonly QuestionConceptExport[];
  /** Reported, never importable. Publication is a two-actor review. */
  readonly status: string;
  /**
   * Where this row came from in a previous system. Descriptive only.
   *
   * Carried through export and import so a migrated book can still be traced
   * back to the printed curriculum, but never used to resolve anything: the
   * legacy maths export reuses one question reference across several distinct
   * questions, so it is not an identity and must not be treated as one.
   */
  readonly sourceRef?: string | null;
}

/**
 * A named error a learner actually makes.
 *
 * A first-class element rather than a field on `ConceptExport`, because a
 * misconception is an entity with its own identity and its own referents: a
 * distractor points at one, a remediation episode is opened against one, and a
 * learner carries one in `LearnerMisconception`. Nesting it inside a concept
 * would make those references unaddressable from a package.
 *
 * Identified by `conceptSlug` + `slug` rather than by the derived key, for the
 * same reason questions reference concepts by slug: a package retargeted at a
 * new edition must not need key rewriting. The stored key is
 * `<conceptKey>-MIS<fingerprint>` and is derived on import, never supplied.
 *
 * `correction` is the text shown once the error is diagnosed. It is the whole
 * point of naming the misconception, so it is required, not optional.
 */
export interface MisconceptionExport {
  readonly slug: string;
  readonly unitSlug: string;
  readonly lessonSlug: string;
  readonly conceptSlug: string;
  readonly name: string;
  readonly description: string;
  readonly correction: string | null;
}

/**
 * Supporting material attached to a concept.
 *
 * Separate from the concept for the same reason as above: a resource has a
 * kind, an order and an optional page range, and the schema already allows one
 * to hang off either a concept or a textbook.
 *
 * `kind` is carried as a string and validated against `ResourceKind` on
 * import. The domain must not import the Prisma enum — that is rule D1, and
 * the export profile is the most tempting place to break it.
 */
export type LearningResourceScope = 'TEXTBOOK' | 'LESSON' | 'CONCEPT';

export interface LearningResourceExport {
  readonly slug: string;
  /**
   * Default is CONCEPT for packages written before profile 1.1. Lesson- and
   * textbook-scoped rows let exports carry the same learning-resource targets
   * the database and authoring API already support, without inventing a second
   * attachment model.
   */
  readonly scope?: LearningResourceScope;
  readonly unitSlug?: string | null;
  readonly lessonSlug?: string | null;
  readonly conceptSlug?: string | null;
  readonly kind: string;
  readonly title: string;
  readonly body: string | null;
  readonly url: string | null;
  readonly orderIndex: number;
  readonly pageStart: number | null;
  readonly pageEnd: number | null;
  readonly estimatedMins: number | null;
}

/**
 * Physical asset attached to textbook, unit, lesson, or concept.
 * Carries relative storage path, MIME type, checksum, and size.
 */
export type ContentAssetScope = 'TEXTBOOK' | 'UNIT' | 'LESSON' | 'CONCEPT';

export interface ContentAssetExport {
  readonly scope: ContentAssetScope;
  readonly unitSlug?: string | null;
  readonly lessonSlug?: string | null;
  readonly conceptSlug?: string | null;
  readonly assetType: string;
  readonly originalName: string;
  readonly relativePath: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly version?: number;
  readonly pageStart?: number | null;
  readonly pageEnd?: number | null;
  readonly title?: string | null;
  readonly altText?: string | null;
  readonly caption?: string | null;
}

export interface ContentPackage {
  readonly meta: ExportMeta;
  readonly textbook: TextbookExport;
  readonly units: readonly UnitExport[];
  readonly lessons: readonly LessonExport[];
  readonly concepts: readonly ConceptExport[];
  readonly prerequisites: readonly PrerequisiteExport[];
  /**
   * Optional so that every package written before this field existed is still
   * a valid package. An importer treats absent and empty identically.
   */
  readonly misconceptions?: readonly MisconceptionExport[];
  readonly learningResources?: readonly LearningResourceExport[];
  readonly assets?: readonly ContentAssetExport[];
  readonly questions: readonly QuestionExport[];
}

/**
 * The resource kinds a package may declare.
 *
 * Mirrors the `ResourceKind` enum. Duplicated deliberately: the domain layer
 * must not import from Prisma, and a package is a public contract that should
 * not silently change shape when an internal enum gains a member.
 */
export const IMPORTABLE_RESOURCE_KINDS = [
  'READING',
  'VIDEO',
  'WORKED_EXAMPLE',
  'FLASHCARD_DECK',
  'REMEDIAL',
  'TEXTBOOK_PAGE',
] as const;

export const IMPORTABLE_ASSET_TYPES = [
  'TEXTBOOK_PDF',
  'UNIT_PDF',
  'LESSON_PDF',
  'PAGE_IMAGE',
  'PAGE_TEXT',
  'RESOURCE_FILE',
  'IMAGE_SUMMARY',
  'AUDIO',
  'VIDEO',
] as const;

/**
 * Dependency order for reading a package.
 *
 * Declared rather than implied, because an importer must not have to infer it
 * and a reviewer must be able to check it. Prerequisites come last: an edge can
 * point at any concept, including one created earlier in the same run.
 */
export const CONTENT_IMPORT_ORDER = [
  'textbook',
  'units',
  'lessons',
  'concepts',
  'prerequisites',
  'assets',
  // Both hang off a concept, so they follow concepts. Misconceptions precede
  // questions because a distractor may name one: the referent must exist
  // before the reference is written, even though this converter never
  // generates such a link (see §3 of the import audit).
  'misconceptions',
  'learningResources',
  'questions',
] as const;

/**
 * Fields a package reports but an importer must never write.
 *
 * Keys are derived; status is decided by a reviewed transition; timestamps are
 * facts about the database, not about the content. Naming them here means the
 * import contract can be checked against one list instead of being argued case
 * by case.
 */
export const NON_IMPORTABLE_FIELDS = ['key', 'status', 'createdAt', 'updatedAt'] as const;

/**
 * Deterministic ordering.
 *
 * Two exports of unchanged content must be byte-identical, or a diff is
 * useless as a review tool and a round-trip test cannot assert equality.
 * Ordering is by the stable business identifier, never by database id or
 * insertion time.
 */
export function sortPackage(pkg: ContentPackage): ContentPackage {
  const bySlug = <T extends { slug: string }>(rows: readonly T[]): T[] =>
    [...rows].sort((a, b) => a.slug.localeCompare(b.slug));

  return {
    ...pkg,
    units: bySlug(pkg.units),
    lessons: [...pkg.lessons].sort(
      (a, b) => a.unitSlug.localeCompare(b.unitSlug) || a.slug.localeCompare(b.slug),
    ),
    concepts: [...pkg.concepts].sort(
      (a, b) =>
        a.unitSlug.localeCompare(b.unitSlug) ||
        a.lessonSlug.localeCompare(b.lessonSlug) ||
        a.slug.localeCompare(b.slug),
    ),
    prerequisites: [...pkg.prerequisites].sort(
      (a, b) => a.conceptKey.localeCompare(b.conceptKey) || a.prerequisiteKey.localeCompare(b.prerequisiteKey),
    ),
    // Both attachment collections sort on the qualified path, because a slug
    // is only unique within its concept. Omitted rather than defaulted to []
    // when absent: the field is optional, and inventing an empty array would
    // make a package written before the field existed differ from itself on
    // re-export.
    ...(pkg.misconceptions
      ? {
          misconceptions: [...pkg.misconceptions].sort(
            (a, b) =>
              a.unitSlug.localeCompare(b.unitSlug) ||
              a.lessonSlug.localeCompare(b.lessonSlug) ||
              a.conceptSlug.localeCompare(b.conceptSlug) ||
              a.slug.localeCompare(b.slug),
          ),
        }
      : {}),
    // Resources carry an author-chosen reading order, so that leads; the slug
    // only breaks ties between two resources sharing an index.
    ...(pkg.learningResources
      ? {
          learningResources: [...pkg.learningResources].sort(
            (a, b) =>
              resourceScopeOf(a).localeCompare(resourceScopeOf(b)) ||
              (a.unitSlug ?? '').localeCompare(b.unitSlug ?? '') ||
              (a.lessonSlug ?? '').localeCompare(b.lessonSlug ?? '') ||
              (a.conceptSlug ?? '').localeCompare(b.conceptSlug ?? '') ||
              a.orderIndex - b.orderIndex ||
              a.slug.localeCompare(b.slug),
          ),
        }
      : {}),
    ...(pkg.assets
      ? {
          assets: [...pkg.assets].sort(
            (a, b) =>
              a.scope.localeCompare(b.scope) ||
              (a.unitSlug ?? '').localeCompare(b.unitSlug ?? '') ||
              (a.lessonSlug ?? '').localeCompare(b.lessonSlug ?? '') ||
              (a.conceptSlug ?? '').localeCompare(b.conceptSlug ?? '') ||
              a.relativePath.localeCompare(b.relativePath),
          ),
        }
      : {}),
    // Questions have no slug, so their stable identifier is the derived key.
    // Sorting by text instead would reorder a package whenever an author fixed
    // a typo, and the diff would claim far more changed than did.
    questions: [...pkg.questions].sort((a, b) => a.key.localeCompare(b.key)),
  };
}

function resourceScopeOf(resource: LearningResourceExport): LearningResourceScope {
  if (resource.scope) return resource.scope;
  if (resource.conceptSlug) return 'CONCEPT';
  if (resource.lessonSlug) return 'LESSON';
  return 'TEXTBOOK';
}

/**
 * Does every reference inside this package resolve?
 *
 * Export runs this on its own output. An export that emits a lesson whose unit
 * is missing would produce a package that can never be imported, and the
 * failure would surface much later as a confusing import error. Better to fail
 * where the bug is.
 *
 * Prerequisites are deliberately NOT required to resolve internally: an edge
 * may legitimately point outside this book. They are reported as external
 * instead, so a caller can decide.
 */
export function checkPackageIntegrity(pkg: ContentPackage): {
  ok: boolean;
  problems: string[];
  externalPrerequisites: string[];
} {
  const problems: string[] = [];

  const unitSlugs = new Set(pkg.units.map((u) => u.slug));
  const lessonIds = new Set(pkg.lessons.map((l) => `${l.unitSlug}/${l.slug}`));
  const conceptKeys = new Set(pkg.concepts.map((c) => c.key));
  const conceptSlugs = new Set(pkg.concepts.map((c) => `${c.unitSlug}/${c.lessonSlug}/${c.slug}`));

  for (const unit of pkg.units) {
    if (unit.parentUnitSlug !== null && !unitSlugs.has(unit.parentUnitSlug)) {
      problems.push(`unit "${unit.slug}" references missing parent unit "${unit.parentUnitSlug}"`);
    }
  }
  for (const lesson of pkg.lessons) {
    if (!unitSlugs.has(lesson.unitSlug)) {
      problems.push(`lesson "${lesson.slug}" references missing unit "${lesson.unitSlug}"`);
    }
  }
  for (const concept of pkg.concepts) {
    if (!lessonIds.has(`${concept.unitSlug}/${concept.lessonSlug}`)) {
      problems.push(
        `concept "${concept.slug}" references missing lesson "${concept.unitSlug}/${concept.lessonSlug}"`,
      );
    }
  }

  for (const question of pkg.questions) {
    if (!lessonIds.has(`${question.unitSlug}/${question.lessonSlug}`)) {
      problems.push(
        `question "${question.key}" references missing lesson "${question.unitSlug}/${question.lessonSlug}"`,
      );
    }

    // A question whose concepts are missing measures nothing, and its key
    // cannot even be derived: the key comes from the primary concept's lesson.
    const primaries = question.concepts.filter((c) => c.isPrimary);
    if (primaries.length !== 1) {
      problems.push(
        `question "${question.key}" must have exactly one primary concept, found ${primaries.length}`,
      );
    }
    for (const link of question.concepts) {
      if (!conceptSlugs.has(`${link.unitSlug}/${link.lessonSlug}/${link.conceptSlug}`)) {
        problems.push(
          `question "${question.key}" references missing concept "${link.conceptSlug}"`,
        );
      }
    }

    // The answer key points at the author's local choice ids. A key naming an
    // option that is not in the package would import a question nobody can
    // answer correctly.
    const choiceIds = new Set(question.choices.map((c) => c.id));
    for (const correct of question.answerKey.correctChoiceIds) {
      if (!choiceIds.has(correct)) {
        problems.push(`question "${question.key}" marks unknown choice "${correct}" as correct`);
      }
    }
  }

  // Misconceptions and resources both hang off a concept. An orphan would
  // import into nothing, or worse, silently attach to the wrong concept if the
  // slug happened to collide in another lesson — hence the fully-qualified
  // triple rather than a bare concept slug.
  const seenMisconceptions = new Set<string>();
  for (const mis of pkg.misconceptions ?? []) {
    const conceptId = `${mis.unitSlug}/${mis.lessonSlug}/${mis.conceptSlug}`;
    if (!conceptSlugs.has(conceptId)) {
      problems.push(`misconception "${mis.slug}" references missing concept "${conceptId}"`);
    }
    // Two misconceptions with one slug on one concept would derive the same
    // key and collide on insert — better named here than as a database error.
    const identity = `${conceptId}/${mis.slug}`;
    if (seenMisconceptions.has(identity)) {
      problems.push(`duplicate misconception "${mis.slug}" on concept "${conceptId}"`);
    }
    seenMisconceptions.add(identity);
  }

  const seenResources = new Set<string>();
  for (const res of pkg.learningResources ?? []) {
    const scope = resourceScopeOf(res);
    let targetId = 'textbook';
    if (scope === 'CONCEPT') {
      const conceptId = `${res.unitSlug ?? ''}/${res.lessonSlug ?? ''}/${res.conceptSlug ?? ''}`;
      targetId = conceptId;
      if (!conceptSlugs.has(conceptId)) {
        problems.push(`resource "${res.slug}" references missing concept "${conceptId}"`);
      }
    } else if (scope === 'LESSON') {
      const lessonId = `${res.unitSlug ?? ''}/${res.lessonSlug ?? ''}`;
      targetId = lessonId;
      if (!lessonIds.has(lessonId)) {
        problems.push(`resource "${res.slug}" references missing lesson "${lessonId}"`);
      }
    }
    if (!(IMPORTABLE_RESOURCE_KINDS as readonly string[]).includes(res.kind)) {
      problems.push(`resource "${res.slug}" declares unknown kind "${res.kind}"`);
    }
    const identity = `${scope}/${targetId}/${res.slug}`;
    if (seenResources.has(identity)) {
      problems.push(`duplicate resource "${res.slug}" on ${scope.toLowerCase()} "${targetId}"`);
    }
    seenResources.add(identity);
  }

  const seenAssets = new Set<string>();
  for (const ast of pkg.assets ?? []) {
    let targetId = 'textbook';
    if (ast.scope === 'CONCEPT') {
      const conceptId = `${ast.unitSlug ?? ''}/${ast.lessonSlug ?? ''}/${ast.conceptSlug ?? ''}`;
      targetId = conceptId;
      if (!conceptSlugs.has(conceptId)) {
        problems.push(`asset "${ast.relativePath}" references missing concept "${conceptId}"`);
      }
    } else if (ast.scope === 'LESSON') {
      const lessonId = `${ast.unitSlug ?? ''}/${ast.lessonSlug ?? ''}`;
      targetId = lessonId;
      if (!lessonIds.has(lessonId)) {
        problems.push(`asset "${ast.relativePath}" references missing lesson "${lessonId}"`);
      }
    } else if (ast.scope === 'UNIT') {
      const unitSlug = ast.unitSlug ?? '';
      targetId = unitSlug;
      if (!unitSlugs.has(unitSlug)) {
        problems.push(`asset "${ast.relativePath}" references missing unit "${unitSlug}"`);
      }
    }
    if (!(IMPORTABLE_ASSET_TYPES as readonly string[]).includes(ast.assetType)) {
      problems.push(`asset "${ast.relativePath}" declares unknown assetType "${ast.assetType}"`);
    }
    if (!ast.relativePath || ast.relativePath.trim() === '' || ast.relativePath.includes('..')) {
      problems.push(`asset "${ast.relativePath}" has invalid relativePath`);
    }
    if (typeof ast.sizeBytes !== 'number' || ast.sizeBytes < 0) {
      problems.push(`asset "${ast.relativePath}" has invalid sizeBytes "${ast.sizeBytes}"`);
    }
    if (!/^[a-fA-F0-9]{64}$/.test(ast.sha256)) {
      problems.push(`asset "${ast.relativePath}" has invalid sha256 checksum "${ast.sha256}"`);
    }
    const identity = `${ast.scope}/${targetId}/${ast.relativePath}`;
    if (seenAssets.has(identity)) {
      problems.push(`duplicate asset "${ast.relativePath}" on ${ast.scope.toLowerCase()} "${targetId}"`);
    }
    seenAssets.add(identity);
  }

  const externalPrerequisites: string[] = [];
  for (const edge of pkg.prerequisites) {
    if (!conceptKeys.has(edge.conceptKey)) {
      problems.push(`prerequisite edge references missing concept "${edge.conceptKey}"`);
    }
    if (!conceptKeys.has(edge.prerequisiteKey)) {
      externalPrerequisites.push(edge.prerequisiteKey);
    }
  }

  return { ok: problems.length === 0, problems, externalPrerequisites };
}
