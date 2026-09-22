/**
 * Content import — the first slice: units, lessons, concepts, prerequisites.
 *
 * The property under test throughout is that the importer is an ADAPTER. It
 * holds no persistence and derives no keys; every write goes through the same
 * ContentAuthoringService the HTTP API calls. These tests use a spy in place of
 * that service, so they can assert exactly which canonical calls were made and
 * with what.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  ContentImportService,
  type ImportProblem,
} from '../../src/contexts/content/application/content-import.service.js';
import {
  CONTENT_PROFILE,
  CONTENT_PROFILE_VERSION,
  type ContentPackage,
} from '../../src/contexts/content/domain/export-profile.js';
import { Errors } from '../../src/shared/kernel/errors.js';
import { Err, Ok } from '../../src/shared/kernel/result.js';

const TB = 'EDU-MATH-G07-P1-ED2026';
const CTX = { actorKey: 'usr_author' };

/**
 * Stands in for ContentAuthoringService and records what the importer asked
 * for. Keys are derived the way the real service derives them, so a test can
 * check that children were attached to the key the parent call returned.
 */
class SpyAuthoring {
  calls: Array<{ method: string; input: Record<string, unknown> }> = [];
  existingSlugs = new Set<string>();
  /** A package targets an existing textbook; flip to prove the refusal. */
  textbookPresent = true;
  failWith: { slug: string; error: ReturnType<typeof Errors.validation> } | null = null;

  async textbookExists(_key: string) {
    return this.textbookPresent;
  }

  async createTextbook(_ctx: unknown, input: { subjectKey: string; gradeKey: string; part: 'PART_1' | 'PART_2'; title: string; edition: string }) {
    this.calls.push({ method: 'createTextbook', input });
    return Ok({ key: TB, title: input.title, edition: input.edition, status: 'DRAFT' });
  }

  async createUnit(_ctx: unknown, input: { textbookKey: string; parentUnitKey?: string | null; name: string; slug?: string | null }) {
    this.calls.push({ method: 'createUnit', input });
    const slug = input.slug!;
    if (this.failWith?.slug === slug) return Err(this.failWith.error);
    if (this.existingSlugs.has(`unit:${slug}`)) {
      return Err(Errors.conflict('content.slug_taken', 'taken', { slug }));
    }
    return Ok({ key: `${input.textbookKey}-U-${slug}`, slug, name: input.name });
  }

  async createLesson(_ctx: unknown, input: { unitKey: string; name: string; slug?: string | null; description?: string | null }) {
    this.calls.push({ method: 'createLesson', input });
    const slug = input.slug!;
    if (this.existingSlugs.has(`lesson:${slug}`)) {
      return Err(Errors.conflict('content.slug_taken', 'taken', { slug }));
    }
    return Ok({ key: `${input.unitKey}-L-${slug}`, slug, name: input.name });
  }

  async createConcept(_ctx: unknown, input: { lessonKey: string; name: string; slug?: string | null; description?: string | null }) {
    this.calls.push({ method: 'createConcept', input });
    const slug = input.slug!;
    if (this.existingSlugs.has(`concept:${slug}`)) {
      return Err(Errors.conflict('content.slug_taken', 'taken', { slug }));
    }
    return Ok({ key: `${input.lessonKey}-C-${slug}`, slug, name: input.name });
  }

  async linkPrerequisite(_ctx: unknown, input: { conceptKey: string; prerequisiteKey: string }) {
    this.calls.push({ method: 'linkPrerequisite', input });
    return Ok({ conceptKey: input.conceptKey, prerequisiteKey: input.prerequisiteKey });
  }

  async createLearningResource(_ctx: unknown, input: { slug?: string; title: string }) {
    this.calls.push({ method: 'createLearningResource', input });
    return Ok({ key: `RES-${input.slug || 'R1'}`, created: true });
  }

  async createMisconception(_ctx: unknown, input: { slug?: string; name: string }) {
    this.calls.push({ method: 'createMisconception', input });
    return Ok({ key: `MIS-${input.slug || 'M1'}`, created: true });
  }
}

/**
 * Stands in for ItemBankService. Questions are written through a different
 * canonical service from structure, and the importer must respect that split
 * rather than collapsing both into one write.
 */
class SpyItemBank {
  calls: Array<{ method: string; input: Record<string, unknown> }> = [];
  existingTexts = new Set<string>();
  failWith: { text: string; error: ReturnType<typeof Errors.validation> } | null = null;

