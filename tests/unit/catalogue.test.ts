/**
 * The academic catalogue.
 *
 * Two things are worth testing here, and they are not the CRUD.
 *
 * The first is **key discipline**. Catalogue keys are not labels: they are
 * embedded in textbook keys (`EDU-MATH-G07-T1-ED2026`), in import packages and
 * in URLs, effectively forever. A subject key containing a dash makes that
 * textbook key ambiguous to split; a term key that does not name its year can
 * only ever exist once, because Term.key is globally unique — which is a bug
 * the legacy seed shipped with bare 'T1'.
 *
 * The second is **refusing to delete something in use**. A catalogue row is a
 * coordinate that textbooks and enrolments are pinned to, so "tidy up the
 * subject list" must not be able to orphan a school's roster.
 */

import { describe, expect, it } from 'vitest';
import {
  ensureRemovable,
  ensureSingleCurrentYear,
  termKeyFor,
  validateAcademicYear,
  validateGrade,
  validateSchool,
  validateSubject,
  validateTerm,
} from '../../src/contexts/catalogue/domain/catalogue.js';
import { CatalogueService } from '../../src/contexts/catalogue/application/catalogue.service.js';
import type {
  AcademicYearRecord,
  CatalogueRepository,
  GradeRecord,
  SchoolRecord,
  SubjectRow,
  TermRecord,
} from '../../src/contexts/catalogue/application/ports.js';

const codeOf = (r: { ok: boolean; error?: { code: string } }): string =>
  r.ok ? '(ok)' : (r.error?.code ?? '(no code)');

describe('catalogue domain: subjects', () => {
  it('accepts a canonical key and normalises case', () => {
    const r = validateSubject({ key: 'math', name: '  الرياضيات  ' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.key).toBe('MATH');
    expect(r.value.name).toBe('الرياضيات');
  });

  it('rejects a key containing a dash', () => {
    // A dash would make EDU-<SUBJ>-G07-... ambiguous to split.
    expect(codeOf(validateSubject({ key: 'MATH-ADV', name: 'x' }))).toBe(
      'catalogue.invalid_subject_key',
    );
  });

  it('rejects a blank name', () => {
    expect(codeOf(validateSubject({ key: 'MATH', name: '   ' }))).toBe('catalogue.name_required');
  });
});

describe('catalogue domain: grades', () => {
  it('requires the key to agree with the ordinal', () => {
    expect(validateGrade({ key: 'G07', ordinal: 7, name: 'السابع' }).ok).toBe(true);
    expect(codeOf(validateGrade({ key: 'G09', ordinal: 3, name: 'x' }))).toBe(
      'catalogue.grade_key_ordinal_mismatch',
    );
  });

  it('rejects a malformed key and an out-of-range ordinal', () => {
    expect(codeOf(validateGrade({ key: 'SEVEN', ordinal: 7, name: 'x' }))).toBe(
      'catalogue.invalid_grade_key',
    );
    expect(codeOf(validateGrade({ key: 'G99', ordinal: 99, name: 'x' }))).toBe(
      'catalogue.invalid_grade_ordinal',
    );
  });
});

describe('catalogue domain: academic years and terms', () => {
  it('requires two consecutive calendar years', () => {
    expect(
      validateAcademicYear({
        key: '2026-2027',
        startsOn: new Date('2026-09-01'),
        endsOn: new Date('2027-06-30'),
      }).ok,
    ).toBe(true);
    expect(
      codeOf(
        validateAcademicYear({
          key: '2026-2028',
          startsOn: new Date('2026-09-01'),
          endsOn: new Date('2028-06-30'),
        }),
      ),
    ).toBe('catalogue.non_consecutive_year');
  });

  it('rejects a year that ends before it starts', () => {
    expect(
      codeOf(
        validateAcademicYear({
          key: '2026-2027',
          startsOn: new Date('2027-06-30'),
          endsOn: new Date('2026-09-01'),
        }),
      ),
    ).toBe('catalogue.inverted_year');
  });

  it('requires a term key to name its academic year', () => {
    // Term.key is globally unique, so a bare 'T1' is claimable by exactly one
    // year in the whole system. Legacy shipped bare keys.
    expect(
      codeOf(validateTerm({ key: 'T1', academicYearKey: '2026-2027', ordinal: 1, name: 'الأول' })),
    ).toBe('catalogue.term_key_not_scoped');
    expect(
      validateTerm({
        key: '2026-2027-T01',
        academicYearKey: '2026-2027',
        ordinal: 1,
        name: 'الأول',
      }).ok,
    ).toBe(true);
  });

  it('builds canonical term keys that pass its own validation', () => {
    const key = termKeyFor('2026-2027', 1);
    expect(key).toBe('2026-2027-T01');
    expect(validateTerm({ key, academicYearKey: '2026-2027', ordinal: 1, name: 'x' }).ok).toBe(true);
  });

  it('allows at most one current year', () => {
    expect(ensureSingleCurrentYear([{ key: 'a', isCurrent: true }]).ok).toBe(true);
    expect(
      codeOf(
        ensureSingleCurrentYear([
          { key: 'a', isCurrent: true },
          { key: 'b', isCurrent: true },
        ]),
      ),
    ).toBe('catalogue.multiple_current_years');
  });
});

describe('catalogue domain: schools and removal', () => {
  it('normalises a school key to lower case', () => {
    const r = validateSchool({ key: 'SCH_Demo', name: 'مدرسة' });
    expect(r.ok && r.value.key).toBe('sch_demo');
  });

  it('permits removal only when nothing references the row', () => {
    expect(ensureRemovable('subject', 'MATH', [{ what: 'textbooks', count: 0 }]).ok).toBe(true);

    const blocked = ensureRemovable('subject', 'MATH', [
      { what: 'textbooks', count: 2 },
      { what: 'enrolments', count: 0 },
    ]);
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.error.code).toBe('catalogue.in_use');
    // The caller is told *what* blocks it, so a UI can explain the refusal
    // instead of just failing.
    expect(blocked.error.details).toMatchObject({
      references: [{ what: 'textbooks', count: 2 }],
    });
  });
});

