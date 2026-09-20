/**
 * Due Work — outstanding and overdue obligations, as their own capability.
 *
 * Built as a separate flow on the owner's explicit instruction:
 *
 *   > Outstanding assignments must be handled by a separate assignment/task
 *   > management flow, not by modifying Learning.next-step. […] Keep
 *   > next-step purely pedagogical. Do not implement it as a hidden branch
 *   > inside next-step.
 *
 * So this file imports nothing from Learning's decision path and nothing here
 * is reachable from it. `next-step` still answers "what do you most need to
 * learn?" from mastery alone; this answers the different question "what is
 * owed, and what is late?". A learner can be up to date pedagogically and
 * behind administratively, and the platform must be able to say both.
 *
 * Two rules hold throughout, both from the owner's ruling:
 *
 *  1. **Lateness is never evidence.** Nothing here writes mastery, assessment
 *     evidence, prerequisite eligibility or an adaptive decision. Overdue work
 *     is an administrative fact, and inferring "does not understand it" from
 *     "did not do it" is exactly the conclusion the system must not invent.
 *  2. **Advisory work is separated, never counted.** PARENT- and SELF-origin
 *     obligations are tracked and shown but excluded from every academic
 *     figure — see `domain/assignment-authority.ts`.
 */

import { Errors } from '../../../shared/kernel/errors.js';
import { Err, Ok, type Result } from '../../../shared/kernel/result.js';
import type { Clock } from '../../../shared/kernel/clock.js';
import { partitionByAuthority } from '../domain/assignment-authority.js';
import type { AssignmentOrigin } from '../domain/plan.js';
import type { ObligationStatus } from '../domain/obligation.js';
import type { AssignmentService } from './assignment.service.js';

/** Beyond this many overdue academic items, staff are told. */
export const OVERDUE_ALERT_THRESHOLD = 3;

export interface DueWorkItem {
  readonly obligationKey: string;
  readonly planKey: string;
  readonly title: string;
  readonly activityType: string;
  readonly activityKey: string;
  readonly origin: AssignmentOrigin;
  readonly status: ObligationStatus;
  readonly dueAt: Date | null;
  readonly isOverdue: boolean;
  /** Whole days late; null when not overdue or when there is no due date. */
  readonly daysOverdue: number | null;
  /**
   * Whether this item counts academically.
   *
   * Surfaced on every row rather than left implicit, so a client cannot
   * accidentally total a list that mixes the two.
   */
  readonly countsTowardCompletion: boolean;
}

export interface DueWorkView {
  readonly learnerKey: string;
  /** Work that gates and counts: teacher, remedial, adaptive. */
  readonly academic: readonly DueWorkItem[];
  /** Tracked and visible, but with no academic consequence: parent, self. */
  readonly advisory: readonly DueWorkItem[];
  readonly summary: {
    readonly outstanding: number;
    readonly overdue: number;
    /** Overdue ACADEMIC items only — the number that may trigger an alert. */
    readonly overdueAcademic: number;
    readonly needsAttention: boolean;
  };
}

/** Statuses that still represent work owed. */
const OUTSTANDING: ReadonlySet<ObligationStatus> = new Set([
  'PENDING',
  'IN_PROGRESS',
  'EXPIRED',
]);

export class DueWorkService {
  constructor(
    private readonly assignments: AssignmentService,
    private readonly clock: Clock,
  ) {}

  /**
   * What this learner owes, split by authority.
   *
   * Statuses come from `AssignmentService`, which derives them from evidence at
   * read time — this service adds no status logic of its own, so there is no
   * second opinion about whether something is done.
   */
  async forLearner(learnerKey: string): Promise<Result<DueWorkView>> {
    const listed = await this.assignments.listForLearner(learnerKey);
    if (!listed.ok) return listed;

    const now = this.clock.now();
    const rows = listed.value.map(({ obligation, plan }) =>
      this.toItem(obligation, plan, now),
    );

    const outstanding = rows.filter((row) => OUTSTANDING.has(row.status));
    const { academic, advisory } = partitionByAuthority(outstanding);
    const overdueAcademic = academic.filter((row) => row.isOverdue).length;

    return Ok({
      learnerKey,
      // Most overdue first, then by due date: the list should open on what is
      // most urgent, not on whatever was created first.
      academic: this.sort(academic),
      advisory: this.sort(advisory),
      summary: {
        outstanding: outstanding.length,
        overdue: outstanding.filter((row) => row.isOverdue).length,
        overdueAcademic,
        // A flag, not a conclusion. It says "a human should look", never
        // "this learner has not understood the material".
        needsAttention: overdueAcademic >= OVERDUE_ALERT_THRESHOLD,
      },
    });
  }

  /**
   * Learners in a cohort who have accumulated overdue academic work.
   *
   * The alert the owner asked for: staff are told when overdue work piles up,
   * *without* the system inventing a mastery conclusion from it.
   */
  async overdueAlerts(input: {
    learnerKeys: readonly string[];
    threshold?: number;
  }): Promise<
    Result<{
      threshold: number;
      learners: readonly { learnerKey: string; overdueAcademic: number; items: readonly DueWorkItem[] }[];
    }>
  > {
    if (input.learnerKeys.length === 0) {
      return Err(Errors.notFound('instruction.empty_cohort', 'No learners in scope.'));
    }

    const threshold = input.threshold ?? OVERDUE_ALERT_THRESHOLD;
    const flagged: { learnerKey: string; overdueAcademic: number; items: DueWorkItem[] }[] = [];

    for (const learnerKey of input.learnerKeys) {
      const view = await this.forLearner(learnerKey);
      if (!view.ok) continue;

      const overdue = view.value.academic.filter((row) => row.isOverdue);
      if (overdue.length >= threshold) {
        flagged.push({ learnerKey, overdueAcademic: overdue.length, items: overdue });
      }
    }

    flagged.sort(
      (a, b) => b.overdueAcademic - a.overdueAcademic || a.learnerKey.localeCompare(b.learnerKey),
    );

    return Ok({ threshold, learners: flagged });
  }

  private toItem(
    obligation: {
      key: string;
      status: string;
      planKey?: string;
    },
    plan: {
      key: string;
      title: string;
      activityType: string;
      activityKey: string;
      origin: AssignmentOrigin;
      dueAt: Date | null;
    },
    now: Date,
  ): DueWorkItem {
    const status = obligation.status as ObligationStatus;
    const dueAt = plan.dueAt;
    const isOverdue =
      dueAt !== null && dueAt.getTime() < now.getTime() && OUTSTANDING.has(status);

    return {
      obligationKey: obligation.key,
      planKey: plan.key,
      title: plan.title,
      activityType: plan.activityType,
      activityKey: plan.activityKey,
      origin: plan.origin,
      status,
      dueAt,
      isOverdue,
      daysOverdue: isOverdue
        ? Math.floor((now.getTime() - dueAt!.getTime()) / 86_400_000)
        : null,
      countsTowardCompletion: partitionByAuthority([{ origin: plan.origin }]).academic.length > 0,
    };
  }

  private sort(items: readonly DueWorkItem[]): DueWorkItem[] {
    return [...items].sort((a, b) => {
      if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
      const aDue = a.dueAt?.getTime() ?? Number.POSITIVE_INFINITY;
      const bDue = b.dueAt?.getTime() ?? Number.POSITIVE_INFINITY;
      return aDue - bDue || a.obligationKey.localeCompare(b.obligationKey);
    });
  }
}
