/**
 * Authoring and publishing services, against an in-memory repository.
 *
 * The point of these tests is the guard: a published textbook must refuse
 * structural writes at the point of write, for units, lessons AND concepts,
 * through one path — that is gate criterion 4, and the thing legacy got wrong
 * by asking the question at fifteen separate call sites.
 */

import { describe, expect, it } from 'vitest';
import { ContentAuthoringService } from '../../src/contexts/content/application/authoring.service.js';
import { PublishingService } from '../../src/contexts/content/application/publishing.service.js';
import type {
  ContentRepository,
  CreatedNode,
  NodeContext,
} from '../../src/contexts/content/application/ports.js';
import type { ContentNodeKind } from '../../src/contexts/content/domain/authoring.js';
import type { PublicationState } from '../../src/contexts/content/domain/publication.js';
import type { TextbookStructure } from '../../src/contexts/content/domain/structural-validation.js';

const TB = 'EDU-MATH-G07-P1-ED2026';
const UNIT = `${TB}-U-SETS`;
const LESSON = `${UNIT}-L-BASICS`;

interface Row {
  kind: ContentNodeKind;
  key: string;
  slug: string;
  parentKey: string;
  orderIndex: number;
  name: string;
  fields: Record<string, unknown>;
}

/**
 * A working fake, not a mock: it stores rows and answers questions about them,
 * so a test failure means the service's logic is wrong rather than that an
 * expectation about call order changed.
 */
class FakeRepo implements ContentRepository {
  status: PublicationState = 'DRAFT';
  rows: Row[] = [];
  edges: Array<{
    conceptKey: string;
    prerequisiteKey: string;
    strength: number;
    requiredMastery: number;
  }> = [];
  publishedAt: Date | undefined;

  constructor() {
    this.rows.push(
      { kind: 'unit', key: UNIT, slug: 'SETS', parentKey: TB, orderIndex: 1, name: 'Sets', fields: {} },
      { kind: 'lesson', key: LESSON, slug: 'BASICS', parentKey: UNIT, orderIndex: 1, name: 'Basics', fields: {} },
    );
  }

  addConcept(slug: string, orderIndex: number): string {
    const key = `${LESSON}-C-${slug}`;
    this.rows.push({ kind: 'concept', key, slug, parentKey: LESSON, orderIndex, name: slug, fields: {} });
    return key;
  }

  async findNode(kind: ContentNodeKind, key: string): Promise<NodeContext | null> {
    if (kind === 'textbook') {
      return key === TB
        ? { kind, key: TB, slug: '', textbookKey: TB, textbookStatus: this.status }
        : null;
    }
    const row = this.rows.find((r) => r.kind === kind && r.key === key);
    return row
      ? { kind, key: row.key, slug: row.slug, textbookKey: TB, textbookStatus: this.status }
      : null;
  }

  async slugTaken(kind: ContentNodeKind, parentKey: string, slug: string): Promise<boolean> {
    return this.rows.some((r) => r.kind === kind && r.parentKey === parentKey && r.slug === slug);
  }

  async nextOrderIndex(kind: ContentNodeKind, parentKey: string): Promise<number> {
    const siblings = this.rows.filter((r) => r.kind === kind && r.parentKey === parentKey);
    return siblings.length + 1;
  }

  private create(kind: ContentNodeKind, input: {
    key: string; slug: string; name: string; orderIndex: number; parentKey: string;
  }): CreatedNode {
    this.rows.push({ ...input, kind, fields: {} });
    return { kind, key: input.key, slug: input.slug, name: input.name, orderIndex: input.orderIndex };
  }

  /** Coordinate rows the fake knows about, keyed by business code. */
  subjects = new Map<string, { id: string; key: string; name: string }>([
    ['MATH', { id: 'sub-1', key: 'MATH', name: 'الرياضيات' }],
  ]);
  grades = new Map<string, { id: string; key: string; ordinal: number; name: string }>([
    ['G07', { id: 'gr-1', key: 'G07', ordinal: 7, name: 'الصف السابع' }],
  ]);
  textbooks = new Map<string, { key: string; title: string; edition: string; status: string }>();

  async resolveTextbookPlacement(i: { subjectKey: string; gradeKey: string }) {
    return {
      subject: this.subjects.get(i.subjectKey) ?? null,
      grade: this.grades.get(i.gradeKey) ?? null,
    };
  }

  async textbookExists(key: string) {
    return this.textbooks.has(key);
  }

