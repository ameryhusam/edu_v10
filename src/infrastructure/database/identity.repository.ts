/**
 * Prisma adapters for the Identity ports.
 */

import type {
  AuditWriter,
  CohortCount,
  EducatorListPage,
  EducatorListQuery,
  EnrollmentListPage,
  EnrollmentListQuery,
  EnrollmentRecord,
  GuardianLinkReader,
  GuardianLinkRecord,
  ProvisionedUser,
  ProvisioningRepository,
  SessionRecord,
  SessionRepository,
  UserAccount,
  UserRepository,
  GuardianChild,
  UserDirectoryPage,
  UserDirectoryQuery,
} from '../../contexts/identity/application/ports.js';
import type { RoleName } from '../../contexts/identity/domain/roles.js';
import type { Db } from './prisma.client.js';

const userInclude = {
  roles: { select: { role: true, schoolId: true } },
  learnerProfile: { select: { key: true } },
} as const;

type UserRow = {
  id: string;
  key: string;
  username: string;
  email: string | null;
  fullName: string;
  passwordHash: string;
  status: string;
  locale: string;
  roles: { role: string; schoolId: string | null }[];
  learnerProfile: { key: string } | null;
};

function toAccount(row: UserRow): UserAccount {
  return {
    id: row.id,
    key: row.key,
    username: row.username,
    email: row.email,
    fullName: row.fullName,
    passwordHash: row.passwordHash,
    status: row.status as UserAccount['status'],
    locale: row.locale,
    roles: row.roles.map((r) => ({ role: r.role as RoleName, schoolId: r.schoolId })),
    learnerKey: row.learnerProfile?.key ?? null,
  };
}

export class PrismaUserRepository implements UserRepository {
  constructor(private readonly db: Db) {}

  async findByLoginIdentifier(identifier: string): Promise<UserAccount | null> {
    // `mode: 'insensitive'` rather than lowercasing the column: usernames may
    // be stored with the casing the school chose, and matching must not depend
    // on how they were typed at registration.
    const row = await this.db.user.findFirst({
      where: {
        OR: [
          { username: { equals: identifier, mode: 'insensitive' } },
          { email: { equals: identifier, mode: 'insensitive' } },
        ],
      },
      include: userInclude,
    });
    return row ? toAccount(row as UserRow) : null;
  }

  async findById(userId: string): Promise<UserAccount | null> {
    const row = await this.db.user.findUnique({ where: { id: userId }, include: userInclude });
    return row ? toAccount(row as UserRow) : null;
  }

  async recordLogin(userId: string, at: Date): Promise<void> {
    await this.db.user.update({ where: { id: userId }, data: { lastLoginAt: at } });
  }

  async updatePasswordHash(userId: string, passwordHash: string): Promise<void> {
    await this.db.user.update({ where: { id: userId }, data: { passwordHash } });
  }
}

const toSession = (row: {
  id: string;
  userId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  rotatedToId: string | null;
}): SessionRecord => ({
  id: row.id,
  userId: row.userId,
  expiresAt: row.expiresAt,
  revokedAt: row.revokedAt,
  rotatedToId: row.rotatedToId,
});

export class PrismaSessionRepository implements SessionRepository {
  constructor(private readonly db: Db) {}

  async create(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    userAgent?: string | null;
    ip?: string | null;
  }): Promise<SessionRecord> {
    const row = await this.db.session.create({
      data: {
        userId: input.userId,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
        userAgent: input.userAgent ?? null,
        ip: input.ip ?? null,
      },
    });
    return toSession(row);
  }

  async setTokenHash(sessionId: string, tokenHash: string): Promise<void> {
    await this.db.session.update({ where: { id: sessionId }, data: { tokenHash } });
  }

  async findByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    const row = await this.db.session.findUnique({ where: { tokenHash } });
    return row ? toSession(row) : null;
  }

  async findById(sessionId: string): Promise<SessionRecord | null> {
    const row = await this.db.session.findUnique({ where: { id: sessionId } });
    return row ? toSession(row) : null;
  }

  async revoke(sessionId: string, at: Date): Promise<void> {
    await this.db.session.update({ where: { id: sessionId }, data: { revokedAt: at } });
  }

  async revokeAllForUser(userId: string, at: Date): Promise<void> {
    await this.db.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: at },
    });
  }

  async markRotated(sessionId: string, newSessionId: string): Promise<void> {
    await this.db.session.update({
      where: { id: sessionId },
      data: { rotatedToId: newSessionId, revokedAt: new Date() },
    });
  }

  async touch(sessionId: string, at: Date): Promise<void> {
    await this.db.session.update({ where: { id: sessionId }, data: { lastUsedAt: at } });
  }
}

