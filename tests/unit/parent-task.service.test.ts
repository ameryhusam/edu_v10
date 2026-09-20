/**
 * Parent tasks: guardianship, advisory origin, and the limits of a parent.
 *
 * The security-relevant assertions here are the ones about what a parent
 * CANNOT do — set a task for a child they are not linked to, author a
 * TEACHER-origin plan, or cancel a teacher's work.
 */

import { describe, expect, it } from 'vitest';
import { ParentTaskService } from '../../src/contexts/instruction/application/parent-task.service.js';
import type { PlanRecord } from '../../src/contexts/instruction/application/ports.js';

const NOW = new Date('2026-09-12T12:00:00.000Z');
const clock = { now: () => NOW };

const PARENT = { userId: 'user-parent-1', userKey: 'usr_parent_1' };

function build(options: { links?: Record<string, string[]>; plans?: PlanRecord[] } = {}) {
  const links = options.links ?? { 'user-parent-1': ['lrn_child'] };
  const plans = new Map<string, PlanRecord>((options.plans ?? []).map((p) => [p.key, p]));
  const obligations = new Map<string, Array<{ key: string; learnerKey: string }>>();
  const statuses: Array<{ key: string; status: string }> = [];

  const repo = {
    findPlan: async (key: string) => plans.get(key) ?? null,
    createPlan: async (input: Record<string, unknown>) => {
      const plan = { ...input, status: 'DRAFT', assignedByKey: input.assignedByUserKey } as unknown as PlanRecord;
      plans.set(plan.key, plan);
      return plan;
    },
    setPlanStatus: async (key: string, status: string) => {
      statuses.push({ key, status });
      const plan = plans.get(key);
      if (plan) plans.set(key, { ...plan, status } as PlanRecord);
    },
    createObligations: async (planKey: string, entries: Array<{ key: string; learnerKey: string }>) => {
      obligations.set(planKey, entries);
      return entries.length;
    },
    obligationsForPlan: async (planKey: string) =>
      (obligations.get(planKey) ?? []).map((e) => ({
        key: e.key,
        planKey,
        learnerKey: e.learnerKey,
        status: 'PENDING',
        blockedByGate: null,
        startedAt: null,
        completedAt: null,
        waivedAt: null,
      })),
    obligationsForLearner: async (learnerKey: string) => {
      const rows: unknown[] = [];
      for (const [planKey, entries] of obligations) {
        for (const entry of entries) {
          if (entry.learnerKey !== learnerKey) continue;
          rows.push({
            key: entry.key,
            planKey,
            learnerKey,
            status: 'PENDING',
            blockedByGate: null,
            startedAt: null,
            completedAt: null,
            waivedAt: null,
            plan: plans.get(planKey),
          });
        }
      }
      return rows;
    },
  };

  const guardianLinks = {
    isVerifiedGuardianOf: async (userId: string, learnerKey: string) =>
      (links[userId] ?? []).includes(learnerKey),
    learnerKeysFor: async (userId: string) => links[userId] ?? [],
  };

  const activities = { describe: async () => ({ exists: true, gradeId: null }) };
  const roster = {
    learnersInScope: async () => [],
    schoolOfLearner: async () => 'school-1',
  };

  const service = new ParentTaskService(
    repo as never,
    guardianLinks as never,
    activities as never,
    roster as never,
    clock,
  );

  return { service, plans, obligations, statuses };
}

const task = {
  learnerKey: 'lrn_child',
  title: 'Practise your times tables',
  activityType: 'LESSON' as const,
  activityKey: 'LESSON-1',
};

