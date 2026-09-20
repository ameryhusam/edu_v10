/**
 * Obligation status and plan rules.
 *
 * The rule under test throughout: an obligation reflects a verdict it did not
 * compute. Nothing here accepts a score, and `deriveStatus` cannot be told a
 * mastery number — it can only be shown a CompletionResult.
 */

import { describe, expect, it } from 'vitest';
import {
  OBLIGATION_STATUSES,
  checkReopenable,
  checkWaivable,
  deriveStatus,
  isAssertableStatus,
  isObligationStatus,
  summarisePlan,
  type ObligationStatus,
} from '../../src/contexts/instruction/domain/obligation.js';
import {
  checkActivityInScope,
  checkPlanTransition,
  checkWindow,
  isPlanEditable,
  planMaterialisation,
  PLAN_STATUSES,
  PLAN_ACTIONS,
  type PlanStatus,
  type PlanAction,
} from '../../src/contexts/instruction/domain/plan.js';
import { evaluateCompletion } from '../../src/contexts/learning/domain/completion-policy.js';

const NOW = new Date('2026-09-11T12:00:00Z');
const YESTERDAY = new Date('2026-09-10T12:00:00Z');
const TOMORROW = new Date('2026-09-12T12:00:00Z');

/** A real completion verdict, never a hand-made object. */
const passed = () =>
  evaluateCompletion({
    requiresAssessment: true,
    attempted: true,
    assessmentPassed: true,
    contentConsumed: true,
    practiceDone: true,
    masteryAchieved: 0.9,
    minimumMastery: 0.85,
  });

const blockedOnMastery = () =>
  evaluateCompletion({
    requiresAssessment: true,
    attempted: true,
    assessmentPassed: true,
    contentConsumed: true,
    practiceDone: true,
    masteryAchieved: 0.4,
    minimumMastery: 0.85,
  });

const notAttempted = () =>
  evaluateCompletion({
    requiresAssessment: true,
    attempted: false,
    minimumMastery: 0.85,
  });

const base = {
  waived: false,
  started: false,
  completion: null,
  dueAt: null,
  now: NOW,
};

describe('deriving obligation status', () => {
  it('is PENDING before anything happens', () => {
    expect(deriveStatus(base).status).toBe('PENDING');
  });

  it('is IN_PROGRESS once the learner starts', () => {
    const v = deriveStatus({ ...base, started: true, completion: notAttempted() });
    expect(v.status).toBe('IN_PROGRESS');
  });

  it('is COMPLETED when the completion policy allows the next step', () => {
    const v = deriveStatus({ ...base, started: true, completion: passed() });
    expect(v.status).toBe('COMPLETED');
    expect(v.blockedByGate).toBeNull();
  });

  it('is EXPIRED when the deadline passed with work unfinished', () => {
    const v = deriveStatus({ ...base, started: true, completion: notAttempted(), dueAt: YESTERDAY });
    expect(v.status).toBe('EXPIRED');
  });

  it('keeps COMPLETED after the deadline — finished work does not expire', () => {
    // Checking the clock before completion would silently expire work the
    // learner actually finished on time.
    const v = deriveStatus({ ...base, started: true, completion: passed(), dueAt: YESTERDAY });
    expect(v.status).toBe('COMPLETED');
  });

  it('is not expired before the deadline', () => {
    const v = deriveStatus({ ...base, started: true, completion: notAttempted(), dueAt: TOMORROW });
    expect(v.status).toBe('IN_PROGRESS');
  });

  it('WAIVED overrides everything, including an expired deadline', () => {
    const v = deriveStatus({ ...base, waived: true, dueAt: YESTERDAY, completion: notAttempted() });
    expect(v.status).toBe('WAIVED');
  });

  it('surfaces the blocking gate for explainability', () => {
    const v = deriveStatus({ ...base, started: true, completion: blockedOnMastery() });

    expect(v.blockedByGate).toBe('MASTERY_BELOW_THRESHOLD');
    // A teacher must not be shown a bare enum.
    expect(v.rationale).toMatch(/support, not repetition/);
  });

  it('reports no gate when nothing blocks', () => {
    expect(deriveStatus({ ...base, started: true, completion: passed() }).blockedByGate).toBeNull();
  });

  it('always produces a rationale', () => {
    for (const started of [true, false]) {
      for (const completion of [null, passed(), blockedOnMastery(), notAttempted()]) {
        const v = deriveStatus({ ...base, started, completion });
        expect(v.rationale.length).toBeGreaterThan(10);
      }
    }
  });
});

