/**
 * Imports a content package.
 *
 * This service owns NO persistence. Every write goes through
 * `ContentAuthoringService` — the same methods the HTTP API calls — so
 * validation, slug rules, key derivation, the textbook write-lock and audit
 * logging apply identically whether content arrives from a form or a file.
 * That is the rule `ARCHITECTURE.md` §4.9 exists to state: an importer is a
 * bulk adapter, never a second write path. Legacy made 19 direct Prisma calls
 * from its importer and ended up with two different definitions of valid
 * content.
 *
 * It is also not a parser. It takes an already-parsed package; deciding whether
 * bytes were XLSX, CSV or JSON is a separate concern that will sit in
 * infrastructure, with no educational rules in it.
 *
 * It writes through two canonical services, not one, because the domain is
 * split that way: structure belongs to `ContentAuthoringService` and items
 * belong to `ItemBankService`. Collapsing them here to make importing simpler
 * would put a third definition of a question in the system.
 */

import { Errors } from '../../../shared/kernel/errors.js';
import { Err, Ok, type Result } from '../../../shared/kernel/result.js';
import {
  CONTENT_PROFILE,
  CONTENT_PROFILE_VERSION,
  checkPackageIntegrity,
  type ContentPackage,
} from '../domain/export-profile.js';
import {
  lessonKey as buildLessonKey,
  unitKey as buildUnitKey,
  textbookKey as buildTextbookKey,
  normalizeSlug,
  questionKey as buildQuestionKey,
  type TextbookKey,
  type UnitKey,
} from '../../../shared/kernel/identifiers.js';
import {
  conceptKey as buildConceptKey,
  type LessonKey,
} from '../../../shared/kernel/identifiers.js';
import type { AuthorContext, ContentAuthoringService } from './authoring.service.js';
import type { ItemBankService } from './item-bank.service.js';
import type { QuestionOrigin, TextbookQuestionRole } from '../domain/question-authoring.js';

/**
 * Re-derive the key of a node that already exists.
 *
 * Not a second identity implementation: it calls the same kernel builders the
 * authoring service uses, so there is exactly one definition of the format.
 * Needed because a slug conflict means "this already exists" and the children
 * still need their parent's key.
 */
function deriveUnitKey(textbookKey: string, slug: string): string | null {
  const key = buildUnitKey(textbookKey as TextbookKey, slug);
  return key.ok ? key.value : null;
}

function deriveConceptKey(lessonKey: string, slug: string): string | null {
  const key = buildConceptKey(lessonKey as LessonKey, slug);
  return key.ok ? key.value : null;
}

function deriveLessonKey(unitKey: string, slug: string): string | null {
  const key = buildLessonKey(unitKey as UnitKey, slug);
  return key.ok ? key.value : null;
}

/** One problem with one row, addressed to whoever has to fix the file. */
export interface ImportProblem {
  /** Which collection: units, lessons, concepts, prerequisites. */
  readonly sheet: string;
  /** 1-based position within that collection, as a person counts rows. */
  readonly row: number;
  readonly field: string | null;
  /** The stable identifier of the offending row, so it can be found by eye. */
  readonly reference: string;
  readonly code: string;
  readonly message: string;
  /** BLOCKING stops the import; WARNING is reported and continues. */
  readonly severity: 'BLOCKING' | 'WARNING';
}

export interface ImportOptions {
  readonly dryRun: boolean;
  readonly mode?: 'APPEND_DEDUP' | 'UPDATE';
  readonly targetTextbookKey?: string;
  readonly selectedUnits?: readonly string[];
  readonly selectedLessons?: readonly string[];
  readonly selectedConcepts?: readonly string[];
  readonly includeResources?: boolean;
  readonly includeMisconceptions?: boolean;
  readonly includeQuestions?: boolean;
}

export interface ImportResult {
  readonly dryRun: boolean;
  readonly applied: boolean;
  readonly textbookKey: string;
  readonly created: {
    readonly units: number;
    readonly lessons: number;
    readonly concepts: number;
    readonly prerequisites: number;
    readonly misconceptions: number;
    readonly learningResources: number;
    readonly questions: number;
  };
  readonly unchanged: {
    readonly units: number;
    readonly lessons: number;
    readonly concepts: number;
    readonly prerequisites: number;
    readonly misconceptions: number;
    readonly learningResources: number;
    readonly questions: number;
  };
  readonly generatedKeys: ReadonlyArray<{ sheet: string; reference: string; key: string }>;
  readonly problems: readonly ImportProblem[];
}

function slugifyOrFallback(raw?: string | null, fallback = 'node'): string {
  if (raw && raw.trim()) {
    const norm = normalizeSlug(raw);
    if (norm.ok && norm.value) return norm.value;
  }
  return fallback;
}

