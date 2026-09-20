/**
 * Catalogue API — subjects, grades, years, terms and the curriculum matrix.
 */

import { api } from '../../shared/api/client';

export interface SubjectRecord {
  readonly key: string;
  readonly name: string;
  readonly nameEn: string | null;
  readonly isActive: boolean;
  readonly textbookCount: number;
  /** Server-computed suggested textbook title for this subject (see §2.2). */
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
  readonly startsOn: string;
  readonly endsOn: string;
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

// ── The curriculum matrix (توزيع المواد على الصفوف) ──────────────────────────

export interface MatrixGrade {
  key: string;
  ordinal: number;
  name: string;
  stage: string | null;
  isActive: boolean;
}

export interface MatrixSubject {
  key: string;
  name: string;
  isActive: boolean;
  /** Grade ordinals the national curriculum offers this subject in. [] = none claimed. */
  standardGradeLevels: readonly number[];
}

export interface MatrixRow {
  gradeKey: string;
  subjectKey: string;
  isActive: boolean;
}

export interface GradeSubjectMatrix {
  grades: readonly MatrixGrade[];
  subjects: readonly MatrixSubject[];
  rows: readonly MatrixRow[];
}

export interface MatrixFillPreview {
  applied: boolean;
  toEnable: number;
  toDisable: number;
  unchanged: number;
}

export const catalogueApi = {
  subjects: {
    list: () => api.get<readonly SubjectRecord[]>('/catalogue/subjects'),
    save: (input: { key: string; name: string; nameEn?: string | null }) =>
      api.post<SubjectRecord>('/catalogue/subjects', input),
    update: (key: string, input: { name?: string; nameEn?: string | null; isActive?: boolean }) =>
      api.patch<SubjectRecord>(`/catalogue/subjects/${encodeURIComponent(key)}`, input),
    remove: (key: string) => api.delete<unknown>(`/catalogue/subjects/${encodeURIComponent(key)}`),
  },

  grades: {
    list: () => api.get<readonly GradeRecord[]>('/catalogue/grades'),
    save: (input: { key: string; ordinal: number; name: string; stage?: string | null }) =>
      api.post<GradeRecord>('/catalogue/grades', input),
    update: (key: string, input: { name?: string; stage?: string | null; isActive?: boolean }) =>
      api.patch<GradeRecord>(`/catalogue/grades/${encodeURIComponent(key)}`, input),
    remove: (key: string) => api.delete<unknown>(`/catalogue/grades/${encodeURIComponent(key)}`),
  },

  academicYears: {
    list: () => api.get<readonly AcademicYearRecord[]>('/catalogue/academic-years'),
    save: (input: { key: string; startsOn: string; endsOn: string }) =>
      api.post<AcademicYearRecord>('/catalogue/academic-years', input),
    makeCurrent: (key: string) =>
      api.post<AcademicYearRecord>(
        `/catalogue/academic-years/${encodeURIComponent(key)}/current`,
        {},
      ),
    remove: (key: string) =>
      api.delete<unknown>(`/catalogue/academic-years/${encodeURIComponent(key)}`),
  },

  terms: {
    list: (academicYearKey?: string) =>
      api.get<readonly TermRecord[]>('/catalogue/terms', {
        ...(academicYearKey ? { query: { academicYearKey } } : {}),
      }),
    save: (input: { key: string; academicYearKey: string; ordinal: number; name: string }) =>
      api.post<TermRecord>('/catalogue/terms', input),
    update: (key: string, input: { name?: string }) =>
      api.patch<TermRecord>(`/catalogue/terms/${encodeURIComponent(key)}`, input),
    remove: (key: string) => api.delete<unknown>(`/catalogue/terms/${encodeURIComponent(key)}`),
  },

  matrix: {
    /** The stored matrix: grades, subjects (with policy), and cells. */
    get: () => api.get<GradeSubjectMatrix>('/catalogue/grade-subjects'),
    /** Save the administrator's cells as one batch */
    save: (changes: readonly { gradeKey: string; subjectKey: string; isActive: boolean }[]) =>
      api.post<readonly MatrixRow[]>('/catalogue/grade-subjects', { changes }),
    /** Preview or apply fill */
    fill: (apply: boolean, gradeKey?: string) =>
      api.post<MatrixFillPreview>('/catalogue/grade-subjects/fill', {
        apply,
        ...(gradeKey ? { gradeKey } : {}),
      }),
    /** Restore the default distribution */
    restore: (apply: boolean) =>
      api.post<MatrixFillPreview>('/catalogue/grade-subjects/restore', { apply }),
  },
};
