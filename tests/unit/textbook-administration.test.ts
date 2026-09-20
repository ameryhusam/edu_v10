/**
 * Textbook administration — the adoption ledger.
 *
 * The rule worth defending: an adoption is a deployment FACT with identity
 * (textbook, school, academic year), not a row to be edited. Re-adopting is a
 * conflict, unadopting removes a fact that must exist, and every coordinate is
 * resolved by business key so a refusal can name what was wrong.
 *
 * Until this service existed the seed was the only writer of adoptions, which
 * made learner entitlement — derived from them — depend on a seed script.
 */

import { describe, expect, it } from 'vitest';
import { TextbookAdministrationService } from '../../src/contexts/content/application/textbook-administration.service.js';
import type {
  AdoptionListPage,
  AdoptionListQuery,
  AdoptionRow,
  TextbookAdministrationRepository,
  TextbookListPage,
  TextbookListQuery,
} from '../../src/contexts/content/application/ports.js';

const ACTOR = { actorKey: 'usr_admin' };

const TRIPLE = {
  textbookKey: 'EDU-MATH-G07-T1-ED2026',
  schoolKey: 'sch_demo',
  academicYearKey: '2026-2027',
};

function adoption(over: Partial<AdoptionRow> = {}): AdoptionRow {
  return {
    textbookKey: TRIPLE.textbookKey,
    textbookTitle: 'Maths G7',
    textbookStatus: 'PUBLISHED',
    schoolKey: TRIPLE.schoolKey,
    schoolName: 'Demo School',
    academicYearKey: TRIPLE.academicYearKey,
    adoptedAt: new Date('2026-09-01T00:00:00Z'),
    ...over,
  };
}

class FakeRepo implements TextbookAdministrationRepository {
  // The outline reads are exercised over the real adapter; this fake only
  // serves the adoption tests.
  async textbookOutline(): Promise<never> {
    throw new Error('not used here');
  }
  async lessonMaterials(): Promise<never> {
    throw new Error('not used here');
  }
  async conceptDetail(): Promise<never> {
    throw new Error('not used here');
  }
  exists = { textbook: true, school: true, academicYear: true };
  adoptions: AdoptionRow[] = [];
  writes: string[] = [];
  lastTextbookQuery: Record<string, unknown> | null = null;
  lastAdoptionQuery: Record<string, unknown> | null = null;

  async listTextbooks(query: TextbookListQuery): Promise<TextbookListPage> {
    this.lastTextbookQuery = query as unknown as Record<string, unknown>;
    return { rows: [], total: 0 };
  }
  async findTextbookByCoordinates(input: {
    subjectKey: string;
    gradeKey: string;
    termKey: string;
    edition: string;
  }) {
    return {
      key: `EDU-${input.subjectKey}-${input.gradeKey}-${input.termKey}-ED${input.edition}`,
      title: `${input.subjectKey} ${input.gradeKey}`,
      edition: input.edition,
    };
  }
  async activeGradeSubjects() {
    return [{ gradeKey: 'G07', gradeName: 'Grade 7', subjectKey: 'MATH', subjectName: 'Maths' }];
  }
  gradeTextbooks: Array<{ key: string; title: string; edition: string }> = [];
  async textbooksForGrade(): Promise<readonly { key: string; title: string; edition: string }[]> {
    return this.gradeTextbooks;
  }
  async listAdoptions(query: AdoptionListQuery): Promise<AdoptionListPage> {
    this.lastAdoptionQuery = query as unknown as Record<string, unknown>;
    return { rows: this.adoptions, total: this.adoptions.length };
  }
  async findAdoption(input: typeof TRIPLE): Promise<AdoptionRow | null> {
    return (
      this.adoptions.find(
        (row) =>
          row.textbookKey === input.textbookKey &&
          row.schoolKey === input.schoolKey &&
          row.academicYearKey === input.academicYearKey,
      ) ?? null
    );
  }
  async createAdoption(input: typeof TRIPLE): Promise<AdoptionRow> {
    this.writes.push('create');
    return adoption({ ...input });
  }
  async deleteAdoption(): Promise<void> {
    this.writes.push('delete');
  }
  async textbookExists(): Promise<boolean> {
    return this.exists.textbook;
  }
  async schoolExists(): Promise<boolean> {
    return this.exists.school;
  }
  async academicYearExists(): Promise<boolean> {
    return this.exists.academicYear;
  }
}

const codeOf = (r: { ok: boolean; error?: { code: string } }) =>
  (r as { error: { code: string } }).error.code;

function service(repo: FakeRepo) {
  const audits: string[] = [];
  const authoring = {
    createTextbook: async (_ctx: unknown, input: { subjectKey: string; gradeKey: string; termKey: string; title: string; edition: string }) => ({
      ok: true,
      value: { key: `EDU-${input.subjectKey}-G07-T1-ED${input.edition}`, title: input.title, edition: input.edition, status: 'DRAFT' },
    }),
  };
  return {
    audits,
    inner: new TextbookAdministrationService(repo, {
      record: async (entry) => {
        audits.push(entry.action);
      },
    }, authoring as never),
  };
}

