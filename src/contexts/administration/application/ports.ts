/**
 * What the administration overview needs from the outside world.
 *
 * Read-only by design: the dashboard assembles counts other contexts own. A
 * write here would be a second way to change those contexts' data, around
 * every invariant their services enforce.
 */

import type { Result } from '../../../shared/kernel/result.js';

export interface CollectionCount {
  readonly collection: string;
  readonly total: number;
}

export interface UserStatusBreakdown {
  readonly status: string;
  readonly total: number;
}

export interface ContentStateBreakdown {
  readonly status: string;
  readonly total: number;
}

/** One line of the audit trail, as an administrator reads it. */
export interface ActivityEntry {
  readonly action: string;
  readonly entity: string;
  readonly entityKey: string | null;
  /** The acting account's display name, when the actor is still known. */
  readonly actorName: string | null;
  readonly createdAt: Date;
}

/**
 * The one year flagged current — the dashboard's first sentence. Null when no
 * year has been made current yet, which is a real state on a fresh install
 * and not an error.
 */
export interface CurrentAcademicYearView {
  readonly key: string;
  readonly startsOn: Date;
  readonly endsOn: Date;
  readonly termCount: number;
}

export interface AdministrationRepository {
  countCollections(): Promise<readonly CollectionCount[]>;
  currentAcademicYear(): Promise<CurrentAcademicYearView | null>;
  usersByStatus(): Promise<readonly UserStatusBreakdown[]>;
  textbooksByStatus(): Promise<readonly ContentStateBreakdown[]>;
  countUnlinkedQuestions(): Promise<number>;
  /** Newest-first slice of the audit trail, for the dashboard's activity feed. */
  recentActivity(limit: number): Promise<readonly ActivityEntry[]>;
  countInactiveSchools(): Promise<number>;
  countInactiveSubjects(): Promise<number>;
  countInactiveGrades(): Promise<number>;
  /** Learners with no current enrolment — entitled to nothing until placed. */
  countLearnersWithoutCurrentEnrollment(): Promise<number>;
  /**
   * TEACHER grants with no school, counted only when more than one school
   * exists: with one school an unscoped grant is unambiguous, and reporting
   * it would be noise. With several, it is a teacher whose cohort scope
   * cannot be determined — a real configuration fault.
   */
  countUnscopedTeacherGrants(): Promise<number>;
}

export type AdministrationPorts = AdministrationRepository;
export type { Result };
