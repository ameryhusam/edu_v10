/**
 * The content export contract.
 *
 * These tests defend the three rules the profile exists to enforce: business
 * field names rather than database columns, derived keys reported but never
 * authored, and derived learner state absent entirely.
 */

import { describe, expect, it } from 'vitest';

import { ContentExportService } from '../../src/contexts/content/application/content-export.service.js';
import type { ContentExportReader, ExportableTextbook } from '../../src/contexts/content/application/ports.js';
import {
  CONTENT_IMPORT_ORDER,
  CONTENT_PROFILE,
  CONTENT_PROFILE_VERSION,
  NON_IMPORTABLE_FIELDS,
  checkPackageIntegrity,
  sortPackage,
  type ContentPackage,
} from '../../src/contexts/content/domain/export-profile.js';

const TB = 'EDU-MATH-G07-T1-ED2026';

function exportable(overrides: Partial<ExportableTextbook> = {}): ExportableTextbook {
  return {
    textbook: {
      key: TB,
      subjectKey: 'MATH',
      gradeKey: 'G07',
      termKey: '2026-2027-T01',
      title: 'Mathematics',
      edition: '2026',
      description: null,
      issuer: null,
      isbn: null,
      publishYear: null,
      totalPages: null,
      status: 'DRAFT',
    },
    units: [
      {
        key: `${TB}-U-SETS`,
        slug: 'SETS',
        parentUnitSlug: null,
        name: 'Sets',
        orderIndex: 0,
        startPage: null,
        endPage: null,
        isActive: true,
        sourceRef: null,
      },
    ],
    lessons: [
      {
        key: `${TB}-U-SETS-L-INTRO`,
        slug: 'INTRO',
        unitSlug: 'SETS',
        name: 'Intro',
        description: null,
        orderIndex: 0,
        estimatedMins: null,
        startPage: null,
        endPage: null,
        isActive: true,
        sourceRef: null,
      },
    ],
    concepts: [
      {
        key: `${TB}-U-SETS-L-INTRO-C-SET`,
        slug: 'SET',
        lessonSlug: 'INTRO',
        unitSlug: 'SETS',
        name: 'Set',
        description: null,
        orderIndex: 0,
        difficulty: 0.5,
        importance: 0.5,
        masteryThreshold: 0.85,
        isCore: true,
        isActive: true,
        pageNumber: null,
        sourceRef: null,
        nameEn: null,
        bloomsLevel: null,
      },
    ],
    prerequisites: [],
    misconceptions: [],
    learningResources: [],
    questions: [],
    ...overrides,
  };
}

class FakeReader implements ContentExportReader {
  constructor(private readonly data: ExportableTextbook | null) {}
  async readExportable() {
    return this.data;
  }
}

const clock = { now: () => new Date('2026-09-12T10:00:00.000Z') };

const setup = (data: ExportableTextbook | null = exportable()) =>
  new ContentExportService(new FakeReader(data), clock);

const CTX = { actorKey: 'usr_author' };

