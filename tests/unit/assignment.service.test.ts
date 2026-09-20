/**
 * AssignmentService against in-memory adapters.
 *
 * These tests are written against the gate's acceptance criteria (§6), and in
 * particular the two that are easiest to lose: re-publication must be
 * idempotent, and no path may accept an achievement value.
 */

import { describe, expect, it } from 'vitest';
import {
  AssignmentService,
  type InstructorContext,
} from '../../src/contexts/instruction/application/assignment.service.js';
import type {
  ActivityReader,
  CompletionReader,
  ObligationRecord,
  PlanRecord,
  PlanRepository,
  RosterReader,
} from '../../src/contexts/instruction/application/ports.js';
import type { ObligationStatus } from '../../src/contexts/instruction/domain/obligation.js';
import type { PlanScope, PlanStatus } from '../../src/contexts/instruction/domain/plan.js';
import { evaluateCompletion } from '../../src/contexts/learning/domain/completion-policy.js';

const SCHOOL = 'sch-1';
const SCOPE: PlanScope = { schoolId: SCHOOL, gradeId: 'g7', termId: 't1' };
const LESSON = 'EDU-MATH-G07-T1-ED2026-U-SETS-L-BASICS';

let tick = 0;
const clock = { now: () => new Date(Date.UTC(2026, 8, 11, 12, 0, tick++)) };

class FakeRepo implements PlanRepository {
  plans = new Map<string, PlanRecord>();
  obligations = new Map<string, ObligationRecord>();
  /**
   * Every learner set handed to createObligations.
   *
   * Asserting on this rather than only on the final row count is what makes
   * the idempotence test real: this fake models the database's
   * @@unique([planId, learnerId]) by skipping clashes, so a service that asked
   * for every learner on every run would still end up with the right rows and
   * a vacuous test would pass. The request itself has to be correct.
   */
  createRequests: string[][] = [];

  async findPlan(key: string) {
    return this.plans.get(key) ?? null;
  }
  async createPlan(input: Parameters<PlanRepository['createPlan']>[0]) {
    const plan: PlanRecord = {
      key: input.key,
      title: input.title,
      instructions: input.instructions,
      origin: input.origin,
      activityType: input.activityType,
      activityKey: input.activityKey,
      scope: input.scope,
      status: 'DRAFT',
      targetLearnerKey: input.targetLearnerKey ?? null,
      availableAt: input.availableAt,
      dueAt: input.dueAt,
      assignedByKey: input.assignedByUserKey,
    };
    this.plans.set(plan.key, plan);
    return plan;
  }
  async updatePlan(key: string, fields: Record<string, unknown>) {
    const plan = this.plans.get(key);
    if (plan) this.plans.set(key, { ...plan, ...fields } as PlanRecord);
  }
  async setPlanStatus(key: string, status: PlanStatus) {
    const plan = this.plans.get(key);
    if (plan) this.plans.set(key, { ...plan, status });
  }
  async obligationLearnerKeys(planKey: string) {
    return [...this.obligations.values()].filter((o) => o.planKey === planKey).map((o) => o.learnerKey);
  }
  async createObligations(planKey: string, entries: ReadonlyArray<{ learnerKey: string; key: string }>) {
    this.createRequests.push(entries.map((e) => e.learnerKey));
    let n = 0;
    for (const e of entries) {
      // The database's @@unique([planId, learnerId]) modelled here.
      const clash = [...this.obligations.values()].some(
        (o) => o.planKey === planKey && o.learnerKey === e.learnerKey,
      );
      if (clash) continue;
      this.obligations.set(e.key, {
        key: e.key,
        planKey,
        learnerKey: e.learnerKey,
        status: 'PENDING',
        blockedByGate: null,
        startedAt: null,
        completedAt: null,
        waivedAt: null,
        waiverReason: null,
      });
      n += 1;
    }
    return n;
  }
  async findObligation(key: string) {
    return this.obligations.get(key) ?? null;
  }
  async obligationsForPlan(planKey: string) {
    return [...this.obligations.values()].filter((o) => o.planKey === planKey);
  }
  async obligationsForLearner(learnerKey: string) {
    return [...this.obligations.values()]
      .filter((o) => o.learnerKey === learnerKey)
      .map((o) => ({ ...o, plan: this.plans.get(o.planKey)! }));
  }
  async updateObligationStatus(
    key: string,
    u: { status: ObligationStatus; blockedByGate: string | null; startedAt?: Date | null; completedAt?: Date | null },
  ) {
    const o = this.obligations.get(key);
    if (!o) return;
    this.obligations.set(key, {
      ...o,
      status: u.status,
      blockedByGate: u.blockedByGate,
      ...(u.startedAt !== undefined ? { startedAt: u.startedAt } : {}),
      ...(u.completedAt !== undefined ? { completedAt: u.completedAt } : {}),
    });
  }
  async waiveObligation(key: string, w: { waivedAt: Date; reason: string }) {
    const o = this.obligations.get(key);
    if (o) this.obligations.set(key, { ...o, status: 'WAIVED', waivedAt: w.waivedAt, waiverReason: w.reason });
  }
  async reopenObligation(key: string) {
    const o = this.obligations.get(key);
    if (o) {
      this.obligations.set(key, {
        ...o,
        status: 'PENDING',
        waivedAt: null,
        waiverReason: null,
      });
    }
  }
}