export function normalizeOrConvertPackage(
  raw: any,
  options: ImportOptions,
): ContentPackage {
  const isHierarchical =
    Array.isArray(raw?.units) &&
    raw.units.some((u: any) => Array.isArray(u?.lessons)) &&
    !Array.isArray(raw?.lessons);

  if (isHierarchical) {
    const rawPart = raw.textbook?.part ?? raw.part;
    const part = rawPart === 'P1' || rawPart === 'PART_1' ? 'PART_1' : rawPart === 'P2' || rawPart === 'PART_2' ? 'PART_2' : null;
    let derivedKey = raw.textbook?.key ?? '';
    if (!derivedKey && raw.subjectKey && raw.gradeKey && part && raw.edition) {
      const gradeMatch = /^G?(\\d{1,2})$/i.exec(String(raw.gradeKey).trim());
      if (gradeMatch) {
        const built = buildTextbookKey({ subject: raw.subjectKey, grade: Number(gradeMatch[1]), part, edition: String(raw.edition) });
        if (built.ok) derivedKey = built.value;
      }
    }
    const tbKey = options.targetTextbookKey || derivedKey || 'UNRESOLVED-TEXTBOOK-KEY';

    const flatUnits: any[] = [];
    const flatLessons: any[] = [];
    const flatConcepts: any[] = [];
    const flatResources: any[] = [];
    const flatMisconceptions: any[] = [];
    const flatQuestions: any[] = [];
    const flatPrerequisites: any[] = [];

    for (const [uIdx, u] of (raw.units ?? []).entries()) {
      const unitSlug = u.slug || slugifyOrFallback(u.name, `UNIT-${uIdx + 1}`);
      flatUnits.push({
        slug: unitSlug,
        name: u.name || `الوحدة ${uIdx + 1}`,
        orderIndex: u.orderIndex ?? uIdx + 1,
        startPage: u.startPage ?? null,
        endPage: u.endPage ?? null,
        parentUnitSlug: u.parentUnitSlug ?? null,
      });

      for (const [lIdx, l] of (u.lessons ?? []).entries()) {
        const lessonSlug = l.slug || slugifyOrFallback(l.name, `LESSON-${lIdx + 1}`);
        flatLessons.push({
          unitSlug,
          slug: lessonSlug,
          name: l.name || `الدرس ${lIdx + 1}`,
          orderIndex: l.orderIndex ?? lIdx + 1,
          estimatedMins: l.estimatedMins ?? 45,
          startPage: l.startPage ?? null,
          endPage: l.endPage ?? null,
          description: l.description ?? null,
        });

        if (l.reading) {
          flatResources.push({
            targetKind: 'LESSON',
            unitSlug,
            lessonSlug,
            slug: `READING-L${lIdx + 1}`,
            kind: 'READING',
            title: l.name,
            body: l.reading,
            orderIndex: 1,
            pageStart: l.startPage ?? null,
            pageEnd: l.endPage ?? null,
            estimatedMins: l.estimatedMins ?? 45,
          });
        }

        for (const [rIdx, res] of (l.extraResources ?? l.materials ?? []).entries()) {
          flatResources.push({
            targetKind: 'LESSON',
            unitSlug,
            lessonSlug,
            slug: res.slug || slugifyOrFallback(res.title, `RES-${rIdx + 2}`),
            kind: res.kind || 'READING',
            title: res.title || 'مادة إثرائية',
            body: res.body ?? null,
            url: res.url ?? null,
            orderIndex: res.orderIndex ?? rIdx + 2,
            pageStart: res.pageStart ?? null,
            pageEnd: res.pageEnd ?? null,
            estimatedMins: res.estimatedMins ?? null,
          });
        }

        for (const [cIdx, c] of (l.concepts ?? []).entries()) {
          const conceptSlug = c.slug || slugifyOrFallback(c.name, `CONCEPT-${cIdx + 1}`);
          flatConcepts.push({
            unitSlug,
            lessonSlug,
            slug: conceptSlug,
            name: c.name || `مفهوم ${cIdx + 1}`,
            orderIndex: c.orderIndex ?? cIdx + 1,
            difficulty: c.difficulty ?? 0.3,
            importance: c.importance ?? 0.9,
            masteryThreshold: c.threshold ?? c.masteryThreshold ?? 0.7,
            isCore: c.isCore ?? true,
            pageNumber: c.page ?? c.pageNumber ?? null,
            description: c.description ?? null,
          });

          for (const p of c.prerequisites ?? []) {
            flatPrerequisites.push({
              conceptKey: conceptSlug,
              prerequisiteKey: p,
              strength: 1.0,
              requiredMastery: 0.7,
            });
          }

          for (const [mIdx, m] of (c.misconceptions ?? []).entries()) {
            flatMisconceptions.push({
              unitSlug,
              lessonSlug,
              conceptSlug,
              slug: m.slug || slugifyOrFallback(m.name, `MIS-${mIdx + 1}`),
              name: m.name,
              description: m.description,
              correction: m.remediation ?? m.correction ?? null,
            });
          }

          for (const q of c.questions ?? []) {
            const choices = (q.choices ?? []).map((ch: any, chIdx: number) => ({
              id: ch.id || `c${chIdx + 1}`,
              text: ch.text,
              misconceptionSlug: ch.misconception || ch.misconceptionSlug || undefined,
            }));
            const correctChoiceIds = choices
              .filter((_: any, i: number) => q.choices[i]?.correct)
              .map((ch: any) => ch.id);

            const validCorrectIds =
              correctChoiceIds.length > 0
                ? correctChoiceIds
                : choices[0]
                  ? [choices[0].id]
                  : ['c1'];

            flatQuestions.push({
              key: q.key || `Q-${conceptSlug}-${flatQuestions.length + 1}`,
              unitSlug,
              lessonSlug,
              type: q.type || 'MCQ_SINGLE',
              text: q.text,
              origin: 'TEXTBOOK_IMPORT',
              role: 'ASSESSMENT',
              difficulty01: q.difficulty01 ?? c.difficulty ?? 0.3,
              choices,
              answerKey: {
                correctChoiceIds: validCorrectIds,
              },
              concepts: [
                {
                  unitSlug,
                  lessonSlug,
                  conceptSlug,
                  weight: 1.0,
                  isPrimary: true,
                },
              ],
            });
          }
        }
      }
    }

    raw = {
      meta: {
        profile: CONTENT_PROFILE,
        profileVersion: CONTENT_PROFILE_VERSION,
        scope: 'FULL',
        exportedAt: new Date().toISOString(),
      },
      textbook: {
        key: tbKey,
        subjectKey: raw.textbook?.subjectKey || raw.subjectKey || 'GENERAL',
        gradeKey: raw.textbook?.gradeKey || raw.gradeKey || 'G01',
        part: part || '',
        title: raw.textbook?.title || raw.title || 'كتاب دراسي',
        edition: String(raw.textbook?.edition || raw.edition || ''),
        status: 'DRAFT',
        issuer: raw.textbook?.issuer || raw.issuer || null,
        totalPages: raw.textbook?.totalPages || raw.totalPages || null,
        description: raw.textbook?.description || raw.description || null,
      },
      units: flatUnits,
      lessons: flatLessons,
      concepts: flatConcepts,
      prerequisites: flatPrerequisites,
      misconceptions: flatMisconceptions,
      learningResources: flatResources,
      questions: flatQuestions,
    };
  }

  // Clone to avoid mutating original
  const pkg: ContentPackage = {
    ...raw,
    meta: raw.meta
      ? raw.meta
      : {
          profile: CONTENT_PROFILE,
          profileVersion: CONTENT_PROFILE_VERSION,
          scope: 'FULL',
          exportedAt: new Date().toISOString(),
        },
    textbook: {
      ...raw.textbook,
      key: options.targetTextbookKey || raw.textbook?.key,
    },
    units: (raw.units ?? []).map((u: any, i: number) => ({
      ...u,
      slug: u.slug || slugifyOrFallback(u.name, `UNIT-${i + 1}`),
    })),
    lessons: (raw.lessons ?? []).map((l: any, i: number) => ({
      ...l,
      slug: l.slug || slugifyOrFallback(l.name, `LESSON-${i + 1}`),
    })),
    concepts: (raw.concepts ?? []).map((c: any, i: number) => ({
      ...c,
      slug: c.slug || slugifyOrFallback(c.name, `CONCEPT-${i + 1}`),
    })),
    prerequisites: raw.prerequisites ?? [],
    misconceptions: (raw.misconceptions ?? []).map((m: any, i: number) => ({
      ...m,
      slug: m.slug || slugifyOrFallback(m.name, `MIS-${i + 1}`),
    })),
    learningResources: (raw.learningResources ?? []).map((r: any, i: number) => ({
      ...r,
      slug: r.slug || slugifyOrFallback(r.title, `RES-${i + 1}`),
    })),
    questions: raw.questions ?? [],
  };

  // ── Apply Granular Selection ──────────────────────────────────────────
  const hasGranularSelection = Boolean(
    (options.selectedUnits && options.selectedUnits.length > 0) ||
    (options.selectedLessons && options.selectedLessons.length > 0) ||
    (options.selectedConcepts && options.selectedConcepts.length > 0),
  );

  let mutableUnits = pkg.units;
  let mutableLessons = pkg.lessons;
  let mutableConcepts = pkg.concepts;
  let mutableQuestions = pkg.questions ?? [];
  let mutableMisconceptions = pkg.misconceptions ?? [];
  let mutableLearningResources = pkg.learningResources ?? [];

  if (hasGranularSelection) {
    if (options.selectedUnits && options.selectedUnits.length > 0) {
      const unitSet = new Set(options.selectedUnits);
      mutableUnits = mutableUnits.filter((u) => unitSet.has(u.slug));
      mutableLessons = mutableLessons.filter((l) => unitSet.has(l.unitSlug));
      const lessonSet = new Set(mutableLessons.map((l) => `${l.unitSlug}/${l.slug}`));
      mutableConcepts = mutableConcepts.filter((c) =>
        lessonSet.has(`${c.unitSlug}/${c.lessonSlug}`),
      );
    }

    if (options.selectedLessons && options.selectedLessons.length > 0) {
      const lessonSet = new Set(options.selectedLessons);
      mutableLessons = mutableLessons.filter(
        (l) => lessonSet.has(l.slug) || lessonSet.has(`${l.unitSlug}/${l.slug}`),
      );
      const activeLessonSet = new Set(mutableLessons.map((l) => `${l.unitSlug}/${l.slug}`));
      mutableConcepts = mutableConcepts.filter((c) =>
        activeLessonSet.has(`${c.unitSlug}/${c.lessonSlug}`),
      );
      const activeUnitSlugs = new Set(mutableLessons.map((l) => l.unitSlug));
      mutableUnits = mutableUnits.filter((u) => activeUnitSlugs.has(u.slug));
    }

    if (options.selectedConcepts && options.selectedConcepts.length > 0) {
      const conceptSet = new Set(options.selectedConcepts);
      mutableConcepts = mutableConcepts.filter(
        (c) =>
          conceptSet.has(c.slug) ||
          conceptSet.has(`${c.unitSlug}/${c.lessonSlug}/${c.slug}`),
      );
      const activeLessonPaths = new Set(
        mutableConcepts.map((c) => `${c.unitSlug}/${c.lessonSlug}`),
      );
      mutableLessons = mutableLessons.filter((l) =>
        activeLessonPaths.has(`${l.unitSlug}/${l.slug}`),
      );
      const activeUnitSlugs = new Set(mutableLessons.map((l) => l.unitSlug));
      mutableUnits = mutableUnits.filter((u) => activeUnitSlugs.has(u.slug));
    }

    const activeConceptPaths = new Set(
      mutableConcepts.map((c) => `${c.unitSlug}/${c.lessonSlug}/${c.slug}`),
    );
    mutableQuestions = mutableQuestions.filter((q) =>
      q.concepts.some((link) =>
        activeConceptPaths.has(`${link.unitSlug}/${link.lessonSlug}/${link.conceptSlug}`),
      ),
    );
    mutableMisconceptions = mutableMisconceptions.filter((m) =>
      activeConceptPaths.has(`${m.unitSlug}/${m.lessonSlug}/${m.conceptSlug}`),
    );
    const activeLessonPaths = new Set(
      mutableLessons.map((l) => `${l.unitSlug}/${l.slug}`),
    );
    mutableLearningResources = mutableLearningResources.filter((r) =>
      r.lessonSlug ? activeLessonPaths.has(`${r.unitSlug}/${r.lessonSlug}`) : true,
    );
  }

  if (options.includeResources === false) {
    mutableLearningResources = [];
  }

  if (options.includeMisconceptions === false) {
    mutableMisconceptions = [];
  }

  if (options.includeQuestions === false) {
    mutableQuestions = [];
  }

  return {
    ...pkg,
    units: mutableUnits,
    lessons: mutableLessons,
    concepts: mutableConcepts,
    questions: mutableQuestions,
    misconceptions: mutableMisconceptions,
    learningResources: mutableLearningResources,
  };
}

