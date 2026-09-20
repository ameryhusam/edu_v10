/**
 * Prisma adapter for the catalogue port.
 *
 * The only interesting thing here is the reference counts. Every read returns
 * them via `_count` so the service can refuse a deletion and say exactly what
 * is still pointing at the row. Fetching them lazily — count only when a delete
 * is attempted — would be one fewer join per list, but then the UI could not
 * grey out a delete button, and the user would only discover the refusal after
 * clicking it.
 *
 * Note the absence of `Promise.all`: PGlite serves one connection at a time in
 * development, so concurrent Prisma calls deadlock.
 */

import type {
  AcademicYearRecord,
  CatalogueRepository,
  GradeSubjectMatrix,
  MatrixRow,
  GradeRecord,
  SchoolRecord,
  SubjectRow as SubjectPortRow,
  TermRecord,
} from '../../contexts/catalogue/application/ports.js';
import type { Db } from './prisma.client.js';

const subjectSelect = {
  key: true,
  name: true,
  nameEn: true,
  isActive: true,
  _count: { select: { textbooks: true } },
} as const;

const gradeSelect = {
  key: true,
  ordinal: true,
  name: true,
  stage: true,
  isActive: true,
  _count: { select: { textbooks: true, enrollments: true } },
} as const;

const yearSelect = {
  key: true,
  startsOn: true,
  endsOn: true,
  isCurrent: true,
  _count: { select: { terms: true, enrollments: true } },
} as const;

const termSelect = {
  key: true,
  ordinal: true,
  name: true,
  academicYear: { select: { key: true } },
  _count: { select: { textbooks: true, enrollments: true } },
} as const;

const schoolSelect = {
  key: true,
  name: true,
  city: true,
  isActive: true,
  _count: { select: { enrollments: true, roles: true } },
} as const;

/** Raw Prisma projection shape — see `SubjectPortRow` for the port's shape. */
type SubjectRow = {
  key: string;
  name: string;
  nameEn: string | null;
  isActive: boolean;
  _count: { textbooks: number };
};
type GradeRow = {
  key: string;
  ordinal: number;
  name: string;
  stage: string | null;
  isActive: boolean;
  _count: { textbooks: number; enrollments: number };
};
type YearRow = {
  key: string;
  startsOn: Date;
  endsOn: Date;
  isCurrent: boolean;
  _count: { terms: number; enrollments: number };
};
type TermRow = {
  key: string;
  ordinal: number;
  name: string;
  academicYear: { key: string };
  _count: { textbooks: number; enrollments: number };
};
type SchoolRow = {
  key: string;
  name: string;
  city: string | null;
  isActive: boolean;
  _count: { enrollments: number; roles: number };
};

const toSubject = (r: SubjectRow): SubjectPortRow => ({
  key: r.key,
  name: r.name,
  nameEn: r.nameEn,
  isActive: r.isActive,
  textbookCount: r._count.textbooks,
});

const toGrade = (r: GradeRow): GradeRecord => ({
  key: r.key,
  ordinal: r.ordinal,
  name: r.name,
  stage: r.stage,
  isActive: r.isActive,
  textbookCount: r._count.textbooks,
  enrollmentCount: r._count.enrollments,
});

const toYear = (r: YearRow): AcademicYearRecord => ({
  key: r.key,
  startsOn: r.startsOn,
  endsOn: r.endsOn,
  isCurrent: r.isCurrent,
  termCount: r._count.terms,
  enrollmentCount: r._count.enrollments,
});

const toTerm = (r: TermRow): TermRecord => ({
  key: r.key,
  academicYearKey: r.academicYear.key,
  ordinal: r.ordinal,
  name: r.name,
  textbookCount: r._count.textbooks,
  enrollmentCount: r._count.enrollments,
});

const toSchool = (r: SchoolRow): SchoolRecord => ({
  key: r.key,
  name: r.name,
  city: r.city,
  isActive: r.isActive,
  enrollmentCount: r._count.enrollments,
  roleGrantCount: r._count.roles,
});

export class PrismaCatalogueRepository implements CatalogueRepository {
  constructor(private readonly db: Db) {}

  // ── Subjects ──────────────────────────────────────────────────────────────