  async createTextbook(i: {
    key: string;
    subjectId: string;
    gradeId: string;
    part: 'PART_1' | 'PART_2';
    title: string;
    edition: string;
  }) {
    const row = { key: i.key, title: i.title, edition: i.edition, status: 'DRAFT' };
    this.textbooks.set(i.key, row);
    return row;
  }

  async createUnit(i: { textbookKey: string; parentUnitKey?: string | null; key: string; slug: string; name: string; orderIndex: number }) {
    return this.create('unit', { ...i, parentKey: i.parentUnitKey ?? i.textbookKey });
  }
  async createLesson(i: { unitKey: string; key: string; slug: string; name: string; orderIndex: number }) {
    return this.create('lesson', { ...i, parentKey: i.unitKey });
  }
  async createConcept(i: { lessonKey: string; key: string; slug: string; name: string; orderIndex: number }) {
    return this.create('concept', { ...i, parentKey: i.lessonKey });
  }

  /** Keyed by derived key, so a repeat insert is detectable exactly as in Prisma. */
  readonly misconceptions = new Map<string, Record<string, unknown>>();
  readonly resources = new Map<string, Record<string, unknown>>();

  async createMisconception(i: {
    conceptKey: string;
    key: string;
    name: string;
    description: string;
    remediation?: string | null;
  }) {
    if (this.misconceptions.has(i.key)) return null;
    this.misconceptions.set(i.key, { ...i });
    return { key: i.key };
  }

  async createLearningResource(i: {
    textbookKey?: string | null;
    lessonKey?: string | null;
    conceptKey?: string | null;
    key: string;
    slug: string;
    kind: string;
    title: string;
  }) {
    if (this.resources.has(i.key)) return null;
    this.resources.set(i.key, { ...i });
    return { key: i.key };
  }

  async updateNode(kind: ContentNodeKind, key: string, fields: Readonly<Record<string, unknown>>) {
    const row = this.rows.find((r) => r.kind === kind && r.key === key);
    if (row) Object.assign(row.fields, fields);
  }

  async siblingKeys(kind: ContentNodeKind, parentKey: string): Promise<string[]> {
    return this.rows
      .filter((r) => r.kind === kind && r.parentKey === parentKey)
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .map((r) => r.key);
  }

  async reorderSiblings(kind: ContentNodeKind, parentKey: string, orderedKeys: readonly string[]) {
    orderedKeys.forEach((key, i) => {
      const row = this.rows.find((r) => r.kind === kind && r.parentKey === parentKey && r.key === key);
      if (row) row.orderIndex = i + 1;
    });
  }

  async loadStructure(textbookKey: string): Promise<TextbookStructure | null> {
    if (textbookKey !== TB) return null;
    const of = (kind: ContentNodeKind) => this.rows.filter((r) => r.kind === kind);
    return {
      textbookKey: TB,
      units: of('unit').map((r) => ({ key: r.key, parentKey: null, orderIndex: r.orderIndex, isActive: true })),
      lessons: of('lesson').map((r) => ({ key: r.key, parentKey: r.parentKey, orderIndex: r.orderIndex, isActive: true })),
      concepts: of('concept').map((r) => ({
        key: r.key,
        parentKey: r.parentKey,
        orderIndex: r.orderIndex,
        isActive: true,
        masteryThreshold: 0.85,
      })),
      prerequisites: this.edges,
      lessonSupport: of('lesson').map((r) => ({
        lessonKey: r.key,
        activeResourceCount: 1,
        readingResourceCount: 1,
      })),
      conceptSupport: of('concept').map((r) => ({
        conceptKey: r.key,
        publishedQuestionCount: 1,
        autoGradableQuestionCount: 1,
        flashcardCount: 1,
        remedialResourceCount: 0,
      })),
      unlinkedQuestions: [],
    };
  }

  async textbookStatus(textbookKey: string): Promise<PublicationState | null> {
    return textbookKey === TB ? this.status : null;
  }

  async setTextbookStatus(_k: string, status: PublicationState, publishedAt?: Date) {
    this.status = status;
    if (publishedAt) this.publishedAt = publishedAt;
  }

  async linkPrerequisite(i: { conceptKey: string; prerequisiteKey: string; strength: number; requiredMastery: number }) {
    this.edges.push(i);
  }
  async unlinkPrerequisite(conceptKey: string, prerequisiteKey: string) {
    this.edges = this.edges.filter((e) => !(e.conceptKey === conceptKey && e.prerequisiteKey === prerequisiteKey));
  }
  async prerequisitesInTextbook() {
    return this.edges;
  }
}

