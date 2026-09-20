/**
 * Assignments — author a plan, publish it, track it.
 *
 * Orchestration only. Scope rules, lifecycle and status derivation all live in
 * `domain/`; completion is read from Learning's policy and never recomputed
 * here. The service's job is to load the right facts in the right order and
 * refuse before writing.
 *
 * The five non-ownerships from the gate hold structurally: there is no method
 * that takes a score, a mastery value, a recommendation or an XP award, and
 * none that reads question content.
 */

import { Errors } from '../../../shared/kernel/errors.js';
import { Err, Ok, type Result } from '../../../shared/kernel/result.js';
import type { Clock } from '../../../shared/kernel/clock.js';
import { normalizeSlug, stableKeyFingerprint } from '../../../shared/kernel/identifiers.js';
import {
  checkReopenable,
  checkWaivable,
  deriveStatus,
  summarisePlan,
  type ObligationStatus,
  type PlanProgress,
} from '../domain/obligation.js';
import {
  checkActivityInScope,
  checkPlanTransition,
  checkWindow,
  isPlanEditable,
  planMaterialisation,
  type AssignmentOrigin,
  type InstructionalActivityType,
  type PlanAction,
  type PlanScope,
} from '../domain/plan.js';
import { hasAcademicAuthority } from '../domain/assignment-authority.js';
import type {
  ActivityReader,
  CompletionReader,
  ObligationRecord,
  PlanRecord,
  PlanRepository,
  RosterReader,
} from './ports.js';

export interface InstructorContext {
  /** For provenance and the audit trail. */
  readonly actorKey: string;
  /** Schools the actor may act in. Empty means platform-wide (admin). */
  readonly schoolIds: readonly string[];
  readonly isPlatformAdmin: boolean;
}

export interface AuditWriter {
  record(entry: {
    actorKey: string;
    action: string;
    targetKey: string;
    details?: Readonly<Record<string, unknown>>;
  }): Promise<void>;
}

export class AssignmentService {
  constructor(
    private readonly repo: PlanRepository,
    private readonly roster: RosterReader,
    private readonly activities: ActivityReader,
    private readonly completion: CompletionReader,
    private readonly clock: Clock,
    private readonly audit?: AuditWriter,
  ) {}

  // ── Authoring ─────────────────────────────────────────────────────────────