class FakeRoster implements RosterReader {
  learners: string[] = ['lrn-a', 'lrn-b'];
  async learnersInScope() {
    return this.learners;
  }
  async schoolOfLearner() {
    return SCHOOL;
  }
  async currentEnrollmentOfLearner(learnerKey: string) {
    return this.learners.includes(learnerKey)
      ? { schoolId: SCHOOL, gradeId: 'g7', termId: 't1' }
      : null;
  }
}

class FakeActivities implements ActivityReader {
  exists = true;
  gradeId: string | null = 'g7';
  async describe() {
    return { exists: this.exists, gradeId: this.gradeId, title: 'Basics' };
  }
}

class FakeCompletion implements CompletionReader {
  byLearner = new Map<string, { completion: ReturnType<typeof evaluateCompletion> | null; started: boolean }>();
  async evaluate(learnerKey: string) {
    return this.byLearner.get(learnerKey) ?? { completion: null, started: false };
  }
}

const CTX: InstructorContext = {
  actorKey: 'usr_teacher',
  schoolIds: [SCHOOL],
  isPlatformAdmin: false,
};

/** Captures audit entries so human-override tests can assert the trail. */
class FakeAudit {
  entries: Array<{ action: string; targetKey: string; details?: Record<string, unknown> }> = [];
  async record(entry: {
    actorKey: string;
    action: string;
    targetKey: string;
    details?: Record<string, unknown>;
  }): Promise<void> {
    this.entries.push({
      action: entry.action,
      targetKey: entry.targetKey,
      ...(entry.details ? { details: entry.details } : {}),
    });
  }
}

function setup() {
  const repo = new FakeRepo();
  const roster = new FakeRoster();
  const activities = new FakeActivities();
  const completion = new FakeCompletion();
  const audit = new FakeAudit();
  return {
    repo,
    roster,
    activities,
    completion,
    audit,
    service: new AssignmentService(repo, roster, activities, completion, clock, audit),
  };
}

async function publishedPlan(s: ReturnType<typeof setup>) {
  const created = await s.service.createPlan(CTX, {
    title: 'Study sets',
    activityType: 'LESSON',
    activityKey: LESSON,
    scope: SCOPE,
  });
  if (!created.ok) throw new Error('setup failed');
  await s.service.transition(CTX, created.value.key, 'PUBLISH');
  return created.value.key;
}