import { IMPORTABLE_RESOURCE_KINDS } from '../../src/contexts/content/domain/export-profile.js';

const CTX = { actorKey: 'usr_author' };
const clock = { now: () => new Date('2026-09-11T12:00:00Z') };

/** Captures what Content announced, without knowing what listens. */
class FakeRetirement {
  retired: string[][] = [];
  shouldThrow = false;
  async conceptsRetired(conceptKeys: readonly string[]) {
    if (this.shouldThrow) throw new Error('downstream is down');
    this.retired.push([...conceptKeys]);
  }
}

/** Captures audit entries so write paths can prove they are recorded. */
class FakeContentAudit {
  entries: Array<{ action: string; targetKey: string }> = [];
  async record(entry: { actorKey: string; action: string; targetKey: string }): Promise<void> {
    this.entries.push({ action: entry.action, targetKey: entry.targetKey });
  }
}

function setup() {
  const repo = new FakeRepo();
  const retirement = new FakeRetirement();
  const audit = new FakeContentAudit();
  return {
    repo,
    retirement,
    audit,
    authoring: new ContentAuthoringService(repo, audit),
    publishing: new PublishingService(repo, clock, undefined, retirement),
  };
}

describe('creating content', () => {
  it('derives the key from the slug and appends to the end', async () => {
    const { authoring } = setup();
    const created = await authoring.createConcept(CTX, { lessonKey: LESSON, name: 'Set Union' });

    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.key).toBe(`${LESSON}-C-SET-UNION`);
    expect(created.value.slug).toBe('SET-UNION');
    expect(created.value.orderIndex).toBe(1);
  });

  it('appends rather than renumbering existing siblings', async () => {
    const { repo, authoring } = setup();
    repo.addConcept('SET', 1);

    const created = await authoring.createConcept(CTX, { lessonKey: LESSON, name: 'Union' });
    expect(created.ok && created.value.orderIndex).toBe(2);
    expect(repo.rows.find((r) => r.slug === 'SET')?.orderIndex).toBe(1);
  });

  it('refuses a duplicate slug among siblings', async () => {
    const { repo, authoring } = setup();
    repo.addConcept('SET', 1);

    const created = await authoring.createConcept(CTX, { lessonKey: LESSON, name: 'Set' });
    expect(created.ok).toBe(false);
    if (created.ok) return;
    expect(created.error.code).toBe('content.slug_taken');
  });

  it('refuses a missing parent', async () => {
    const { authoring } = setup();
    const created = await authoring.createConcept(CTX, { lessonKey: `${UNIT}-L-GHOST`, name: 'X' });

    expect(created.ok).toBe(false);
    if (created.ok) return;
    expect(created.error.code).toBe('content.node_not_found');
  });

  it('refuses an out-of-range mastery threshold', async () => {
    const { authoring } = setup();
    const created = await authoring.createConcept(CTX, {
      lessonKey: LESSON,
      name: 'X',
      masteryThreshold: 0,
    });

    expect(created.ok).toBe(false);
    if (created.ok) return;
    expect(created.error.code).toBe('content.mastery_threshold_out_of_range');
  });
});

describe('the published-textbook write guard', () => {
  it('refuses creating a unit, lesson and concept — all three kinds', async () => {
    const { repo, authoring } = setup();
    repo.status = 'PUBLISHED';

    const results = [
      await authoring.createUnit(CTX, { textbookKey: TB, name: 'New Unit' }),
      await authoring.createLesson(CTX, { unitKey: UNIT, name: 'New Lesson' }),
      await authoring.createConcept(CTX, { lessonKey: LESSON, name: 'New Concept' }),
    ];

    for (const r of results) {
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect(r.error.code).toBe('content.textbook_locked');
    }
  });

  it('refuses reordering', async () => {
    const { repo, authoring } = setup();
    const a = repo.addConcept('A', 1);
    const b = repo.addConcept('B', 2);
    repo.status = 'PUBLISHED';

    const outcome = await authoring.reorder(CTX, 'concept', LESSON, [b, a]);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe('content.textbook_locked');
  });

  it('refuses structural field edits but permits presentational ones', async () => {
    const { repo, authoring } = setup();
    const key = repo.addConcept('SET', 1);
    repo.status = 'PUBLISHED';

    const structural = await authoring.updateNode(CTX, 'concept', key, { masteryThreshold: 0.9 });
    expect(structural.ok).toBe(false);
    if (!structural.ok) expect(structural.error.code).toBe('content.textbook_locked');

    // A typo fix changes nothing the engines compute.
    const presentational = await authoring.updateNode(CTX, 'concept', key, { name: 'Set (fixed)' });
    expect(presentational.ok).toBe(true);
  });

  it('refuses prerequisite links', async () => {
    const { repo, authoring } = setup();
    const a = repo.addConcept('A', 1);
    const b = repo.addConcept('B', 2);
    repo.status = 'PUBLISHED';

    const outcome = await authoring.linkPrerequisite(CTX, { conceptKey: b, prerequisiteKey: a });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe('content.textbook_locked');
  });

  it('applies the same lock to ARCHIVED', async () => {
    const { repo, authoring } = setup();
    repo.status = 'ARCHIVED';

    const outcome = await authoring.createConcept(CTX, { lessonKey: LESSON, name: 'X' });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe('content.textbook_locked');
  });

  it('allows everything again while IN_REVIEW — review is still editing', async () => {
    const { repo, authoring } = setup();
    repo.status = 'IN_REVIEW';

    expect((await authoring.createConcept(CTX, { lessonKey: LESSON, name: 'X' })).ok).toBe(true);
  });
});

