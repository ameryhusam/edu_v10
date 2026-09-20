/**
 * The people surface (provisioning), as the UI sees it.
 *
 * Every call here is admin-gated on the server. Nothing in this module decides
 * who may call it — FE10 forbids the frontend from holding an authorization
 * opinion, and a UI that hides a button is a courtesy, never a control.
 *
 * There is no `delete` for a person: someone who has answered a question is
 * part of the evidence record, so the server offers suspend, reinstate and
 * archive instead, and the client must not invent a destructive verb it does
 * not have.
 */

import { api } from '../../shared/api/client';

export type RoleName =
  | 'SYSTEM_ADMIN'
  | 'SCHOOL_ADMIN'
  | 'TEACHER'
  | 'STUDENT'
  | 'PARENT'
  | 'CONTENT_AUTHOR';

export type UserStatus = 'ACTIVE' | 'SUSPENDED' | 'INVITED' | 'ARCHIVED';

export const ALL_ROLES: readonly RoleName[] = [
  'SYSTEM_ADMIN',
  'SCHOOL_ADMIN',
  'TEACHER',
  'STUDENT',
  'PARENT',
  'CONTENT_AUTHOR',
];

export const ALL_STATUSES: readonly UserStatus[] = ['ACTIVE', 'SUSPENDED', 'INVITED', 'ARCHIVED'];

export interface DirectoryUser {
  readonly key: string;
  readonly username: string;
  readonly fullName: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly status: UserStatus;
  readonly roles: readonly RoleName[];
}

export interface DirectoryPage {
  readonly rows: readonly DirectoryUser[];
  /** Matching users in total, not rows on this page. */
  readonly total: number;
}

/**
 * Index-signature shaped because the shared client serialises a query bag.
 * Keeping the named fields alongside it preserves the type checking that
 * would otherwise be lost to a bare `Record<string, unknown>`.
 */
export interface DirectoryQuery {
  readonly search?: string | undefined;
  readonly role?: RoleName | undefined;
  readonly status?: UserStatus | undefined;
  readonly schoolKey?: string | undefined;
  readonly limit?: number | undefined;
  readonly offset?: number | undefined;
  readonly [key: string]: string | number | boolean | null | undefined;
}

/** One user, fully: identity, scoped roles, and the profiles roles imply. */
export interface EducatorSubjectSpecialty {
  readonly subjectKey: string;
  readonly subjectName: string;
}

export interface UserDetail {
  readonly key: string;
  readonly username: string;
  readonly fullName: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly status: UserStatus;
  readonly roles: ReadonlyArray<{ role: RoleName; schoolKey: string | null }>;
  readonly learnerKey: string | null;
  readonly guardianKey: string | null;
  readonly educatorKey: string | null;
  readonly employeeCode: string | null;
  readonly specialty: string | null;
  readonly subjectSpecialties: readonly EducatorSubjectSpecialty[];
}

/** A teacher as the administration sees them: person, staff profile, scope. */
export interface EducatorRow {
  readonly userKey: string;
  readonly username: string;
  readonly fullName: string;
  readonly email: string | null;
  readonly status: UserStatus;
  readonly educatorKey: string | null;
  readonly employeeCode: string | null;
  readonly specialty: string | null;
  readonly subjectSpecialties: readonly EducatorSubjectSpecialty[];
  readonly schools: ReadonlyArray<{ schoolKey: string; schoolName: string }>;
}

export interface EducatorPage {
  readonly rows: readonly EducatorRow[];
  readonly total: number;
}

export interface EducatorQuery {
  readonly search?: string | undefined;
  readonly schoolKey?: string | undefined;
  readonly limit?: number | undefined;
  readonly offset?: number | undefined;
  readonly [key: string]: string | number | boolean | null | undefined;
}

/** An enrolment as a browsing administrator reads it: keys plus names. */
export interface EnrollmentRow {
  readonly key: string;
  readonly learnerKey: string;
  readonly learnerName: string;
  readonly schoolKey: string;
  readonly schoolName: string;
  readonly academicYearKey: string;
  readonly termKey: string;
  readonly termName: string;
  readonly gradeKey: string;
  readonly gradeName: string;
  readonly isCurrent: boolean;
  readonly createdAt: string;
}

/** A learner-scoped placement list: keys for writes, names for reading. */
export interface LearnerEnrollmentRecord {
  readonly key: string;
  readonly learnerKey: string;
  readonly schoolKey: string;
  readonly schoolName: string;
  readonly academicYearKey: string;
  readonly termKey: string;
  readonly termName: string;
  readonly gradeKey: string;
  readonly gradeName: string;
  readonly isCurrent: boolean;
}