describe('authoring a plan', () => {
  it('creates a draft', async () => {
    const s = setup();
    const created = await s.service.createPlan(CTX, {
      title: 'Study sets',
      activityType: 'LESSON',
      activityKey: LESSON,
      scope: SCOPE,
    });

    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.status).toBe('DRAFT');
    expect(created.value.origin).toBe('TEACHER');
  });

  it('creates no obligations until published', async () => {
    const s = setup();
    await s.service.createPlan(CTX, {
      title: 'X',
      activityType: 'LESSON',
      activityKey: LESSON,
      scope: SCOPE,
    });
    expect(s.repo.obligations.size).toBe(0);
  });

  it('refuses an activity from another grade before writing (LD-2)', async () => {
    const s = setup();
    s.activities.gradeId = 'g8';

    const created = await s.service.createPlan(CTX, {
      title: 'X',
      activityType: 'LESSON',
      activityKey: LESSON,
      scope: SCOPE,
    });

    expect(created.ok).toBe(false);
    if (created.ok) return;
    expect(created.error.code).toBe('instruction.activity_out_of_scope');
    expect(s.repo.plans.size).toBe(0);
  });

  it('refuses a missing activity', async () => {
    const s = setup();
    s.activities.exists = false;

    const created = await s.service.createPlan(CTX, {
      title: 'X',
      activityType: 'EXAM',
      activityKey: 'nope',
      scope: SCOPE,
    });
    expect(created.ok).toBe(false);
    if (created.ok) return;
    expect(created.error.code).toBe('instruction.activity_not_found');
  });

  it('refuses a due date before release', async () => {
    const s = setup();
    const created = await s.service.createPlan(CTX, {
      title: 'X',
      activityType: 'LESSON',
      activityKey: LESSON,
      scope: SCOPE,
      availableAt: new Date('2026-10-01'),
      dueAt: new Date('2026-09-01'),
    });
    expect(created.ok).toBe(false);
    if (created.ok) return;
    expect(created.error.code).toBe('instruction.window_inverted');
  });

  it('refuses assigning into another school (R2)', async () => {
    const s = setup();
    const created = await s.service.createPlan(CTX, {
      title: 'X',
      activityType: 'LESSON',
      activityKey: LESSON,
      scope: { ...SCOPE, schoolId: 'other-school' },
    });

    expect(created.ok).toBe(false);
    if (created.ok) return;
    expect(created.error.code).toBe('instruction.school_out_of_scope');
  });

  it('lets a platform admin cross schools', async () => {
    const s = setup();
    const created = await s.service.createPlan(
      { ...CTX, isPlatformAdmin: true, schoolIds: [] },
      { title: 'X', activityType: 'LESSON', activityKey: LESSON, scope: { ...SCOPE, schoolId: 'any' } },
    );
    expect(created.ok).toBe(true);
  });

  it('refuses editing a published plan', async () => {
    const s = setup();
    const key = await publishedPlan(s);

    const updated = await s.service.updatePlan(CTX, key, { title: 'Changed' });
    expect(updated.ok).toBe(false);
    if (updated.ok) return;
    expect(updated.error.code).toBe('instruction.plan_not_editable');
  });
});

describe('publishing and materialisation', () => {
  it('creates one obligation per learner in scope', async () => {
    const s = setup();
    const key = await publishedPlan(s);

    expect(s.repo.obligations.size).toBe(2);
    expect((await s.repo.obligationsForPlan(key)).map((o) => o.learnerKey).sort()).toEqual([
      'lrn-a',
      'lrn-b',
    ]);
  });

  it('is idempotent — re-materialising asks for nobody and creates nothing', async () => {
    const s = setup();
    const key = await publishedPlan(s);
    s.repo.createRequests = [];

    const again = await s.service.materialise(CTX, key);

    expect(again.ok && again.value.obligationsCreated).toBe(0);
    expect(s.repo.obligations.size).toBe(2);
    // The service must not even ASK to create rows it knows exist; relying on
    // the unique constraint to absorb them would hide a real bug.
    expect(s.repo.createRequests).toEqual([]);
  });

  it('adds only a late enrolment', async () => {
    const s = setup();
    const key = await publishedPlan(s);
    s.roster.learners = ['lrn-a', 'lrn-b', 'lrn-late'];

    s.repo.createRequests = [];
    const again = await s.service.materialise(CTX, key);

    expect(again.ok && again.value.obligationsCreated).toBe(1);
    expect(s.repo.obligations.size).toBe(3);
    // Exactly the late enrolment, not the whole roster again.
    expect(s.repo.createRequests).toEqual([['lrn-late']]);
  });

  it('refuses publishing twice', async () => {
    const s = setup();
    const key = await publishedPlan(s);

    const again = await s.service.transition(CTX, key, 'PUBLISH');
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.error.code).toBe('instruction.already_published');
  });

  it('cancelling keeps existing obligations', async () => {
    const s = setup();
    const key = await publishedPlan(s);

    await s.service.transition(CTX, key, 'CANCEL');
    // A learner may already have done the work; deleting would make that
    // evidence unattributable.
    expect(s.repo.obligations.size).toBe(2);
  });

  it('refuses materialising an unpublished plan', async () => {
    const s = setup();
    const created = await s.service.createPlan(CTX, {
      title: 'X',
      activityType: 'LESSON',
      activityKey: LESSON,
      scope: SCOPE,
    });
    if (!created.ok) return;

    const m = await s.service.materialise(CTX, created.value.key);
    expect(m.ok).toBe(false);
    if (m.ok) return;
    expect(m.error.code).toBe('instruction.plan_not_published');
  });
});