// ── Service behaviour ───────────────────────────────────────────────────────

function subject(over: Partial<SubjectRow> = {}): SubjectRow {
  return { key: 'MATH', name: 'الرياضيات', nameEn: 'Maths', isActive: true, textbookCount: 0, ...over };
}
function year(over: Partial<AcademicYearRecord> = {}): AcademicYearRecord {
  return {
    key: '2026-2027',
    startsOn: new Date('2026-09-01'),
    endsOn: new Date('2027-06-30'),
    isCurrent: false,
    termCount: 0,
    enrollmentCount: 0,
    ...over,
  };
}

/** Records what was written, so "did not write" is provable. */
class FakeRepo implements CatalogueRepository {
  writes: string[] = [];
  subjects: SubjectRow[] = [subject()];
  years: AcademicYearRecord[] = [year({ isCurrent: true })];
  terms: TermRecord[] = [];
  grades: GradeRecord[] = [];
  /** The matrix fake: policy per subject, stored cells, and the writes. */
  matrixSubjects: { key: string; name: string; isActive: boolean; standardGradeLevels: number[] }[] = [];
  matrixGrades: { key: string; ordinal: number; name: string; stage: string | null; isActive: boolean }[] = [];
  matrixRows: { gradeKey: string; subjectKey: string; isActive: boolean }[] = [];

  async gradeSubjectMatrix() {
    return {
      grades: this.matrixGrades,
      subjects: this.matrixSubjects,
      rows: this.matrixRows,
    };
  }

  async applyGradeSubjectCells(
    changes: readonly { gradeKey: string; subjectKey: string; isActive: boolean }[],
  ) {
    const out = [];
    for (const change of changes) {
      const existing = this.matrixRows.find(
        (r) => r.gradeKey === change.gradeKey && r.subjectKey === change.subjectKey,
      );
      if (existing) existing.isActive = change.isActive;
      else this.matrixRows.push({ ...change });
      this.writes.push(`cell:${change.gradeKey}:${change.subjectKey}:${change.isActive}`);
      out.push({ ...change });
    }
    return out;
  }

