/**
 * Ports owned by the Identity context.
 */

import type { ScopedRoleGrant } from '../domain/roles.js';
import type { AccessTokenClaims, RefreshTokenClaims, TokenClaims } from '../domain/credentials.js';

export interface UserAccount {
  readonly id: string;
  readonly key: string;
  readonly username: string;
  readonly email: string | null;
  readonly fullName: string;
  readonly passwordHash: string;
  readonly status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  readonly locale: string;
  readonly roles: readonly ScopedRoleGrant[];
  /** Present only when the user has a learner profile. */
  readonly learnerKey: string | null;
}

export interface UserRepository {
  /** Match on username OR email, already normalised by the caller. */
  findByLoginIdentifier(identifier: string): Promise<UserAccount | null>;
  findById(userId: string): Promise<UserAccount | null>;
  recordLogin(userId: string, at: Date): Promise<void>;
  updatePasswordHash(userId: string, passwordHash: string): Promise<void>;
}

export interface SessionRecord {
  readonly id: string;
  readonly userId: string;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly rotatedToId: string | null;
}

export interface SessionRepository {
  /** Stores only a hash — a leaked database must not yield usable tokens. */
  create(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    userAgent?: string | null;
    ip?: string | null;
  }): Promise<SessionRecord>;
  /**
   * Attach the token hash after the session id is known.
   *
   * A refresh token embeds its own session id, so the row must exist before the
   * token can be signed. The row is created with a placeholder hash and updated
   * here — the placeholder is unguessable, so the session is never usable in
   * between.
   */
  setTokenHash(sessionId: string, tokenHash: string): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<SessionRecord | null>;
  findById(sessionId: string): Promise<SessionRecord | null>;
  revoke(sessionId: string, at: Date): Promise<void>;
  /** Used on logout-everywhere and on detected token reuse. */
  revokeAllForUser(userId: string, at: Date): Promise<void>;
  markRotated(sessionId: string, newSessionId: string): Promise<void>;
  touch(sessionId: string, at: Date): Promise<void>;
}

export interface PasswordHasher {
  hash(plain: string): Promise<string>;
  verify(plain: string, hash: string): Promise<boolean>;
}

export interface TokenService {
  signAccess(claims: AccessTokenClaims, ttlSeconds: number): string;
  signRefresh(claims: RefreshTokenClaims, ttlSeconds: number): string;
  /** Returns null for anything invalid — expired, tampered, or wrong secret. */
  verify(token: string): TokenClaims | null;
  /** Stable one-way digest used as the session lookup key. */
  hashToken(token: string): string;
}

/**
 * Records security-relevant events.
 *
 * Deliberately fire-and-forget at the call site: an audit failure must not
 * prevent a legitimate login, and must not block a logout.
 */
export interface AuditWriter {
  record(entry: {
    actorId: string | null;
    action: string;
    entity: string;
    entityKey?: string | null;
    requestId?: string | null;
    ip?: string | null;
    after?: Readonly<Record<string, unknown>> | null;
  }): Promise<void>;
}

/**
 * A child, as their guardian needs to see them.
 *
 * `learnerKeysFor` returns keys, which is all an authorization check needs. A
 * parent choosing between two children needs a name — `lrn_demo_student` is
 * not something to show a person. The name already exists on the user record;
 * this is a presentation field, not new state.
 */
export interface GuardianChild {
  readonly learnerKey: string;
  readonly fullName: string;
  readonly relation: string | null;
  /** Present only once the learner is enrolled. */
  readonly gradeName: string | null;
}

export interface GuardianLinkReader {
  /** Verified links only. An unverified claim of guardianship grants nothing. */
  isVerifiedGuardianOf(guardianUserId: string, learnerKey: string): Promise<boolean>;
  learnerKeysFor(guardianUserId: string): Promise<string[]>;
  /**
   * Gap G2: the same verified links, with the detail a parent UI must render.
   *
   * Deliberately a second method rather than a widening of `learnerKeysFor`.
   * That one is called on the authorization path for every learner-scoped
   * request, and it should keep selecting one column.
   */
  childrenFor(guardianUserId: string): Promise<GuardianChild[]>;

  /**
   * Current school uuid for staff learner reads.
   *
   * Actor role scopes in access tokens use UserRole.schoolId (the database id),
   * not the public school key, so cross-school learner checks need this minimal
   * lookup before applying role scope. Null means the learner has no current
   * enrolment and therefore is not readable through a school-scoped staff role.
   */
  currentEnrollmentSchoolIdFor?(learnerKey: string): Promise<string | null>;
}

// ─── Provisioning ───────────────────────────────────────────────────────────
//
// A separate port from `UserRepository` on purpose. That one exists to
// authenticate somebody who already exists and is read-mostly; this one
// creates people and grants access. Keeping them apart means the login path
// cannot accidentally acquire a `createUser` it has no business holding.

export interface EducatorSubjectSpecialty {
  readonly subjectKey: string;
  readonly subjectName: string;
}