export class PrismaAuditWriter implements AuditWriter {
  constructor(private readonly db: Db) {}

  async record(entry: {
    actorId: string | null;
    action: string;
    entity: string;
    entityKey?: string | null;
    requestId?: string | null;
    ip?: string | null;
    after?: Readonly<Record<string, unknown>> | null;
  }): Promise<void> {
    await this.db.auditEntry.create({
      data: {
        actorId: entry.actorId,
        action: entry.action,
        entity: entry.entity,
        entityKey: entry.entityKey ?? null,
        requestId: entry.requestId ?? null,
        ip: entry.ip ?? null,
        after: (entry.after ?? undefined) as object | undefined,
      },
    });
  }
}

export class PrismaGuardianLinkReader implements GuardianLinkReader {
  constructor(private readonly db: Db) {}

  async isVerifiedGuardianOf(guardianUserId: string, learnerKey: string): Promise<boolean> {
    const link = await this.db.guardianLink.findFirst({
      where: {
        isVerified: true,
        guardian: { userId: guardianUserId },
        learner: { key: learnerKey },
      },
      select: { id: true },
    });
    return link !== null;
  }

  async learnerKeysFor(guardianUserId: string): Promise<string[]> {
    const links = await this.db.guardianLink.findMany({
      where: { isVerified: true, guardian: { userId: guardianUserId } },
      select: { learner: { select: { key: true } } },
    });
    return links.map((l) => l.learner.key);
  }