  async listSubjects() {
    return this.subjects;
  }
  async findSubject(key: string) {
    return this.subjects.find((s) => s.key === key) ?? null;
  }
  async upsertSubject(i: { key: string; name: string; nameEn: string | null }) {
    this.writes.push(`upsertSubject:${i.key}`);
    return subject(i);
  }
  async updateSubject(key: string) {
    this.writes.push(`updateSubject:${key}`);
    return subject({ key });
  }
  async deleteSubject(key: string) {
    this.writes.push(`deleteSubject:${key}`);
  }
  async listGrades(): Promise<readonly GradeRecord[]> {
    // Default [] keeps every pre-matrix test's world empty; tests that seed
    // `grades` (the update-merge test, the matrix tests) see their rows.
    return this.grades;
  }
  gradesFound: GradeRecord[] = [];
  async findGrade(): Promise<GradeRecord | null> {
    return this.gradesFound[0] ?? null;
  }
  async findGradeByOrdinal() {
    return null;
  }
  async upsertGrade(i: { key: string; ordinal: number; name: string; stage: string | null }) {
    this.writes.push(`upsertGrade:${i.key}`);
    return { ...i, isActive: true, textbookCount: 0, enrollmentCount: 0 };
  }
  async updateGrade(
    key: string,
    patch: { name?: string; stage?: string | null; isActive?: boolean } = {},
  ) {
    this.writes.push(`updateGrade:${key}`);
    return {
      key,
      ordinal: 1,
      name: 'x',
      stage: null,
      isActive: true,
      textbookCount: 0,
      enrollmentCount: 0,
      ...patch,
    };
  }
  async deleteGrade(key: string) {
    this.writes.push(`deleteGrade:${key}`);
  }
  async listAcademicYears() {
    return this.years;
  }
  async findAcademicYear(key: string) {
    return this.years.find((y) => y.key === key) ?? null;
  }
  async upsertAcademicYear(i: { key: string; startsOn: Date; endsOn: Date }) {
    this.writes.push(`upsertYear:${i.key}`);
    return year(i);
  }
  async deleteAcademicYear(key: string) {
    this.writes.push(`deleteYear:${key}`);
  }
  async setCurrentAcademicYear(key: string) {
    this.writes.push(`setCurrent:${key}`);
    return year({ key, isCurrent: true });
  }
  async listTerms() {
    return this.terms;
  }
  async findTerm(key: string) {
    return this.terms.find((t) => t.key === key) ?? null;
  }
  async upsertTerm(i: { key: string; academicYearKey: string; ordinal: number; name: string }) {
    this.writes.push(`upsertTerm:${i.key}`);
    return { ...i, textbookCount: 0, enrollmentCount: 0 };
  }
  async updateTerm(key: string) {
    this.writes.push(`updateTerm:${key}`);
    return {
      key,
      academicYearKey: '2026-2027',
      ordinal: 1,
      name: 'x',
      textbookCount: 0,
      enrollmentCount: 0,
    };
  }
  async deleteTerm(key: string) {
    this.writes.push(`deleteTerm:${key}`);
  }
  async listSchools(): Promise<readonly SchoolRecord[]> {
    return [];
  }
  async findSchool() {
    return null;
  }
  async upsertSchool(i: { key: string; name: string; city: string | null }) {
    this.writes.push(`upsertSchool:${i.key}`);
    return { ...i, isActive: true, enrollmentCount: 0, roleGrantCount: 0 };
  }
  async updateSchool(key: string) {
    this.writes.push(`updateSchool:${key}`);
    return { key, name: 'x', city: null, isActive: true, enrollmentCount: 0, roleGrantCount: 0 };
  }
  async deleteSchool(key: string) {
    this.writes.push(`deleteSchool:${key}`);
  }
}

