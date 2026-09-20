/**
 * What the catalogue needs from the outside world.
 *
 * One port, not five: subjects, grades, years, terms and schools are edited by
 * the same administrator in the same screen, and splitting them into separate
 * repositories would buy nothing but five constructor arguments.
 *
 * The delete methods return reference counts rather than booleans because the
 * domain decides whether removal is allowed and the caller deserves to be told
 * *what* is still pointing at the row.
 */

export interface SubjectRecord {
  readonly key: string;
  readonly name: string;
  readonly nameEn: string | null;
  readonly isActive: boolean;
  /** How many textbooks use this subject. Drives the in-use refusal. */
  readonly textbookCount: number;
  /**
   * The suggested textbook title for this subject, computed once here from
   * `textbookTitleForSubject` (content's domain) rather than in every screen
   * that offers to create a textbook — see
   * docs/BACKEND-FINAL-AUDIT-AND-PRODUCTION-PLAN-2026-09-15.md §2.2, where the
   * same naming function existed as a byte-for-byte duplicate in the web
   * client and the backend.
   */
  readonly defaultTextbookTitle: string;
}

export interface GradeRecord {
  readonly key: string;
  readonly ordinal: number;
  readonly name: string;
  readonly stage: string | null;
  readonly isActive: boolean;
  readonly textbookCount: number;
  readonly enrollmentCount: number;
}

export interface AcademicYearRecord {
  readonly key: string;
  readonly startsOn: Date;
  readonly endsOn: Date;
  readonly isCurrent: boolean;
  readonly termCount: number;
  readonly enrollmentCount: number;
}

export interface TermRecord {
  readonly key: string;
  readonly academicYearKey: string;
  readonly ordinal: number;
  readonly name: string;
  readonly textbookCount: number;
  readonly enrollmentCount: number;
}

/** A subject as the matrix shows it: identity plus its offer policy. */
export interface MatrixSubject {
  readonly key: string;
  readonly name: string;
  readonly isActive: boolean;
  /** Grade ordinals the national curriculum offers this subject in. [] = none claimed. */
  readonly standardGradeLevels: readonly number[];
}

export interface MatrixGrade {
  readonly key: string;
  readonly ordinal: number;
  readonly name: string;
  readonly stage: string | null;
  readonly isActive: boolean;
}

/** One materialised cell of the matrix. Absent rows mean "not offered". */
export interface MatrixRow {
  readonly gradeKey: string;
  readonly subjectKey: string;
  readonly isActive: boolean;
}

export interface GradeSubjectMatrix {
  readonly grades: readonly MatrixGrade[];
  readonly subjects: readonly MatrixSubject[];
  readonly rows: readonly MatrixRow[];
}

export interface SchoolRecord {
  readonly key: string;
  readonly name: string;
  readonly city: string | null;
  readonly isActive: boolean;
  readonly enrollmentCount: number;
  readonly roleGrantCount: number;
}

/**
 * What the repository actually stores and can compute without help: every
 * `SubjectRecord` field except `defaultTextbookTitle`, which is a pure
 * function of `name` and therefore the application service's job to attach —
 * see `withDefaultTitle` in `catalogue.service.ts`. Keeping this derived
 * field out of the repository's own return type means an adapter cannot drift
 * from the naming rule by recomputing it itself.
 */
export type SubjectRow = Omit<SubjectRecord, 'defaultTextbookTitle'>;

export interface CatalogueRepository {
  listSubjects(): Promise<readonly SubjectRow[]>;
  findSubject(key: string): Promise<SubjectRow | null>;

  /** The grade × subject matrix: every reference row, and every stored cell. */
  gradeSubjectMatrix(): Promise<GradeSubjectMatrix>;
  /** Create or update cells, wholesale, by (gradeKey, subjectKey). */
  applyGradeSubjectCells(
    changes: readonly { gradeKey: string; subjectKey: string; isActive: boolean }[],
  ): Promise<readonly MatrixRow[]>;
  upsertSubject(input: {
    key: string;
    name: string;
    nameEn: string | null;
  }): Promise<SubjectRow>;
  updateSubject(
    key: string,
    patch: { name?: string; nameEn?: string | null; isActive?: boolean },
  ): Promise<SubjectRow>;
  deleteSubject(key: string): Promise<void>;

  listGrades(): Promise<readonly GradeRecord[]>;
  findGrade(key: string): Promise<GradeRecord | null>;
  upsertGrade(input: {
    key: string;
    ordinal: number;
    name: string;
    stage: string | null;
  }): Promise<GradeRecord>;
  updateGrade(
    key: string,
    patch: { name?: string; stage?: string | null; isActive?: boolean },
  ): Promise<GradeRecord>;
  deleteGrade(key: string): Promise<void>;
  /** Another grade already holding this ordinal, if any. Ordinal is unique. */
  findGradeByOrdinal(ordinal: number): Promise<GradeRecord | null>;

  listAcademicYears(): Promise<readonly AcademicYearRecord[]>;
  findAcademicYear(key: string): Promise<AcademicYearRecord | null>;
  upsertAcademicYear(input: {
    key: string;
    startsOn: Date;
    endsOn: Date;
  }): Promise<AcademicYearRecord>;
  deleteAcademicYear(key: string): Promise<void>;
  /** Clear every `isCurrent` flag, then set one. A single transaction. */
  setCurrentAcademicYear(key: string): Promise<AcademicYearRecord>;

  listTerms(academicYearKey?: string): Promise<readonly TermRecord[]>;
  findTerm(key: string): Promise<TermRecord | null>;
  upsertTerm(input: {
    key: string;
    academicYearKey: string;
    ordinal: number;
    name: string;
  }): Promise<TermRecord>;
  updateTerm(key: string, patch: { name?: string }): Promise<TermRecord>;
  deleteTerm(key: string): Promise<void>;

  listSchools(): Promise<readonly SchoolRecord[]>;
  findSchool(key: string): Promise<SchoolRecord | null>;
  upsertSchool(input: { key: string; name: string; city: string | null }): Promise<SchoolRecord>;
  updateSchool(
    key: string,
    patch: { name?: string; city?: string | null; isActive?: boolean },
  ): Promise<SchoolRecord>;
  deleteSchool(key: string): Promise<void>;
}