  /**
   * The matrix in one read: reference rows for context, stored cells as the
   * truth. Absence is information — "not offered" is a missing row, not a
   * row with a flag, so the UI can tell an administrator's explicit "off"
   * (stored, disabled) from "never decided" (absent).
   */
  async gradeSubjectMatrix(): Promise<GradeSubjectMatrix> {
    const [grades, subjects, cells] = await Promise.all([
      this.db.grade.findMany({
        select: { key: true, ordinal: true, name: true, stage: true, isActive: true },
        orderBy: { ordinal: 'asc' },
      }),
      this.db.subject.findMany({
        select: { key: true, name: true, isActive: true, standardGradeLevels: true },
        orderBy: { key: 'asc' },
      }),
      this.db.gradeSubject.findMany({
        select: { isActive: true, grade: { select: { key: true } }, subject: { select: { key: true } } },
      }),
    ]);
    return {
      grades,
      subjects: subjects.map((s) => ({
        key: s.key,
        name: s.name,
        isActive: s.isActive,
        standardGradeLevels: s.standardGradeLevels,
      })),
      rows: cells.map((c) => ({
        gradeKey: c.grade.key,
        subjectKey: c.subject.key,
        isActive: c.isActive,
      })),
    };
  }

  /**
   * Cell writes are sequential on purpose: PGlite executes one statement at a
   * time, and the batches here are an administrator's matrix save (tens of
   * rows), not a bulk import.
   */
  async applyGradeSubjectCells(
    changes: readonly { gradeKey: string; subjectKey: string; isActive: boolean }[],
  ): Promise<readonly MatrixRow[]> {
    const gradeIds = new Map(
      (await this.db.grade.findMany({ select: { id: true, key: true } })).map((g) => [g.key, g.id]),
    );
    const subjectIds = new Map(
      (await this.db.subject.findMany({ select: { id: true, key: true } })).map((s) => [s.key, s.id]),
    );

    const out: MatrixRow[] = [];
    for (const change of changes) {
      const gradeId = gradeIds.get(change.gradeKey);
      const subjectId = subjectIds.get(change.subjectKey);
      if (!gradeId || !subjectId) continue; // the service already refused these
      const row = await this.db.gradeSubject.upsert({
        where: { gradeId_subjectId: { gradeId, subjectId } },
        create: {
          key: `${change.gradeKey}-${change.subjectKey}`,
          gradeId,
          subjectId,
          isActive: change.isActive,
        },
        update: { isActive: change.isActive },
        select: { isActive: true },
      });
      out.push({ gradeKey: change.gradeKey, subjectKey: change.subjectKey, isActive: row.isActive });
    }
    return out;
  }

  async listSubjects(): Promise<readonly SubjectPortRow[]> {
    const rows = await this.db.subject.findMany({
      select: subjectSelect,
      orderBy: { key: 'asc' },
    });
    return rows.map(toSubject);
  }

  async findSubject(key: string): Promise<SubjectPortRow | null> {
    const row = await this.db.subject.findUnique({ where: { key }, select: subjectSelect });
    return row ? toSubject(row) : null;
  }

  async upsertSubject(input: {
    key: string;
    name: string;
    nameEn: string | null;
  }): Promise<SubjectPortRow> {
    const row = await this.db.subject.upsert({
      where: { key: input.key },
      create: { key: input.key, name: input.name, nameEn: input.nameEn },
      update: { name: input.name, nameEn: input.nameEn },
      select: subjectSelect,
    });
    return toSubject(row);
  }

  async updateSubject(
    key: string,
    patch: { name?: string; nameEn?: string | null; isActive?: boolean },
  ): Promise<SubjectPortRow> {
    const row = await this.db.subject.update({
      where: { key },
      data: patch,
      select: subjectSelect,
    });
    return toSubject(row);
  }

  async deleteSubject(key: string): Promise<void> {
    await this.db.subject.delete({ where: { key } });
  }

  // ── Grades ────────────────────────────────────────────────────────────────

  async listGrades(): Promise<readonly GradeRecord[]> {
    const rows = await this.db.grade.findMany({ select: gradeSelect, orderBy: { ordinal: 'asc' } });
    return rows.map(toGrade);
  }

  async findGrade(key: string): Promise<GradeRecord | null> {
    const row = await this.db.grade.findUnique({ where: { key }, select: gradeSelect });
    return row ? toGrade(row) : null;
  }

  async findGradeByOrdinal(ordinal: number): Promise<GradeRecord | null> {
    const row = await this.db.grade.findUnique({ where: { ordinal }, select: gradeSelect });
    return row ? toGrade(row) : null;
  }

  async upsertGrade(input: {
    key: string;
    ordinal: number;
    name: string;
    stage: string | null;
  }): Promise<GradeRecord> {
    const row = await this.db.grade.upsert({
      where: { key: input.key },
      create: input,
      update: { name: input.name, stage: input.stage },
      select: gradeSelect,
    });
    return toGrade(row);
  }