describe('status is derived, never asserted', () => {
  const passing = () =>
    evaluateCompletion({
      requiresAssessment: true,
      attempted: true,
      assessmentPassed: true,
      contentConsumed: true,
      practiceDone: true,
      masteryAchieved: 0.95,
      minimumMastery: 0.85,
    });

  it('starts PENDING with no evidence', async () => {
    const s = setup();
    const key = await publishedPlan(s);
    const rows = await s.repo.obligationsForPlan(key);

    const refreshed = await s.service.refreshObligation(rows[0]!.key);
    expect(refreshed.ok && refreshed.value.status).toBe('PENDING');
  });

  it('becomes COMPLETED when the completion policy allows the next step', async () => {
    const s = setup();
    const key = await publishedPlan(s);
    s.completion.byLearner.set('lrn-a', { completion: passing(), started: true });

    const rows = await s.repo.obligationsForPlan(key);
    const a = rows.find((o) => o.learnerKey === 'lrn-a')!;

    const refreshed = await s.service.refreshObligation(a.key);
    expect(refreshed.ok && refreshed.value.status).toBe('COMPLETED');
  });

  it('reports the blocking gate rather than a score', async () => {
    const s = setup();
    const key = await publishedPlan(s);
    s.completion.byLearner.set('lrn-a', {
      completion: evaluateCompletion({
        requiresAssessment: true,
        attempted: true,
        assessmentPassed: true,
        contentConsumed: true,
        practiceDone: true,
        masteryAchieved: 0.3,
        minimumMastery: 0.85,
      }),
      started: true,
    });

    const rows = await s.repo.obligationsForPlan(key);
    const a = rows.find((o) => o.learnerKey === 'lrn-a')!;
    const refreshed = await s.service.refreshObligation(a.key);

    expect(refreshed.ok).toBe(true);
    if (!refreshed.ok) return;
    expect(refreshed.value.status).toBe('IN_PROGRESS');
    expect(refreshed.value.blockedByGate).toBe('MASTERY_BELOW_THRESHOLD');
    // The obligation stores no achievement of its own.
    expect(refreshed.value).not.toHaveProperty('masteryAchieved');
    expect(refreshed.value).not.toHaveProperty('score');
  });

  it('exposes no method that accepts an achievement value', () => {
    // The mirror of legacy's PATCH {masteryAchieved} must not exist.
    const methods = Object.getOwnPropertyNames(AssignmentService.prototype);
    expect(methods).not.toContain('markComplete');
    expect(methods).not.toContain('setMastery');
    expect(methods).not.toContain('markProgress');
    expect(methods).not.toContain('grade');
  });

  it('refreshes a whole plan for the teacher view', async () => {
    const s = setup();
    const key = await publishedPlan(s);
    s.completion.byLearner.set('lrn-a', { completion: passing(), started: true });

    const progress = await s.service.planProgress(CTX, key);
    expect(progress.ok).toBe(true);
    if (!progress.ok) return;
    expect(progress.value.progress).toMatchObject({ total: 2, completed: 1, pending: 1 });
    expect(progress.value.progress.completionRate).toBe(0.5);
  });

  it('lists a learner their own obligations', async () => {
    const s = setup();
    await publishedPlan(s);

    const list = await s.service.listForLearner('lrn-a');
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    expect(list.value).toHaveLength(1);
    expect(list.value[0]!.plan.title).toBe('Study sets');
  });
});