export interface ImportOutcome {
  /** True when nothing was written: either a dry run, or a refusal. */
  readonly dryRun: boolean;
  readonly applied: boolean;
  readonly textbookKey: string;
  readonly created: {
    units: number;
    lessons: number;
    concepts: number;
    prerequisites: number;
    misconceptions: number;
    learningResources: number;
    questions: number;
  };
  /** Skipped because they already exist — an import is re-runnable. */
  readonly unchanged: {
    units: number;
    lessons: number;
    concepts: number;
    prerequisites: number;
    misconceptions: number;
    learningResources: number;
    questions: number;
  };
  readonly generatedKeys: ReadonlyArray<{ sheet: string; reference: string; key: string }>;
  readonly problems: readonly ImportProblem[];
}

function resourceScope(resource: { scope?: string; conceptSlug?: string | null; lessonSlug?: string | null }): 'TEXTBOOK' | 'LESSON' | 'CONCEPT' {
  if (resource.scope === 'TEXTBOOK' || resource.scope === 'LESSON' || resource.scope === 'CONCEPT') {
    return resource.scope;
  }
  if (resource.conceptSlug) return 'CONCEPT';
  if (resource.lessonSlug) return 'LESSON';
  return 'TEXTBOOK';
}

export class ContentImportService {
  constructor(
    private readonly authoring: ContentAuthoringService,
    private readonly itemBank: ItemBankService,
  ) {}