describe('updating', () => {
  it('refuses a slug change with the slug code, not the lock code', async () => {
    const { repo, authoring } = setup();
    const key = repo.addConcept('SET', 1);
    repo.status = 'PUBLISHED';

    const outcome = await authoring.updateNode(CTX, 'concept', key, { slug: 'SETS' });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    // "textbook_locked" would imply un-publishing makes the rename possible.
    // It never is.
    expect(outcome.error.code).toBe('content.slug_immutable');
  });

  it('accepts an unchanged slug alongside a real edit', async () => {
    const { repo, authoring } = setup();
    const key = repo.addConcept('SET', 1);

    const outcome = await authoring.updateNode(CTX, 'concept', key, { slug: 'SET', name: 'Set' });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.updated).toEqual(['name']);
  });

  it('refuses an attempt to set the key', async () => {
    const { repo, authoring } = setup();
    const key = repo.addConcept('SET', 1);

    const outcome = await authoring.updateNode(CTX, 'concept', key, { key: 'OTHER' });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe('content.key_immutable');
  });

  it('renaming leaves the stored slug untouched', async () => {
    const { repo, authoring } = setup();
    const key = repo.addConcept('SET-UNION', 1);

    await authoring.updateNode(CTX, 'concept', key, { name: 'Completely Different Name' });

    const row = repo.rows.find((r) => r.key === key);
    expect(row?.slug).toBe('SET-UNION');
    expect(row?.key).toBe(key);
  });
});

describe('reordering', () => {
  it('renumbers contiguously from 1', async () => {
    const { repo, authoring } = setup();
    const a = repo.addConcept('A', 1);
    const b = repo.addConcept('B', 2);
    const c = repo.addConcept('C', 3);

    const outcome = await authoring.reorder(CTX, 'concept', LESSON, [c, a, b]);

    expect(outcome.ok).toBe(true);
    expect(await repo.siblingKeys('concept', LESSON)).toEqual([c, a, b]);
  });

  it('refuses an incomplete list', async () => {
    const { repo, authoring } = setup();
    const a = repo.addConcept('A', 1);
    repo.addConcept('B', 2);

    const outcome = await authoring.reorder(CTX, 'concept', LESSON, [a]);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe('content.reorder_incomplete');
  });
});