  /**
   * The same verified links, with the detail a parent screen renders (G2).
   *
   * The grade comes from the learner's CURRENT enrollment, and is null when
   * there is none — a registered child who has not been placed in a class yet
   * is a real state, and inventing a grade for them would be a lie the parent
   * cannot check.
   */
  async childrenFor(guardianUserId: string): Promise<GuardianChild[]> {
    const links = await this.db.guardianLink.findMany({
      where: { isVerified: true, guardian: { userId: guardianUserId } },
      select: {
        relation: true,
        learner: {
          select: {
            key: true,
            user: { select: { fullName: true } },
            enrollments: {
              where: { isCurrent: true },
              select: { grade: { select: { name: true } } },
              take: 1,
            },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return links.map((link) => ({
      learnerKey: link.learner.key,
      fullName: link.learner.user.fullName,
      relation: link.relation,
      gradeName: link.learner.enrollments[0]?.grade.name ?? null,
    }));
  }

  async currentEnrollmentSchoolIdFor(learnerKey: string): Promise<string | null> {
    const row = await this.db.enrollment.findFirst({
      where: { learner: { key: learnerKey }, isCurrent: true },
      select: { schoolId: true },
    });
    return row?.schoolId ?? null;
  }
}

/**
 * Provisioning writes.
 *
 * Business keys in, business keys out: no uuid crosses this boundary, so the
 * application layer never learns how rows are addressed.
 *
 * Note the sequential awaits. PGlite serves a single connection, and a
 * `Promise.all` of two Prisma queries terminates it — a failure that only shows
 * up under the live checks, never in unit tests.
 */
type EducatorListRow = {
  key: string;
  username: string;
  fullName: string;
  email: string | null;
  status: string;
  educatorProfile: {
    key: string;
    employeeCode: string | null;
    specialty: string | null;
    subjectSpecialties: Array<{ subject: { key: string; name: string } }>;
  } | null;
  roles: Array<{ school: { key: string; name: string } | null }>;
};

export class PrismaProvisioningRepository implements ProvisioningRepository {
  constructor(private readonly db: Db) {}

  async countSchools(): Promise<number> {
    return this.db.school.count();
  }

  /**
   * The user directory (gap G6).
   *
   * Two queries, sequentially: PGlite serves exactly one connection, so a
   * `Promise.all` of two Prisma calls kills it. The count is separate from the
   * page because a directory that cannot say how many matches exist forces the
   * UI to guess whether another page is there.
   *
   * Ordered by username, which is unique — an unstable sort makes paging skip
   * and repeat rows, and Postgres guarantees no order without ORDER BY.
   */
  async listUsers(query: UserDirectoryQuery): Promise<UserDirectoryPage> {
    const search = query.search?.trim();
    const where = {
      ...(search
        ? {
            OR: [
              { username: { contains: search, mode: 'insensitive' as const } },
              { fullName: { contains: search, mode: 'insensitive' as const } },
              { email: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
      ...(query.status ? { status: query.status as never } : {}),
      // A role filter is a filter on the grants, so it must be expressed as a
      // relation predicate: filtering the included rows would return every
      // user and merely hide their roles.
      ...(query.role || query.schoolKey
        ? {
            roles: {
              some: {
                ...(query.role ? { role: query.role as never } : {}),
                ...(query.schoolKey ? { school: { key: query.schoolKey } } : {}),
              },
            },
          }
        : {}),
    };

    const total = await this.db.user.count({ where });
    const rows = await this.db.user.findMany({
      where,
      orderBy: { username: 'asc' },
      take: query.limit,
      skip: query.offset,
      select: {
        key: true,
        username: true,
        fullName: true,
        email: true,
        phone: true,
        status: true,
        roles: { select: { role: true } },
      },
    });

    return {
      total,
      rows: rows.map((row) => ({
        key: row.key,
        username: row.username,
        fullName: row.fullName,
        email: row.email,
        phone: row.phone,
        status: row.status,
        // Distinct: the same role held at two schools is one role to a reader.
        roles: [...new Set(row.roles.map((r) => r.role))],
      })),
    };
  }

  async findUserByKey(userKey: string): Promise<ProvisionedUser | null> {
    const row = await this.db.user.findUnique({
      where: { key: userKey },
      select: provisionedSelect,
    });
    return row ? toProvisioned(row) : null;
  }

  async findUserByUsername(username: string): Promise<ProvisionedUser | null> {
    const row = await this.db.user.findUnique({
      where: { username },
      select: provisionedSelect,
    });
    return row ? toProvisioned(row) : null;
  }

  async findUserKeyByEmail(email: string): Promise<string | null> {
    const row = await this.db.user.findUnique({ where: { email }, select: { key: true } });
    return row?.key ?? null;
  }

  async createUser(input: {
    key: string;
    username: string;
    fullName: string;
    email: string | null;
    phone: string | null;
    passwordHash: string;
    status: string;
  }): Promise<ProvisionedUser> {
    const row = await this.db.user.create({
      data: {
        key: input.key,
        username: input.username,
        fullName: input.fullName,
        email: input.email,
        phone: input.phone,
        passwordHash: input.passwordHash,
        status: input.status as never,
      },
      select: provisionedSelect,
    });
    return toProvisioned(row);
  }

  async updateUserProfile(
    userKey: string,
    patch: { fullName?: string; email?: string | null; phone?: string | null },
  ): Promise<ProvisionedUser> {
    const row = await this.db.user.update({
      where: { key: userKey },
      data: {
        ...(patch.fullName !== undefined ? { fullName: patch.fullName } : {}),
        ...(patch.email !== undefined ? { email: patch.email } : {}),
        ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
      },
      select: provisionedSelect,
    });
    return toProvisioned(row);
  }

  async setUserStatus(userKey: string, status: string): Promise<ProvisionedUser> {
    const row = await this.db.user.update({
      where: { key: userKey },
      data: { status: status as never },
      select: provisionedSelect,
    });
    return toProvisioned(row);
  }

  async grantRole(input: {
    userKey: string;
    role: string;
    schoolKey: string | null;
  }): Promise<ProvisionedUser> {
    const user = await this.db.user.findUniqueOrThrow({
      where: { key: input.userKey },
      select: { id: true },
    });
    const schoolId = await this.schoolIdFor(input.schoolKey);

    await this.db.userRole.create({
      data: { userId: user.id, role: input.role as never, schoolId },
    });
    return this.mustFindUser(input.userKey);
  }

  async revokeRole(input: {
    userKey: string;
    role: string;
    schoolKey: string | null;
  }): Promise<ProvisionedUser> {
    const user = await this.db.user.findUniqueOrThrow({
      where: { key: input.userKey },
      select: { id: true },
    });
    const schoolId = await this.schoolIdFor(input.schoolKey);

    await this.db.userRole.deleteMany({
      where: { userId: user.id, role: input.role as never, schoolId },
    });
    return this.mustFindUser(input.userKey);
  }

  async createLearnerProfile(input: {
    userKey: string;
    learnerKey: string;
  }): Promise<ProvisionedUser> {
    const user = await this.db.user.findUniqueOrThrow({
      where: { key: input.userKey },
      select: { id: true },
    });
    await this.db.learnerProfile.create({ data: { key: input.learnerKey, userId: user.id } });
    return this.mustFindUser(input.userKey);
  }

  async createEducatorProfile(input: {
    userKey: string;
    educatorKey: string;
    employeeCode?: string | null;
    specialty?: string | null;
    subjectKeys?: readonly string[];
  }): Promise<ProvisionedUser> {
    const user = await this.db.user.findUniqueOrThrow({
      where: { key: input.userKey },
      select: { id: true },
    });
    const profile = await this.db.educatorProfile.create({
      data: {
        key: input.educatorKey,
        userId: user.id,
        employeeCode: input.employeeCode ?? null,
        specialty: input.specialty ?? null,
      },
      select: { id: true },
    });
    if (input.subjectKeys) {
      await replaceEducatorSubjectSpecialties(this.db, profile.id, input.subjectKeys);
    }
    return this.mustFindUser(input.userKey);
  }

  async updateEducatorProfile(
    userKey: string,
    patch: { employeeCode?: string | null; specialty?: string | null; subjectKeys?: readonly string[] },
  ): Promise<ProvisionedUser> {
    const user = await this.db.user.findUniqueOrThrow({
      where: { key: userKey },
      select: { id: true, username: true },
    });
    // A teacher granted before the profile followed the role (or seeded by
    // hand without one) still deserves their staff fields: create-on-update.
    const { subjectKeys, ...profilePatch } = patch;
    const existing = await this.db.educatorProfile.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });
    const profile = !existing
      ? await this.db.educatorProfile.create({
          data: {
            key: `edu_${user.username}`,
            userId: user.id,
            employeeCode: patch.employeeCode ?? null,
            specialty: patch.specialty ?? null,
          },
          select: { id: true },
        })
      : await this.db.educatorProfile.update({
          where: { userId: user.id },
          data: profilePatch,
          select: { id: true },
        });

    if (subjectKeys !== undefined) {
      await replaceEducatorSubjectSpecialties(this.db, profile.id, subjectKeys);
    }
    return this.mustFindUser(userKey);
  }

  async createGuardianProfile(input: {
    userKey: string;
    guardianKey: string;
  }): Promise<ProvisionedUser> {
    const user = await this.db.user.findUniqueOrThrow({
      where: { key: input.userKey },
      select: { id: true },
    });
    await this.db.guardianProfile.create({ data: { key: input.guardianKey, userId: user.id } });
    return this.mustFindUser(input.userKey);
  }

  async resolveEnrollmentCoordinates(input: {
    schoolKey: string;
    academicYearKey: string;
    termKey: string;
    gradeKey: string;
  }): Promise<{
    schoolKey: string | null;
    academicYearKey: string | null;
    termKey: string | null;
    gradeKey: string | null;
    termOrdinal: number | null;
    termAcademicYearKey: string | null;
    schoolIsActive: boolean | null;
    gradeIsActive: boolean | null;
  }> {
    const school = await this.db.school.findUnique({
      where: { key: input.schoolKey },
      select: { key: true, isActive: true },
    });
    const year = await this.db.academicYear.findUnique({
      where: { key: input.academicYearKey },
      select: { key: true },
    });
    const term = await this.db.term.findUnique({
      where: { key: input.termKey },
      select: { key: true, ordinal: true, academicYear: { select: { key: true } } },
    });
    const grade = await this.db.grade.findUnique({
      where: { key: input.gradeKey },
      select: { key: true, isActive: true },
    });

    return {
      schoolKey: school?.key ?? null,
      academicYearKey: year?.key ?? null,
      termKey: term?.key ?? null,
      gradeKey: grade?.key ?? null,
      termOrdinal: term?.ordinal ?? null,
      termAcademicYearKey: term?.academicYear.key ?? null,
      schoolIsActive: school?.isActive ?? null,
      gradeIsActive: grade?.isActive ?? null,
    };
  }

  async findEnrollment(key: string): Promise<EnrollmentRecord | null> {
    const row = await this.db.enrollment.findUnique({ where: { key }, select: enrollmentSelect });
    return row ? toEnrollment(row) : null;
  }

  async currentEnrollmentFor(learnerKey: string): Promise<EnrollmentRecord | null> {
    const row = await this.db.enrollment.findFirst({
      where: { learner: { key: learnerKey }, isCurrent: true },
      select: enrollmentSelect,
    });
    return row ? toEnrollment(row) : null;
  }

  async listEnrollmentsFor(learnerKey: string): Promise<readonly EnrollmentRecord[]> {
    const rows = await this.db.enrollment.findMany({
      where: { learner: { key: learnerKey } },
      select: enrollmentSelect,
      orderBy: { key: 'asc' },
    });
    return rows.map(toEnrollment);
  }

  /**
   * Enrolments across the installation, for the administration browser.
   *
   * Every filter is server-side: a client that fetched all enrolments to
   * filter them in memory would be quick on a demo database and unusable on a
   * school district's. Ordered by creation descending — newest placement
   * first is the order an administrator triages in.
   */
  async listEnrollments(query: EnrollmentListQuery): Promise<EnrollmentListPage> {
    const where = {
      ...(query.schoolKey ? { school: { key: query.schoolKey } } : {}),
      ...(query.academicYearKey ? { academicYear: { key: query.academicYearKey } } : {}),
      ...(query.termKey ? { term: { key: query.termKey } } : {}),
      ...(query.gradeKey ? { grade: { key: query.gradeKey } } : {}),
      ...(query.learnerKey ? { learner: { key: query.learnerKey } } : {}),
      ...(query.current !== undefined ? { isCurrent: query.current } : {}),
    };

    const total = await this.db.enrollment.count({ where });
    const rows = await this.db.enrollment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: query.limit,
      skip: query.offset,
      select: {
        key: true,
        isCurrent: true,
        createdAt: true,
        learner: { select: { key: true, user: { select: { fullName: true } } } },
        school: { select: { key: true, name: true } },
        academicYear: { select: { key: true } },
        term: { select: { key: true, name: true } },
        grade: { select: { key: true, name: true } },
      },
    });

    return {
      total,
      rows: rows.map((row) => ({
        key: row.key,
        learnerKey: row.learner.key,
        learnerName: row.learner.user.fullName,
        schoolKey: row.school.key,
        schoolName: row.school.name,
        academicYearKey: row.academicYear.key,
        termKey: row.term.key,
        termName: row.term.name,
        gradeKey: row.grade.key,
        gradeName: row.grade.name,
        isCurrent: row.isCurrent,
        createdAt: row.createdAt,
      })),
    };
  }

  /**
   * Cohorts as a query over current enrolments — the shape the class-roster
   * investigation prescribed instead of a Class entity. Grouped in SQL so a
   * school with thousands of learners is one cheap aggregation, not a
   * fetch-and-count.
   */
  async cohortCounts(
    schoolKey: string,
    academicYearKey?: string | undefined,
  ): Promise<readonly CohortCount[]> {
    const rows = await this.db.enrollment.groupBy({
      by: ['gradeId'],
      where: {
        isCurrent: true,
        school: { key: schoolKey },
        ...(academicYearKey ? { academicYear: { key: academicYearKey } } : {}),
      },
      _count: { _all: true },
    });

    const grades = await this.db.grade.findMany({
      where: { id: { in: rows.map((row) => row.gradeId) } },
      select: { id: true, key: true, name: true, ordinal: true },
    });
    const gradeById = new Map(grades.map((grade) => [grade.id, grade]));

    return rows
      .map((row) => {
        const grade = gradeById.get(row.gradeId);
        if (!grade) return null;
        return { gradeKey: grade.key, gradeName: grade.name, currentCount: row._count._all };
      })
      .filter((row): row is CohortCount => row !== null)
      .sort((a, b) => a.gradeKey.localeCompare(b.gradeKey));
  }

  /**
   * Teachers with their staff profile and school scope.
   *
   * A user appears here when they hold a TEACHER grant — an EducatorProfile
   * without the grant is staff data with no teaching authority, and the grant
   * without the profile is a user the provisioning path would have given one
   * to. Showing both keeps this list honest about what the domain actually
   * records.
   */
  async listEducators(query: EducatorListQuery): Promise<EducatorListPage> {
    const search = query.search?.trim();
    const where = {
      roles: {
        some: {
          role: 'TEACHER' as never,
          ...(query.schoolKey ? { school: { key: query.schoolKey } } : {}),
        },
      },
      ...(search
        ? {
            OR: [
              { username: { contains: search, mode: 'insensitive' as const } },
              { fullName: { contains: search, mode: 'insensitive' as const } },
              { email: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const total = await this.db.user.count({ where });
    const rows = (await this.db.user.findMany({
      where,
      orderBy: { username: 'asc' },
      take: query.limit,
      skip: query.offset,
      select: {
        key: true,
        username: true,
        fullName: true,
        email: true,
        status: true,
        educatorProfile: {
          select: {
            key: true,
            employeeCode: true,
            specialty: true,
            subjectSpecialties: {
              select: { subject: { select: { key: true, name: true } } },
              orderBy: { subject: { name: 'asc' } },
            },
          },
        },
        roles: {
          where: { role: 'TEACHER' as never },
          select: { school: { select: { key: true, name: true } } },
        },
      } as never,
    })) as EducatorListRow[];

    return {
      total,
      rows: rows.map((row) => ({
        userKey: row.key,
        username: row.username,
        fullName: row.fullName,
        email: row.email,
        status: row.status,
        educatorKey: row.educatorProfile?.key ?? null,
        employeeCode: row.educatorProfile?.employeeCode ?? null,
        specialty: row.educatorProfile?.specialty ?? null,
        subjectSpecialties:
          row.educatorProfile?.subjectSpecialties.map((link) => ({
            subjectKey: link.subject.key,
            subjectName: link.subject.name,
          })) ?? [],
        schools: row.roles
          .map((grant) => grant.school)
          .filter((school): school is { key: string; name: string } => school !== null)
          .map((school) => ({ schoolKey: school.key, schoolName: school.name })),
      })),
    };
  }

  /**
   * Create the row and stand down any other current enrolment, atomically.
   *
   * "Exactly one current enrolment per learner" is what `schoolOfLearner` and
   * every cohort query assume. The schema comment claims the database enforces
   * it, but the index on `[learnerId, isCurrent]` is not unique, so two current
   * rows are storable. Until that index is corrected this transaction is what
   * actually holds the invariant — and it belongs here either way, because a
   * caller must not be able to half-apply it.
   */
  async createEnrollment(input: {
    key: string;
    learnerKey: string;
    schoolKey: string;
    academicYearKey: string;
    termKey: string;
    gradeKey: string;
    isCurrent: boolean;
  }): Promise<EnrollmentRecord> {
    const learner = await this.db.learnerProfile.findUniqueOrThrow({
      where: { key: input.learnerKey },
      select: { id: true },
    });
    const school = await this.db.school.findUniqueOrThrow({
      where: { key: input.schoolKey },
      select: { id: true },
    });
    const year = await this.db.academicYear.findUniqueOrThrow({
      where: { key: input.academicYearKey },
      select: { id: true },
    });
    const term = await this.db.term.findUniqueOrThrow({
      where: { key: input.termKey },
      select: { id: true },
    });
    const grade = await this.db.grade.findUniqueOrThrow({
      where: { key: input.gradeKey },
      select: { id: true },
    });

    const row = await this.db.$transaction(async (tx) => {
      if (input.isCurrent) {
        await tx.enrollment.updateMany({
          where: { learnerId: learner.id, isCurrent: true },
          data: { isCurrent: false },
        });
      }
      return tx.enrollment.create({
        data: {
          key: input.key,
          learnerId: learner.id,
          schoolId: school.id,
          academicYearId: year.id,
          termId: term.id,
          gradeId: grade.id,
          isCurrent: input.isCurrent,
        },
        select: enrollmentSelect,
      });
    });
    return toEnrollment(row);
  }

  async makeEnrollmentCurrent(key: string): Promise<EnrollmentRecord> {
    const target = await this.db.enrollment.findUniqueOrThrow({
      where: { key },
      select: { learnerId: true },
    });

    const row = await this.db.$transaction(async (tx) => {
      await tx.enrollment.updateMany({
        where: { learnerId: target.learnerId, isCurrent: true },
        data: { isCurrent: false },
      });
      return tx.enrollment.update({
        where: { key },
        data: { isCurrent: true },
        select: enrollmentSelect,
      });
    });
    return toEnrollment(row);
  }

  async endEnrollment(key: string): Promise<EnrollmentRecord> {
    const row = await this.db.enrollment.update({
      where: { key },
      data: { isCurrent: false },
      select: enrollmentSelect,
    });
    return toEnrollment(row);
  }

  async findGuardianLink(input: {
    guardianKey: string;
    learnerKey: string;
  }): Promise<GuardianLinkRecord | null> {
    const row = await this.db.guardianLink.findFirst({
      where: { guardian: { key: input.guardianKey }, learner: { key: input.learnerKey } },
      select: guardianLinkSelect,
    });
    return row ? toGuardianLink(row) : null;
  }

  async linkGuardian(input: {
    guardianKey: string;
    learnerKey: string;
    relation: string | null;
  }): Promise<GuardianLinkRecord> {
    const guardian = await this.db.guardianProfile.findUniqueOrThrow({
      where: { key: input.guardianKey },
      select: { id: true },
    });
    const learner = await this.db.learnerProfile.findUniqueOrThrow({
      where: { key: input.learnerKey },
      select: { id: true },
    });

    const row = await this.db.guardianLink.create({
      data: {
        guardianId: guardian.id,
        learnerId: learner.id,
        relation: input.relation,
        // Never verified on creation: a verified link is what opens a child's
        // record to another account.
        isVerified: false,
      },
      select: guardianLinkSelect,
    });
    return toGuardianLink(row);
  }

  async setGuardianLinkVerified(input: {
    guardianKey: string;
    learnerKey: string;
    isVerified: boolean;
  }): Promise<GuardianLinkRecord> {
    const existing = await this.db.guardianLink.findFirstOrThrow({
      where: { guardian: { key: input.guardianKey }, learner: { key: input.learnerKey } },
      select: { id: true },
    });
    const row = await this.db.guardianLink.update({
      where: { id: existing.id },
      data: { isVerified: input.isVerified },
      select: guardianLinkSelect,
    });
    return toGuardianLink(row);
  }

  async unlinkGuardian(input: { guardianKey: string; learnerKey: string }): Promise<void> {
    const existing = await this.db.guardianLink.findFirstOrThrow({
      where: { guardian: { key: input.guardianKey }, learner: { key: input.learnerKey } },
      select: { id: true },
    });
    await this.db.guardianLink.delete({ where: { id: existing.id } });
  }

  async listGuardianLinksForLearner(learnerKey: string): Promise<readonly GuardianLinkRecord[]> {
    const rows = await this.db.guardianLink.findMany({
      where: { learner: { key: learnerKey } },
      select: guardianLinkSelect,
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toGuardianLink);
  }

  async listGuardianLinksForGuardian(guardianKey: string): Promise<readonly GuardianLinkRecord[]> {
    const rows = await this.db.guardianLink.findMany({
      where: { guardian: { key: guardianKey } },
      select: guardianLinkSelect,
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toGuardianLink);
  }

  private async schoolIdFor(schoolKey: string | null): Promise<string | null> {
    if (schoolKey === null) return null;
    const school = await this.db.school.findUniqueOrThrow({
      where: { key: schoolKey },
      select: { id: true },
    });
    return school.id;
  }

  private async mustFindUser(userKey: string): Promise<ProvisionedUser> {
    const row = await this.db.user.findUniqueOrThrow({
      where: { key: userKey },
      select: provisionedSelect,
    });
    return toProvisioned(row);
  }
}

const provisionedSelect = {
  key: true,
  username: true,
  fullName: true,
  email: true,
  phone: true,
  status: true,
  roles: { select: { role: true, school: { select: { key: true } } } },
  learnerProfile: { select: { key: true } },
  guardianProfile: { select: { key: true } },
  educatorProfile: {
    select: {
      key: true,
      employeeCode: true,
      specialty: true,
      subjectSpecialties: {
        select: { subject: { select: { key: true, name: true } } },
        orderBy: { subject: { name: 'asc' } },
      },
    },
  },
} as const;

function toProvisioned(row: {
  key: string;
  username: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  status: string;
  roles: { role: string; school: { key: string } | null }[];
  learnerProfile: { key: string } | null;
  guardianProfile: { key: string } | null;
  educatorProfile: {
    key: string;
    employeeCode: string | null;
    specialty: string | null;
    subjectSpecialties: Array<{ subject: { key: string; name: string } }>;
  } | null;
}): ProvisionedUser {
  return {
    key: row.key,
    username: row.username,
    fullName: row.fullName,
    email: row.email,
    phone: row.phone,
    status: row.status,
    roles: row.roles.map((r) => ({ role: r.role, schoolKey: r.school?.key ?? null })),
    learnerKey: row.learnerProfile?.key ?? null,
    guardianKey: row.guardianProfile?.key ?? null,
    educatorKey: row.educatorProfile?.key ?? null,
    employeeCode: row.educatorProfile?.employeeCode ?? null,
    specialty: row.educatorProfile?.specialty ?? null,
    subjectSpecialties:
      row.educatorProfile?.subjectSpecialties.map((link) => ({
        subjectKey: link.subject.key,
        subjectName: link.subject.name,
      })) ?? [],
  };
}

type EducatorSubjectSpecialtyDelegate = {
  deleteMany(args: { where: { educatorId: string } }): Promise<unknown>;
  createMany(args: {
    data: Array<{ educatorId: string; subjectId: string }>;
    skipDuplicates?: boolean;
  }): Promise<unknown>;
};

async function replaceEducatorSubjectSpecialties(
  db: Db,
  educatorId: string,
  subjectKeys: readonly string[],
): Promise<void> {
  const unique = [...new Set(subjectKeys.map((key) => key.trim()).filter(Boolean))];
  const delegate = (db as unknown as { educatorSubjectSpecialty: EducatorSubjectSpecialtyDelegate })
    .educatorSubjectSpecialty;

  await delegate.deleteMany({ where: { educatorId } });
  if (unique.length === 0) return;

  const subjects = await db.subject.findMany({
    where: { key: { in: unique } },
    select: { id: true },
  });
  if (subjects.length === 0) return;

  await delegate.createMany({
    data: subjects.map((subject) => ({ educatorId, subjectId: subject.id })),
    skipDuplicates: true,
  });
}

const enrollmentSelect = {
  key: true,
  isCurrent: true,
  learner: { select: { key: true } },
  school: { select: { key: true, name: true } },
  academicYear: { select: { key: true } },
  term: { select: { key: true, name: true } },
  grade: { select: { key: true, name: true } },
} as const;

function toEnrollment(row: {
  key: string;
  isCurrent: boolean;
  learner: { key: string };
  school: { key: string; name: string };
  academicYear: { key: string };
  term: { key: string; name: string };
  grade: { key: string; name: string };
}): EnrollmentRecord {
  return {
    key: row.key,
    learnerKey: row.learner.key,
    schoolKey: row.school.key,
    schoolName: row.school.name,
    academicYearKey: row.academicYear.key,
    termKey: row.term.key,
    termName: row.term.name,
    gradeKey: row.grade.key,
    gradeName: row.grade.name,
    isCurrent: row.isCurrent,
  };
}

const guardianLinkSelect = {
  relation: true,
  isVerified: true,
  guardian: { select: { key: true } },
  learner: { select: { key: true } },
} as const;

function toGuardianLink(row: {
  relation: string | null;
  isVerified: boolean;
  guardian: { key: string };
  learner: { key: string };
}): GuardianLinkRecord {
  return {
    guardianKey: row.guardian.key,
    learnerKey: row.learner.key,
    relation: row.relation,
    isVerified: row.isVerified,
  };
}