  /**
   * Validate a package and, unless this is a dry run, apply it.
   */
  async importPackage(
    ctx: AuthorContext,
    rawPkg: ContentPackage | Record<string, unknown>,
    options: ImportOptions,
  ): Promise<Result<ImportOutcome>> {
    const mode = options.mode ?? 'APPEND_DEDUP';
    const problems: ImportProblem[] = [];

    // Normalize or convert hierarchical / partial packages
    const pkg = normalizeOrConvertPackage(rawPkg, options);

    // ── 1. Profile ────────────────────────────────────────────────────────
    if (pkg.meta?.profile !== CONTENT_PROFILE) {
      return Err(
        Errors.validation('import.unknown_profile', 'This file is not an Edu7 content package.', {
          expected: CONTENT_PROFILE,
          received: pkg.meta?.profile ?? null,
        }),
      );
    }
    const major = (v: string) => v.split('.')[0];
    if (major(pkg.meta.profileVersion ?? '') !== major(CONTENT_PROFILE_VERSION)) {
      return Err(
        Errors.validation(
          'import.unsupported_profile_version',
          'This package was written for a different major version of the content profile.',
          { supported: CONTENT_PROFILE_VERSION, received: pkg.meta.profileVersion ?? null },
        ),
      );
    }

    let textbookKey = pkg.textbook?.key;
    if (!textbookKey) {
      return Err(
        Errors.validation('import.textbook_required', 'A package must name the textbook it targets.'),
      );
    }

    // A package describes the textbook header as business coordinates. Import
    // therefore ensures that book through ContentAuthoringService after the
    // package has passed all consistency checks, rather than making admins
    // create an empty shell first or duplicating textbook writes here. If the
    // derived key differs from the informational package key, children still
    // attach to the canonical key returned by createTextbook.
    const textbookExistsInitially = await this.authoring.textbookExists(textbookKey);

    // ── 2. Internal consistency, before anything is written ───────────────
    const integrity = checkPackageIntegrity(pkg);
    for (const problem of integrity.problems) {
      problems.push({
        sheet: 'package',
        row: 0,
        field: null,
        reference: textbookKey,
        code: 'import.unresolved_reference',
        message: problem,
        severity: 'BLOCKING',
      });
    }

    // ── 3. Duplicates within the file ─────────────────────────────────────
    // A file that names the same unit twice is ambiguous about which row wins.
    // Refusing is the only honest answer; picking one silently is not.
    this.collectDuplicates(pkg, problems);

    // ── 4. Required fields ────────────────────────────────────────────────
    this.collectMissingFields(pkg, problems);

    const blocking = problems.filter((p) => p.severity === 'BLOCKING');
    if (blocking.length > 0) {
      return Ok({
        dryRun: options.dryRun,
        applied: false,
        textbookKey,
        created: { units: 0, lessons: 0, concepts: 0, prerequisites: 0, misconceptions: 0, learningResources: 0, questions: 0 },
        unchanged: { units: 0, lessons: 0, concepts: 0, prerequisites: 0, misconceptions: 0, learningResources: 0, questions: 0 },
        generatedKeys: [],
        problems,
      });
    }

    const created = { units: 0, lessons: 0, concepts: 0, prerequisites: 0, misconceptions: 0, learningResources: 0, questions: 0 };
    const unchanged = { units: 0, lessons: 0, concepts: 0, prerequisites: 0, misconceptions: 0, learningResources: 0, questions: 0 };
    const generatedKeys: Array<{ sheet: string; reference: string; key: string }> = [];

    if (options.dryRun) {
      // Report what WOULD be written, not zeros.
      //
      // A dry run that validates and then says "created: 0" answers the wrong
      // question. The reviewer is deciding whether to apply this package, and
      // that decision needs the counts — "122 concepts, 66 misconceptions" is
      // checkable against the source; a row of zeros is not.
      //
      // These are counts of what the package CONTAINS, having passed every
      // structural check above. They are deliberately not labelled "created":
      // whether a given row already exists is only knowable by writing, and
      // guessing would be the prediction this codebase refuses to make.
      return Ok({
        dryRun: true,
        applied: false,
        textbookKey,
        created: {
          units: pkg.units.length,
          lessons: pkg.lessons.length,
          concepts: pkg.concepts.length,
          prerequisites: pkg.prerequisites.length,
          misconceptions: (pkg.misconceptions ?? []).length,
          learningResources: (pkg.learningResources ?? []).length,
          questions: pkg.questions.length,
        },
        unchanged,
        generatedKeys,
        problems,
      });
    }

    if (!textbookExistsInitially) {
      const createdTextbook = await this.authoring.createTextbook(ctx, {
        subjectKey: pkg.textbook.subjectKey,
        gradeKey: pkg.textbook.gradeKey,
        part: pkg.textbook.part,
        title: pkg.textbook.title,
        edition: pkg.textbook.edition,
        description: pkg.textbook.description ?? null,
        issuer: pkg.textbook.issuer ?? null,
        isbn: pkg.textbook.isbn ?? null,
        publishYear: pkg.textbook.publishYear ?? null,
        totalPages: pkg.textbook.totalPages ?? null,
      });
      if (!createdTextbook.ok) {
        return Ok({
          dryRun: false,
          applied: false,
          textbookKey,
          created,
          unchanged,
          generatedKeys,
          problems: [this.toProblem('textbook', 1, textbookKey, createdTextbook.error)],
        });
      }
      textbookKey = createdTextbook.value.key;
      generatedKeys.push({ sheet: 'textbook', reference: pkg.textbook.key, key: textbookKey });
    } else if (mode === 'UPDATE') {
      const update = await this.authoring.updateNode(ctx, 'textbook', textbookKey, {
        title: pkg.textbook.title,
        description: pkg.textbook.description ?? null,
        issuer: pkg.textbook.issuer ?? null,
        publishYear: pkg.textbook.publishYear ?? null,
        totalPages: pkg.textbook.totalPages ?? null,
      });
      if (!update.ok) problems.push(this.toProblem('textbook', 1, textbookKey, update.error));
    }

    // ── 5. Apply, in declared dependency order ────────────────────────────
    //
    // Slug -> derived key, learned as we go. A child is created against the
    // key the domain just returned, never against a key composed here: doing
    // the arithmetic locally would be this service quietly re-implementing
    // identity.
    const unitKeyBySlug = new Map<string, string>();
    const lessonKeyByPath = new Map<string, string>();
    /** unit/lesson/concept -> derived concept key, for the G7 attachments. */
    const conceptKeyByPath = new Map<string, string>();

    for (const [index, unit] of pkg.units.entries()) {
      // Parents first: a nested unit needs its parent's key to exist.
      if (unit.parentUnitSlug && !unitKeyBySlug.has(unit.parentUnitSlug)) {
        const parentIndex = pkg.units.findIndex((u) => u.slug === unit.parentUnitSlug);
        if (parentIndex > index) {
          problems.push({
            sheet: 'units',
            row: index + 1,
            field: 'parentUnitSlug',
            reference: unit.slug,
            code: 'import.parent_after_child',
            message: `Unit "${unit.slug}" appears before its parent "${unit.parentUnitSlug}".`,
            severity: 'BLOCKING',
          });
          continue;
        }
      }

      const result = await this.authoring.createUnit(ctx, {
        textbookKey,
        parentUnitKey: unit.parentUnitSlug ? (unitKeyBySlug.get(unit.parentUnitSlug) ?? null) : null,
        name: unit.name,
        slug: unit.slug,
        startPage: unit.startPage ?? null,
        endPage: unit.endPage ?? null,
        sourceRef: unit.sourceRef ?? null,
      });

      if (result.ok) {
        unitKeyBySlug.set(unit.slug, result.value.key);
        generatedKeys.push({ sheet: 'units', reference: unit.slug, key: result.value.key });
        created.units += 1;
      } else if (result.error.code === 'content.slug_taken') {
        const existing = deriveUnitKey(textbookKey, unit.slug);
        if (existing) unitKeyBySlug.set(unit.slug, existing);
        if (mode === 'UPDATE' && existing) {
          const update = await this.authoring.updateNode(ctx, 'unit', existing, {
            name: unit.name, startPage: unit.startPage ?? null, endPage: unit.endPage ?? null, sourceRef: unit.sourceRef ?? null,
          });
          if (!update.ok) problems.push(this.toProblem('units', index, unit.slug, update.error));
        }
        unchanged.units += 1;
      } else {
        problems.push(this.toProblem('units', index, unit.slug, result.error));
      }
    }

    for (const [index, lesson] of pkg.lessons.entries()) {
      const unitKey = unitKeyBySlug.get(lesson.unitSlug);
      if (!unitKey) {
        problems.push({
          sheet: 'lessons',
          row: index + 1,
          field: 'unitSlug',
          reference: lesson.slug,
          code: 'import.unresolved_reference',
          message: `Unit "${lesson.unitSlug}" could not be resolved.`,
          severity: 'BLOCKING',
        });
        continue;
      }

      const result = await this.authoring.createLesson(ctx, {
        unitKey,
        name: lesson.name,
        slug: lesson.slug,
        description: lesson.description ?? null,
        estimatedMins: lesson.estimatedMins ?? null,
        startPage: lesson.startPage ?? null,
        endPage: lesson.endPage ?? null,
        sourceRef: lesson.sourceRef ?? null,
      });

      const path = `${lesson.unitSlug}/${lesson.slug}`;
      if (result.ok) {
        lessonKeyByPath.set(path, result.value.key);
        generatedKeys.push({ sheet: 'lessons', reference: path, key: result.value.key });
        created.lessons += 1;
      } else if (result.error.code === 'content.slug_taken') {
        const existing = deriveLessonKey(unitKey, lesson.slug);
        if (existing) lessonKeyByPath.set(path, existing);
        if (mode === 'UPDATE' && existing) {
          const update = await this.authoring.updateNode(ctx, 'lesson', existing, {
            name: lesson.name, description: lesson.description ?? null, estimatedMins: lesson.estimatedMins ?? null,
            startPage: lesson.startPage ?? null, endPage: lesson.endPage ?? null, sourceRef: lesson.sourceRef ?? null,
          });
          if (!update.ok) problems.push(this.toProblem('lessons', index, lesson.slug, update.error));
        }
        unchanged.lessons += 1;
      } else {
        problems.push(this.toProblem('lessons', index, lesson.slug, result.error));
      }
    }

    for (const [index, concept] of pkg.concepts.entries()) {
      const lessonKey = lessonKeyByPath.get(`${concept.unitSlug}/${concept.lessonSlug}`);
      if (!lessonKey) {
        problems.push({
          sheet: 'concepts',
          row: index + 1,
          field: 'lessonSlug',
          reference: concept.slug,
          code: 'import.unresolved_reference',
          message: `Lesson "${concept.unitSlug}/${concept.lessonSlug}" could not be resolved.`,
          severity: 'BLOCKING',
        });
        continue;
      }

      const result = await this.authoring.createConcept(ctx, {
        lessonKey,
        name: concept.name,
        slug: concept.slug,
        description: concept.description ?? null,
        difficulty: concept.difficulty,
        importance: concept.importance,
        masteryThreshold: concept.masteryThreshold,
        isCore: concept.isCore,
        pageNumber: concept.pageNumber ?? null,
        sourceRef: concept.sourceRef ?? null,
        nameEn: concept.nameEn ?? null,
        bloomsLevel: concept.bloomsLevel ?? null,
      });

      const conceptPath = `${concept.unitSlug}/${concept.lessonSlug}/${concept.slug}`;
      if (result.ok) {
        conceptKeyByPath.set(conceptPath, result.value.key);
        generatedKeys.push({ sheet: 'concepts', reference: concept.slug, key: result.value.key });
        created.concepts += 1;
      } else if (result.error.code === 'content.slug_taken') {
        const existing = deriveConceptKey(lessonKey, concept.slug);
        if (existing) conceptKeyByPath.set(conceptPath, existing);
        if (mode === 'UPDATE' && existing) {
          const update = await this.authoring.updateNode(ctx, 'concept', existing, {
            name: concept.name, description: concept.description ?? null, difficulty: concept.difficulty,
            importance: concept.importance, masteryThreshold: concept.masteryThreshold, isCore: concept.isCore,
            pageNumber: concept.pageNumber ?? null, sourceRef: concept.sourceRef ?? null,
            nameEn: concept.nameEn ?? null, bloomsLevel: concept.bloomsLevel ?? null,
          });
          if (!update.ok) problems.push(this.toProblem('concepts', index, concept.slug, update.error));
        }
        unchanged.concepts += 1;
      } else {
        problems.push(this.toProblem('concepts', index, concept.slug, result.error));
      }
    }

    // Concept attachments (G7). Both resolve their parent through the same
    // slug path the concepts loop just built, so a misconception can never
    // silently land on a same-named concept in another lesson.
    for (const [index, mis] of (pkg.misconceptions ?? []).entries()) {
      const conceptKey = conceptKeyByPath.get(
        `${mis.unitSlug}/${mis.lessonSlug}/${mis.conceptSlug}`,
      );
      if (!conceptKey) {
        problems.push({
          sheet: 'misconceptions',
          row: index + 1,
          field: 'conceptSlug',
          reference: mis.slug,
          code: 'import.unresolved_reference',
          message: `Concept "${mis.unitSlug}/${mis.lessonSlug}/${mis.conceptSlug}" could not be resolved.`,
          severity: 'BLOCKING',
        });
        continue;
      }

      const result = await this.authoring.createMisconception(ctx, {
        conceptKey,
        slug: mis.slug,
        name: mis.name,
        description: mis.description,
        correction: mis.correction ?? null,
      });

      if (!result.ok) {
        problems.push(this.toProblem('misconceptions', index, mis.slug, result.error));
      } else if (result.value.created) {
        generatedKeys.push({ sheet: 'misconceptions', reference: mis.slug, key: result.value.key });
        created.misconceptions += 1;
      } else {
        unchanged.misconceptions += 1;
      }
    }

    for (const [index, res] of (pkg.learningResources ?? []).entries()) {
      const scope = resourceScope(res);
      const target: { textbookKey?: string; lessonKey?: string; conceptKey?: string } = {};
      if (scope === 'CONCEPT') {
        const conceptKey = conceptKeyByPath.get(
          `${res.unitSlug ?? ''}/${res.lessonSlug ?? ''}/${res.conceptSlug ?? ''}`,
        );
        if (!conceptKey) {
          problems.push({
            sheet: 'learningResources',
            row: index + 1,
            field: 'conceptSlug',
            reference: res.slug,
            code: 'import.unresolved_reference',
            message: `Concept "${res.unitSlug ?? ''}/${res.lessonSlug ?? ''}/${res.conceptSlug ?? ''}" could not be resolved.`,
            severity: 'BLOCKING',
          });
          continue;
        }
        target.conceptKey = conceptKey;
      } else if (scope === 'LESSON') {
        const lessonKey = lessonKeyByPath.get(`${res.unitSlug ?? ''}/${res.lessonSlug ?? ''}`);
        if (!lessonKey) {
          problems.push({
            sheet: 'learningResources',
            row: index + 1,
            field: 'lessonSlug',
            reference: res.slug,
            code: 'import.unresolved_reference',
            message: `Lesson "${res.unitSlug ?? ''}/${res.lessonSlug ?? ''}" could not be resolved.`,
            severity: 'BLOCKING',
          });
          continue;
        }
        target.lessonKey = lessonKey;
      } else {
        target.textbookKey = textbookKey;
      }

      const result = await this.authoring.createLearningResource(ctx, {
        ...target,
        slug: res.slug,
        kind: res.kind,
        title: res.title,
        body: res.body ?? null,
        url: res.url ?? null,
        orderIndex: res.orderIndex,
        pageStart: res.pageStart ?? null,
        pageEnd: res.pageEnd ?? null,
        estimatedMins: res.estimatedMins ?? null,
      });

      if (!result.ok) {
        problems.push(this.toProblem('learningResources', index, res.slug, result.error));
      } else if (result.value.created) {
        generatedKeys.push({
          sheet: 'learningResources',
          reference: res.slug,
          key: result.value.key,
        });
        created.learningResources += 1;
      } else {
        unchanged.learningResources += 1;
      }
    }

    for (const [index, edge] of pkg.prerequisites.entries()) {
      const result = await this.authoring.linkPrerequisite(ctx, {
        conceptKey: edge.conceptKey,
        prerequisiteKey: edge.prerequisiteKey,
        strength: edge.strength,
        requiredMastery: edge.requiredMastery,
      });

      if (result.ok) {
        // The repository upserts, so a repeated edge is a success rather than
        // a conflict. Counted as created; re-running is safe either way.
        created.prerequisites += 1;
      } else {
        problems.push(
          this.toProblem('prerequisites', index, `${edge.conceptKey} <- ${edge.prerequisiteKey}`, result.error),
        );
      }
    }

    // ── Questions, last: they reference concepts on both sides ───────────
    //
    // Written through ItemBankService, the same service the authoring API
    // uses, so the provenance invariant, the misconception check, the
    // cross-textbook refusal and the write-lock all apply unchanged.
    for (const [index, question] of pkg.questions.entries()) {
      const links: Array<{ conceptKey: string; weight: number; isPrimary: boolean }> = [];
      let unresolved: string | null = null;

      for (const link of question.concepts) {
        const lessonKey = lessonKeyByPath.get(`${link.unitSlug}/${link.lessonSlug}`);
        const conceptKey = lessonKey
          ? buildConceptKey(lessonKey as LessonKey, link.conceptSlug)
          : null;
        if (!conceptKey?.ok) {
          unresolved = `${link.unitSlug}/${link.lessonSlug}/${link.conceptSlug}`;
          break;
        }
        links.push({
          conceptKey: conceptKey.value,
          weight: link.weight,
          isPrimary: link.isPrimary,
        });
      }

      if (unresolved !== null) {
        problems.push({
          sheet: 'questions',
          row: index + 1,
          field: 'conceptSlug',
          reference: question.text.slice(0, 60),
          code: 'import.unresolved_reference',
          message: `Concept "${unresolved}" could not be resolved.`,
          severity: 'BLOCKING',
        });
        continue;
      }

      // Placement comes from the question's own unit/lesson slugs, which the
      // package has always carried. Previously it was inferred from the
      // primary concept, so an item could not be filed without one.
      const questionLessonKey = lessonKeyByPath.get(`${question.unitSlug}/${question.lessonSlug}`);
      if (!questionLessonKey) {
        problems.push({
          sheet: 'questions',
          row: index + 1,
          field: 'lessonSlug',
          reference: question.text.slice(0, 60),
          code: 'import.unresolved_reference',
          message: `Lesson "${question.unitSlug}/${question.lessonSlug}" could not be resolved.`,
          severity: 'BLOCKING',
        });
        continue;
      }

      const result = await this.itemBank.createQuestion(ctx, {
        lessonKey: questionLessonKey,
        type: question.type as never,
        text: question.text,
        hint: question.hint ?? null,
        explanation: question.explanation ?? null,
        points: question.points,
        difficulty01: question.difficulty01,
        // Provenance is carried as the file states it, and the domain decides
        // whether the claim is coherent. An import must not quietly relabel a
        // question's origin, and must not assume one either: a file that says
        // nothing imports as UNKNOWN, which is the honest answer.
        origin: (question.origin ?? 'UNKNOWN') as QuestionOrigin,
        textbookRole: (question.textbookRole ?? null) as TextbookQuestionRole | null,
        sourceRef: question.sourceRef ?? null,
        choices: question.choices.map((c) => ({
          id: c.id,
          text: c.text,
          misconceptionKey: c.misconceptionKey ?? null,
          feedback: c.feedback ?? null,
        })),
        answerKey: {
          correctChoiceIds: question.answerKey.correctChoiceIds,
          acceptedTexts: question.answerKey.acceptedTexts,
          numericMin: question.answerKey.numericMin,
          numericMax: question.answerKey.numericMax,
          caseSensitive: question.answerKey.caseSensitive,
          allowPartialCredit: question.answerKey.allowPartialCredit,
        },
        concepts: links,
      });

      if (result.ok) {
        generatedKeys.push({
          sheet: 'questions',
          reference: question.text.slice(0, 60),
          key: result.value.key,
        });
        created.questions += 1;
      } else if (result.error.code === 'question.exists') {
        // Identity is the stem against the lesson, so the same question twice
        // is the same question. Re-running an import must not fork the bank.
        unchanged.questions += 1;
      } else {
        problems.push(this.toProblem('questions', index, question.text.slice(0, 60), result.error));
      }
    }

    return Ok({
      dryRun: false,
      applied: problems.filter((p) => p.severity === 'BLOCKING').length === 0,
      textbookKey,
      created,
      unchanged,
      generatedKeys,
      problems,
    });
  }