describe('content export — the package', () => {
  it('declares its profile and version so an importer can refuse what it cannot read', async () => {
    const res = await setup().exportTextbook(CTX, TB);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.meta.profile).toBe(CONTENT_PROFILE);
    expect(res.value.meta.profileVersion).toBe(CONTENT_PROFILE_VERSION);
    expect(res.value.meta.scope).toBe('FULL');
  });

  it('uses business codes, never database ids', async () => {
    const res = await setup().exportTextbook(CTX, TB);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const flat = JSON.stringify(res.value);
    expect(res.value.textbook.subjectKey).toBe('MATH');
    // A UUID anywhere in the payload means an internal id leaked.
    expect(flat).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(flat).not.toContain('textbookId');
    expect(flat).not.toContain('unitId');
    expect(flat).not.toContain('lessonId');
  });

  it('references children by slug, so nesting survives a re-key', async () => {
    const res = await setup().exportTextbook(CTX, TB);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.lessons[0]!.unitSlug).toBe('SETS');
    expect(res.value.concepts[0]!.lessonSlug).toBe('INTRO');
    expect(res.value.concepts[0]!.unitSlug).toBe('SETS');
  });

  it('carries no derived learner state', async () => {
    const res = await setup().exportTextbook(CTX, TB);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // Assert on FIELD NAMES, not on a substring of the whole document: a naive
    // search for "xp" matches "exportedAt", which would have made this pass
    // for the wrong reason.
    const fieldNames = new Set<string>();
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (node && typeof node === 'object') {
        for (const [k, v] of Object.entries(node)) {
          fieldNames.add(k.toLowerCase());
          walk(v);
        }
      }
    };
    walk(res.value);

    for (const forbidden of ['xp', 'evidence', 'attempts', 'completion', 'streak', 'masterylevel']) {
      expect(fieldNames.has(forbidden)).toBe(false);
    }
    // And nothing that merely contains those words as a whole field either.
    expect([...fieldNames].some((f) => f.includes('evidence') || f.includes('attempt'))).toBe(false);
    // masteryThreshold is content (an authored setting), not learner state.
    expect(res.value.concepts[0]!.masteryThreshold).toBe(0.85);
  });

  it('reports status but marks it non-importable', async () => {
    const res = await setup().exportTextbook(CTX, TB);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.textbook.status).toBe('DRAFT');
    expect(NON_IMPORTABLE_FIELDS).toContain('status');
    expect(NON_IMPORTABLE_FIELDS).toContain('key');
  });

  it('exports a draft, because review and hand-off need work in progress', async () => {
    const res = await setup().exportTextbook(CTX, TB);
    expect(res.ok).toBe(true);
  });

  it('refuses an unknown textbook rather than returning an empty package', async () => {
    const res = await setup(null).exportTextbook(CTX, 'NOPE');

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('content.textbook_not_found');
  });

  it('declares a dependency order every reference can be resolved in', () => {
    expect(CONTENT_IMPORT_ORDER[0]).toBe('textbook');

    // What matters is not which entity is last, but that nothing is read
    // before what it points at. Questions reference concepts, and prerequisite
    // edges reference concepts on both ends, so both must follow concepts.
    const position = (entity: string) => CONTENT_IMPORT_ORDER.indexOf(entity as never);
    expect(position('units')).toBeLessThan(position('lessons'));
    expect(position('lessons')).toBeLessThan(position('concepts'));
    expect(position('concepts')).toBeLessThan(position('prerequisites'));
    expect(position('concepts')).toBeLessThan(position('questions'));
  });
});

describe('content export — determinism', () => {
  it('is byte-identical across two exports of unchanged content', async () => {
    const service = setup();
    const a = await service.exportTextbook(CTX, TB);
    const b = await service.exportTextbook(CTX, TB);

    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(JSON.stringify(a.value)).toBe(JSON.stringify(b.value));
  });

  it('orders by business identifier, not by the order rows arrived', () => {
    const shuffled = exportable({
      units: [
        { key: 'k2', slug: 'ZEBRA', parentUnitSlug: null, name: 'Z', orderIndex: 1, startPage: null, endPage: null, isActive: true, sourceRef: null },
        { key: 'k1', slug: 'ALPHA', parentUnitSlug: null, name: 'A', orderIndex: 0, startPage: null, endPage: null, isActive: true, sourceRef: null },
      ],
      lessons: [],
      concepts: [],
    });
    const sorted = sortPackage({
      meta: { profile: CONTENT_PROFILE, profileVersion: CONTENT_PROFILE_VERSION, scope: 'FULL', exportedAt: 'x' },
      ...shuffled,
    } as unknown as ContentPackage);

    expect(sorted.units.map((u) => u.slug)).toEqual(['ALPHA', 'ZEBRA']);
  });
});

