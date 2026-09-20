/**
 * Prisma adapters for the Instruction ports.
 *
 * Note what these classes cannot do: there is no method that writes a score,
 * a mastery value or an attempt count, because the ports do not declare one.
 * The completion reader below READS Learning's and Mastery's canonical state
 * and hands back a policy verdict — it never derives a second opinion.
 */

import { evaluateCompletion } from '../../contexts/learning/domain/completion-policy.js';
import { DEFAULT_MASTERY_THRESHOLD } from '../../contexts/mastery/domain/mastery-level.js';
import type {
  ActivityReader,
  CompletionReader,
  ObligationRecord,
  PlanRecord,
  PlanRepository,
  RosterReader,
} from '../../contexts/instruction/application/ports.js';
import type { ObligationStatus } from '../../contexts/instruction/domain/obligation.js';
import type {
  AssignmentOrigin,
  InstructionalActivityType,
  PlanScope,
  PlanStatus,
} from '../../contexts/instruction/domain/plan.js';
import { publishedConcept, publishedLesson, publishedTextbook } from './published-content.js';
import type { Db } from './prisma.client.js';

const planSelect = {
  key: true,
  title: true,
  instructions: true,
  origin: true,
  activityType: true,
  activityKey: true,
  schoolId: true,
  gradeId: true,
  termId: true,
  status: true,
  targetLearner: { select: { key: true } },
  availableAt: true,
  dueAt: true,
  assignedBy: { select: { key: true } },
} as const;

type PlanRow = {
  key: string;
  title: string;
  instructions: string | null;
  origin: string;
  activityType: string;
  activityKey: string;
  schoolId: string;
  gradeId: string | null;
  termId: string | null;
  status: string;
  targetLearner: { key: string } | null;
  availableAt: Date | null;
  dueAt: Date | null;
  assignedBy: { key: string } | null;
};

function toPlan(row: PlanRow): PlanRecord {
  return {
    key: row.key,
    title: row.title,
    instructions: row.instructions,
    origin: row.origin as AssignmentOrigin,
    activityType: row.activityType as InstructionalActivityType,
    activityKey: row.activityKey,
    scope: { schoolId: row.schoolId, gradeId: row.gradeId, termId: row.termId },
    status: row.status as PlanStatus,
    targetLearnerKey: row.targetLearner?.key ?? null,
    availableAt: row.availableAt,
    dueAt: row.dueAt,
    assignedByKey: row.assignedBy?.key ?? null,
  };
}

const obligationSelect = {
  key: true,
  status: true,
  blockedByGate: true,
  startedAt: true,
  completedAt: true,
  waivedAt: true,
  waiverReason: true,
  learner: { select: { key: true } },
  plan: { select: { key: true } },
} as const;

type ObligationRow = {
  key: string;
  status: string;
  blockedByGate: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  waivedAt: Date | null;
  waiverReason: string | null;
  learner: { key: string };
  plan: { key: string };
};

function toObligation(row: ObligationRow): ObligationRecord {
  return {
    key: row.key,
    planKey: row.plan.key,
    learnerKey: row.learner.key,
    status: row.status as ObligationStatus,
    blockedByGate: row.blockedByGate,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    waivedAt: row.waivedAt,
    waiverReason: row.waiverReason,
  };
}

export class PrismaPlanRepository implements PlanRepository {
  constructor(private readonly db: Db) {}

  async findPlan(key: string): Promise<PlanRecord | null> {
    const row = await this.db.instructionalPlan.findUnique({ where: { key }, select: planSelect });
    return row ? toPlan(row as PlanRow) : null;
  }

