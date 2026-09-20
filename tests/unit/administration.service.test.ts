/**
 * The administrator's overview.
 *
 * The service does no counting of its own — the interesting behaviour is that
 * the "needs attention" figures are derived from the same rows the rest of the
 * dashboard shows, so a card and its alert can never tell different stories.
 */

import { describe, expect, it } from 'vitest';
import { AdministrationService } from '../../src/contexts/administration/application/administration.service.js';
import type {
  ActivityEntry,
  AdministrationRepository,
  CollectionCount,
  ContentStateBreakdown,
  CurrentAcademicYearView,
  UserStatusBreakdown,
} from '../../src/contexts/administration/application/ports.js';

class FakeRepo implements AdministrationRepository {
  collections: readonly CollectionCount[] = [
    { collection: 'users', total: 9 },
    { collection: 'questions', total: 113 },
  ];
  users: readonly UserStatusBreakdown[] = [
    { status: 'ACTIVE', total: 7 },
    { status: 'SUSPENDED', total: 2 },
  ];
  textbooks: readonly ContentStateBreakdown[] = [
    { status: 'DRAFT', total: 1 },
    { status: 'PUBLISHED', total: 1 },
  ];
  unlinked = 4;
  inactiveSchools = 1;
  inactiveSubjects = 0;
  inactiveGrades = 2;
  learnersWithoutEnrollment = 3;
  unscopedTeacherGrants = 1;
  year: CurrentAcademicYearView | null = {
    key: '2026-2027',
    startsOn: new Date('2026-08-01'),
    endsOn: new Date('2027-06-30'),
    termCount: 3,
  };
  activity: readonly ActivityEntry[] = [
    {
      action: 'identity.learner_enrolled',
      entity: 'identity',
      entityKey: 'enr_demo',
      actorName: 'مدير المدرسة',
      createdAt: new Date('2026-09-13T10:00:00Z'),
    },
  ];

  async countCollections() {
    return this.collections;
  }
  async currentAcademicYear() {
    return this.year;
  }
  async usersByStatus() {
    return this.users;
  }
  async textbooksByStatus() {
    return this.textbooks;
  }
  async countUnlinkedQuestions() {
    return this.unlinked;
  }
  async recentActivity() {
    return this.activity;
  }
  async countInactiveSchools() {
    return this.inactiveSchools;
  }
  async countInactiveSubjects() {
    return this.inactiveSubjects;
  }
  async countInactiveGrades() {
    return this.inactiveGrades;
  }
  async countLearnersWithoutCurrentEnrollment() {
    return this.learnersWithoutEnrollment;
  }
  async countUnscopedTeacherGrants() {
    return this.unscopedTeacherGrants;
  }
}

describe('the overview', () => {
  it('reports every collection the dashboard renders', async () => {
    const repo = new FakeRepo();
    const result = await new AdministrationService(repo).overview();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.collections).toEqual(repo.collections);
  });

  it('carries the current academic year for the header status', async () => {
    const repo = new FakeRepo();
    const result = await new AdministrationService(repo).overview();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.currentAcademicYear).toEqual(repo.year);
  });

  it('reports no current year as null, not as an error', async () => {
    // A fresh install has no year yet. The dashboard must say so in words
    // rather than render an empty string where a year belongs.
    const repo = new FakeRepo();
    repo.year = null;
    const result = await new AdministrationService(repo).overview();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.currentAcademicYear).toBeNull();
  });

  it('derives the attention figures from the same rows it displays', async () => {
    // The point of deriving rather than asking the repository for a separate
    // "alerts" query: the badge and the breakdown cannot disagree, because
    // there is only one set of numbers.
    const repo = new FakeRepo();
    const result = await new AdministrationService(repo).overview();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.attention).toEqual({
      unlinkedQuestions: 4,
      suspendedUsers: 2,
      draftTextbooks: 1,
      inactiveSchools: 1,
      inactiveSubjects: 0,
      inactiveGrades: 2,
      learnersWithoutEnrollment: 3,
      unscopedTeacherGrants: 1,
    });
  });

  it('reports zero rather than nothing when a status is absent', async () => {
    // A clean installation has no suspended users at all, so the group-by
    // returns no such row. The dashboard must render "0", not an empty space
    // that reads as "unknown".
    const repo = new FakeRepo();
    repo.users = [{ status: 'ACTIVE', total: 7 }];
    repo.textbooks = [];

    const result = await new AdministrationService(repo).overview();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.attention.suspendedUsers).toBe(0);
    expect(result.value.attention.draftTextbooks).toBe(0);
    expect(result.value.attention.inactiveSchools).toBe(1);
    expect(result.value.attention.inactiveGrades).toBe(2);
  });

  it('reads the activity feed from the audit trail, newest first', async () => {
    const repo = new FakeRepo();
    const result = await new AdministrationService(repo).activity(20);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The record the provisioning service already wrote — presented, not
    // invented.
    expect(result.value).toEqual(repo.activity);
  });
});