  async createPlan(
    ctx: InstructorContext,
    input: {
      title: string;
      instructions?: string | null;
      origin?: AssignmentOrigin;
      activityType: InstructionalActivityType;
      activityKey: string;
      scope: PlanScope;
      targetLearnerKey?: string | null;
      availableAt?: Date | null;
      dueAt?: Date | null;
    },
  ): Promise<Result<PlanRecord>> {
    const targetLearnerKey = input.targetLearnerKey?.trim() || null;
    let scope = input.scope;
    if (targetLearnerKey) {
      const enrollment = await this.roster.currentEnrollmentOfLearner(targetLearnerKey);
      if (!enrollment) {
        return Err(
          Errors.notFound('instruction.learner_not_enrolled', 'The learner has no current enrollment.', {
            learnerKey: targetLearnerKey,
          }),
        );
      }
      if (input.scope.schoolId !== enrollment.schoolId) {
        return Err(
          Errors.validation(
            'instruction.learner_outside_scope',
            'The selected learner is not enrolled in the requested school scope.',
            { learnerKey: targetLearnerKey, schoolId: input.scope.schoolId },
          ),
        );
      }
      if (input.scope.gradeId && enrollment.gradeId && input.scope.gradeId !== enrollment.gradeId) {
        return Err(
          Errors.validation(
            'instruction.learner_grade_outside_scope',
            'The selected learner is not enrolled in the requested grade scope.',
            { learnerKey: targetLearnerKey, gradeId: input.scope.gradeId },
          ),
        );
      }
      if (input.scope.termId && enrollment.termId && input.scope.termId !== enrollment.termId) {
        return Err(
          Errors.validation(
            'instruction.learner_term_outside_scope',
            'The selected learner is not enrolled in the requested term scope.',
            { learnerKey: targetLearnerKey, termId: input.scope.termId },
          ),
        );
      }
      scope = {
        schoolId: enrollment.schoolId,
        gradeId: input.scope.gradeId ?? enrollment.gradeId,
        termId: input.scope.termId ?? enrollment.termId,
      };
    }

    // A teacher at school A must not assign to learners at school B (R2).
    const scoped = this.assertSchoolAllowed(ctx, scope.schoolId);
    if (!scoped.ok) return scoped;

    const window = checkWindow(input.availableAt ?? null, input.dueAt ?? null);
    if (window) return refuse(window);

    const activity = await this.activities.describe(input.activityType, input.activityKey);
    if (!activity.exists) {
      return Err(
        Errors.notFound('instruction.activity_not_found', 'The assigned activity does not exist.', {
          activityType: input.activityType,
          activityKey: input.activityKey,
        }),
      );
    }

    // LD-2: a named refusal before any write.
    const outOfScope = checkActivityInScope({
      activityType: input.activityType,
      activityKey: input.activityKey,
      activityGradeId: activity.gradeId,
      scope,
    });
    if (outOfScope) return refuse(outOfScope);

    const key = this.planKey(input.title, input.activityKey);
    const plan = await this.repo.createPlan({
      key,
      title: input.title,
      instructions: input.instructions ?? null,
      origin: input.origin ?? 'TEACHER',
      activityType: input.activityType,
      activityKey: input.activityKey,
      scope,
      targetLearnerKey,
      availableAt: input.availableAt ?? null,
      dueAt: input.dueAt ?? null,
      assignedByUserKey: ctx.actorKey,
    });

    await this.log(ctx, 'instruction.plan_created', key, { activityKey: input.activityKey });
    return Ok(plan);
  }

  /** Only a draft may be edited: learners have not been told about it yet. */
  async updatePlan(
    ctx: InstructorContext,
    planKey: string,
    patch: { title?: string; instructions?: string | null; availableAt?: Date | null; dueAt?: Date | null },
  ): Promise<Result<PlanRecord>> {
    const plan = await this.repo.findPlan(planKey);
    if (!plan) return planNotFound(planKey);

    const scoped = this.assertSchoolAllowed(ctx, plan.scope.schoolId);
    if (!scoped.ok) return scoped;

    if (!isPlanEditable(plan.status)) {
      return Err(
        Errors.conflict(
          'instruction.plan_not_editable',
          `A ${plan.status.toLowerCase()} plan cannot be edited. Cancel it and create a new one.`,
          { planKey, status: plan.status },
        ),
      );
    }

    const availableAt = patch.availableAt !== undefined ? patch.availableAt : plan.availableAt;
    const dueAt = patch.dueAt !== undefined ? patch.dueAt : plan.dueAt;
    const window = checkWindow(availableAt, dueAt);
    if (window) return refuse(window);

    await this.repo.updatePlan(planKey, patch as Record<string, unknown>);
    await this.log(ctx, 'instruction.plan_updated', planKey, { fields: Object.keys(patch) });

    const updated = await this.repo.findPlan(planKey);
    return updated ? Ok(updated) : planNotFound(planKey);
  }

  // ── Publish / materialise ─────────────────────────────────────────────────

  /**
   * Publish a plan and create one obligation per learner in scope.
   *
   * Idempotent: re-running after a late enrolment adds exactly the missing
   * learner. That is why `materialise` is callable separately below.
   */
  async transition(
    ctx: InstructorContext,
    planKey: string,
    action: PlanAction,
  ): Promise<Result<{ planKey: string; status: string; obligationsCreated: number }>> {
    const plan = await this.repo.findPlan(planKey);
    if (!plan) return planNotFound(planKey);

    const scoped = this.assertSchoolAllowed(ctx, plan.scope.schoolId);
    if (!scoped.ok) return scoped;

    const outcome = checkPlanTransition(plan.status, action);
    if (!outcome.allowed) {
      return Err(Errors.conflict(outcome.code, outcome.reason, { planKey, from: plan.status }));
    }

    let created = 0;
    if (outcome.materialises) {
      const result = await this.materialiseInto(plan);
      if (!result.ok) return result;
      created = result.value;
    }

    await this.repo.setPlanStatus(
      planKey,
      outcome.to,
      outcome.materialises ? this.clock.now() : undefined,
    );
    await this.log(ctx, `instruction.plan_${action.toLowerCase()}`, planKey, { created });

    return Ok({ planKey, status: outcome.to, obligationsCreated: created });
  }