describe('ParentTaskService.create', () => {
  it('creates a PARENT-origin plan and one obligation', async () => {
    const { service, obligations } = build();
    const result = await service.create(PARENT, task);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.plan.origin).toBe('PARENT');
    expect(result.value.countsTowardCompletion).toBe(false);
    expect(obligations.get(result.value.plan.key)).toHaveLength(1);
  });

  it('publishes immediately — a parent has no draft workflow', async () => {
    const { service, statuses } = build();
    await service.create(PARENT, task);
    expect(statuses[0]!.status).toBe('PUBLISHED');
  });

  it('refuses a child the actor is not a verified guardian of', async () => {
    const { service } = build();
    const result = await service.create(PARENT, { ...task, learnerKey: 'lrn_other_child' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('instruction.not_guardian');
  });

  it('cannot be talked into a TEACHER origin by extra input', async () => {
    const { service } = build();
    // Even if a client smuggles an origin through, the service hard-codes it.
    const result = await service.create(PARENT, {
      ...task,
      origin: 'TEACHER',
    } as never);

    expect(result.ok && result.value.plan.origin).toBe('PARENT');
  });

  it('inherits the school from the child rather than accepting one', async () => {
    const { service } = build();
    const result = await service.create(PARENT, task);
    expect(result.ok && result.value.plan.scope.schoolId).toBe('school-1');
  });

  it('refuses a due date before the availability date', async () => {
    const { service } = build();
    const result = await service.create(PARENT, {
      ...task,
      availableAt: new Date('2026-09-20T00:00:00.000Z'),
      dueAt: new Date('2026-09-14T00:00:00.000Z'),
    });

    expect(result.ok).toBe(false);
  });

  it('treats an identical re-submission as a duplicate, not a second task', async () => {
    const { service } = build();
    await service.create(PARENT, task);
    const again = await service.create(PARENT, task);

    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.code).toBe('instruction.parent_task_duplicate');
  });

  it('refuses when the learner is not enrolled anywhere', async () => {
    // Scoping a task needs a school, and the parent is never asked for one.
    // Nothing is written: the refusal happens before the repository is touched.
    const unenrolled = new ParentTaskService(
      {
        findPlan: async () => {
          throw new Error('repository must not be reached when scoping fails');
        },
      } as never,
      { isVerifiedGuardianOf: async () => true, learnerKeysFor: async () => [] } as never,
      { describe: async () => ({ exists: true, gradeId: null }) } as never,
      { learnersInScope: async () => [], schoolOfLearner: async () => null } as never,
      clock,
    );

    const result = await unenrolled.create(PARENT, task);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('instruction.learner_not_enrolled');
  });
});

describe('ParentTaskService.cancel', () => {
  it('cancels a task this parent set, without deleting it', async () => {
    const { service, plans } = build();
    const created = await service.create(PARENT, task);
    if (!created.ok) throw new Error('setup failed');

    const result = await service.cancel(PARENT, created.value.plan.key);
    expect(result.ok).toBe(true);
    // Still present — history is preserved.
    expect(plans.get(created.value.plan.key)!.status).toBe('CANCELLED');
  });

  it("refuses to cancel a teacher's plan", async () => {
    const teacherPlan = {
      key: 'PLAN-TEACHER-1',
      title: 'Homework',
      instructions: null,
      origin: 'TEACHER',
      activityType: 'LESSON',
      activityKey: 'LESSON-1',
      scope: { schoolId: 'school-1', gradeId: null, termId: null },
      status: 'PUBLISHED',
      availableAt: null,
      dueAt: null,
      assignedByKey: 'usr_teacher_1',
    } as PlanRecord;

    const { service } = build({ plans: [teacherPlan] });
    const result = await service.cancel(PARENT, 'PLAN-TEACHER-1');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('instruction.not_task_author');
  });

  it("refuses to cancel another parent's task with the same refusal", async () => {
    const otherParentPlan = {
      key: 'PLAN-PARENT-OTHER',
      title: 'Read a chapter',
      instructions: null,
      origin: 'PARENT',
      activityType: 'LESSON',
      activityKey: 'LESSON-1',
      scope: { schoolId: 'school-1', gradeId: null, termId: null },
      status: 'PUBLISHED',
      availableAt: null,
      dueAt: null,
      assignedByKey: 'usr_parent_2',
    } as PlanRecord;

    const { service } = build({ plans: [otherParentPlan] });
    const result = await service.cancel(PARENT, 'PLAN-PARENT-OTHER');

    expect(result.ok).toBe(false);
    // Same code as the teacher case: probing keys reveals nothing.
    if (!result.ok) expect(result.error.code).toBe('instruction.not_task_author');
  });
});

describe('ParentTaskService.childTasks', () => {
  it('labels each task with whether it counts academically', async () => {
    const { service } = build();
    await service.create(PARENT, task);

    const result = await service.childTasks(PARENT, 'lrn_child');
    if (!result.ok) throw new Error('expected ok');

    expect(result.value.tasks[0]!.countsTowardCompletion).toBe(false);
    expect(result.value.tasks[0]!.setByThisParent).toBe(true);
  });

  it("excludes the parent's own tasks from the academic summary", async () => {
    const { service } = build();
    await service.create(PARENT, task);
    await service.create(PARENT, { ...task, title: 'Another chore' });

    const result = await service.childTasks(PARENT, 'lrn_child');
    if (!result.ok) throw new Error('expected ok');

    expect(result.value.tasks).toHaveLength(2);
    // Two parent tasks must not make school progress look like 0 of 2.
    expect(result.value.academicSummary).toEqual({ total: 0, completed: 0 });
  });

  it('refuses to show a child the actor does not guard', async () => {
    const { service } = build();
    const result = await service.childTasks(PARENT, 'lrn_other_child');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('instruction.not_guardian');
  });
});