export interface ProvisionedUser {
  readonly key: string;
  readonly username: string;
  readonly fullName: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly status: string;
  readonly roles: ReadonlyArray<{ role: string; schoolKey: string | null }>;
  readonly learnerKey: string | null;
  readonly guardianKey: string | null;
  /** Staff-specific fields, present when the user has an EducatorProfile. */
  readonly educatorKey: string | null;
  readonly employeeCode: string | null;
  /** Legacy free-text note; structured subject specialties are below. */
  readonly specialty: string | null;
  readonly subjectSpecialties: readonly EducatorSubjectSpecialty[];
}

export interface EnrollmentRecord {
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

/**
 * An enrolment as a browsing administrator reads it.
 *
 * Keys are the identity; names are presentation. The list is for finding and
 * inspecting placements, and `lrn_x` next to `sch_y` is a table nobody can
 * read — the same shape `GuardianChild` already uses for the same reason.
 */
export interface EnrollmentListRow extends EnrollmentRecord {
  readonly learnerName: string;
  readonly schoolName: string;
  readonly termName: string;
  readonly gradeName: string;
  readonly createdAt: Date;
}

export interface EnrollmentListPage {
  readonly rows: readonly EnrollmentListRow[];
  readonly total: number;
}

export interface EnrollmentListQuery {
  readonly schoolKey?: string | undefined;
  readonly academicYearKey?: string | undefined;
  readonly termKey?: string | undefined;
  readonly gradeKey?: string | undefined;
  readonly learnerKey?: string | undefined;
  readonly current?: boolean | undefined;
  readonly limit: number;
  readonly offset: number;
}

/**
 * One teacher as the administration sees them: the person, the staff profile,
 * and every school their TEACHER grant is scoped to. Assignments beyond the
 * school (subject/grade) do not exist in the domain and are therefore absent
 * here — an honest column of "no assignment model" would be a fabrication.
 */
export interface EducatorRow {
  readonly userKey: string;
  readonly username: string;
  readonly fullName: string;
  readonly email: string | null;
  readonly status: string;
  readonly educatorKey: string | null;
  readonly employeeCode: string | null;
  /** Legacy free-text note. */
  readonly specialty: string | null;
  /** One or more catalogue subjects this teacher specialises in. */
  readonly subjectSpecialties: readonly EducatorSubjectSpecialty[];
  /** One entry per school the TEACHER role is granted at. May be empty. */
  readonly schools: ReadonlyArray<{ schoolKey: string; schoolName: string }>;
}

export interface EducatorListPage {
  readonly rows: readonly EducatorRow[];
  readonly total: number;
}

export interface EducatorListQuery {
  /** Matches username, full name or email. Case-insensitive, substring. */
  readonly search?: string | undefined;
  readonly schoolKey?: string | undefined;
  readonly limit: number;
  readonly offset: number;
}

/**
 * A cohort, as the domain defines it: a QUERY over current enrolments, never
 * a stored class entity (docs/CLASS-ROSTER-INVESTIGATION.md). One row per
 * grade that has current enrolments at the school.
 */
export interface CohortCount {
  readonly gradeKey: string;
  readonly gradeName: string;
  readonly currentCount: number;
}

export interface GuardianLinkRecord {
  readonly guardianKey: string;
  readonly learnerKey: string;
  readonly relation: string | null;
  readonly isVerified: boolean;
}

/**
 * Writes for people and their placements.
 *
 * Every method takes and returns business keys. A uuid never crosses this
 * boundary, so the application layer cannot start passing database identity
 * around and the adapter stays free to change how rows are addressed.
 */
/**
 * A user as an administrator scans them in a directory (gap G6).
 *
 * Deliberately thinner than `ProvisionedUser`: a directory row is for finding
 * a person, not for inspecting them. Anything the list does not display is
 * fetched by `findUserByKey` when the administrator opens the record.
 */
export interface UserDirectoryRow {
  readonly key: string;
  readonly username: string;
  readonly fullName: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly status: string;
  readonly roles: readonly string[];
}

/** One page of the directory, with the total so the UI can page honestly. */
export interface UserDirectoryPage {
  readonly rows: readonly UserDirectoryRow[];
  /** Matching rows in total, not rows returned. */
  readonly total: number;
}

export interface UserDirectoryQuery {
  /** Matches username, full name or email. Case-insensitive, substring. */
  readonly search?: string | undefined;
  readonly role?: string | undefined;
  readonly status?: string | undefined;
  readonly schoolKey?: string | undefined;
  readonly limit: number;
  readonly offset: number;
}

export interface ProvisioningRepository {
  /** How many schools exist — decides whether an unscoped grant is ambiguous. */
  countSchools(): Promise<number>;

  /**
   * Find people (gap G6).
   *
   * Until this existed an administrator had to already know a user's key to
   * see anything, which made every administration screen unbuildable: there
   * was no way to answer "who is in this system".
   */
  listUsers(query: UserDirectoryQuery): Promise<UserDirectoryPage>;