  /**
   * Re-run materialisation for an already-published plan.
   *
   * The late-enrolment case: a learner who joins the cohort after publication
   * has no obligation, and legacy had no answer for it at all.
   */
  async materialise(
    ctx: InstructorContext,
    planKey: string,
  ): Promise<Result<{ planKey: string; obligationsCreated: number }>> {
    const plan = await this.repo.findPlan(planKey);
    if (!plan) return planNotFound(planKey);

    const scoped = this.assertSchoolAllowed(ctx, plan.scope.schoolId);
    if (!scoped.ok) return scoped;

    if (plan.status !== 'PUBLISHED') {
      return Err(
        Errors.conflict(
          'instruction.plan_not_published',
          'Only a published plan has obligations to materialise.',
          { planKey, status: plan.status },
        ),
      );
    }

    const created = await this.materialiseInto(plan);
    if (!created.ok) return created;

    await this.log(ctx, 'instruction.plan_materialised', planKey, { created: created.value });
    return Ok({ planKey, obligationsCreated: created.value });
  }

  private async materialiseInto(plan: PlanRecord): Promise<Result<number>> {
    const rosterKeys = plan.targetLearnerKey
      ? [plan.targetLearnerKey]
      : await this.roster.learnersInScope(plan.scope);
    const existing = await this.repo.obligationLearnerKeys(plan.key);
    const { toCreate } = planMaterialisation(rosterKeys, existing);

    if (toCreate.length === 0) return Ok(0);

    const entries = toCreate.map((learnerKey) => ({
      learnerKey,
      key: `${plan.key}-OB${stableKeyFingerprint(learnerKey)}`,
    }));

    const created = await this.repo.createObligations(plan.key, entries);
    return Ok(created);
  }

  // ── Status ────────────────────────────────────────────────────────────────

  /**
   * Recompute one obligation's status from canonical evidence.
   *
   * Nothing is asserted: the completion verdict comes from Learning, and this
   * only translates it into a commitment status.
   */
  async refreshObligation(obligationKey: string): Promise<Result<ObligationRecord>> {
    const obligation = await this.repo.findObligation(obligationKey);
    if (!obligation) return obligationNotFound(obligationKey);

    const plan = await this.repo.findPlan(obligation.planKey);
    if (!plan) return planNotFound(obligation.planKey);

    const refreshed = await this.recompute(obligation, plan);
    return Ok(refreshed);
  }

  private async recompute(
    obligation: ObligationRecord,
    plan: PlanRecord,
  ): Promise<ObligationRecord> {
    // A waived obligation is a human's decision; recomputing it would undo them.
    if (obligation.status === 'WAIVED') return obligation;

    const { completion, started } = await this.completion.evaluate(
      obligation.learnerKey,
      plan.activityType,
      plan.activityKey,
    );

    const now = this.clock.now();
    const verdict = deriveStatus({
      waived: false,
      started: started || obligation.startedAt != null,
      completion,
      dueAt: plan.dueAt,
      now,
    });

    if (
      verdict.status === obligation.status &&
      verdict.blockedByGate === obligation.blockedByGate
    ) {
      return obligation;
    }

    await this.repo.updateObligationStatus(obligation.key, {
      status: verdict.status,
      blockedByGate: verdict.blockedByGate,
      evaluatedAt: now,
      ...(verdict.status !== 'PENDING' && obligation.startedAt == null ? { startedAt: now } : {}),
      ...(verdict.status === 'COMPLETED' && obligation.completedAt == null
        ? { completedAt: now }
        : {}),
    });

    return {
      ...obligation,
      status: verdict.status,
      blockedByGate: verdict.blockedByGate,
    };
  }