describe('what a human may assert', () => {
  it('permits exactly one status', () => {
    const assertable = OBLIGATION_STATUSES.filter(isAssertableStatus);
    expect(assertable).toEqual(['WAIVED']);
  });

  it('refuses waiving completed work', () => {
    // "Excusing" finished work would erase a real achievement.
    const outcome = checkWaivable('COMPLETED');
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('instruction.cannot_waive_completed');
  });

  it('refuses waiving twice', () => {
    const outcome = checkWaivable('WAIVED');
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('instruction.already_waived');
  });

  it('permits waiving work that is pending, started or overdue', () => {
    for (const s of ['PENDING', 'IN_PROGRESS', 'EXPIRED'] as ObligationStatus[]) {
      expect(checkWaivable(s).ok).toBe(true);
    }
  });

  it('validates status names', () => {
    expect(isObligationStatus('COMPLETED')).toBe(true);
    expect(isObligationStatus('GRADED')).toBe(false);
  });
});

describe('plan lifecycle — exhaustive over all 6 state × action pairs', () => {
  const ALLOWED: Array<[PlanStatus, PlanAction, PlanStatus]> = [
    ['DRAFT', 'PUBLISH', 'PUBLISHED'],
    ['DRAFT', 'CANCEL', 'CANCELLED'],
    ['PUBLISHED', 'CANCEL', 'CANCELLED'],
  ];

  for (const from of PLAN_STATUSES) {
    for (const action of PLAN_ACTIONS) {
      const expected = ALLOWED.find(([f, a]) => f === from && a === action);
      it(`${from} + ${action} → ${expected ? expected[2] : 'REFUSED'}`, () => {
        const outcome = checkPlanTransition(from, action);
        if (expected) {
          expect(outcome.allowed).toBe(true);
          if (!outcome.allowed) return;
          expect(outcome.to).toBe(expected[2]);
        } else {
          expect(outcome.allowed).toBe(false);
          if (outcome.allowed) return;
          expect(outcome.code).toMatch(/^instruction\./);
        }
      });
    }
  }

  it('materialises obligations only on publish', () => {
    const publish = checkPlanTransition('DRAFT', 'PUBLISH');
    const cancel = checkPlanTransition('PUBLISHED', 'CANCEL');
    expect(publish.allowed && publish.materialises).toBe(true);
    expect(cancel.allowed && cancel.materialises).toBe(false);
  });

  it('has no un-publish', () => {
    // Reverting to DRAFT would make an assignment vanish from a learner's
    // list with no record it existed. Withdrawing is CANCEL.
    const reachDraft = PLAN_STATUSES.flatMap((f) =>
      PLAN_ACTIONS.map((a) => checkPlanTransition(f, a)),
    ).filter((o) => o.allowed && o.to === 'DRAFT');
    expect(reachDraft).toHaveLength(0);
  });

  it('only a draft is editable', () => {
    expect(isPlanEditable('DRAFT')).toBe(true);
    expect(isPlanEditable('PUBLISHED')).toBe(false);
    expect(isPlanEditable('CANCELLED')).toBe(false);
  });
});

describe('activity scope (legacy rule LD-2)', () => {
  const scope = { schoolId: 'sch1', gradeId: 'g7', termId: 't1' };

  it('accepts an activity in the target grade', () => {
    expect(
      checkActivityInScope({
        activityType: 'LESSON',
        activityKey: 'K',
        activityGradeId: 'g7',
        scope,
      }),
    ).toBeNull();
  });

  it('refuses an activity from another grade, by name, before any write', () => {
    const refusal = checkActivityInScope({
      activityType: 'LESSON',
      activityKey: 'K',
      activityGradeId: 'g8',
      scope,
    });

    expect(refusal?.code).toBe('instruction.activity_out_of_scope');
    expect(refusal?.details).toMatchObject({ activityGradeId: 'g8', scopeGradeId: 'g7' });
  });

  it('accepts any grade when the plan targets the whole school', () => {
    expect(
      checkActivityInScope({
        activityType: 'EXAM',
        activityKey: 'K',
        activityGradeId: 'g9',
        scope: { schoolId: 'sch1', gradeId: null, termId: null },
      }),
    ).toBeNull();
  });

  it('requires an activity key', () => {
    const refusal = checkActivityInScope({
      activityType: 'LESSON',
      activityKey: '   ',
      activityGradeId: 'g7',
      scope,
    });
    expect(refusal?.code).toBe('instruction.activity_key_required');
  });
});