  async createPlan(input: {
    key: string;
    title: string;
    instructions: string | null;
    origin: AssignmentOrigin;
    activityType: InstructionalActivityType;
    activityKey: string;
    scope: PlanScope;
    targetLearnerKey?: string | null;
    availableAt: Date | null;
    dueAt: Date | null;
    assignedByUserKey: string | null;
  }): Promise<PlanRecord> {
    const author = input.assignedByUserKey
      ? await this.db.user.findUnique({
          where: { key: input.assignedByUserKey },
          select: { id: true },
        })
      : null;
    const targetLearner = input.targetLearnerKey
      ? await this.db.learnerProfile.findUnique({
          where: { key: input.targetLearnerKey },
          select: { id: true },
        })
      : null;

    const row = await this.db.instructionalPlan.create({
      data: {
        key: input.key,
        title: input.title,
        instructions: input.instructions,
        origin: input.origin,
        activityType: input.activityType,
        activityKey: input.activityKey,
        schoolId: input.scope.schoolId,
        gradeId: input.scope.gradeId,
        termId: input.scope.termId,
        targetLearnerId: targetLearner?.id ?? null,
        availableAt: input.availableAt,
        dueAt: input.dueAt,
        assignedById: author?.id ?? null,
      },
      select: planSelect,
    });
    return toPlan(row as PlanRow);
  }

  async updatePlan(key: string, fields: Readonly<Record<string, unknown>>): Promise<void> {
    await this.db.instructionalPlan.update({ where: { key }, data: fields as Record<string, never> });
  }

  async setPlanStatus(key: string, status: PlanStatus, publishedAt?: Date): Promise<void> {
    await this.db.instructionalPlan.update({
      where: { key },
      data: { status, ...(publishedAt ? { publishedAt } : {}) },
    });
  }

  async obligationLearnerKeys(planKey: string): Promise<string[]> {
    const rows = await this.db.learnerObligation.findMany({
      where: { plan: { key: planKey } },
      select: { learner: { select: { key: true } } },
    });
    return rows.map((r) => r.learner.key);
  }

  /**
   * Create the missing obligations.
   *
   * `skipDuplicates` is belt and braces: the service already filters against
   * existing rows, but two teachers publishing the same plan concurrently
   * would otherwise race on `@@unique([planId, learnerId])`.
   */
  async createObligations(
    planKey: string,
    entries: ReadonlyArray<{ learnerKey: string; key: string }>,
  ): Promise<number> {
    if (entries.length === 0) return 0;

    const plan = await this.db.instructionalPlan.findUniqueOrThrow({
      where: { key: planKey },
      select: { id: true },
    });
    const learners = await this.db.learnerProfile.findMany({
      where: { key: { in: entries.map((e) => e.learnerKey) } },
      select: { id: true, key: true },
    });
    const idByKey = new Map(learners.map((l) => [l.key, l.id]));

    const data = entries
      .filter((e) => idByKey.has(e.learnerKey))
      .map((e) => ({ key: e.key, planId: plan.id, learnerId: idByKey.get(e.learnerKey)! }));

    const result = await this.db.learnerObligation.createMany({ data, skipDuplicates: true });
    return result.count;
  }

  async findObligation(key: string): Promise<ObligationRecord | null> {
    const row = await this.db.learnerObligation.findUnique({
      where: { key },
      select: obligationSelect,
    });
    return row ? toObligation(row as ObligationRow) : null;
  }