  async updateGrade(
    key: string,
    patch: { name?: string; stage?: string | null; isActive?: boolean },
  ): Promise<GradeRecord> {
    const row = await this.db.grade.update({ where: { key }, data: patch, select: gradeSelect });
    return toGrade(row);
  }

  async deleteGrade(key: string): Promise<void> {
    await this.db.grade.delete({ where: { key } });
  }

  // ── Academic years ────────────────────────────────────────────────────────

  async listAcademicYears(): Promise<readonly AcademicYearRecord[]> {
    const rows = await this.db.academicYear.findMany({
      select: yearSelect,
      orderBy: { key: 'desc' },
    });
    return rows.map(toYear);
  }

  async findAcademicYear(key: string): Promise<AcademicYearRecord | null> {
    const row = await this.db.academicYear.findUnique({ where: { key }, select: yearSelect });
    return row ? toYear(row) : null;
  }

  async upsertAcademicYear(input: {
    key: string;
    startsOn: Date;
    endsOn: Date;
  }): Promise<AcademicYearRecord> {
    const row = await this.db.academicYear.upsert({
      where: { key: input.key },
      create: input,
      update: { startsOn: input.startsOn, endsOn: input.endsOn },
      select: yearSelect,
    });
    return toYear(row);
  }

  /**
   * One transaction, because a half-applied change here leaves the system with
   * either zero or two current years, and every unscoped read depends on there
   * being exactly one.
   */
  async setCurrentAcademicYear(key: string): Promise<AcademicYearRecord> {
    const [, row] = await this.db.$transaction([
      this.db.academicYear.updateMany({
        where: { isCurrent: true, key: { not: key } },
        data: { isCurrent: false },
      }),
      this.db.academicYear.update({
        where: { key },
        data: { isCurrent: true },
        select: yearSelect,
      }),
    ]);
    return toYear(row);
  }

  async deleteAcademicYear(key: string): Promise<void> {
    await this.db.academicYear.delete({ where: { key } });
  }

  // ── Terms ─────────────────────────────────────────────────────────────────

  async listTerms(academicYearKey?: string): Promise<readonly TermRecord[]> {
    const rows = await this.db.term.findMany({
      ...(academicYearKey ? { where: { academicYear: { key: academicYearKey } } } : {}),
      select: termSelect,
      orderBy: [{ academicYear: { key: 'desc' } }, { ordinal: 'asc' }],
    });
    return rows.map(toTerm);
  }

  async findTerm(key: string): Promise<TermRecord | null> {
    const row = await this.db.term.findUnique({ where: { key }, select: termSelect });
    return row ? toTerm(row) : null;
  }

  async upsertTerm(input: {
    key: string;
    academicYearKey: string;
    ordinal: number;
    name: string;
  }): Promise<TermRecord> {
    const year = await this.db.academicYear.findUniqueOrThrow({
      where: { key: input.academicYearKey },
      select: { id: true },
    });
    const row = await this.db.term.upsert({
      where: { key: input.key },
      create: {
        key: input.key,
        academicYearId: year.id,
        ordinal: input.ordinal,
        name: input.name,
      },
      update: { name: input.name },
      select: termSelect,
    });
    return toTerm(row);
  }

  async updateTerm(key: string, patch: { name?: string }): Promise<TermRecord> {
    const row = await this.db.term.update({ where: { key }, data: patch, select: termSelect });
    return toTerm(row);
  }

  async deleteTerm(key: string): Promise<void> {
    await this.db.term.delete({ where: { key } });
  }

  // ── Schools ───────────────────────────────────────────────────────────────

  async listSchools(): Promise<readonly SchoolRecord[]> {
    const rows = await this.db.school.findMany({ select: schoolSelect, orderBy: { name: 'asc' } });
    return rows.map(toSchool);
  }

  async findSchool(key: string): Promise<SchoolRecord | null> {
    const row = await this.db.school.findUnique({ where: { key }, select: schoolSelect });
    return row ? toSchool(row) : null;
  }

  async upsertSchool(input: {
    key: string;
    name: string;
    city: string | null;
  }): Promise<SchoolRecord> {
    const row = await this.db.school.upsert({
      where: { key: input.key },
      create: input,
      update: { name: input.name, city: input.city },
      select: schoolSelect,
    });
    return toSchool(row);
  }

  async updateSchool(
    key: string,
    patch: { name?: string; city?: string | null; isActive?: boolean },
  ): Promise<SchoolRecord> {
    const row = await this.db.school.update({
      where: { key },
      data: patch,
      select: schoolSelect,
    });
    return toSchool(row);
  }

  async deleteSchool(key: string): Promise<void> {
    await this.db.school.delete({ where: { key } });
  }
}