describe('assignment window', () => {
  it('accepts a normal window', () => {
    expect(checkWindow(YESTERDAY, TOMORROW)).toBeNull();
  });

  it('accepts open-ended windows', () => {
    expect(checkWindow(null, null)).toBeNull();
    expect(checkWindow(null, TOMORROW)).toBeNull();
    expect(checkWindow(YESTERDAY, null)).toBeNull();
  });

  it('refuses a due date before release', () => {
    // Otherwise the obligation is overdue the moment it appears.
    expect(checkWindow(TOMORROW, YESTERDAY)?.code).toBe('instruction.window_inverted');
  });
});

describe('materialisation', () => {
  it('creates one obligation per roster learner', () => {
    const m = planMaterialisation(['a', 'b', 'c'], []);
    expect(m.toCreate).toEqual(['a', 'b', 'c']);
    expect(m.alreadyPresent).toEqual([]);
  });

  it('is idempotent — re-running creates nothing', () => {
    const m = planMaterialisation(['a', 'b'], ['a', 'b']);
    expect(m.toCreate).toEqual([]);
    expect(m.alreadyPresent).toEqual(['a', 'b']);
  });

  it('adds only the late enrolment', () => {
    // The case legacy did not handle at all.
    const m = planMaterialisation(['a', 'b', 'c'], ['a', 'b']);
    expect(m.toCreate).toEqual(['c']);
  });

  it('never removes a learner who left the cohort', () => {
    // They may already have done the work; that evidence must stay attributable.
    const m = planMaterialisation(['a'], ['a', 'departed']);
    expect(m.toCreate).toEqual([]);
    expect(m.alreadyPresent).toEqual(['a']);
  });

  it('tolerates a duplicated roster entry', () => {
    const m = planMaterialisation(['a', 'a', 'b'], []);
    expect(m.toCreate).toEqual(['a', 'b']);
  });
});

describe('plan progress', () => {
  it('counts each status', () => {
    const s = summarisePlan(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'COMPLETED', 'EXPIRED']);
    expect(s).toMatchObject({ total: 5, pending: 1, inProgress: 1, completed: 2, expired: 1 });
  });

  it('excludes waived learners from the completion rate', () => {
    // Counting an excused learner as a failure would misreport the class.
    const s = summarisePlan(['COMPLETED', 'WAIVED', 'PENDING']);
    expect(s.completionRate).toBe(0.5); // 1 of 2 expected, not 1 of 3
  });

  it('reports zero rather than NaN for an empty plan', () => {
    expect(summarisePlan([]).completionRate).toBe(0);
  });

  it('reports zero when everyone is waived', () => {
    expect(summarisePlan(['WAIVED', 'WAIVED']).completionRate).toBe(0);
  });
});

/**
 * Reopen — the only exit from WAIVED.
 *
 * `recompute()` deliberately skips waived rows so a background pass can never
 * silently undo a human decision. That safety property is also what makes a
 * mistaken waiver permanent without an explicit reopen.
 */
describe('checkReopenable', () => {
  it('allows reopening a waived obligation', () => {
    expect(checkReopenable('WAIVED').ok).toBe(true);
  });

  it('refuses anything that is not waived', () => {
    for (const status of ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'EXPIRED'] as const) {
      const r = checkReopenable(status);
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect(r.code).toBe('instruction.not_waived');
    }
  });

  it('is the exact inverse of checkWaivable on the waived state', () => {
    // Waive refuses when already waived; reopen accepts only then. Together
    // they make the transition a cycle with no gap and no overlap.
    expect(checkWaivable('WAIVED').ok).toBe(false);
    expect(checkReopenable('WAIVED').ok).toBe(true);
  });
});