  async obligationsForPlan(planKey: string): Promise<ObligationRecord[]> {
    const rows = await this.db.learnerObligation.findMany({
      where: { plan: { key: planKey } },
      select: obligationSelect,
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => toObligation(r as ObligationRow));
  }

  async obligationsForLearner(
    learnerKey: string,
    options?: { includeInactive?: boolean },
  ): Promise<Array<ObligationRecord & { plan: PlanRecord }>> {
    const rows = await this.db.learnerObligation.findMany({
      where: {
        learner: { key: learnerKey },
        // A cancelled plan's work is no longer required, so it is hidden by
        // default rather than deleted — the evidence stays attributable.
        ...(options?.includeInactive ? {} : { plan: { status: 'PUBLISHED' } }),
      },
      select: { ...obligationSelect, plan: { select: planSelect } },
      orderBy: { createdAt: 'desc' },
    });

    return rows.map((r) => ({
      ...toObligation({ ...r, plan: { key: (r.plan as PlanRow).key } } as ObligationRow),
      plan: toPlan(r.plan as PlanRow),
    }));
  }

  async updateObligationStatus(
    key: string,
    update: {
      status: ObligationStatus;
      blockedByGate: string | null;
      evaluatedAt: Date;
      startedAt?: Date | null;
      completedAt?: Date | null;
    },
  ): Promise<void> {
    await this.db.learnerObligation.update({
      where: { key },
      data: {
        status: update.status,
        blockedByGate: update.blockedByGate,
        evaluatedAt: update.evaluatedAt,
        ...(update.startedAt !== undefined ? { startedAt: update.startedAt } : {}),
        ...(update.completedAt !== undefined ? { completedAt: update.completedAt } : {}),
      },
    });
  }

  async waiveObligation(
    key: string,
    waiver: { waivedByUserKey: string; waivedAt: Date; reason: string },
  ): Promise<void> {
    const actor = await this.db.user.findUnique({
      where: { key: waiver.waivedByUserKey },
      select: { id: true },
    });

    await this.db.learnerObligation.update({
      where: { key },
      data: {
        status: 'WAIVED',
        waivedById: actor?.id ?? null,
        waivedAt: waiver.waivedAt,
        waiverReason: waiver.reason,
      },
    });
  }

  async reopenObligation(key: string): Promise<void> {
    // Back to PENDING, not to a guessed status: the service recomputes it from
    // the completion policy immediately afterwards. Writing a status here would
    // be this adapter deciding what the learner's standing is.
    await this.db.learnerObligation.update({
      where: { key },
      data: {
        status: 'PENDING',
        waivedById: null,
        waivedAt: null,
        waiverReason: null,
      },
    });
  }
}

/**
 * A cohort resolved by query, not by a roster table.
 *
 * This is the whole of "a class is a query": `Enrollment` already records who
 * is where, so a Class entity would be a denormalised copy that can disagree
 * with it.
 */
export class PrismaRosterReader implements RosterReader {
  constructor(private readonly db: Db) {}

  async learnersInScope(scope: PlanScope): Promise<string[]> {
    const rows = await this.db.enrollment.findMany({
      where: {
        schoolId: scope.schoolId,
        isCurrent: true,
        ...(scope.gradeId ? { gradeId: scope.gradeId } : {}),
        ...(scope.termId ? { termId: scope.termId } : {}),
      },
      select: { learner: { select: { key: true } } },
    });
    return rows.map((r) => r.learner.key);
  }

  async schoolOfLearner(learnerKey: string): Promise<string | null> {
    const row = await this.db.enrollment.findFirst({
      where: { learner: { key: learnerKey }, isCurrent: true },
      select: { schoolId: true },
    });
    return row?.schoolId ?? null;
  }

  async currentEnrollmentOfLearner(
    learnerKey: string,
  ): Promise<{ schoolId: string; gradeId: string | null; termId: string | null } | null> {
    const row = await this.db.enrollment.findFirst({
      where: { learner: { key: learnerKey }, isCurrent: true },
      select: { schoolId: true, gradeId: true, termId: true },
    });
    return row ?? null;
  }
}

/**
 * Resolves the activity being assigned, just far enough to refuse a bad one.
 *
 * Only published content is assignable: assigning a draft lesson would create
 * an obligation the learner cannot open, since learner reads filter on
 * publication (see published-content.ts).
 */
export class PrismaActivityReader implements ActivityReader {
  constructor(private readonly db: Db) {}

