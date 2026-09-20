/**
 * Enrolment guards and browsing — service level.
 *
 * The rules worth defending:
 *
 * - An inactive school or grade takes no NEW enrolments. The flag means
 *   something precisely because the write path refuses it; without this guard
 *   `isActive` would be a display value.
 * - The browser clamps its page size, like the user directory, so a caller
 *   cannot ask for the whole table through a second read path.
 *
 * The repository is faked, not mocked per-assertion: these tests are about
 * the service's decisions, not the adapter's SQL.
 */

import { describe, expect, it } from 'vitest';
import { ProvisioningService } from '../../src/contexts/identity/application/provisioning.service.js';
import type {
  EducatorListPage,
  EducatorListQuery,
  EnrollmentListPage,
  EnrollmentListQuery,
  ProvisionedUser,
  ProvisioningRepository,
} from '../../src/contexts/identity/application/ports.js';
import { Ok } from '../../src/shared/kernel/result.js';

const ACTOR = { actorId: null, actorKey: 'usr_admin' };

function makeUser(over: Partial<ProvisionedUser> = {}): ProvisionedUser {
  return {
    key: 'usr_x',
    username: 'x',
    fullName: 'X',
    email: null,
    phone: null,
    status: 'ACTIVE',
    roles: [{ role: 'STUDENT', schoolKey: null }],
    learnerKey: 'lrn_x',
    guardianKey: null,
    educatorKey: null,
    employeeCode: null,
    specialty: null,
    subjectSpecialties: [],
    ...over,
  };
}

class FakeRepo implements ProvisioningRepository {
  schoolIsActive = true;
  gradeIsActive = true;
  enrollmentExists = false;
  lastEnrollmentQuery: Record<string, unknown> | null = null;
  lastEducatorQuery: Record<string, unknown> | null = null;

  async countSchools(): Promise<number> {
    return 1;
  }
  async createEducatorProfile(): Promise<never> {
    throw new Error('not used here');
  }
  async updateEducatorProfile(): Promise<never> {
    throw new Error('not used here');
  }
  async listUsers(): Promise<never> {
    throw new Error('not used here');
  }
  async findUserByKey(): Promise<null> {
    return null;
  }
  async findUserByUsername(): Promise<null> {
    return null;
  }
  async findUserKeyByEmail(): Promise<null> {
    return null;
  }
  async createUser(): Promise<never> {
    throw new Error('not used here');
  }
  async updateUserProfile(): Promise<never> {
    throw new Error('not used here');
  }
  async setUserStatus(): Promise<never> {
    throw new Error('not used here');
  }
  async grantRole(): Promise<never> {
    throw new Error('not used here');
  }
  async revokeRole(): Promise<never> {
    throw new Error('not used here');
  }
  async createLearnerProfile(): Promise<never> {
    throw new Error('not used here');
  }
  async createGuardianProfile(): Promise<never> {
    throw new Error('not used here');
  }
  async resolveEnrollmentCoordinates() {
    return {
      schoolKey: 'sch_demo',
      academicYearKey: '2026-2027',
      termKey: '2026-2027-T01',
      gradeKey: 'G07',
      termOrdinal: 1,
      termAcademicYearKey: '2026-2027',
      schoolIsActive: this.schoolIsActive,
      gradeIsActive: this.gradeIsActive,
    };
  }
  async findEnrollment(): Promise<null> {
    return this.enrollmentExists ? ({} as never) : null;
  }
  async currentEnrollmentFor(): Promise<null> {
    return null;
  }
  async listEnrollmentsFor(): Promise<never[]> {
    return [];
  }
  async listEnrollments(query: EnrollmentListQuery): Promise<EnrollmentListPage> {
    this.lastEnrollmentQuery = query as unknown as Record<string, unknown>;
    return { rows: [], total: 0 };
  }
  async listEducators(query: EducatorListQuery): Promise<EducatorListPage> {
    this.lastEducatorQuery = query as unknown as Record<string, unknown>;
    return { rows: [], total: 0 };
  }
  async cohortCounts(): Promise<never[]> {
    return [];
  }
  async createEnrollment(input: { key: string }): Promise<never> {
    return { ...input, learnerKey: 'lrn_x', schoolKey: 'sch_demo' } as never;
  }
  async makeEnrollmentCurrent(): Promise<never> {
    throw new Error('not used here');
  }
  async endEnrollment(): Promise<never> {
    throw new Error('not used here');
  }
  async findGuardianLink(): Promise<null> {
    return null;
  }
  async linkGuardian(): Promise<never> {
    throw new Error('not used here');
  }
  async unlinkGuardian(): Promise<void> {}
  async setGuardianLinkVerified(): Promise<never> {
    throw new Error('not used here');
  }
  async listGuardianLinksForLearner(): Promise<never[]> {
    return [];
  }
  async listGuardianLinksForGuardian(): Promise<never[]> {
    return [];
  }
}

