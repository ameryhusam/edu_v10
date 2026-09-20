/**
 * Due Work: overdue derivation, advisory separation, and staff alerts.
 *
 * The service adds no status logic of its own — it reads statuses from
 * AssignmentService — so these tests focus on the three things it does decide:
 * what counts as overdue, which bucket an item lands in, and when a human is
 * told.
 */

import { describe, expect, it } from 'vitest';
import { DueWorkService, OVERDUE_ALERT_THRESHOLD } from '../../src/contexts/instruction/application/due-work.service.js';
import { Ok } from '../../src/shared/kernel/result.js';
import type { AssignmentService } from '../../src/contexts/instruction/application/assignment.service.js';

const NOW = new Date('2026-09-12T12:00:00.000Z');
const clock = { now: () => NOW };

const daysAgo = (n: number): Date => new Date(NOW.getTime() - n * 86_400_000);
const daysAhead = (n: number): Date => new Date(NOW.getTime() + n * 86_400_000);

interface Row {
  key: string;
  status: string;
  origin: string;
  dueAt: Date | null;
}

/** Minimal stand-in: Due Work only consumes listForLearner. */
function serviceWith(rows: Record<string, Row[]>): DueWorkService {
  const assignments = {
    listForLearner: async (learnerKey: string) =>
      Ok(
        (rows[learnerKey] ?? []).map((row) => ({
          obligation: { key: row.key, status: row.status },
          plan: {
            key: `PLAN-${row.key}`,
            title: `Task ${row.key}`,
            activityType: 'LESSON',
            activityKey: 'LESSON-1',
            origin: row.origin,
            dueAt: row.dueAt,
          },
        })),
      ),
  } as unknown as AssignmentService;

  return new DueWorkService(assignments, clock);
}

