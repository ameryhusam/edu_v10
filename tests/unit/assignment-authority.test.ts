/**
 * The advisory-origin rule, tested as a rule rather than as a UI behaviour.
 *
 * The owner's ruling was explicit that hiding parent tasks in the frontend is
 * not enough, so these tests assert the property at the domain boundary: no
 * matter who calls it, PARENT work cannot acquire academic authority.
 */

import { describe, expect, it } from 'vitest';
import {
  checkAcademicAuthority,
  hasAcademicAuthority,
  isAdvisoryOnly,
  partitionByAuthority,
} from '../../src/contexts/instruction/domain/assignment-authority.js';
import { ASSIGNMENT_ORIGINS, type AssignmentOrigin } from '../../src/contexts/instruction/domain/plan.js';

describe('assignment authority', () => {
  it('grants academic authority to teacher, remedial and adaptive work', () => {
    expect(hasAcademicAuthority('TEACHER')).toBe(true);
    expect(hasAcademicAuthority('REMEDIAL')).toBe(true);
    expect(hasAcademicAuthority('ADAPTIVE')).toBe(true);
  });

  it('refuses academic authority to PARENT work', () => {
    expect(hasAcademicAuthority('PARENT')).toBe(false);
    expect(isAdvisoryOnly('PARENT')).toBe(true);
  });

  it('refuses academic authority to SELF work', () => {
    // A learner cannot manufacture their own academic record, for the same
    // reason they cannot mark their own mastery.
    expect(isAdvisoryOnly('SELF')).toBe(true);
  });

  it('classifies every declared origin — no origin is left undecided', () => {
    // Guards against a new origin being added to the union and silently
    // falling through whichever branch a caller happens to write first.
    for (const origin of ASSIGNMENT_ORIGINS) {
      expect(typeof hasAcademicAuthority(origin)).toBe('boolean');
      expect(hasAcademicAuthority(origin)).toBe(!isAdvisoryOnly(origin));
    }
  });

  it('names the refusal instead of returning a bare false', () => {
    const result = checkAcademicAuthority('PARENT');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.refusal.code).toBe('instruction.advisory_origin');
      expect(result.refusal.reason).toContain('advisory');
    }
  });

  it('lets academic origins through the guard', () => {
    expect(checkAcademicAuthority('TEACHER').ok).toBe(true);
  });

  it('keeps parent work OUT of the academic bucket but still tracks it', () => {
    const { academic, advisory } = partitionByAuthority([
      { origin: 'TEACHER' as AssignmentOrigin, id: 'a' },
      { origin: 'PARENT' as AssignmentOrigin, id: 'b' },
      { origin: 'REMEDIAL' as AssignmentOrigin, id: 'c' },
      { origin: 'SELF' as AssignmentOrigin, id: 'd' },
    ]);

    expect(academic.map((o) => o.id)).toEqual(['a', 'c']);
    // Advisory work is not discarded — a parent must still see it.
    expect(advisory.map((o) => o.id)).toEqual(['b', 'd']);
  });

  it('does not let a pile of parent tasks dilute an academic completion rate', () => {
    // The concrete failure this prevents: a parent sets five tasks, the child
    // does none, and the child's school-facing completion appears to collapse.
    const obligations = [
      { origin: 'TEACHER' as AssignmentOrigin, done: true },
      ...Array.from({ length: 5 }, () => ({ origin: 'PARENT' as AssignmentOrigin, done: false })),
    ];

    const { academic } = partitionByAuthority(obligations);
    const rate = academic.filter((o) => o.done).length / academic.length;

    expect(academic).toHaveLength(1);
    expect(rate).toBe(1);
  });

  it('returns empty buckets for empty input rather than throwing', () => {
    expect(partitionByAuthority([])).toEqual({ academic: [], advisory: [] });
  });
});