  /** A learner's own list, with each status refreshed against live evidence. */
  async listForLearner(
    learnerKey: string,
  ): Promise<Result<Array<{ obligation: ObligationRecord; plan: PlanRecord }>>> {
    const rows = await this.repo.obligationsForLearner(learnerKey);

    const refreshed = await Promise.all(
      rows.map(async ({ plan, ...obligation }) => ({
        plan,
        obligation: await this.recompute(obligation as ObligationRecord, plan),
      })),
    );

    return Ok(refreshed);
  }

  /** The teacher's "how is this cohort doing?" view. */
  async planProgress(
    ctx: InstructorContext,
    planKey: string,
  ): Promise<
    Result<{
      plan: PlanRecord;
      progress: PlanProgress;
      /** False for PARENT/SELF plans: tracked and shown, never counted. */
      countsTowardCompletion: boolean;
      obligations: readonly ObligationRecord[];
    }>
  > {
    const plan = await this.repo.findPlan(planKey);
    if (!plan) return planNotFound(planKey);

    const scoped = this.assertSchoolAllowed(ctx, plan.scope.schoolId);
    if (!scoped.ok) return scoped;

    const obligations = await this.repo.obligationsForPlan(planKey);
    const refreshed = await Promise.all(obligations.map((o) => this.recompute(o, plan)));

    // A plan has ONE origin, so the whole plan is either academic or advisory.
    // An advisory plan still reports who did what — a parent must be able to
    // see that — but its completion rate is not an academic figure and is
    // labelled as such rather than silently blended into school reporting.
    const countsTowardCompletion = hasAcademicAuthority(plan.origin);

    return Ok({
      plan,
      progress: summarisePlan(refreshed.map((o) => o.status as ObligationStatus)),
      countsTowardCompletion,
      obligations: refreshed,
    });
  }

  // ── The one asserted transition ───────────────────────────────────────────

  /**
   * Excuse a learner. The only human-asserted status, and it is audited.
   *
   * Note what this method does NOT have: a sibling that marks an obligation
   * complete. Completion is earned, never granted.
   */
  async waive(
    ctx: InstructorContext,
    obligationKey: string,
    reason: string,
  ): Promise<Result<ObligationRecord>> {
    if (!reason.trim()) {
      return Err(
        Errors.validation('instruction.waiver_reason_required', 'A waiver must say why.', {
          obligationKey,
        }),
      );
    }

    const obligation = await this.repo.findObligation(obligationKey);
    if (!obligation) return obligationNotFound(obligationKey);

    const plan = await this.repo.findPlan(obligation.planKey);
    if (!plan) return planNotFound(obligation.planKey);

    const scoped = this.assertSchoolAllowed(ctx, plan.scope.schoolId);
    if (!scoped.ok) return scoped;

    // Refresh first: waiving work the learner has already finished should be
    // refused on the CURRENT verdict, not a stale row.
    const current = await this.recompute(obligation, plan);

    const allowed = checkWaivable(current.status as ObligationStatus);
    if (!allowed.ok) {
      return Err(Errors.conflict(allowed.code, allowed.reason, { obligationKey }));
    }

    const now = this.clock.now();
    await this.repo.waiveObligation(obligationKey, {
      waivedByUserKey: ctx.actorKey,
      waivedAt: now,
      reason,
    });
    await this.log(ctx, 'instruction.obligation_waived', obligationKey, {
      reason,
      previousStatus: current.status,
    });

    return Ok({ ...current, status: 'WAIVED', waivedAt: now, waiverReason: reason });
  }