  async createQuestion(_ctx: unknown, input: Record<string, unknown>) {
    this.calls.push({ method: 'createQuestion', input });
    const text = input.text as string;
    if (this.failWith?.text === text) return Err(this.failWith.error);
    if (this.existingTexts.has(text)) {
      return Err(Errors.conflict('question.exists', 'already present', { text }));
    }
    return Ok({ key: `Q-${text.replace(/\W+/g, '').slice(0, 8)}`, text });
  }
}

const QUESTION = {
  key: 'ignored',
  unitSlug: 'SETS',
  lessonSlug: 'INTRO',
  type: 'MCQ_SINGLE',
  text: 'What is a set?',
  hint: null,
  explanation: null,
  points: 1,
  difficulty01: 0.5,
  origin: 'TEXTBOOK',
  textbookRole: 'EXERCISE',
  choices: [
    { id: 'c1', text: 'A collection', orderIndex: 0, misconceptionKey: null, feedback: null },
    { id: 'c2', text: 'A number', orderIndex: 1, misconceptionKey: null, feedback: null },
  ],
  answerKey: {
    correctChoiceIds: ['c1'],
    acceptedTexts: [],
    numericMin: null,
    numericMax: null,
    caseSensitive: false,
    allowPartialCredit: false,
  },
  concepts: [
    { unitSlug: 'SETS', lessonSlug: 'INTRO', conceptSlug: 'SET', weight: 1, isPrimary: true },
  ],
  status: 'DRAFT',
} as const;

function pkg(over: Partial<ContentPackage> = {}): ContentPackage {
  return {
    meta: {
      profile: CONTENT_PROFILE,
      profileVersion: CONTENT_PROFILE_VERSION,
      scope: 'FULL',
      exportedAt: '2026-09-12T10:00:00.000Z',
    },
    textbook: {
      key: TB,
      subjectKey: 'MATH',
      gradeKey: 'G07',
      part: 'PART_1',
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
      { key: 'ignored', slug: 'SETS', parentUnitSlug: null, name: 'Sets', orderIndex: 0, startPage: null, endPage: null, isActive: true },
    ],
    lessons: [
      { key: 'ignored', slug: 'INTRO', unitSlug: 'SETS', name: 'Intro', description: null, orderIndex: 0, estimatedMins: null, startPage: null, endPage: null, isActive: true },
    ],
    concepts: [
      { key: 'ignored', slug: 'SET', lessonSlug: 'INTRO', unitSlug: 'SETS', name: 'Set', description: null, orderIndex: 0, difficulty: 0.5, importance: 0.5, masteryThreshold: 0.85, isCore: true, isActive: true, pageNumber: null },
    ],
    prerequisites: [],
    questions: [],
    ...over,
  } as ContentPackage;
}

const setup = () => {
  const authoring = new SpyAuthoring();
  const itemBank = new SpyItemBank();
  return {
    authoring,
    itemBank,
    service: new ContentImportService(authoring as never, itemBank as never),
  };
};

describe('content import — it is an adapter, not a write path', () => {
  it('creates everything through the canonical authoring service', async () => {
    const { authoring, service } = setup();
    const res = await service.importPackage(CTX, pkg(), { dryRun: false });

    expect(res.ok).toBe(true);
    expect(authoring.calls.map((c) => c.method)).toEqual([
      'createUnit',
      'createLesson',
      'createConcept',
    ]);
  });

  it('attaches children to the key the parent call returned, never a composed one', async () => {
    const { authoring, service } = setup();
    await service.importPackage(CTX, pkg(), { dryRun: false });

    const lesson = authoring.calls.find((c) => c.method === 'createLesson')!;
    const concept = authoring.calls.find((c) => c.method === 'createConcept')!;
    expect(lesson.input.unitKey).toBe(`${TB}-U-SETS`);
    expect(concept.input.lessonKey).toBe(`${TB}-U-SETS-L-INTRO`);
  });

  it('ignores the key column in the file and reports the derived key instead', async () => {
    const { authoring, service } = setup();
    const res = await service.importPackage(CTX, pkg(), { dryRun: false });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // Nothing named "ignored" was ever sent to the domain.
    expect(JSON.stringify(authoring.calls)).not.toContain('ignored');
    expect(res.value.generatedKeys).toContainEqual({
      sheet: 'units',
      reference: 'SETS',
      key: `${TB}-U-SETS`,
    });
  });
});