describe('CatalogueService', () => {
  it('refuses to delete a subject that still has textbooks, without writing', async () => {
    const repo = new FakeRepo();
    repo.subjects = [subject({ textbookCount: 2 })];
    const service = new CatalogueService(repo);

    const result = await service.deleteSubject('MATH');

    expect(codeOf(result)).toBe('catalogue.in_use');
    // The evidence that matters: no delete reached the database.
    expect(repo.writes).toEqual([]);
  });

  it('refuses to delete the current academic year', async () => {
    const repo = new FakeRepo();
    const service = new CatalogueService(repo);

    const result = await service.deleteAcademicYear('2026-2027');

    expect(codeOf(result)).toBe('catalogue.current_year_protected');
    expect(repo.writes).toEqual([]);
  });

  it('refuses a term whose academic year does not exist, before writing', async () => {
    const repo = new FakeRepo();
    const service = new CatalogueService(repo);

    const result = await service.saveTerm({
      key: '2030-2031-T01',
      academicYearKey: '2030-2031',
      ordinal: 1,
      name: 'x',
    });

    expect(codeOf(result)).toBe('catalogue.not_found');
    expect(repo.writes).toEqual([]);
  });

  it('re-validates the merged row on patch, not just the patch', async () => {
    const repo = new FakeRepo();
    const service = new CatalogueService(repo);

    // A blank name is individually plausible as a patch field but produces an
    // invalid row, so it must be rejected against the merged result.
    const result = await service.updateSubject('MATH', { name: '   ' });

    expect(codeOf(result)).toBe('catalogue.name_required');
    expect(repo.writes).toEqual([]);
  });

  it('reports a missing row as not found rather than creating it', async () => {
    const repo = new FakeRepo();
    const service = new CatalogueService(repo);

    expect(codeOf(await service.updateSubject('NOPE', { name: 'x' }))).toBe('catalogue.not_found');
    expect(repo.writes).toEqual([]);
  });

  it('saves a valid subject through one upsert', async () => {
    const repo = new FakeRepo();
    const service = new CatalogueService(repo);

    const result = await service.saveSubject({ key: 'sci', name: 'العلوم' });

    expect(result.ok).toBe(true);
    // Normalised on the way in, so the caller's case does not become the key.
    expect(repo.writes).toEqual(['upsertSubject:SCI']);
  });

  it('deactivates a grade through the lifecycle patch, like a subject or school', async () => {
    const repo = new FakeRepo();
    const grades: GradeRecord[] = [
      {
        key: 'G07',
        ordinal: 7,
        name: 'الصف السابع',
        stage: 'preparatory',
        isActive: true,
        textbookCount: 1,
        enrollmentCount: 2,
      },
    ];
    repo.grades = grades;
    repo.gradesFound = grades;
    const originalUpdate = repo.updateGrade.bind(repo);
    repo.updateGrade = async (
      key: string,
      patch: { name?: string; stage?: string | null; isActive?: boolean },
    ) => {
      const saved = await originalUpdate(key, patch);
      repo.writes.pop();
      repo.writes.push(`updateGrade:${key}:${JSON.stringify(patch)}`);
      return { ...saved, ...patch } as GradeRecord;
    };
    const service = new CatalogueService(repo);

    const result = await service.updateGrade('G07', { isActive: false });

    expect(result.ok).toBe(true);
    // The merged row is still what gets re-validated; the lifecycle flag rides
    // along the same single write every other patch uses.
    expect(repo.writes).toEqual([`updateGrade:G07:${JSON.stringify({ name: grades[0]!.name, stage: grades[0]!.stage, isActive: false })}`]);
  });
});

/**
 * The curriculum matrix — the legacy fill algorithm, ported.
 *
 * The rules under test are the old studio's own, restated for this codebase:
 * preview computes and never writes; the policy wins over stored cells; a
 * subject with no claimed policy is never touched; and a policy-off cell is
 * expressed by absence, not by materialising disabled rows.
 */