describe('prerequisites', () => {
  it('links two concepts', async () => {
    const { repo, authoring } = setup();
    const a = repo.addConcept('A', 1);
    const b = repo.addConcept('B', 2);

    const outcome = await authoring.linkPrerequisite(CTX, { conceptKey: b, prerequisiteKey: a });
    expect(outcome.ok).toBe(true);
    expect(repo.edges).toHaveLength(1);
  });

  it('refuses an edge that would close a cycle — before writing it', async () => {
    const { repo, authoring } = setup();
    const a = repo.addConcept('A', 1);
    const b = repo.addConcept('B', 2);
    await authoring.linkPrerequisite(CTX, { conceptKey: b, prerequisiteKey: a });

    const outcome = await authoring.linkPrerequisite(CTX, { conceptKey: a, prerequisiteKey: b });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe('content.prerequisite_cycle');
    // The bad edge must not have been persisted.
    expect(repo.edges).toHaveLength(1);
  });

  it('refuses a longer cycle A→B→C→A', async () => {
    const { repo, authoring } = setup();
    const a = repo.addConcept('A', 1);
    const b = repo.addConcept('B', 2);
    const c = repo.addConcept('C', 3);
    await authoring.linkPrerequisite(CTX, { conceptKey: b, prerequisiteKey: a });
    await authoring.linkPrerequisite(CTX, { conceptKey: c, prerequisiteKey: b });

    const outcome = await authoring.linkPrerequisite(CTX, { conceptKey: a, prerequisiteKey: c });
    expect(outcome.ok).toBe(false);
    expect(repo.edges).toHaveLength(2);
  });

  it('refuses a self-prerequisite', async () => {
    const { repo, authoring } = setup();
    const a = repo.addConcept('A', 1);

    const outcome = await authoring.linkPrerequisite(CTX, { conceptKey: a, prerequisiteKey: a });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe('content.self_prerequisite');
  });

  it('refuses a missing prerequisite', async () => {
    const { repo, authoring } = setup();
    const a = repo.addConcept('A', 1);

    const outcome = await authoring.linkPrerequisite(CTX, {
      conceptKey: a,
      prerequisiteKey: `${LESSON}-C-GHOST`,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe('content.node_not_found');
  });

  it('refuses out-of-range strength', async () => {
    const { repo, authoring } = setup();
    const a = repo.addConcept('A', 1);
    const b = repo.addConcept('B', 2);

    const outcome = await authoring.linkPrerequisite(CTX, {
      conceptKey: b,
      prerequisiteKey: a,
      strength: 1.5,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe('content.value_out_of_range');
  });

  it('unlinks', async () => {
    const { repo, authoring } = setup();
    const a = repo.addConcept('A', 1);
    const b = repo.addConcept('B', 2);
    await authoring.linkPrerequisite(CTX, { conceptKey: b, prerequisiteKey: a });

    expect((await authoring.unlinkPrerequisite(CTX, b, a)).ok).toBe(true);
    expect(repo.edges).toHaveLength(0);
  });
});

describe('publishing', () => {
  it('walks the full happy path DRAFT → IN_REVIEW → PUBLISHED → ARCHIVED → PUBLISHED', async () => {
    const { repo, publishing } = setup();
    repo.addConcept('A', 1);

    expect((await publishing.apply(CTX, TB, 'SUBMIT')).ok).toBe(true);
    expect(repo.status).toBe('IN_REVIEW');

    const approved = await publishing.apply(CTX, TB, 'APPROVE');
    expect(approved.ok).toBe(true);
    expect(repo.status).toBe('PUBLISHED');
    expect(repo.publishedAt).toEqual(new Date('2026-09-11T12:00:00Z'));

    expect((await publishing.apply(CTX, TB, 'ARCHIVE')).ok).toBe(true);
    expect((await publishing.apply(CTX, TB, 'RESTORE')).ok).toBe(true);
    expect(repo.status).toBe('PUBLISHED');
  });

  it('blocks SUBMIT on a structurally invalid book, listing every issue', async () => {
    const { repo, publishing } = setup();
    // No concepts at all — the book has an empty required layer.
    const outcome = await publishing.apply(CTX, TB, 'SUBMIT');

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe('content.structure_invalid');
    expect(outcome.error.details?.['issueCount']).toBeGreaterThan(0);
    expect(repo.status).toBe('DRAFT');
  });

  it('blocks SUBMIT when a cycle exists', async () => {
    const { repo, publishing } = setup();
    const a = repo.addConcept('A', 1);
    const b = repo.addConcept('B', 2);
    // Written directly, bypassing the service, as a corrupt-data scenario.
    repo.edges.push(
      { conceptKey: b, prerequisiteKey: a, strength: 1, requiredMastery: 0.7 },
      { conceptKey: a, prerequisiteKey: b, strength: 1, requiredMastery: 0.7 },
    );

    const outcome = await publishing.apply(CTX, TB, 'SUBMIT');
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe('content.structure_invalid');
  });

  it('validates on SUBMIT, not on APPROVE — a reviewer reads, they do not debug', async () => {
    const { repo, publishing } = setup();
    repo.addConcept('A', 1);
    await publishing.apply(CTX, TB, 'SUBMIT');

    // Corrupt the structure after review started.
    repo.rows.push({
      kind: 'concept', key: `${LESSON}-C-GAP`, slug: 'GAP',
      parentKey: LESSON, orderIndex: 9, name: 'Gap', fields: {},
    });

    // APPROVE does not re-run the structural gate.
    expect((await publishing.apply(CTX, TB, 'APPROVE')).ok).toBe(true);
  });

  it('propagates the domain refusal code for an illegal transition', async () => {
    const { repo, publishing } = setup();
    repo.status = 'PUBLISHED';

    const outcome = await publishing.apply(CTX, TB, 'SUBMIT');
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe('content.published_cannot_return_to_draft');
  });

  it('refuses DRAFT → PUBLISHED directly', async () => {
    const { repo, publishing } = setup();
    repo.addConcept('A', 1);

    const outcome = await publishing.apply(CTX, TB, 'APPROVE');
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe('content.review_required');
  });

  it('does not stamp publishedAt on RESTORE', async () => {
    const { repo, publishing } = setup();
    repo.addConcept('A', 1);
    await publishing.apply(CTX, TB, 'SUBMIT');
    await publishing.apply(CTX, TB, 'APPROVE');
    const firstPublish = repo.publishedAt;
    await publishing.apply(CTX, TB, 'ARCHIVE');
    await publishing.apply(CTX, TB, 'RESTORE');

    // Restoring is not first publication.
    expect(repo.publishedAt).toEqual(firstPublish);
  });

  it('reports readiness without changing state', async () => {
    const { repo, publishing } = setup();
    const report = await publishing.checkReadiness(TB);

    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.ready).toBe(false);
    expect(report.value.issues.length).toBeGreaterThan(0);
    expect(repo.status).toBe('DRAFT');

    repo.addConcept('A', 1);
    const after = await publishing.checkReadiness(TB);
    expect(after.ok && after.value.ready).toBe(true);
  });

  it('reports a missing textbook', async () => {
    const { publishing } = setup();
    const outcome = await publishing.apply(CTX, 'EDU-NOPE-G01-T1-ED2026', 'SUBMIT');

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe('content.textbook_not_found');
  });
});


describe('archiving retires concepts', () => {
  /** A book with concepts in it, driven to PUBLISHED where ARCHIVE is legal. */
  function publish(repo: FakeRepo): string[] {
    const keys = [repo.addConcept('SET', 1), repo.addConcept('UNION', 2)];
    repo.status = 'PUBLISHED';
    return keys;
  }

  it('announces every concept in the book when it is archived', async () => {
    const { repo, publishing, retirement } = setup();
    const keys = publish(repo);

    const result = await publishing.apply(CTX, TB, 'ARCHIVE');
    expect(result.ok).toBe(true);

    expect(retirement.retired).toHaveLength(1);
    // Every concept, not just the ones someone happened to be looking at.
    expect(retirement.retired[0]?.slice().sort()).toEqual(keys.slice().sort());
  });

  it('announces nothing on any other transition', async () => {
    // Publishing a book does not retire anything. If this fired on SUBMIT or
    // APPROVE it would supersede live gaps the moment a book went out.
    const { repo, publishing, retirement } = setup();
    repo.status = 'IN_REVIEW';

    await publishing.apply(CTX, TB, 'APPROVE');
    expect(retirement.retired).toEqual([]);
  });

  it('reads the concept list BEFORE the status changes', async () => {
    // The regression this guards: published-content filters exclude an
    // archived book, so loading the structure afterwards can come back empty
    // and silently announce nothing at all.
    const { repo, publishing, retirement } = setup();
    publish(repo);

    await publishing.apply(CTX, TB, 'ARCHIVE');
    expect(retirement.retired[0]?.length).toBeGreaterThan(0);
  });

  it('still archives when the listener throws', async () => {
    // An editor must not be blocked by a downstream failure.
    const { repo, publishing, retirement } = setup();
    publish(repo);
    retirement.shouldThrow = true;

    const result = await publishing.apply(CTX, TB, 'ARCHIVE');
    expect(result.ok).toBe(true);
    expect(repo.status).toBe('ARCHIVED');
  });

  it('works without a listener at all', async () => {
    // The port is optional; every existing construction omits it.
    const repo = new FakeRepo();
    repo.addConcept('SET', 1);
    repo.status = 'PUBLISHED';
    const publishing = new PublishingService(repo, clock);

    const result = await publishing.apply(CTX, TB, 'ARCHIVE');
    expect(result.ok).toBe(true);
  });
});

/**
 * Textbook creation — the first step of every authoring workflow, which until
 * now happened outside the application entirely (seed + raw SQL only).
 */
describe('createTextbook', () => {
  const COORDS = {
    subjectKey: 'MATH',
    gradeKey: 'G07',
    part: 'PART_1',
    title: 'Mathematics — Grade 7',
    edition: '2026',
  };

  it('derives the key from coordinates and edition', async () => {
    const { authoring } = setup();
    const created = await authoring.createTextbook(CTX, COORDS);

    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.key).toBe('EDU-MATH-G07-P1-ED2026');
    expect(created.value.status).toBe('DRAFT');
  });

  it('never accepts a caller-supplied key', async () => {
    const { authoring } = setup();
    // A key in the payload must not influence identity: the domain owns it.
    const created = await authoring.createTextbook(CTX, {
      ...COORDS,
      key: 'ATTACKER-CHOSEN-KEY',
    } as never);

    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.key).toBe('EDU-MATH-G07-P1-ED2026');
  });

  it('a new printed edition is a different textbook', async () => {
    const { authoring } = setup();
    const first = await authoring.createTextbook(CTX, COORDS);
    const second = await authoring.createTextbook(CTX, { ...COORDS, edition: 'REV2' });

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value.key).not.toBe(second.value.key);
    expect(second.value.key).toBe('EDU-MATH-G07-P1-EDREV2');
  });

  it('refuses a duplicate subject+grade+part+edition', async () => {
    const { authoring } = setup();
    await authoring.createTextbook(CTX, COORDS);
    const again = await authoring.createTextbook(CTX, COORDS);

    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.error.code).toBe('content.textbook_exists');
  });

  it('names which coordinate is missing, rather than failing the whole row', async () => {
    const { authoring } = setup();
    const created = await authoring.createTextbook(CTX, { ...COORDS, subjectKey: 'NOPE' });

    expect(created.ok).toBe(false);
    if (created.ok) return;
    expect(created.error.code).toBe('content.coordinate_not_found');
    expect(created.error.details).toMatchObject({ missing: ['subjectKey'] });
  });

  it('reports every missing coordinate at once', async () => {
    const { authoring } = setup();
    const created = await authoring.createTextbook(CTX, {
      ...COORDS,
      subjectKey: 'NOPE',
      gradeKey: 'ALSO-NOPE',
    });

    expect(created.ok).toBe(false);
    if (created.ok) return;
    expect(created.error.details).toMatchObject({ missing: ['subjectKey', 'gradeKey'] });
  });

  it('requires a title', async () => {
    const { authoring } = setup();
    const created = await authoring.createTextbook(CTX, { ...COORDS, title: '   ' });

    expect(created.ok).toBe(false);
    if (created.ok) return;
    expect(created.error.code).toBe('content.title_required');
  });

  it('always starts in DRAFT, never published on arrival', async () => {
    const { authoring } = setup();
    // Accepting a status here would skip the two-actor review the publication
    // lifecycle exists to enforce.
    const created = await authoring.createTextbook(CTX, { ...COORDS, status: 'PUBLISHED' } as never);

    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.status).toBe('DRAFT');
  });

  it('writes an audit entry', async () => {
    const { authoring, audit } = setup();
    await authoring.createTextbook(CTX, COORDS);

    expect(audit.entries.some((e) => e.action === 'content.textbook_created')).toBe(true);
  });

  it('refuses a title that repeats the resolved grade name (§2.2)', async () => {
    const { authoring } = setup();
    // FakeRepo's G07 resolves to grade name 'الصف السابع' — a title carrying
    // that text would double it once the UI appends `gradeName` after `title`.
    const created = await authoring.createTextbook(CTX, {
      ...COORDS,
      title: 'كتاب الرياضيات الصف السابع',
    });

    expect(created.ok).toBe(false);
    if (created.ok) return;
    expect(created.error.code).toBe('content.title_repeats_placement');
  });

  it('refuses a title that repeats the physical part (§2.2)', async () => {
    const { authoring } = setup();
    const created = await authoring.createTextbook(CTX, {
      ...COORDS,
      title: 'رياضيات PART_1',
    });

    expect(created.ok).toBe(false);
    if (created.ok) return;
    expect(created.error.code).toBe('content.title_repeats_placement');
  });

  it('accepts a title that does not mention the grade or part', async () => {
    const { authoring } = setup();
    const created = await authoring.createTextbook(CTX, COORDS);

    expect(created.ok).toBe(true);
  });
});

