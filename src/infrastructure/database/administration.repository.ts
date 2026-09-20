/**
 * Prisma adapter for the administration overview.
 *
 * Every query here is a count. No row data crosses this boundary, which keeps
 * the dashboard cheap on a real school's database: the expensive version of
 * this screen is the one that fetches lists in order to measure their length.
 *
 * The one exception is `recentActivity`, which returns a bounded slice of the
 * audit trail — a feed of the twenty newest entries is cheap precisely
 * because it is bounded and indexed on createdAt.
 *
 * Sequential throughout, like the catalogue adapter and for the same reason —
 * PGlite serves one connection in development and parallel Prisma calls
 * deadlock on it.
 */

import type {
  ActivityEntry,
  AdministrationRepository,
  CollectionCount,
  ContentStateBreakdown,
  CurrentAcademicYearView,
  UserStatusBreakdown,
} from '../../contexts/administration/application/ports.js';
import type { Db } from './prisma.client.js';

export class PrismaAdministrationRepository implements AdministrationRepository {
  constructor(private readonly db: Db) {}

  async countCollections(): Promise<readonly CollectionCount[]> {
    return [
      { collection: 'users', total: await this.db.user.count() },
      { collection: 'learners', total: await this.db.learnerProfile.count() },
      { collection: 'educators', total: await this.db.educatorProfile.count() },
      { collection: 'schools', total: await this.db.school.count() },
      { collection: 'subjects', total: await this.db.subject.count() },
      { collection: 'activeSubjects', total: await this.db.subject.count({ where: { isActive: true } }) },
      { collection: 'grades', total: await this.db.grade.count() },
      { collection: 'academicYears', total: await this.db.academicYear.count() },
      { collection: 'terms', total: await this.db.term.count() },
      { collection: 'textbooks', total: await this.db.textbook.count() },
      { collection: 'units', total: await this.db.unit.count() },
      { collection: 'lessons', total: await this.db.lesson.count() },
      { collection: 'concepts', total: await this.db.concept.count() },
      { collection: 'questions', total: await this.db.question.count() },
      { collection: 'exams', total: await this.db.exam.count() },
      { collection: 'attempts', total: await this.db.attempt.count() },
      { collection: 'enrollments', total: await this.db.enrollment.count() },
      { collection: 'currentEnrollments', total: await this.db.enrollment.count({ where: { isCurrent: true } }) },
    ];
  }

  async currentAcademicYear(): Promise<CurrentAcademicYearView | null> {
    // Exactly one row carries isCurrent — "make current" clears the others in
    // the same transaction — so findFirst cannot race a second winner.
    const year = await this.db.academicYear.findFirst({ where: { isCurrent: true } });
    if (!year) return null;
    const termCount = await this.db.term.count({ where: { academicYearId: year.id } });
    return { key: year.key, startsOn: year.startsOn, endsOn: year.endsOn, termCount };
  }

  async usersByStatus(): Promise<readonly UserStatusBreakdown[]> {
    const rows = await this.db.user.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    return rows.map((row) => ({ status: String(row.status), total: row._count._all }));
  }

  async textbooksByStatus(): Promise<readonly ContentStateBreakdown[]> {
    const rows = await this.db.textbook.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    return rows.map((row) => ({ status: String(row.status), total: row._count._all }));
  }

  async countUnlinkedQuestions(): Promise<number> {
    // "No concept link" is the publish gate's own definition, expressed as the
    // absence of any QuestionConcept row. Counting `concepts: { none: {} }`
    // rather than a denormalised flag means the number cannot drift away from
    // the rule that actually blocks publication.
    return this.db.question.count({ where: { concepts: { none: {} } } });
  }

  async recentActivity(limit: number): Promise<readonly ActivityEntry[]> {
    const rows = await this.db.auditEntry.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        action: true,
        entity: true,
        entityKey: true,
        createdAt: true,
        actor: { select: { fullName: true } },
      },
    });
    return rows.map((row) => ({
      action: row.action,
      entity: row.entity,
      entityKey: row.entityKey,
      actorName: row.actor?.fullName ?? null,
      createdAt: row.createdAt,
    }));
  }

  async countInactiveSchools(): Promise<number> {
    return this.db.school.count({ where: { isActive: false } });
  }

  async countInactiveSubjects(): Promise<number> {
    return this.db.subject.count({ where: { isActive: false } });
  }

  async countInactiveGrades(): Promise<number> {
    return this.db.grade.count({ where: { isActive: false } });
  }

  async countLearnersWithoutCurrentEnrollment(): Promise<number> {
    return this.db.learnerProfile.count({ where: { enrollments: { none: { isCurrent: true } } } });
  }

  async countUnscopedTeacherGrants(): Promise<number> {
    // With one school an unscoped TEACHER grant is unambiguous, so the count
    // is only meaningful — and only reported — once a second school exists.
    const schools = await this.db.school.count();
    if (schools <= 1) return 0;
    return this.db.userRole.count({ where: { role: 'TEACHER', schoolId: null } });
  }
}