describe('the curriculum matrix', () => {
  function matrixRepo(): FakeRepo {
    const repo = new FakeRepo();
    repo.matrixGrades = [
      { key: 'G07', ordinal: 7, name: 'الصف السابع', stage: 'preparatory', isActive: true },
      { key: 'G10', ordinal: 10, name: 'الصف العاشر', stage: 'secondary', isActive: true },
    ];
    repo.matrixSubjects = [
      { key: 'MATH', name: 'الرياضيات', isActive: true, standardGradeLevels: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
      { key: 'PHYS', name: 'الفيزياء', isActive: true, standardGradeLevels: [10, 11, 12] },
      { key: 'ART', name: 'التربية الفنية', isActive: true, standardGradeLevels: [] },
    ];
    // The batch save validates against the SAME reference rows the matrix
    // renders, so the fake carries both views.
    repo.grades = repo.matrixGrades.map((g) => ({
      ...g,
      textbookCount: 0,
      enrollmentCount: 0,
    }));
    repo.subjects = repo.matrixSubjects.map((s) => ({
      key: s.key,
      name: s.name,
      nameEn: null,
      isActive: s.isActive,
      textbookCount: 0,
    }));
    return repo;
  }

  it('previews what fill would change and writes nothing', async () => {
    const repo = matrixRepo();
    // One stored contradiction: maths off in G07 (the policy says on).
    repo.matrixRows = [{ gradeKey: 'G07', subjectKey: 'MATH', isActive: false }];

    const result = await new CatalogueService(repo).fillGradeSubjectsFromPolicy({ apply: false });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // MATH: G07 flips on (stored contradiction), G10 materialises (absent,
    //       policy says on). PHYS: G07 absent + policy off → stays absent;
    //       G10 materialises. ART: no claimed policy → not counted at all.
    expect(result.value.toEnable).toBe(3);
    expect(result.value.toDisable).toBe(0);
    expect(result.value.applied).toBe(false);
    expect(repo.writes).toEqual([]);
  });

  it('applies the policy over stored contradictions on confirm', async () => {
    const repo = matrixRepo();
    repo.matrixRows = [
      { gradeKey: 'G07', subjectKey: 'MATH', isActive: false }, // policy says on
      { gradeKey: 'G07', subjectKey: 'PHYS', isActive: true }, // policy says off
    ];

    const result = await new CatalogueService(repo).fillGradeSubjectsFromPolicy({ apply: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.toEnable).toBe(3); // MATH@G07, MATH@G10, PHYS@G10
    expect(result.value.toDisable).toBe(1); // PHYS@G07
    expect(repo.matrixRows.find((r) => r.gradeKey === 'G07' && r.subjectKey === 'MATH')?.isActive).toBe(true);
    expect(repo.matrixRows.find((r) => r.gradeKey === 'G07' && r.subjectKey === 'PHYS')?.isActive).toBe(false);
    expect(repo.matrixRows.find((r) => r.gradeKey === 'G10' && r.subjectKey === 'PHYS')?.isActive).toBe(true);
  });

  it('never touches a subject without a claimed policy', async () => {
    const repo = matrixRepo();
    repo.matrixRows = [];

    const result = await new CatalogueService(repo).fillGradeSubjectsFromPolicy({ apply: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Only MATH (2 grades) and PHYS (G10 only) cells were written; ART has
    // no policy and must not appear in any write.
    expect(repo.writes.filter((w) => w.includes('ART'))).toEqual([]);
    expect(repo.writes).toHaveLength(3);
  });

  it('refuses a batch that addresses an unknown grade or subject', async () => {
    const repo = matrixRepo();
    const result = await new CatalogueService(repo).applyGradeSubjectCells([
      { gradeKey: 'G99', subjectKey: 'MATH', isActive: true },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('catalogue.matrix_unknown_cell');
    expect(repo.writes).toEqual([]);
  });

  it('saves the administrator\u2019s cells as one batch', async () => {
    const repo = matrixRepo();
    const result = await new CatalogueService(repo).applyGradeSubjectCells([
      { gradeKey: 'G07', subjectKey: 'ART', isActive: true },
      { gradeKey: 'G10', subjectKey: 'ART', isActive: true },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(2);
    expect(repo.writes).toEqual(['cell:G07:ART:true', 'cell:G10:ART:true']);
  });
});