  async describe(
    activityType: InstructionalActivityType,
    activityKey: string,
  ): Promise<{ exists: boolean; gradeId: string | null; title: string | null }> {
    switch (activityType) {
      case 'LESSON':
      case 'REVIEW_SET':
      case 'REMEDIATION_PLAN': {
        const row = await this.db.lesson.findFirst({
          where: { key: activityKey, ...publishedLesson },
          select: { name: true, unit: { select: { textbook: { select: { gradeId: true } } } } },
        });
        return row
          ? { exists: true, gradeId: row.unit.textbook.gradeId, title: row.name }
          : { exists: false, gradeId: null, title: null };
      }
      case 'CONCEPT': {
        const row = await this.db.concept.findFirst({
          where: { key: activityKey, ...publishedConcept },
          select: {
            name: true,
            lesson: { select: { unit: { select: { textbook: { select: { gradeId: true } } } } } },
          },
        });
        return row
          ? { exists: true, gradeId: row.lesson.unit.textbook.gradeId, title: row.name }
          : { exists: false, gradeId: null, title: null };
      }
      case 'EXAM': {
        const row = await this.db.exam.findFirst({
          where: { key: activityKey, status: 'PUBLISHED', textbook: publishedTextbook },
          select: { title: true, textbook: { select: { gradeId: true } } },
        });
        return row
          ? { exists: true, gradeId: row.textbook?.gradeId ?? null, title: row.title }
          : { exists: false, gradeId: null, title: null };
      }
    }
  }
}

/**
 * Reads whether the work is done, through the canonical owners.
 *
 * Deliberately returns a `CompletionResult`, not a number: Instruction must
 * not be able to see or store a mastery value. The policy is Learning's, run
 * here over Mastery's state — there is no second formula.
 */
export class PrismaCompletionReader implements CompletionReader {
  constructor(private readonly db: Db) {}

  async evaluate(
    learnerKey: string,
    activityType: InstructionalActivityType,
    activityKey: string,
  ) {
    const conceptKeys = await this.conceptsFor(activityType, activityKey);
    if (conceptKeys.length === 0) return { completion: null, started: false };

    const [mastery, attempts] = await Promise.all([
      this.db.conceptMastery.findMany({
        where: { learner: { key: learnerKey }, concept: { key: { in: conceptKeys } } },
        select: { mastery: true, attemptsCount: true, concept: { select: { key: true } } },
      }),
      this.db.attempt.count({
        where: {
          learner: { key: learnerKey },
          ...(activityType === 'EXAM'
            ? { exam: { key: activityKey } }
            : { lessonKey: activityKey }),
        },
      }),
    ]);

    const started = attempts > 0 || mastery.some((m) => m.attemptsCount > 0);

    // The activity is complete only when EVERY concept in it is mastered; the
    // weakest concept decides, because a learner who mastered three of four
    // has not finished the lesson.
    const weakest = conceptKeys.reduce((lowest, key) => {
      const m = mastery.find((row) => row.concept.key === key)?.mastery ?? 0;
      return Math.min(lowest, m);
    }, 1);

    const attempted = mastery.some((m) => m.attemptsCount > 0);

    return {
      completion: evaluateCompletion({
        requiresAssessment: true,
        attempted,
        assessmentPassed: attempted,
        masteryAchieved: weakest,
        minimumMastery: DEFAULT_MASTERY_THRESHOLD,
      }),
      started,
    };
  }

  private async conceptsFor(
    activityType: InstructionalActivityType,
    activityKey: string,
  ): Promise<string[]> {
    if (activityType === 'CONCEPT') return [activityKey];

    if (activityType === 'EXAM') {
      const rows = await this.db.questionConcept.findMany({
        where: { question: { examItems: { some: { exam: { key: activityKey } } } } },
        select: { concept: { select: { key: true } } },
      });
      return [...new Set(rows.map((r) => r.concept.key))];
    }

    const rows = await this.db.concept.findMany({
      where: { lesson: { key: activityKey }, isActive: true },
      select: { key: true },
    });
    return rows.map((r) => r.key);
  }
}
