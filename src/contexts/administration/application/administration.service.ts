/**
 * The administrator's overview.
 *
 * Assembles one answer to "what is in this installation and what needs
 * attention" from counts other contexts own. It makes no decisions and stores
 * nothing; if a number here disagrees with the screen that owns it, this one
 * is wrong by definition.
 *
 * The authorization check does not live here. It lives at the route, next to
 * every other route's check, because scattering role rules between transport
 * and service is how two of them end up disagreeing.
 */

import { Ok, type Result } from '../../../shared/kernel/result.js';
import type {
  CurrentAcademicYearView,
  ActivityEntry,
  AdministrationRepository,
  CollectionCount,
  ContentStateBreakdown,
  UserStatusBreakdown,
} from './ports.js';

export interface AdminOverview {
  readonly collections: readonly CollectionCount[];
  /** The one current year, or null on a fresh install — the header's status. */
  readonly currentAcademicYear: CurrentAcademicYearView | null;
  readonly usersByStatus: readonly UserStatusBreakdown[];
  readonly textbooksByStatus: readonly ContentStateBreakdown[];
  /**
   * Things a human should look at, as counts.
   *
   * Deliberately a small, named set rather than a generic "alerts" list. An
   * open-ended alert stream on an admin dashboard becomes wallpaper within a
   * week; a handful of specific numbers stay legible.
   */
  readonly attention: {
    /** Stored but unpublishable: no concept link, so they cannot be examined. */
    readonly unlinkedQuestions: number;
    /** Accounts that exist but cannot sign in. */
    readonly suspendedUsers: number;
    /** Books still being written. Not a problem — context for the rest. */
    readonly draftTextbooks: number;
    /** Retired from new enrolments but still visible to every reader. */
    readonly inactiveSchools: number;
    readonly inactiveSubjects: number;
    readonly inactiveGrades: number;
    /** Learners with no current enrolment: entitled to nothing until placed. */
    readonly learnersWithoutEnrollment: number;
    /** TEACHER grants with no school while several schools exist. */
    readonly unscopedTeacherGrants: number;
  };
}

export class AdministrationService {
  constructor(private readonly repo: AdministrationRepository) {}

  async overview(): Promise<Result<AdminOverview>> {
    // Sequential, not Promise.all. These reads are independent and running
    // them together would be faster, but PGlite serves a single connection in
    // development and concurrent Prisma calls deadlock on it. The dashboard
    // working everywhere beats the dashboard being quick in production and
    // hanging on a developer's machine.
    const collections = await this.repo.countCollections();
    const currentAcademicYear = await this.repo.currentAcademicYear();
    const usersByStatus = await this.repo.usersByStatus();
    const textbooksByStatus = await this.repo.textbooksByStatus();
    const unlinkedQuestions = await this.repo.countUnlinkedQuestions();
    const inactiveSchools = await this.repo.countInactiveSchools();
    const inactiveSubjects = await this.repo.countInactiveSubjects();
    const inactiveGrades = await this.repo.countInactiveGrades();
    const learnersWithoutEnrollment = await this.repo.countLearnersWithoutCurrentEnrollment();
    const unscopedTeacherGrants = await this.repo.countUnscopedTeacherGrants();

    const totalFor = (
      rows: readonly { status: string; total: number }[],
      status: string,
    ): number => rows.find((row) => row.status === status)?.total ?? 0;

    return Ok({
      collections,
      currentAcademicYear,
      usersByStatus,
      textbooksByStatus,
      attention: {
        unlinkedQuestions,
        suspendedUsers: totalFor(usersByStatus, 'SUSPENDED'),
        draftTextbooks: totalFor(textbooksByStatus, 'DRAFT'),
        inactiveSchools,
        inactiveSubjects,
        inactiveGrades,
        learnersWithoutEnrollment,
        unscopedTeacherGrants,
      },
    });
  }

  /**
   * The audit trail, newest first. This is the real record the provisioning
   * and authoring services already write; reading it here adds no new write
   * path and invents no "activity" of its own.
   */
  async activity(limit = 20): Promise<Result<readonly ActivityEntry[]>> {
    return Ok(await this.repo.recentActivity(Math.min(Math.max(limit, 1), 50)));
  }
}