  /** A domain refusal, rewritten as a row a person can locate in their file. */
  private toProblem(
    sheet: string,
    index: number,
    reference: string,
    error: { code: string; message: string },
  ): ImportProblem {
    return {
      sheet,
      row: index + 1,
      field: null,
      reference,
      code: error.code,
      message: error.message,
      severity: 'BLOCKING',
    };
  }

  private collectDuplicates(pkg: ContentPackage, problems: ImportProblem[]): void {
    const check = <T>(sheet: string, rows: readonly T[], id: (row: T) => string): void => {
      const seen = new Map<string, number>();
      rows.forEach((row, index) => {
        const key = id(row);
        const first = seen.get(key);
        if (first !== undefined) {
          problems.push({
            sheet,
            row: index + 1,
            field: null,
            reference: key,
            code: 'import.duplicate_identifier',
            message: `"${key}" also appears at row ${first + 1}.`,
            severity: 'BLOCKING',
          });
          return;
        }
        seen.set(key, index);
      });
    };

    check('units', pkg.units, (u) => u.slug);
    check('lessons', pkg.lessons, (l) => `${l.unitSlug}/${l.slug}`);
    check('concepts', pkg.concepts, (c) => `${c.unitSlug}/${c.lessonSlug}/${c.slug}`);
    check('prerequisites', pkg.prerequisites, (p) => `${p.conceptKey}<-${p.prerequisiteKey}`);
    check('learningResources', pkg.learningResources ?? [], (r) => {
      const scope = resourceScope(r);
      const target =
        scope === 'CONCEPT'
          ? `${r.unitSlug ?? ''}/${r.lessonSlug ?? ''}/${r.conceptSlug ?? ''}`
          : scope === 'LESSON'
            ? `${r.unitSlug ?? ''}/${r.lessonSlug ?? ''}`
            : 'textbook';
      return `${scope}/${target}/${r.slug}`;
    });
    // A question's identity is its text within its lesson, so that is what
    // makes two rows the same row -- not a key column the file should not have
    // been carrying in the first place.
    check('questions', pkg.questions, (q) => `${q.unitSlug}/${q.lessonSlug}/${q.text}`);
  }