export interface EnrollmentPage {
  readonly rows: readonly EnrollmentRow[];
  readonly total: number;
}

export interface EnrollmentQuery {
  readonly schoolKey?: string | undefined;
  readonly academicYearKey?: string | undefined;
  readonly termKey?: string | undefined;
  readonly gradeKey?: string | undefined;
  readonly learnerKey?: string | undefined;
  readonly current?: boolean | undefined;
  readonly limit?: number | undefined;
  readonly offset?: number | undefined;
  readonly [key: string]: string | number | boolean | null | undefined;
}

export interface EnrollmentCreateInput {
  readonly learnerKey: string;
  readonly schoolKey: string;
  readonly academicYearKey: string;
  readonly termKey: string;
  readonly gradeKey: string;
  readonly isCurrent?: boolean;
}

/** A cohort: current enrolments grouped by grade — a query, not an entity. */
export interface CohortCount {
  readonly gradeKey: string;
  readonly gradeName: string;
  readonly currentCount: number;
}

export interface GuardianLinkRow {
  readonly guardianKey: string;
  readonly learnerKey: string;
  readonly relation: string | null;
  readonly isVerified: boolean;
}

export const peopleApi = {
  // ── Users ────────────────────────────────────────────────────────────────

  users: (query: DirectoryQuery) => api.get<DirectoryPage>('provisioning/users', { query }),

  user: (userKey: string) => api.get<UserDetail>(`provisioning/users/${userKey}`),

  createUser: (input: {
    username: string;
    fullName: string;
    password: string;
    email?: string | null;
    phone?: string | null;
    roles: readonly string[];
    schoolKey?: string | null;
  }) => api.post<UserDetail>('provisioning/users', input),

  updateUser: (input: {
    userKey: string;
    fullName?: string;
    email?: string | null;
    phone?: string | null;
  }) => api.patch<UserDetail>('provisioning/users', input),

  changeStatus: (input: { userKey: string; status: UserStatus }) =>
    api.post<UserDetail>('provisioning/users/status', input),

  // ── Roles ────────────────────────────────────────────────────────────────

  grantRole: (input: { userKey: string; role: RoleName; schoolKey?: string | null }) =>
    api.post<UserDetail>('provisioning/roles', input),

  revokeRole: (input: { userKey: string; role: RoleName; schoolKey?: string | null }) =>
    api.post<UserDetail>('provisioning/roles/revoke', input),

  // ── Enrolments ───────────────────────────────────────────────────────────

  enrollments: (query: EnrollmentQuery) =>
    api.get<EnrollmentPage>('provisioning/enrollments', { query }),

  enroll: (input: EnrollmentCreateInput) =>
    api.post<EnrollmentRow>('provisioning/enrollments', input),

  learnerEnrollments: (learnerKey: string) =>
    api.get<readonly LearnerEnrollmentRecord[]>(
      `provisioning/learners/${learnerKey}/enrollments`,
    ),

  makeEnrollmentCurrent: (enrollmentKey: string) =>
    api.post<EnrollmentRow>('provisioning/enrollments/make-current', {
      enrollmentKey,
    }),

  endEnrollment: (enrollmentKey: string) =>
    api.post<EnrollmentRow>('provisioning/enrollments/end', { enrollmentKey }),

  cohorts: (schoolKey: string, academicYearKey?: string) =>
    api.get<readonly CohortCount[]>('provisioning/enrollments/cohorts', {
      query: { schoolKey, ...(academicYearKey ? { academicYearKey } : {}) },
    }),

  // ── Teachers ─────────────────────────────────────────────────────────────

  educators: (query: EducatorQuery) => api.get<EducatorPage>('provisioning/educators', { query }),

  // ── Guardianship ─────────────────────────────────────────────────────────

  guardiansOf: (learnerKey: string) =>
    api.get<readonly GuardianLinkRow[]>(`provisioning/learners/${learnerKey}/guardians`),

  linkGuardian: (input: { guardianKey: string; learnerKey: string; relation?: string | null }) =>
    api.post<GuardianLinkRow>('provisioning/guardian-links', input),

  setGuardianVerified: (input: {
    guardianKey: string;
    learnerKey: string;
    isVerified: boolean;
  }) => api.post<GuardianLinkRow>('provisioning/guardian-links/verification', input),

  unlinkGuardian: (input: { guardianKey: string; learnerKey: string }) =>
    api.post<unknown>('provisioning/guardian-links/remove', input),
};

export const adminApi = peopleApi;