describe('content export — integrity', () => {
  const pkg = (over: Partial<ContentPackage>): ContentPackage =>
    ({
      meta: { profile: CONTENT_PROFILE, profileVersion: CONTENT_PROFILE_VERSION, scope: 'FULL', exportedAt: 'x' },
      ...exportable(),
      ...over,
    }) as unknown as ContentPackage;

  it('accepts a self-consistent package', () => {
    expect(checkPackageIntegrity(pkg({})).ok).toBe(true);
  });

  it('rejects a lesson whose unit is missing', () => {
    const broken = pkg({
      lessons: [
        {
          key: 'k',
          slug: 'ORPHAN',
          unitSlug: 'NO-SUCH-UNIT',
          name: 'Orphan',
          description: null,
          orderIndex: 0,
          estimatedMins: null,
          startPage: null,
          endPage: null,
          isActive: true,
          sourceRef: null,
        },
      ],
      concepts: [],
    });
    const result = checkPackageIntegrity(broken);

    expect(result.ok).toBe(false);
    expect(result.problems[0]).toContain('missing unit');
  });

  it('rejects a unit whose parent is missing', () => {
    const broken = pkg({
      units: [
        { key: 'k', slug: 'CHILD', parentUnitSlug: 'GHOST', name: 'C', orderIndex: 0, startPage: null, endPage: null, isActive: true, sourceRef: null },
      ],
      lessons: [],
      concepts: [],
    });

    expect(checkPackageIntegrity(broken).ok).toBe(false);
  });

  it('treats a prerequisite outside the book as external, not broken', () => {
    // Cross-grade prerequisites are real: an edge may point at another book.
    const withExternal = pkg({
      prerequisites: [
        {
          conceptKey: `${TB}-U-SETS-L-INTRO-C-SET`,
          prerequisiteKey: 'EDU-MATH-G06-T1-ED2026-U-X-L-Y-C-Z',
          strength: 0.8,
          requiredMastery: 0.7,
        },
      ],
    });
    const result = checkPackageIntegrity(withExternal);

    expect(result.ok).toBe(true);
    expect(result.externalPrerequisites).toHaveLength(1);
  });

  it('rejects an edge whose own concept is missing from the package', () => {
    const broken = pkg({
      prerequisites: [
        { conceptKey: 'NOT-IN-PACKAGE', prerequisiteKey: 'ALSO-NOT', strength: 0.8, requiredMastery: 0.7 },
      ],
    });

    expect(checkPackageIntegrity(broken).ok).toBe(false);
  });

  it('fails the export when its own output is inconsistent', async () => {
    const inconsistent = exportable({
      lessons: [
        {
          key: 'k',
          slug: 'ORPHAN',
          unitSlug: 'NO-SUCH-UNIT',
          name: 'Orphan',
          description: null,
          orderIndex: 0,
          estimatedMins: null,
          startPage: null,
          endPage: null,
          isActive: true,
          sourceRef: null,
        },
      ],
      concepts: [],
    });
    const res = await setup(inconsistent).exportTextbook(CTX, TB);

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('content.export_inconsistent');
  });
});

/**
 * Export/import parity.
 *
 * The bug these defend against was silent: `readExportable` simply did not
 * select misconceptions or learning resources, so `import(export(X))` produced
 * a strictly smaller book than X and said nothing. Both collections are
 * OPTIONAL in the package format, so no schema check could catch it, and every
 * existing test passed because the fixtures never had any.
 */