describe('DueWorkService.forLearner', () => {
  it('marks work past its due date as overdue and counts the days', () => {
    const service = serviceWith({
      L1: [{ key: 'o1', status: 'PENDING', origin: 'TEACHER', dueAt: daysAgo(3) }],
    });

    return service.forLearner('L1').then((result) => {
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const item = result.value.academic[0]!;
      expect(item.isOverdue).toBe(true);
      expect(item.daysOverdue).toBe(3);
    });
  });

  it('does not call future work overdue', async () => {
    const service = serviceWith({
      L1: [{ key: 'o1', status: 'PENDING', origin: 'TEACHER', dueAt: daysAhead(2) }],
    });

    const result = await service.forLearner('L1');
    expect(result.ok && result.value.academic[0]!.isOverdue).toBe(false);
    expect(result.ok && result.value.academic[0]!.daysOverdue).toBeNull();
  });

  it('treats work with no due date as outstanding but never overdue', async () => {
    const service = serviceWith({
      L1: [{ key: 'o1', status: 'PENDING', origin: 'TEACHER', dueAt: null }],
    });

    const result = await service.forLearner('L1');
    expect(result.ok && result.value.summary.outstanding).toBe(1);
    expect(result.ok && result.value.summary.overdue).toBe(0);
  });

  it('drops completed and waived work from the owed list', async () => {
    const service = serviceWith({
      L1: [
        { key: 'done', status: 'COMPLETED', origin: 'TEACHER', dueAt: daysAgo(9) },
        { key: 'excused', status: 'WAIVED', origin: 'TEACHER', dueAt: daysAgo(9) },
        { key: 'owed', status: 'PENDING', origin: 'TEACHER', dueAt: daysAgo(1) },
      ],
    });

    const result = await service.forLearner('L1');
    expect(result.ok && result.value.academic.map((i) => i.obligationKey)).toEqual(['owed']);
  });

  it('puts PARENT work in the advisory bucket, never the academic one', async () => {
    const service = serviceWith({
      L1: [
        { key: 'p1', status: 'PENDING', origin: 'PARENT', dueAt: daysAgo(4) },
        { key: 't1', status: 'PENDING', origin: 'TEACHER', dueAt: daysAgo(1) },
      ],
    });

    const result = await service.forLearner('L1');
    if (!result.ok) throw new Error('expected ok');

    expect(result.value.academic.map((i) => i.obligationKey)).toEqual(['t1']);
    expect(result.value.advisory.map((i) => i.obligationKey)).toEqual(['p1']);
    // Visible and overdue — it just carries no academic weight.
    expect(result.value.advisory[0]!.isOverdue).toBe(true);
    expect(result.value.advisory[0]!.countsTowardCompletion).toBe(false);
  });

  it('excludes overdue PARENT work from the figure that triggers alerts', async () => {
    const service = serviceWith({
      L1: Array.from({ length: 6 }, (_, i) => ({
        key: `p${i}`,
        status: 'PENDING',
        origin: 'PARENT',
        dueAt: daysAgo(5),
      })),
    });

    const result = await service.forLearner('L1');
    if (!result.ok) throw new Error('expected ok');

    expect(result.value.summary.overdue).toBe(6);
    expect(result.value.summary.overdueAcademic).toBe(0);
    // Six missed parent chores must not raise an academic flag.
    expect(result.value.summary.needsAttention).toBe(false);
  });

  it('flags attention once overdue ACADEMIC work crosses the threshold', async () => {
    const service = serviceWith({
      L1: Array.from({ length: OVERDUE_ALERT_THRESHOLD }, (_, i) => ({
        key: `t${i}`,
        status: 'PENDING',
        origin: 'TEACHER',
        dueAt: daysAgo(2),
      })),
    });

    const result = await service.forLearner('L1');
    expect(result.ok && result.value.summary.needsAttention).toBe(true);
  });

  it('orders overdue work first, then by due date', async () => {
    const service = serviceWith({
      L1: [
        { key: 'later', status: 'PENDING', origin: 'TEACHER', dueAt: daysAhead(5) },
        { key: 'soon', status: 'PENDING', origin: 'TEACHER', dueAt: daysAhead(1) },
        { key: 'late', status: 'PENDING', origin: 'TEACHER', dueAt: daysAgo(1) },
      ],
    });

    const result = await service.forLearner('L1');
    expect(result.ok && result.value.academic.map((i) => i.obligationKey)).toEqual([
      'late',
      'soon',
      'later',
    ]);
  });

  it('returns empty buckets for a learner who owes nothing', async () => {
    const service = serviceWith({ L1: [] });
    const result = await service.forLearner('L1');

    expect(result.ok && result.value.summary.outstanding).toBe(0);
    expect(result.ok && result.value.summary.needsAttention).toBe(false);
  });
});

describe('DueWorkService.overdueAlerts', () => {
  it('reports only learners at or above the threshold, worst first', async () => {
    const overdueRows = (n: number, origin = 'TEACHER'): Row[] =>
      Array.from({ length: n }, (_, i) => ({
        key: `o${i}`,
        status: 'PENDING',
        origin,
        dueAt: daysAgo(2),
      }));

    const service = serviceWith({
      A: overdueRows(2),
      B: overdueRows(5),
      C: overdueRows(3),
      D: overdueRows(9, 'PARENT'),
    });

    const result = await service.overdueAlerts({ learnerKeys: ['A', 'B', 'C', 'D'] });
    if (!result.ok) throw new Error('expected ok');

    // A is below threshold; D's nine overdue items are all advisory.
    expect(result.value.learners.map((l) => l.learnerKey)).toEqual(['B', 'C']);
    expect(result.value.learners[0]!.overdueAcademic).toBe(5);
  });

  it('honours a caller-supplied threshold', async () => {
    const service = serviceWith({
      A: [{ key: 'o1', status: 'PENDING', origin: 'TEACHER', dueAt: daysAgo(1) }],
    });

    const result = await service.overdueAlerts({ learnerKeys: ['A'], threshold: 1 });
    expect(result.ok && result.value.learners).toHaveLength(1);
  });

  it('refuses an empty cohort rather than reporting a silent all-clear', async () => {
    const service = serviceWith({});
    const result = await service.overdueAlerts({ learnerKeys: [] });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('instruction.empty_cohort');
  });
});