  private collectMissingFields(pkg: ContentPackage, problems: ImportProblem[]): void {
    const required = <T>(
      sheet: string,
      rows: readonly T[],
      fields: ReadonlyArray<keyof T & string>,
      id: (row: T) => string,
    ): void => {
      rows.forEach((row, index) => {
        for (const field of fields) {
          const value = row[field];
          if (value === undefined || value === null || String(value).trim() === '') {
            problems.push({
              sheet,
              row: index + 1,
              field,
              reference: id(row),
              code: 'import.required_field_missing',
              message: `"${field}" is required.`,
              severity: 'BLOCKING',
            });
          }
        }
      });
    };

    required('units', pkg.units, ['slug', 'name'], (u) => u.slug ?? '(no slug)');
    required('lessons', pkg.lessons, ['slug', 'name', 'unitSlug'], (l) => l.slug ?? '(no slug)');
    required('concepts', pkg.concepts, ['slug', 'name', 'lessonSlug', 'unitSlug'], (c) => c.slug ?? '(no slug)');
    required(
      'prerequisites',
      pkg.prerequisites,
      ['conceptKey', 'prerequisiteKey'],
      (p) => p.conceptKey ?? '(no concept)',
    );
    required('learningResources', pkg.learningResources ?? [], ['slug', 'kind', 'title'], (r) => r.slug ?? '(no slug)');
    (pkg.learningResources ?? []).forEach((resource, index) => {
      const scope = resourceScope(resource);
      const needed =
        scope === 'CONCEPT'
          ? (['unitSlug', 'lessonSlug', 'conceptSlug'] as const)
          : scope === 'LESSON'
            ? (['unitSlug', 'lessonSlug'] as const)
            : ([] as const);
      for (const field of needed) {
        const value = resource[field];
        if (value === undefined || value === null || String(value).trim() === '') {
          problems.push({
            sheet: 'learningResources',
            row: index + 1,
            field,
            reference: resource.slug ?? '(no slug)',
            code: 'import.required_field_missing',
            message: `"${field}" is required for ${scope.toLowerCase()} resources.`,
            severity: 'BLOCKING',
          });
        }
      }
    });
    required('questions', pkg.questions, ['text', 'type'], (q) => q.text?.slice(0, 60) ?? '(no text)');
  }
}