/**
 * Misconceptions and learning resources (gap G7).
 *
 * The legacy curriculum carries 66 named misconceptions and 122 remedial
 * resources. Before this, `ContentPackage` had no way to express either, so a
 * conversion would have reported success while dropping all 188 — and the
 * remediation engine, which exists to act on exactly this data, would have had
 * nothing subject-specific to work with.
 */
describe('concept attachments', () => {
  it('derives a stable misconception key from the concept and slug', async () => {
    const { repo, authoring } = setup();
    const concept = repo.addConcept('SET', 1);

    const made = await authoring.createMisconception(CTX, {
      conceptKey: concept,
      slug: 'ANY-GROUPING-IS-A-SET',
      name: 'Any grouping is a set',
      description: 'Treats a subjective collection as a well-defined set.',
      correction: 'A set must be defined precisely enough that two people agree on its members.',
    });

    expect(made.ok).toBe(true);
    if (!made.ok) return;
    expect(made.value.created).toBe(true);
    // Fingerprinted, not ordinal: renumbering concepts must never move it.
    expect(made.value.key.startsWith(`${concept}-MIS`)).toBe(true);
  });

  it('is idempotent: re-importing the same package creates nothing new', async () => {
    const { repo, authoring } = setup();
    const concept = repo.addConcept('SET', 1);
    const input = {
      conceptKey: concept,
      slug: 'ANY-GROUPING-IS-A-SET',
      name: 'Any grouping is a set',
      description: 'Treats a subjective collection as a well-defined set.',
    };

    const first = await authoring.createMisconception(CTX, input);
    const second = await authoring.createMisconception(CTX, input);

    expect(first.ok && first.value.created).toBe(true);
    expect(second.ok && second.value.created).toBe(false);
    // Same key both times, and exactly one row.
    expect(first.ok && second.ok && first.value.key === second.value.key).toBe(true);
    expect(repo.misconceptions.size).toBe(1);
  });

  it('does not overwrite an existing misconception on re-import', async () => {
    const { repo, authoring } = setup();
    const concept = repo.addConcept('SET', 1);
    await authoring.createMisconception(CTX, {
      conceptKey: concept,
      slug: 'X',
      name: 'Original name',
      description: 'Original description.',
    });
    await authoring.createMisconception(CTX, {
      conceptKey: concept,
      slug: 'X',
      name: 'Rewritten by a re-import',
      description: 'Rewritten.',
    });

    // An author's later edit must survive a re-import; existing content wins.
    const stored = [...repo.misconceptions.values()][0];
    expect(stored?.['name']).toBe('Original name');
  });

  it('records an audit entry only when something was actually created', async () => {
    const { repo, authoring, audit } = setup();
    const concept = repo.addConcept('SET', 1);
    const input = { conceptKey: concept, slug: 'X', name: 'X', description: 'd' };

    await authoring.createMisconception(CTX, input);
    await authoring.createMisconception(CTX, input);

    const entries = audit.entries.filter((e) => e.action === 'content.misconception_created');
    expect(entries).toHaveLength(1);
  });

  it('refuses an unknown resource kind rather than coercing it', async () => {
    const { repo, authoring } = setup();
    const concept = repo.addConcept('SET', 1);

    const made = await authoring.createLearningResource(CTX, {
      conceptKey: concept,
      slug: 'INTRO',
      kind: 'ANALOGY',
      title: 'A simple analogy',
      body: 'Analogy text.',
    });

    // Legacy used contentType: "ANALOGY", which is not a ResourceKind. The
    // converter must map it deliberately; the service must not guess.
    expect(made.ok).toBe(false);
    if (made.ok) return;
    expect(made.error.code).toBe('content.unknown_resource_kind');
  });

  it('accepts every kind the package contract declares', async () => {
    const { repo, authoring } = setup();
    const concept = repo.addConcept('SET', 1);

    for (const kind of IMPORTABLE_RESOURCE_KINDS) {
      const made = await authoring.createLearningResource(CTX, {
        conceptKey: concept,
        slug: `R-${kind}`,
        kind,
        title: `Resource ${kind}`,
        body: `Body for ${kind}.`,
      });
      expect(made.ok, `kind ${kind} should be accepted`).toBe(true);
    }
    expect(repo.resources.size).toBe(IMPORTABLE_RESOURCE_KINDS.length);
  });

  it('refuses to attach to a concept that does not exist', async () => {
    const { authoring } = setup();

    const made = await authoring.createMisconception(CTX, {
      conceptKey: `${LESSON}-C-NOT-THERE`,
      slug: 'X',
      name: 'X',
      description: 'd',
    });

    expect(made.ok).toBe(false);
    if (made.ok) return;
    expect(made.error.code).toBe('content.node_not_found');
  });
});
