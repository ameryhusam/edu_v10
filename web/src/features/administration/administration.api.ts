/**
 * Platform administration, as the UI sees it.
 */

import { api } from '../../shared/api/client';
import {
  catalogueApi,
  type SubjectRecord,
  type GradeRecord,
  type AcademicYearRecord,
  type TermRecord,
  type GradeSubjectMatrix,
  type MatrixFillPreview,
  type MatrixGrade,
  type MatrixSubject,
  type MatrixRow,
} from '../catalogue/catalogue.api';

export type {
  SubjectRecord,
  GradeRecord,
  AcademicYearRecord,
  TermRecord,
  GradeSubjectMatrix,
  MatrixFillPreview,
  MatrixGrade,
  MatrixSubject,
  MatrixRow,
};

export type AdminCollection =
  | 'users'
  | 'learners'
  | 'educators'
  | 'schools'
  | 'subjects'
  | 'activeSubjects'
  | 'grades'
  | 'academicYears'
  | 'terms'
  | 'textbooks'
  | 'units'
  | 'lessons'
  | 'concepts'
  | 'questions'
  | 'exams'
  | 'attempts'
  | 'enrollments'
  | 'currentEnrollments';

export interface CollectionCount {
  readonly collection: AdminCollection;
  readonly total: number;
}

export interface StatusBreakdown {
  readonly status: string;
  readonly total: number;
}

export type AttentionId =
  | 'unlinkedQuestions'
  | 'suspendedUsers'
  | 'draftTextbooks'
  | 'inactiveSchools'
  | 'inactiveSubjects'
  | 'inactiveGrades'
  | 'learnersWithoutEnrollment'
  | 'unscopedTeacherGrants';

export interface AdminOverview {
  readonly collections: readonly CollectionCount[];
  /** The one current year, or null on a fresh install — the header's status. */
  readonly currentAcademicYear: {
    readonly key: string;
    readonly startsOn: string;
    readonly endsOn: string;
    readonly termCount: number;
  } | null;
  readonly usersByStatus: readonly StatusBreakdown[];
  readonly textbooksByStatus: readonly StatusBreakdown[];
  readonly attention: Readonly<Record<AttentionId, number>>;
}

export interface ActivityEntry {
  readonly action: string;
  readonly entity: string;
  readonly entityKey: string | null;
  readonly actorName: string | null;
  readonly createdAt: string;
}

export const administrationApi = {
  overview: () => api.get<AdminOverview>('/administration/overview'),

  activity: (limit = 12) =>
    api.get<readonly ActivityEntry[]>('/administration/activity', { query: { limit } }),

  subjects: catalogueApi.subjects,
  grades: catalogueApi.grades,
  academicYears: catalogueApi.academicYears,
  terms: catalogueApi.terms,
  matrix: catalogueApi.matrix,

  educators: {
    create: (input: {
      username: string;
      fullName: string;
      password: string;
      email?: string | null;
      phone?: string | null;
      schoolKey: string;
      employeeCode?: string | null;
      specialty?: string | null;
      subjectKeys?: readonly string[];
    }) => api.post<unknown>('provisioning/educators', input),

    update: (input: {
      userKey: string;
      schoolKey?: string;
      employeeCode?: string | null;
      specialty?: string | null;
      subjectKeys?: readonly string[];
    }) => api.patch<unknown>('provisioning/educators', input),
  },
};