describe('adopting a textbook for a school', () => {
  it('records the deployment fact and audits it', async () => {
    const repo = new FakeRepo();
    const { inner, audits } = service(repo);

    const result = await inner.adopt(ACTOR, TRIPLE);

    expect(result.ok).toBe(true);
    expect(repo.writes).toEqual(['create']);
    expect(audits).toEqual(['content.textbook_adopted']);
  });

  it('refuses an unknown coordinate by name, without writing', async () => {
    const repo = new FakeRepo();
    repo.exists.school = false;
    const { inner } = service(repo);

    const result = await inner.adopt(ACTOR, TRIPLE);

    expect(result.ok).toBe(false);
    expect(codeOf(result)).toBe('content.adoption_coordinate_not_found');
    expect(repo.writes).toEqual([]);
  });

  it('refuses a repeat adoption — the triple is the identity', async () => {
    const repo = new FakeRepo();
    repo.adoptions = [adoption()];
    const { inner } = service(repo);

    const result = await inner.adopt(ACTOR, TRIPLE);

    expect(result.ok).toBe(false);
    expect(codeOf(result)).toBe('content.adoption_exists');
    expect(repo.writes).toEqual([]);
  });

  it('allows adopting a DRAFT book — entitlement filters published, not adoption', async () => {
    // Planning ahead is legitimate: the school records what it WILL teach
    // while the ingested copy is still being prepared. The publication gate
    // decides what learners may open; duplicating that rule here would give
    // it a second opinion.
    const repo = new FakeRepo();
    repo.adoptions = [];
    const { inner } = service(repo);

    const result = await inner.adopt(ACTOR, TRIPLE);

    expect(result.ok).toBe(true);
  });
});

describe('withdrawing an adoption', () => {
  it('removes an existing fact and audits it', async () => {
    const repo = new FakeRepo();
    repo.adoptions = [adoption()];
    const { inner, audits } = service(repo);

    const result = await inner.unadopt(ACTOR, TRIPLE);

    expect(result.ok).toBe(true);
    expect(repo.writes).toEqual(['delete']);
    expect(audits).toEqual(['content.textbook_unadopted']);
  });

  it('refuses to withdraw a fact that does not exist', async () => {
    const repo = new FakeRepo();
    const { inner } = service(repo);

    const result = await inner.unadopt(ACTOR, TRIPLE);

    expect(result.ok).toBe(false);
    expect(codeOf(result)).toBe('content.adoption_not_found');
  });
});

describe('accrediting a whole grade', () => {
  it('adopts every one of the grade\'s textbooks and reports which were already adopted', async () => {
    const repo = new FakeRepo();
    repo.gradeTextbooks = [
      { key: 'EDU-MATH-G07-T1-ED2026', title: 'Maths G7', edition: '2026' },
      { key: 'EDU-SCI-G07-T1-ED2026', title: 'Science G7', edition: '2026' },
    ];
    repo.adoptions = [adoption({ textbookKey: 'EDU-MATH-G07-T1-ED2026' })];
    const { inner, audits } = service(repo);

    const result = await inner.adoptGrade(ACTOR, {
      gradeKey: 'G07',
      schoolKey: TRIPLE.schoolKey,
      academicYearKey: TRIPLE.academicYearKey,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.adopted).toBe(1);
      expect(result.value.alreadyAdopted).toBe(1);
      expect(result.value.rows).toHaveLength(2);
    }
    expect(audits).toContain('content.grade_accredited');
  });

  it('accredits a single named textbook for the grade when one is given', async () => {
    const repo = new FakeRepo();
    const { inner } = service(repo);

    const result = await inner.adoptGrade(ACTOR, {
      gradeKey: 'G07',
      textbookKey: TRIPLE.textbookKey,
      schoolKey: TRIPLE.schoolKey,
      academicYearKey: TRIPLE.academicYearKey,
    });

    expect(result.ok).toBe(true);
    expect(repo.writes).toEqual(['create']);
  });

  it('refuses a grade with no textbooks yet, without writing', async () => {
    const repo = new FakeRepo();
    repo.gradeTextbooks = [];
    const { inner } = service(repo);

    const result = await inner.adoptGrade(ACTOR, {
      gradeKey: 'G07',
      schoolKey: TRIPLE.schoolKey,
      academicYearKey: TRIPLE.academicYearKey,
    });

    expect(result.ok).toBe(false);
    expect(codeOf(result)).toBe('content.grade_has_no_textbooks');
    expect(repo.writes).toEqual([]);
  });

  it('refuses an unknown school by name, without writing', async () => {
    const repo = new FakeRepo();
    repo.exists.school = false;
    const { inner } = service(repo);

    const result = await inner.adoptGrade(ACTOR, {
      gradeKey: 'G07',
      textbookKey: TRIPLE.textbookKey,
      schoolKey: TRIPLE.schoolKey,
      academicYearKey: TRIPLE.academicYearKey,
    });

    expect(result.ok).toBe(false);
    expect(codeOf(result)).toBe('content.adoption_coordinate_not_found');
    expect(repo.writes).toEqual([]);
  });
});

describe('the catalogue browser', () => {
  it('clamps its page size like every other directory', async () => {
    const repo = new FakeRepo();
    const { inner } = service(repo);

    await inner.listTextbooks({ limit: 5000, offset: -3 });

    expect(repo.lastTextbookQuery).toMatchObject({ limit: 100, offset: 0 });
  });

  it('clamps the adoption list the same way', async () => {
    const repo = new FakeRepo();
    const { inner } = service(repo);

    await inner.listAdoptions({ limit: 0, offset: -1 });

    expect(repo.lastAdoptionQuery).toMatchObject({ limit: 1, offset: 0 });
  });
});