  /**
   * Undo a waiver.
   *
   * The audited gap: `recompute()` skips waived rows so a human decision is
   * never silently reverted by a background pass, which is correct — but it
   * also means a mistaken waiver is permanent, and a teacher who excuses the
   * wrong learner has no remedy. This is that remedy, and the ONLY exit from
   * WAIVED.
   *
   * It asserts nothing. The waiver is cleared and the status is immediately
   * recomputed from evidence, so reopening cannot mark work done, cannot
   * un-complete finished work, and writes no mastery. A reason is required for
   * the same purpose as on the waiver: the audit trail has to explain both
   * directions of a human override.
   */
  async reopen(
    ctx: InstructorContext,
    obligationKey: string,
    reason: string,
  ): Promise<Result<ObligationRecord>> {
    if (!reason.trim()) {
      return Err(
        Errors.validation('instruction.reopen_reason_required', 'Reopening must say why.', {
          obligationKey,
        }),
      );
    }

    const obligation = await this.repo.findObligation(obligationKey);
    if (!obligation) return obligationNotFound(obligationKey);

    const plan = await this.repo.findPlan(obligation.planKey);
    if (!plan) return planNotFound(obligation.planKey);

    const scoped = this.assertSchoolAllowed(ctx, plan.scope.schoolId);
    if (!scoped.ok) return scoped;

    // Read the stored row, NOT a recompute: recompute() returns waived rows
    // untouched, so it cannot tell us anything new here, and the stored status
    // is the human decision we are withdrawing.
    const allowed = checkReopenable(obligation.status as ObligationStatus);
    if (!allowed.ok) {
      return Err(Errors.conflict(allowed.code, allowed.reason, { obligationKey }));
    }

    await this.repo.reopenObligation(obligationKey);
    await this.log(ctx, 'instruction.obligation_reopened', obligationKey, {
      reason,
      previousStatus: obligation.status,
    });

    // Now that the waiver is gone, derive the real standing from evidence.
    const cleared: ObligationRecord = {
      ...obligation,
      status: 'PENDING',
      waivedAt: null,
      waiverReason: null,
    };
    return Ok(await this.recompute(cleared, plan));
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private assertSchoolAllowed(ctx: InstructorContext, schoolId: string): Result<void> {
    if (ctx.isPlatformAdmin) return Ok(undefined);
    if (ctx.schoolIds.includes(schoolId)) return Ok(undefined);
    return Err(
      Errors.forbidden(
        'instruction.school_out_of_scope',
        'You may not assign work in this school.',
        { schoolId },
      ),
    );
  }

  /**
   * A plan key that is stable per (title, activity) but never collides across
   * repeated assignments of the same lesson: the clock disambiguates, because
   * assigning the same lesson twice in a term is legitimate.
   */
  private planKey(title: string, activityKey: string): string {
    const slug = normalizeSlug(title);
    const label = slug.ok ? slug.value.slice(0, 16) : 'PLAN';
    const fingerprint = stableKeyFingerprint(`${activityKey}:${this.clock.now().toISOString()}`);
    return `PLAN-${label}-${fingerprint}`;
  }

  private async log(
    ctx: InstructorContext,
    action: string,
    targetKey: string,
    details?: Record<string, unknown>,
  ): Promise<void> {
    if (!this.audit) return;
    try {
      await this.audit.record({
        actorKey: ctx.actorKey,
        action,
        targetKey,
        ...(details ? { details } : {}),
      });
    } catch {
      // Best-effort: a lost audit line must not fail a teacher's assignment.
    }
  }
}

function refuse(r: { code: string; reason: string; details?: Readonly<Record<string, unknown>> }): Result<never> {
  return Err(Errors.validation(r.code, r.reason, r.details as Record<string, unknown> | undefined));
}

function planNotFound(planKey: string): Result<never> {
  return Err(Errors.notFound('instruction.plan_not_found', 'No plan with this key.', { planKey }));
}

function obligationNotFound(key: string): Result<never> {
  return Err(
    Errors.notFound('instruction.obligation_not_found', 'No obligation with this key.', { key }),
  );
}