describe('content import — dry run', () => {
  it('writes nothing and says so', async () => {
    const { authoring, service } = setup();
    const res = await service.importPackage(CTX, pkg(), { dryRun: true });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.dryRun).toBe(true);
    expect(res.value.applied).toBe(false);
    expect(authoring.calls).toHaveLength(0);
  });

  it('reports the same problems a real run would', async () => {
    const { service } = setup();
    const broken = pkg({
      lessons: [
        { key: 'k', slug: 'ORPHAN', unitSlug: 'GHOST', name: 'Orphan', description: null, orderIndex: 0, estimatedMins: null, startPage: null, endPage: null, isActive: true },
      ],
      concepts: [],
    });

    const dry = await service.importPackage(CTX, broken, { dryRun: true });
    const wet = await service.importPackage(CTX, broken, { dryRun: false });

    expect(dry.ok && wet.ok).toBe(true);
    if (!dry.ok || !wet.ok) return;
    expect(dry.value.problems.map((p) => p.code)).toEqual(wet.value.problems.map((p) => p.code));
    expect(wet.value.applied).toBe(false);
  });
});

describe('content import — validation before any write', () => {
  it('refuses a package that is not an Edu7 content profile', async () => {
    const { authoring, service } = setup();
    const res = await service.importPackage(
      CTX,
      pkg({ meta: { ...pkg().meta, profile: 'something.else' } as never }),
      { dryRun: false },
    );

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('import.unknown_profile');
    expect(authoring.calls).toHaveLength(0);
  });

  it('refuses a different major profile version rather than guessing', async () => {
    const { service } = setup();
    const res = await service.importPackage(
      CTX,
      pkg({ meta: { ...pkg().meta, profileVersion: '2.0' } as never }),
      { dryRun: false },
    );

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('import.unsupported_profile_version');
  });

  it('accepts a newer minor version of the same major', async () => {
    const { service } = setup();
    const res = await service.importPackage(
      CTX,
      pkg({ meta: { ...pkg().meta, profileVersion: '1.7' } as never }),
      { dryRun: true },
    );

    expect(res.ok).toBe(true);
  });

  it('rejects a duplicate identifier instead of picking a winner', async () => {
    const { authoring, service } = setup();
    const duplicated = pkg({
      units: [
        { key: 'a', slug: 'SETS', parentUnitSlug: null, name: 'First', orderIndex: 0, startPage: null, endPage: null, isActive: true },
        { key: 'b', slug: 'SETS', parentUnitSlug: null, name: 'Second', orderIndex: 1, startPage: null, endPage: null, isActive: true },
      ],
      lessons: [],
      concepts: [],
    });

    const res = await service.importPackage(CTX, duplicated, { dryRun: false });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.applied).toBe(false);
    expect(res.value.problems[0]?.code).toBe('import.duplicate_identifier');
    expect(res.value.problems[0]?.row).toBe(2);
    // Nothing was written: validation completes before any write begins.
    expect(authoring.calls).toHaveLength(0);
  });

  it('rejects an unresolved reference rather than nulling it', async () => {
    const { authoring, service } = setup();
    const res = await service.importPackage(
      CTX,
      pkg({
        lessons: [
          { key: 'k', slug: 'L', unitSlug: 'NO-SUCH-UNIT', name: 'L', description: null, orderIndex: 0, estimatedMins: null, startPage: null, endPage: null, isActive: true },
        ],
        concepts: [],
      }),
      { dryRun: false },
    );

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.applied).toBe(false);
    expect(res.value.problems.some((p) => p.code === 'import.unresolved_reference')).toBe(true);
    expect(authoring.calls).toHaveLength(0);
  });

  it('reports a missing required field with its sheet, row and field name', async () => {
    const { service } = setup();
    const res = await service.importPackage(
      CTX,
      pkg({
        units: [
          { key: 'k', slug: 'SETS', parentUnitSlug: null, name: '', orderIndex: 0, startPage: null, endPage: null, isActive: true },
        ],
        lessons: [],
        concepts: [],
      }),
      { dryRun: false },
    );

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const problem = res.value.problems.find((p) => p.code === 'import.required_field_missing');
    expect(problem).toMatchObject({ sheet: 'units', row: 1, field: 'name', severity: 'BLOCKING' });
  });

  it('never returns a bare "import failed" with no detail', async () => {
    const { service } = setup();
    const res = await service.importPackage(
      CTX,
      pkg({ units: [], lessons: [{ key: 'k', slug: 'X', unitSlug: 'GONE', name: 'X', description: null, orderIndex: 0, estimatedMins: null, startPage: null, endPage: null, isActive: true }], concepts: [] }),
      { dryRun: false },
    );

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    for (const problem of res.value.problems) {
      expect(problem.code).toMatch(/^import\./);
      expect(problem.message.length).toBeGreaterThan(0);
      expect(problem.reference.length).toBeGreaterThan(0);
    }
  });
});