describe('content export — parity with import', () => {
  const WITH_ATTACHMENTS = exportable({
    misconceptions: [
      {
        slug: 'ANY-GROUP-IS-A-SET',
        unitSlug: 'SETS',
        lessonSlug: 'INTRO',
        conceptSlug: 'SET',
        name: 'Any collection is a set',
        description: 'Treats an ill-defined collection as a set.',
        correction: 'Membership must be decidable.',
      },
    ],
    learningResources: [
      {
        slug: 'WHAT-IS-A-SET',
        unitSlug: 'SETS',
        lessonSlug: 'INTRO',
        conceptSlug: 'SET',
        kind: 'READING',
        title: 'What is a set?',
        body: null,
        url: 'https://example.invalid/sets',
        orderIndex: 0,
        pageStart: 9,
        pageEnd: 10,
        estimatedMins: 5,
      },
    ],
  });

  it('emits every collection the package format can carry', async () => {
    const res = await setup(WITH_ATTACHMENTS).exportTextbook(CTX, TB);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.misconceptions).toHaveLength(1);
    expect(res.value.learningResources).toHaveLength(1);
  });

  /**
   * The regression guard proper.
   *
   * Asserting "misconceptions is present" only defends the two fields that
   * were missed this time. This instead requires every collection the IMPORTER
   * reads — CONTENT_IMPORT_ORDER, the one list both sides already agree on —
   * to appear in the exporter's output. A future collection added to the
   * format fails here until export carries it too.
   */
  it('exports every entity the importer is prepared to read', async () => {
    const res = await setup(WITH_ATTACHMENTS).exportTextbook(CTX, TB);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const pkg = res.value as unknown as Record<string, unknown>;

    for (const entity of CONTENT_IMPORT_ORDER) {
      expect(Object.hasOwn(pkg, entity)).toBe(true);
    }
  });

  it('round-trips attachment fields without losing or renaming any', async () => {
    const res = await setup(WITH_ATTACHMENTS).exportTextbook(CTX, TB);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // Deep equality, not a spot-check: a dropped `correction` or a renamed
    // `pageStart` is exactly the kind of loss that stays invisible otherwise.
    expect(res.value.misconceptions).toEqual(WITH_ATTACHMENTS.misconceptions);
    expect(res.value.learningResources).toEqual(WITH_ATTACHMENTS.learningResources);
  });

  it('orders attachments deterministically, so two exports diff clean', async () => {
    const shuffled = exportable({
      misconceptions: [
        { slug: 'B', unitSlug: 'SETS', lessonSlug: 'INTRO', conceptSlug: 'SET', name: 'B', description: 'b', correction: null },
        { slug: 'A', unitSlug: 'SETS', lessonSlug: 'INTRO', conceptSlug: 'SET', name: 'A', description: 'a', correction: null },
      ],
      learningResources: [
        { slug: 'SECOND', unitSlug: 'SETS', lessonSlug: 'INTRO', conceptSlug: 'SET', kind: 'READING', title: '2', body: null, url: null, orderIndex: 5, pageStart: null, pageEnd: null, estimatedMins: null },
        { slug: 'FIRST', unitSlug: 'SETS', lessonSlug: 'INTRO', conceptSlug: 'SET', kind: 'READING', title: '1', body: null, url: null, orderIndex: 1, pageStart: null, pageEnd: null, estimatedMins: null },
      ],
    });
    const res = await setup(shuffled).exportTextbook(CTX, TB);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.misconceptions?.map((m) => m.slug)).toEqual(['A', 'B']);
    // Resources sort on the author's reading order, not the slug: FIRST has
    // the lower orderIndex, and would sort second if the slug won.
    expect(res.value.learningResources?.map((r) => r.slug)).toEqual(['FIRST', 'SECOND']);
  });

  it('refuses an attachment pointing at a concept that is not in the book', async () => {
    const dangling = exportable({
      misconceptions: [
        {
          slug: 'ORPHAN',
          unitSlug: 'SETS',
          lessonSlug: 'INTRO',
          conceptSlug: 'NO-SUCH-CONCEPT',
          name: 'Orphan',
          description: 'points nowhere',
          correction: null,
        },
      ],
    });
    const res = await setup(dangling).exportTextbook(CTX, TB);

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('content.export_inconsistent');
  });
});