  findUserByKey(userKey: string): Promise<ProvisionedUser | null>;
  findUserByUsername(username: string): Promise<ProvisionedUser | null>;
  /** Null when no user carries that email; used to refuse a silent collision. */
  findUserKeyByEmail(email: string): Promise<string | null>;

  createUser(input: {
    key: string;
    username: string;
    fullName: string;
    email: string | null;
    phone: string | null;
    passwordHash: string;
    status: string;
  }): Promise<ProvisionedUser>;

  updateUserProfile(
    userKey: string,
    patch: { fullName?: string; email?: string | null; phone?: string | null },
  ): Promise<ProvisionedUser>;

  setUserStatus(userKey: string, status: string): Promise<ProvisionedUser>;

  grantRole(input: { userKey: string; role: string; schoolKey: string | null }): Promise<ProvisionedUser>;
  /** Idempotent: revoking a grant that is not held is not an error. */
  revokeRole(input: { userKey: string; role: string; schoolKey: string | null }): Promise<ProvisionedUser>;

  createLearnerProfile(input: { userKey: string; learnerKey: string }): Promise<ProvisionedUser>;
  createGuardianProfile(input: { userKey: string; guardianKey: string }): Promise<ProvisionedUser>;
  /** The staff profile a TEACHER grant implies. Staff fields are optional. */
  createEducatorProfile(input: {
    userKey: string;
    educatorKey: string;
    employeeCode?: string | null;
    specialty?: string | null;
    subjectKeys?: readonly string[];
  }): Promise<ProvisionedUser>;
  /** Correct the mutable staff fields. Creates the profile if it is missing. */
  updateEducatorProfile(
    userKey: string,
    patch: {
      employeeCode?: string | null;
      specialty?: string | null;
      /** Replace the teacher's subject specialties when present. */
      subjectKeys?: readonly string[];
    },
  ): Promise<ProvisionedUser>;

  /** Null for any coordinate the caller named that does not exist. */
  resolveEnrollmentCoordinates(input: {
    schoolKey: string;
    academicYearKey: string;
    termKey: string;
    gradeKey: string;
  }): Promise<{
    schoolKey: string | null;
    academicYearKey: string | null;
    termKey: string | null;
    gradeKey: string | null;
    /** The term's 1-based ordinal, needed to derive the enrolment key. */
    termOrdinal: number | null;
    /** The year the term actually belongs to, to catch a mismatched pair. */
    termAcademicYearKey: string | null;
    /** Lifecycle of the named rows: an inactive school or grade refuses new
     *  enrolments while historical ones keep their reference. */
    schoolIsActive: boolean | null;
    gradeIsActive: boolean | null;
  }>;

  /** Enrolments across the installation, filtered server-side and paged. */
  listEnrollments(query: EnrollmentListQuery): Promise<EnrollmentListPage>;

  /** Cohorts as a query: current enrolments grouped by grade, per school. */
  cohortCounts(schoolKey: string, academicYearKey?: string | undefined): Promise<readonly CohortCount[]>;

  /** Teachers: the person, their staff profile, and their school scope. */
  listEducators(query: EducatorListQuery): Promise<EducatorListPage>;

  findEnrollment(key: string): Promise<EnrollmentRecord | null>;
  currentEnrollmentFor(learnerKey: string): Promise<EnrollmentRecord | null>;
  listEnrollmentsFor(learnerKey: string): Promise<readonly EnrollmentRecord[]>;

  /**
   * Create the enrolment and, when it is current, stand down any other current
   * one for that learner — in a single transaction. "Exactly one current
   * enrolment" is an invariant, so it cannot be two writes a caller might only
   * half-complete.
   */
  createEnrollment(input: {
    key: string;
    learnerKey: string;
    schoolKey: string;
    academicYearKey: string;
    termKey: string;
    gradeKey: string;
    isCurrent: boolean;
  }): Promise<EnrollmentRecord>;

  /** Same invariant, applied when an existing enrolment becomes the current one. */
  makeEnrollmentCurrent(key: string): Promise<EnrollmentRecord>;

  endEnrollment(key: string): Promise<EnrollmentRecord>;

  findGuardianLink(input: {
    guardianKey: string;
    learnerKey: string;
  }): Promise<GuardianLinkRecord | null>;
  linkGuardian(input: {
    guardianKey: string;
    learnerKey: string;
    relation: string | null;
  }): Promise<GuardianLinkRecord>;
  setGuardianLinkVerified(input: {
    guardianKey: string;
    learnerKey: string;
    isVerified: boolean;
  }): Promise<GuardianLinkRecord>;
  unlinkGuardian(input: { guardianKey: string; learnerKey: string }): Promise<void>;
  listGuardianLinksForLearner(learnerKey: string): Promise<readonly GuardianLinkRecord[]>;
  listGuardianLinksForGuardian(guardianKey: string): Promise<readonly GuardianLinkRecord[]>;
}