describe('content import — re-running', () => {
  it('counts an existing node as unchanged, not as an error', async () => {
    const { authoring, service } = setup();
    authoring.existingSlugs.add('unit:SETS');

    const res = await service.importPackage(CTX, pkg(), { dryRun: false });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.unchanged.units).toBe(1);
    expect(res.value.created.units).toBe(0);
    expect(res.value.applied).toBe(true);
  });

  it('still resolves children under a unit that already existed', async () => {
    const { authoring, service } = setup();
    authoring.existingSlugs.add('unit:SETS');

    await service.importPackage(CTX, pkg(), { dryRun: false });

    // The lesson must still be created, against the existing unit's key.
    const lesson = authoring.calls.find((c) => c.method === 'createLesson');
    expect(lesson?.input.unitKey).toBe(`${TB}-U-SETS`);
  });

  it('surfaces a domain refusal as a row-level problem', async () => {
    const { authoring, service } = setup();
    authoring.failWith = {
      slug: 'SETS',
      error: Errors.validation('content.textbook_locked', 'This book is published.'),
    };

    const res = await service.importPackage(CTX, pkg(), { dryRun: false });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const problem = res.value.problems.find((p) => p.code === 'content.textbook_locked');
    expect(problem).toMatchObject({ sheet: 'units', row: 1, reference: 'SETS' });
    // The domain's own refusal reached the report unchanged -- import did not
    // reinterpret or swallow it.
    expect(res.value.applied).toBe(false);
  });
});

describe('content import — ordering', () => {
  it('creates a parent unit before its nested child', async () => {
    const { authoring, service } = setup();
    const nested = pkg({
      units: [
        { key: 'a', slug: 'PARENT', parentUnitSlug: null, name: 'Parent', orderIndex: 0, startPage: null, endPage: null, isActive: true },
        { key: 'b', slug: 'CHILD', parentUnitSlug: 'PARENT', name: 'Child', orderIndex: 1, startPage: null, endPage: null, isActive: true },
      ],
      lessons: [],
      concepts: [],
    });

    await service.importPackage(CTX, nested, { dryRun: false });

    const child = authoring.calls.find((c) => (c.input as { slug: string }).slug === 'CHILD');
    expect(child?.input.parentUnitKey).toBe(`${TB}-U-PARENT`);
  });

  it('refuses a child that appears before its parent', async () => {
    const { service } = setup();
    const outOfOrder = pkg({
      units: [
        { key: 'b', slug: 'CHILD', parentUnitSlug: 'PARENT', name: 'Child', orderIndex: 0, startPage: null, endPage: null, isActive: true },
        { key: 'a', slug: 'PARENT', parentUnitSlug: null, name: 'Parent', orderIndex: 1, startPage: null, endPage: null, isActive: true },
      ],
      lessons: [],
      concepts: [],
    });

    const res = await service.importPackage(CTX, outOfOrder, { dryRun: false });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.problems.some((p) => p.code === 'import.parent_after_child')).toBe(true);
  });

  it('links prerequisites last, after every concept exists', async () => {
    const { authoring, service } = setup();
    // Two real concepts: a self-edge is refused by integrity, correctly.
    const withEdges = pkg({
      // Real keys here: prerequisite edges reference concepts BY KEY, so the
      // package must be internally consistent on keys even though the importer
      // ignores them when creating nodes.
      concepts: [
        { key: `${TB}-U-SETS-L-INTRO-C-SET`, slug: 'SET', lessonSlug: 'INTRO', unitSlug: 'SETS', name: 'Set', description: null, orderIndex: 0, difficulty: 0.5, importance: 0.5, masteryThreshold: 0.85, isCore: true, isActive: true, pageNumber: null },
        { key: `${TB}-U-SETS-L-INTRO-C-SUBSET`, slug: 'SUBSET', lessonSlug: 'INTRO', unitSlug: 'SETS', name: 'Subset', description: null, orderIndex: 1, difficulty: 0.6, importance: 0.5, masteryThreshold: 0.85, isCore: false, isActive: true, pageNumber: null },
      ],
      prerequisites: [
        {
          conceptKey: `${TB}-U-SETS-L-INTRO-C-SUBSET`,
          prerequisiteKey: `${TB}-U-SETS-L-INTRO-C-SET`,
          strength: 0.8,
          requiredMastery: 0.7,
        },
      ],
    });

    await service.importPackage(CTX, withEdges, { dryRun: false });

    const methods = authoring.calls.map((c) => c.method);
    expect(methods.indexOf('linkPrerequisite')).toBeGreaterThan(methods.indexOf('createConcept'));
  });
});