/**
 * Legacy provenance.
 *
 * A migrated book must be traceable back to the curriculum it came from, but
 * the legacy reference must never become identity: the legacy maths export
 * reuses one questionKey across up to three distinct questions in a lesson, so
 * anything that treats it as a key either rejects valid content or resolves to
 * the wrong row.
 */
describe('content export — legacy provenance', () => {
  const MIGRATED = exportable({
    units: [
      {
        key: `${TB}-U-SETS`,
        slug: 'SETS',
        parentUnitSlug: null,
        name: 'Sets',
        orderIndex: 0,
        startPage: null,
        endPage: null,
        isActive: true,
        sourceRef: 'EDU-2026-MATH-G07-T1-U01',
      },
    ],
    concepts: [
      {
        key: `${TB}-U-SETS-L-INTRO-C-SET`,
        slug: 'SET',
        lessonSlug: 'INTRO',
        unitSlug: 'SETS',
        name: 'المجموعة',
        description: null,
        orderIndex: 0,
        difficulty: 0.25,
        importance: 0.9,
        masteryThreshold: 0.75,
        isCore: true,
        isActive: true,
        pageNumber: 9,
        sourceRef: 'EDU-2026-MATH-G07-T1-U01-L01-C01',
        nameEn: 'Set',
        bloomsLevel: 'remember',
      },
    ],
  });

  it('carries the legacy reference through the package', async () => {
    const res = await setup(MIGRATED).exportTextbook(CTX, TB);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.units[0]!.sourceRef).toBe('EDU-2026-MATH-G07-T1-U01');
    expect(res.value.concepts[0]!.sourceRef).toBe('EDU-2026-MATH-G07-T1-U01-L01-C01');
  });

  it('keeps editorial fields the old converter discarded', async () => {
    const res = await setup(MIGRATED).exportTextbook(CTX, TB);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // Both are authored content, not derivable later: nameEn would have to be
    // re-translated and bloomsLevel re-decided, neither checkable against the
    // original once dropped.
    expect(res.value.concepts[0]!.nameEn).toBe('Set');
    expect(res.value.concepts[0]!.bloomsLevel).toBe('remember');
  });

  it('never lets the legacy reference act as identity', async () => {
    // Two distinct concepts sharing one legacy reference is exactly what the
    // real data does. It must export cleanly: identity is the derived key and
    // the slug, and sourceRef is descriptive.
    const shared = exportable({
      concepts: [
        {
          key: `${TB}-U-SETS-L-INTRO-C-A`, slug: 'A', lessonSlug: 'INTRO', unitSlug: 'SETS',
          name: 'A', description: null, orderIndex: 0, difficulty: 0.5, importance: 0.5,
          masteryThreshold: 0.85, isCore: true, isActive: true, pageNumber: null,
          sourceRef: 'SAME-LEGACY-KEY', nameEn: null, bloomsLevel: null,
        },
        {
          key: `${TB}-U-SETS-L-INTRO-C-B`, slug: 'B', lessonSlug: 'INTRO', unitSlug: 'SETS',
          name: 'B', description: null, orderIndex: 1, difficulty: 0.5, importance: 0.5,
          masteryThreshold: 0.85, isCore: true, isActive: true, pageNumber: null,
          sourceRef: 'SAME-LEGACY-KEY', nameEn: null, bloomsLevel: null,
        },
      ],
    });
    const res = await setup(shared).exportTextbook(CTX, TB);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.concepts).toHaveLength(2);
    expect(new Set(res.value.concepts.map((c) => c.sourceRef)).size).toBe(1);
    expect(new Set(res.value.concepts.map((c) => c.key)).size).toBe(2);
  });

  it('treats provenance as optional, so a natively-authored book is valid', async () => {
    const res = await setup().exportTextbook(CTX, TB);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.units[0]!.sourceRef).toBeNull();
  });
});