const INPUT = {
  learnerKey: 'lrn_x',
  schoolKey: 'sch_demo',
  academicYearKey: '2026-2027',
  termKey: '2026-2027-T01',
  gradeKey: 'G07',
};

function service(repo: FakeRepo): ProvisioningService {
  return new ProvisioningService(
    repo,
    { hash: async () => 'hash', verify: async () => false },
    { record: async () => {} },
  );
}

describe('enrolling a learner — lifecycle guards', () => {
  it('refuses an inactive school with a named error', async () => {
    const repo = new FakeRepo();
    repo.schoolIsActive = false;
    const result = await service(repo).enrolLearner(ACTOR, INPUT);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('identity.school_inactive');
  });

  it('refuses an inactive grade with a named error', async () => {
    const repo = new FakeRepo();
    repo.gradeIsActive = false;
    const result = await service(repo).enrolLearner(ACTOR, INPUT);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('identity.grade_inactive');
  });

  it('enrols into an active school and grade, past or current year alike', async () => {
    const repo = new FakeRepo();
    const result = await service(repo).enrolLearner(ACTOR, INPUT);
    // The year's currency is deliberately not consulted: enrolling for a
    // future year is planning, not a fault.
    expect(result.ok).toBe(true);
  });
});

describe('the enrolment browser', () => {
  it('clamps the page size so no caller can fetch the whole table', async () => {
    const repo = new FakeRepo();
    await service(repo).browseEnrollments({ limit: 10000, offset: -5 });
    expect(repo.lastEnrollmentQuery).toMatchObject({ limit: 100, offset: 0 });
  });

  it('defaults to a sane page', async () => {
    const repo = new FakeRepo();
    await service(repo).browseEnrollments({});
    expect(repo.lastEnrollmentQuery).toMatchObject({ limit: 25, offset: 0 });
  });

  it('passes the coordinate filters through untouched', async () => {
    const repo = new FakeRepo();
    await service(repo).browseEnrollments({ schoolKey: 'sch_demo', current: true });
    expect(repo.lastEnrollmentQuery).toMatchObject({
      schoolKey: 'sch_demo',
      current: true,
    });
  });
});

describe('the educator directory', () => {
  it('clamps its page size the same way', async () => {
    const repo = new FakeRepo();
    await service(repo).listEducators({ limit: 999, offset: -1 });
    expect(repo.lastEducatorQuery).toMatchObject({ limit: 100, offset: 0 });
  });
});

describe('ProvisionedUser — staff fields', () => {
  it('carries the educator profile alongside the identity it extends', () => {
    // EducatorProfile is an extension of User, never a separate account: the
    // read model must present it as fields on the person.
    const teacher = makeUser({
      roles: [{ role: 'TEACHER', schoolKey: 'sch_demo' }],
      educatorKey: 'edu_x',
      employeeCode: 'T-204',
      specialty: 'Mathematics',
    });
    expect(teacher.educatorKey).toBe('edu_x');
    expect(teacher.employeeCode).toBe('T-204');
    expect(teacher.specialty).toBe('Mathematics');
  });
});