describe('content import — derived state is never importable', () => {
  it('makes no call carrying mastery, evidence or xp', async () => {
    const { authoring, service } = setup();
    await service.importPackage(CTX, pkg(), { dryRun: false });

    const sent = JSON.stringify(authoring.calls).toLowerCase();
    for (const forbidden of ['evidence', 'attempt', 'xp"', 'masterylevel', 'completion']) {
      expect(sent).not.toContain(forbidden);
    }
  });

  it('does not pass publication status through to the domain', async () => {
    const { authoring, service } = setup();
    await service.importPackage(CTX, pkg(), { dryRun: false });

    // status is reported by export but must never be an import input:
    // publication is a two-actor reviewed transition.
    for (const call of authoring.calls) {
      expect(Object.keys(call.input)).not.toContain('status');
    }
  });
});

describe('content import — questions', () => {
  it('writes questions through the item bank, not the authoring service', async () => {
    const { authoring, itemBank, service } = setup();
    await service.importPackage(CTX, pkg({ questions: [QUESTION] }), { dryRun: false });

    // Structure and items are separate canonical services. An importer that
    // wrote a question through the authoring service would be inventing a
    // third definition of what a question is.
    expect(itemBank.calls.map((c) => c.method)).toEqual(['createQuestion']);
    expect(authoring.calls.some((c) => c.method === 'createQuestion')).toBe(false);
  });

  it('resolves concept links to the keys the structure pass produced', async () => {
    const { itemBank, service } = setup();
    await service.importPackage(CTX, pkg({ questions: [QUESTION] }), { dryRun: false });

    const input = itemBank.calls[0]!.input as { concepts: Array<{ conceptKey: string }> };
    expect(input.concepts[0]!.conceptKey).toBe(`${TB}-U-SETS-L-INTRO-C-SET`);
  });

  it('carries the provenance claim through without rewriting it', async () => {
    const { itemBank, service } = setup();
    await service.importPackage(CTX, pkg({ questions: [QUESTION] }), { dryRun: false });

    const input = itemBank.calls[0]!.input;
    expect(input.origin).toBe('TEXTBOOK');
    expect(input.textbookRole).toBe('EXERCISE');
  });

  it('imports an unstated origin as UNKNOWN rather than assuming a textbook question', async () => {
    const { itemBank, service } = setup();
    const anonymous = { ...QUESTION, origin: undefined, textbookRole: undefined };
    await service.importPackage(CTX, pkg({ questions: [anonymous as never] }), { dryRun: false });

    // Migration honesty: a file that does not say where an item came from must
    // not have "printed in the textbook" inferred for it.
    expect(itemBank.calls[0]!.input.origin).toBe('UNKNOWN');
    expect(itemBank.calls[0]!.input.textbookRole).toBeNull();
  });

  it('lets the domain refuse an incoherent provenance claim', async () => {
    const { itemBank, service } = setup();
    itemBank.failWith = {
      text: QUESTION.text,
      error: Errors.validation(
        'question.textbook_role_requires_textbook_origin',
        'Only a question printed in the textbook can have a textbook role.',
      ),
    };

    const res = await service.importPackage(
      CTX,
      pkg({ questions: [{ ...QUESTION, origin: 'AI' } as never] }),
      { dryRun: false },
    );

    // The rule lives in the domain and the importer surfaces it as a row, so
    // there is one definition of a coherent claim rather than two.
    expect(res.ok).toBe(true);
    const outcome = (res as { value: { applied: boolean; problems: readonly ImportProblem[] } }).value;
    expect(outcome.applied).toBe(false);
    expect(outcome.problems[0]!.code).toBe('question.textbook_role_requires_textbook_origin');
    expect(outcome.problems[0]!.sheet).toBe('questions');
  });

  it('counts a question that already exists as unchanged', async () => {
    const { itemBank, service } = setup();
    itemBank.existingTexts.add(QUESTION.text);

    const res = await service.importPackage(CTX, pkg({ questions: [QUESTION] }), { dryRun: false });
    const outcome = (res as { value: { created: { questions: number }; unchanged: { questions: number }; applied: boolean } }).value;

    // A question's identity is its stem within its lesson, so re-running an
    // import must not fork the bank into near-duplicate items.
    expect(outcome.created.questions).toBe(0);
    expect(outcome.unchanged.questions).toBe(1);
    expect(outcome.applied).toBe(true);
  });

  it('reports the same question twice in one file as a duplicate row', async () => {
    const { itemBank, service } = setup();
    const res = await service.importPackage(CTX, pkg({ questions: [QUESTION, QUESTION] }), {
      dryRun: false,
    });

    const outcome = (res as { value: { applied: boolean; problems: readonly ImportProblem[] } }).value;
    expect(outcome.applied).toBe(false);
    expect(outcome.problems.some((p) => p.code === 'import.duplicate_identifier' && p.sheet === 'questions')).toBe(true);
    expect(itemBank.calls).toHaveLength(0);
  });

  it('refuses a question whose concept is not in the package', async () => {
    const { itemBank, service } = setup();
    const orphan = {
      ...QUESTION,
      concepts: [{ unitSlug: 'SETS', lessonSlug: 'INTRO', conceptSlug: 'MISSING', weight: 1, isPrimary: true }],
    };

    const res = await service.importPackage(CTX, pkg({ questions: [orphan as never] }), {
      dryRun: false,
    });
    const outcome = (res as { value: { applied: boolean; problems: readonly ImportProblem[] } }).value;

    expect(outcome.applied).toBe(false);
    expect(outcome.problems.some((p) => p.code === 'import.unresolved_reference')).toBe(true);
    expect(itemBank.calls).toHaveLength(0);
  });

  it('refuses an answer key naming a choice that does not exist', async () => {
    const { itemBank, service } = setup();
    const broken = {
      ...QUESTION,
      answerKey: { ...QUESTION.answerKey, correctChoiceIds: ['c9'] },
    };

    const res = await service.importPackage(CTX, pkg({ questions: [broken as never] }), {
      dryRun: false,
    });
    const outcome = (res as { value: { applied: boolean } }).value;

    // Otherwise the import succeeds and produces a question no learner can
    // answer correctly -- a failure that would only surface as bad evidence.
    expect(outcome.applied).toBe(false);
    expect(itemBank.calls).toHaveLength(0);
  });

  it('refuses a question with no single primary concept', async () => {
    const { service } = setup();
    const twoPrimaries = {
      ...QUESTION,
      concepts: [
        { unitSlug: 'SETS', lessonSlug: 'INTRO', conceptSlug: 'SET', weight: 1, isPrimary: true },
        { unitSlug: 'SETS', lessonSlug: 'INTRO', conceptSlug: 'SET', weight: 1, isPrimary: true },
      ],
    };

    const res = await service.importPackage(CTX, pkg({ questions: [twoPrimaries as never] }), {
      dryRun: false,
    });
    // The key derives from the primary concept's lesson, so "which one is
    // primary" is not a stylistic question.
    expect((res as { value: { applied: boolean } }).value.applied).toBe(false);
  });

  it('writes no question during a dry run, but reports what it would write', async () => {
    const { itemBank, service } = setup();
    const res = await service.importPackage(CTX, pkg({ questions: [QUESTION] }), { dryRun: true });

    // Nothing is written: that is the whole contract of a dry run, and it is
    // asserted against the item bank rather than against a counter, because
    // the counter is a claim and the spy is evidence.
    expect(itemBank.calls).toHaveLength(0);
    expect((res as { value: { applied: boolean } }).value.applied).toBe(false);

    // The counts describe the package, so a reviewer deciding whether to
    // apply it can check them against the source. Reporting zero here would
    // answer a question nobody asked.
    expect((res as { value: { created: { questions: number } } }).value.created.questions).toBe(1);
  });

  it('ensures a package textbook through the canonical authoring service', async () => {
    const { authoring, itemBank, service } = setup();
    authoring.textbookPresent = false;

    const res = await service.importPackage(CTX, pkg({ questions: [QUESTION] }), { dryRun: false });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(authoring.calls[0]?.method).toBe('createTextbook');
    expect(authoring.calls.map((c) => c.method)).toContain('createUnit');
    expect(itemBank.calls).toHaveLength(1);
    expect(res.value.generatedKeys).toContainEqual({ sheet: 'textbook', reference: TB, key: TB });
  });

  it('never passes publication status or a supplied key to the item bank', async () => {
    const { itemBank, service } = setup();
    await service.importPackage(CTX, pkg({ questions: [QUESTION] }), { dryRun: false });

    const input = itemBank.calls[0]!.input;
    expect(input.status).toBeUndefined();
    expect(input.key).toBeUndefined();
  });

  it('imports questions only after their concepts exist', async () => {
    const { authoring, itemBank, service } = setup();
    const order: string[] = [];
    const originalConcept = authoring.createConcept.bind(authoring);
    authoring.createConcept = async (ctx: unknown, input: never) => {
      order.push('concept');
      return originalConcept(ctx, input);
    };
    const originalQuestion = itemBank.createQuestion.bind(itemBank);
    itemBank.createQuestion = async (ctx: unknown, input: never) => {
      order.push('question');
      return originalQuestion(ctx, input);
    };

    await service.importPackage(CTX, pkg({ questions: [QUESTION] }), { dryRun: false });
    expect(order).toEqual(['concept', 'question']);
  });

  describe('streamlined & context-aware import', () => {
    it('auto-generates slugs and keys from hierarchical curriculum JSON without subject code', async () => {
      const { authoring, service } = setup();
      const hierarchicalSpec = {
        title: 'الرياضيات الميسرة',
        units: [
          {
            name: 'الأعداد والعمليات',
            lessons: [
              {
                name: 'الجمع البسيط',
                reading: 'شرح مفهوم الجمع البسيط للأطفال',
                concepts: [
                  {
                    name: 'مفهوم الجمع',
                    misconceptions: [{ name: 'الخلط بين الجمع والطرح', description: 'يظن أن الجمع ينقص العدد' }],
                    questions: [
                      {
                        text: 'ما هو حاصل 2 + 3؟',
                        choices: [{ text: '5', correct: true }, { text: '1', correct: false }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      };

      const res = await service.importPackage(CTX, hierarchicalSpec as any, {
        dryRun: false,
        targetTextbookKey: TB,
      });

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.applied).toBe(true);
        expect(res.value.created.units).toBe(1);
        expect(res.value.created.lessons).toBe(1);
        expect(res.value.created.concepts).toBe(1);
        expect(res.value.created.learningResources).toBe(1);
        expect(res.value.created.misconceptions).toBe(1);
        expect(res.value.created.questions).toBe(1);
      }
      expect(authoring.calls.map((c) => c.method)).toContain('createUnit');
      expect(authoring.calls.map((c) => c.method)).toContain('createLesson');
      expect(authoring.calls.map((c) => c.method)).toContain('createConcept');
    });

    it('supports granular selection of units and toggling tables', async () => {
      const { service } = setup();
      const hierarchicalSpec = {
        units: [
          {
            name: 'الوحدة 1',
            slug: 'U1',
            lessons: [
              {
                name: 'الدرس 1',
                slug: 'L1',
                concepts: [{ name: 'المفهوم 1', slug: 'C1' }],
              },
            ],
          },
          {
            name: 'الوحدة 2',
            slug: 'U2',
            lessons: [
              {
                name: 'الدرس 2',
                slug: 'L2',
                concepts: [{ name: 'المفهوم 2', slug: 'C2' }],
              },
            ],
          },
        ],
      };

      const res = await service.importPackage(CTX, hierarchicalSpec as any, {
        dryRun: true,
        targetTextbookKey: TB,
        selectedUnits: ['U1'],
        includeQuestions: false,
        includeResources: false,
      });

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.created.units).toBe(1);
        expect(res.value.created.lessons).toBe(1);
        expect(res.value.created.concepts).toBe(1);
        expect(res.value.created.questions).toBe(0);
        expect(res.value.created.learningResources).toBe(0);
      }
    });
  });
});
