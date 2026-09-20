/**
 * Parent-authored tasks — real, visible, and advisory only.
 *
 * The owner's ruling in full:
 *
 *   > Parent-authored assignments should exist as a real capability and may
 *   > appear in the learner's obligation/task feed […] but they must never gate
 *   > lesson/unit/path progression, count toward academic completion, alter
 *   > mastery, emit assessment evidence, or change prerequisite eligibility.
 *   > Only teacher/staff origin may participate in academic obligation and
 *   > completion policies. This must be enforced in the domain/application
 *   > layer, not merely hidden in the UI.
 *
 * This service is the parent's write surface, kept separate from
 * `AssignmentService` for one reason that matters: a parent is not a
 * small-scoped teacher. A teacher assigns to a *scope* (a school, a grade) and
 * holds a role grant; a parent assigns to *one verified child* and holds a
 * guardian link. Modelling the parent as an `InstructorContext` with a narrow
 * scope would have meant widening `INSTRUCTOR_ROLES`, and every future
 * teacher-only feature would then have had to remember to exclude parents.
 * Here, the only thing a parent can create is a PARENT-origin plan, and
 * `hasAcademicAuthority('PARENT')` is false everywhere it is consulted.
 *
 * What is deliberately absent: waiver, extension of someone else's work, any
 * write to mastery, and any path that could publish a TEACHER-origin plan.
 */

import { Errors } from '../../../shared/kernel/errors.js';
import { Err, Ok, type Result } from '../../../shared/kernel/result.js';
import type { Clock } from '../../../shared/kernel/clock.js';
import { stableKeyFingerprint } from '../../../shared/kernel/identifiers.js';
import { checkWindow, type InstructionalActivityType } from '../domain/plan.js';
import { hasAcademicAuthority } from '../domain/assignment-authority.js';
import { deriveStatus, type ObligationStatus } from '../domain/obligation.js';
import type { GuardianLinkReader } from '../../identity/application/ports.js';
import type {
  ActivityReader,
  ObligationRecord,
  PlanRecord,
  PlanRepository,
  RosterReader,
} from './ports.js';

export interface GuardianContext {
  /** The guardian's user id, as used by the verified-link reader. */
  readonly userId: string;
  readonly userKey: string;
}

export interface ParentTaskRecord {
  readonly plan: PlanRecord;
  readonly obligation: ObligationRecord;
  /** Always false. Present so clients never have to infer it. */
  readonly countsTowardCompletion: false;
}

export class ParentTaskService {
  constructor(
    private readonly repo: PlanRepository,
    private readonly guardianLinks: GuardianLinkReader,
    private readonly activities: ActivityReader,
    private readonly roster: RosterReader,
    private readonly clock: Clock,
  ) {}

  /**
   * Create an advisory task for one child.
   *
   * Published and materialised immediately: a parent has no draft workflow to
   * manage and no cohort to review before release. The single obligation is
   * created here rather than through the roster path, because the roster
   * resolves a *scope* and a parent's reach is one named child.
   */
  async create(
    ctx: GuardianContext,
    input: {
      learnerKey: string;
      title: string;
      instructions?: string | null;
      activityType: InstructionalActivityType;
      activityKey: string;
      availableAt?: Date | null;
      dueAt?: Date | null;
    },
  ): Promise<Result<ParentTaskRecord>> {
    // Guardianship is verified per request against the link table. An
    // unverified claim grants nothing, and a token is never trusted for this.
    const allowed = await this.guardianLinks.isVerifiedGuardianOf(ctx.userId, input.learnerKey);
    if (!allowed) {
      return Err(
        Errors.forbidden(
          'instruction.not_guardian',
          'You may only set tasks for a child you are a verified guardian of.',
        ),
      );
    }

    const window = checkWindow(input.availableAt ?? null, input.dueAt ?? null);
    if (window) {
      return Err(Errors.validation(window.code, window.reason, window.details));
    }

    const activity = await this.activities.describe(input.activityType, input.activityKey);
    if (!activity.exists) {
      return Err(
        Errors.notFound('instruction.activity_not_found', 'The assigned activity does not exist.', {
          activityType: input.activityType,
          activityKey: input.activityKey,
        }),
      );
    }

    // A plan carries a school scope; a parent's task inherits the child's own
    // school rather than letting the parent name one. There is no cross-school
    // reach to guard against because the parent never supplies the value.
    const schoolId = await this.roster.schoolOfLearner(input.learnerKey);
    if (!schoolId) {
      return Err(
        Errors.notFound(
          'instruction.learner_not_enrolled',
          'This learner is not currently enrolled, so a task cannot be scoped.',
          { learnerKey: input.learnerKey },
        ),
      );
    }

    const now = this.clock.now();
    const planKey = `PLAN-PARENT-${stableKeyFingerprint(
      `${ctx.userKey}:${input.learnerKey}:${input.title}:${input.activityKey}`,
    )}`;

    const existing = await this.repo.findPlan(planKey);
    if (existing) {
      // The same parent setting the same task on the same activity twice is a
      // double submit, not a second task.
      return Err(
        Errors.conflict(
          'instruction.parent_task_duplicate',
          'You have already set this task for this child.',
          { planKey },
        ),
      );
    }

    const plan = await this.repo.createPlan({
      key: planKey,
      title: input.title,
      instructions: input.instructions ?? null,
      // The whole point. Not a parameter — a parent cannot author any other
      // origin, so there is no input through which TEACHER could be requested.
      origin: 'PARENT',
      activityType: input.activityType,
      activityKey: input.activityKey,
      scope: { schoolId, gradeId: null, termId: null },
      targetLearnerKey: input.learnerKey,
      availableAt: input.availableAt ?? null,
      dueAt: input.dueAt ?? null,
      assignedByUserKey: ctx.userKey,
    });

    await this.repo.setPlanStatus(planKey, 'PUBLISHED', now);

    await this.repo.createObligations(planKey, [
      { learnerKey: input.learnerKey, key: `${planKey}-OB${stableKeyFingerprint(input.learnerKey)}` },
    ]);

    const obligations = await this.repo.obligationsForPlan(planKey);
    const obligation = obligations[0];
    if (!obligation) {
      return Err(
        Errors.conflict(
          'instruction.parent_task_not_materialised',
          'The task was created but no obligation was recorded.',
          { planKey },
        ),
      );
    }

    return Ok({
      plan: { ...plan, status: 'PUBLISHED' },
      obligation,
      countsTowardCompletion: false,
    });
  }