describe('waiving — the only asserted transition', () => {
  it('waives with a reason and records it', async () => {
    const s = setup();
    const key = await publishedPlan(s);
    const rows = await s.repo.obligationsForPlan(key);

    const waived = await s.service.waive(CTX, rows[0]!.key, 'Off sick all week');
    expect(waived.ok).toBe(true);
    if (!waived.ok) return;
    expect(waived.value.status).toBe('WAIVED');
    expect(waived.value.waiverReason).toBe('Off sick all week');
  });

  it('requires a reason', async () => {
    const s = setup();
    const key = await publishedPlan(s);
    const rows = await s.repo.obligationsForPlan(key);

    const waived = await s.service.waive(CTX, rows[0]!.key, '   ');
    expect(waived.ok).toBe(false);
    if (waived.ok) return;
    expect(waived.error.code).toBe('instruction.waiver_reason_required');
  });

  it('refuses to waive work already completed', async () => {
    const s = setup();
    const key = await publishedPlan(s);
    s.completion.byLearner.set('lrn-a', {
      completion: evaluateCompletion({
        requiresAssessment: true,
        attempted: true,
        assessmentPassed: true,
        contentConsumed: true,
        practiceDone: true,
        masteryAchieved: 0.95,
        minimumMastery: 0.85,
      }),
      started: true,
    });

    const rows = await s.repo.obligationsForPlan(key);
    const a = rows.find((o) => o.learnerKey === 'lrn-a')!;

    // Refused against the CURRENT verdict, not the stale PENDING row.
    const waived = await s.service.waive(CTX, a.key, 'sick');
    expect(waived.ok).toBe(false);
    if (waived.ok) return;
    expect(waived.error.code).toBe('instruction.cannot_waive_completed');
  });

  it('a waived obligation is not recomputed back out of WAIVED', async () => {
    const s = setup();
    const key = await publishedPlan(s);
    const rows = await s.repo.obligationsForPlan(key);
    await s.service.waive(CTX, rows[0]!.key, 'sick');

    const refreshed = await s.service.refreshObligation(rows[0]!.key);
    expect(refreshed.ok && refreshed.value.status).toBe('WAIVED');
  });

  it('refuses waiving in another school', async () => {
    const s = setup();
    const key = await publishedPlan(s);
    const rows = await s.repo.obligationsForPlan(key);

    const waived = await s.service.waive(
      { ...CTX, schoolIds: ['elsewhere'] },
      rows[0]!.key,
      'sick',
    );
    expect(waived.ok).toBe(false);
    if (waived.ok) return;
    expect(waived.error.code).toBe('instruction.school_out_of_scope');
  });
});

describe('reopening — undoing a human override', () => {
  const waivedRow = async (s: ReturnType<typeof setup>) => {
    const key = await publishedPlan(s);
    const rows = await s.repo.obligationsForPlan(key);
    const target = rows[0]!.key;
    const waived = await s.service.waive(CTX, target, 'Waived by mistake');
    expect(waived.ok).toBe(true);
    return target;
  };

  it('clears the waiver and returns to an evidence-derived status', async () => {
    const s = setup();
    const target = await waivedRow(s);

    const reopened = await s.service.reopen(CTX, target, 'Wrong learner');

    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    expect(reopened.value.status).not.toBe('WAIVED');
    expect(reopened.value.waiverReason).toBeNull();
    expect(reopened.value.waivedAt).toBeNull();
  });

  it('requires a reason, exactly as waiving does', async () => {
    const s = setup();
    const target = await waivedRow(s);

    const reopened = await s.service.reopen(CTX, target, '  ');

    expect(reopened.ok).toBe(false);
    if (reopened.ok) return;
    expect(reopened.error.code).toBe('instruction.reopen_reason_required');
  });

  it('refuses to reopen an obligation that was never waived', async () => {
    const s = setup();
    const key = await publishedPlan(s);
    const rows = await s.repo.obligationsForPlan(key);

    const reopened = await s.service.reopen(CTX, rows[0]!.key, 'Nothing to undo');

    expect(reopened.ok).toBe(false);
    if (reopened.ok) return;
    expect(reopened.error.code).toBe('instruction.not_waived');
  });

  it('can be waived again after reopening', async () => {
    const s = setup();
    const target = await waivedRow(s);
    await s.service.reopen(CTX, target, 'Undo');

    const again = await s.service.waive(CTX, target, 'Actually still absent');

    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.value.status).toBe('WAIVED');
  });

  it('records the reopen in the audit trail with the previous status', async () => {
    const s = setup();
    const target = await waivedRow(s);

    await s.service.reopen(CTX, target, 'Wrong learner');

    const entry = s.audit.entries.find((e) => e.action === 'instruction.obligation_reopened');
    expect(entry).toBeDefined();
    expect(entry?.targetKey).toBe(target);
    expect(entry?.details).toMatchObject({ reason: 'Wrong learner', previousStatus: 'WAIVED' });
  });

  it('refuses a teacher from another school', async () => {
    const s = setup();
    const target = await waivedRow(s);

    const reopened = await s.service.reopen(
      { ...CTX, schoolIds: ['some-other-school'] },
      target,
      'Not my school',
    );

    expect(reopened.ok).toBe(false);
  });

  it('asserts nothing about the work itself', async () => {
    const s = setup();
    const target = await waivedRow(s);

    const reopened = await s.service.reopen(CTX, target, 'Undo');

    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    // Reopening withdraws an assertion; it must not make a new one. With no
    // new evidence the learner is back to not-started, not completed.
    expect(reopened.value.status).toBe('PENDING');
    expect(reopened.value.completedAt ?? null).toBeNull();
  });
});