  /**
   * Cancel a task this parent set.
   *
   * Cancellation, not deletion: the child may already have seen it, and the
   * history of what was asked is worth keeping. A parent may only cancel their
   * own PARENT-origin plans — the origin check is what stops a crafted planKey
   * from reaching a teacher's work.
   */
  async cancel(ctx: GuardianContext, planKey: string): Promise<Result<{ planKey: string }>> {
    const plan = await this.repo.findPlan(planKey);
    if (!plan) {
      return Err(Errors.notFound('instruction.plan_not_found', 'No such task.', { planKey }));
    }

    if (plan.origin !== 'PARENT' || plan.assignedByKey !== ctx.userKey) {
      // Deliberately the same refusal for "not yours" and "not a parent task":
      // a parent probing keys learns nothing about what exists.
      return Err(
        Errors.forbidden(
          'instruction.not_task_author',
          'You may only cancel a task you set yourself.',
        ),
      );
    }

    await this.repo.setPlanStatus(planKey, 'CANCELLED');
    return Ok({ planKey });
  }

  /**
   * The parent's view of one child: what was asked, and what came of it.
   *
   * Reports academic work too — a parent is entitled to see school assignments
   * — but every row is labelled with whether it counts, and the summary counts
   * only academic work so a parent's own tasks cannot distort the picture they
   * are shown of their child's schoolwork.
   */
  async childTasks(
    ctx: GuardianContext,
    learnerKey: string,
  ): Promise<
    Result<{
      learnerKey: string;
      tasks: ReadonlyArray<{
        obligationKey: string;
        planKey: string;
        title: string;
        origin: string;
        status: ObligationStatus;
        dueAt: Date | null;
        setByThisParent: boolean;
        countsTowardCompletion: boolean;
      }>;
      academicSummary: { total: number; completed: number };
    }>
  > {
    const allowed = await this.guardianLinks.isVerifiedGuardianOf(ctx.userId, learnerKey);
    if (!allowed) {
      return Err(
        Errors.forbidden(
          'instruction.not_guardian',
          'You may only view a child you are a verified guardian of.',
        ),
      );
    }

    const rows = await this.repo.obligationsForLearner(learnerKey);
    const now = this.clock.now();

    const tasks = rows.map(({ plan, ...obligation }) => {
      // Status is derived here exactly as AssignmentService derives it, from
      // the row's own recorded facts — this read never asserts a status.
      const verdict = deriveStatus({
        waived: obligation.waivedAt !== null,
        started: obligation.startedAt !== null,
        completion: null,
        dueAt: plan.dueAt,
        now,
      });

      return {
        obligationKey: obligation.key,
        planKey: plan.key,
        title: plan.title,
        origin: plan.origin,
        status: (obligation.status as ObligationStatus) ?? verdict.status,
        dueAt: plan.dueAt,
        setByThisParent: plan.origin === 'PARENT' && plan.assignedByKey === ctx.userKey,
        countsTowardCompletion: hasAcademicAuthority(plan.origin),
      };
    });

    const academic = tasks.filter((t) => t.countsTowardCompletion);

    return Ok({
      learnerKey,
      tasks,
      academicSummary: {
        total: academic.length,
        completed: academic.filter((t) => t.status === 'COMPLETED').length,
      },
    });
  }
}
