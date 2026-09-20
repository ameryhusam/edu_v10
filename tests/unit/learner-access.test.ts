/**
 * Deliverable G: a parent sees their own children and nobody else's.
 *
 * These are the cases that must be REFUSED. A bug here is invisible in normal
 * use — the app looks fine right up until someone changes a key in a URL.
 */

import { describe, expect, it } from 'vitest';
import {
  requireSelfLearner,
  resolveLearnerAccess,
  resolveLearnerKey,
} from '../../src/interface/http/learner-access.js';
import type { Actor } from '../../src/interface/http/middleware/context.js';
import type { GuardianLinkReader } from '../../src/contexts/identity/application/ports.js';

/** Only the link parent→child-1 is verified. */
const guardians: GuardianLinkReader = {
  async isVerifiedGuardianOf(guardianUserId, learnerKey) {
    return guardianUserId === 'parent-1' && learnerKey === 'lrn_child_1';
  },
  async learnerKeysFor(guardianUserId) {
    return guardianUserId === 'parent-1' ? ['lrn_child_1'] : [];
  },
  async childrenFor() {
    return [];
  },
  async currentEnrollmentSchoolIdFor(learnerKey) {
    if (learnerKey === 'lrn_same_school' || learnerKey === 'lrn_any') return 'school-A';
    if (learnerKey === 'lrn_other_school') return 'school-B';
    return null;
  },
};

const actor = (over: Partial<Actor> = {}): Actor => ({
  userId: 'user-1',
  userKey: 'usr_1',
  roles: [],
  ...over,
});

const learnerActor = actor({ roles: [{ role: 'STUDENT', schoolId: null }], learnerKey: 'lrn_me' });
const parentActor = actor({ userId: 'parent-1', roles: [{ role: 'PARENT', schoolId: null }] });
const teacherActor = actor({ userId: 'teacher-1', roles: [{ role: 'TEACHER', schoolId: 'school-A' }] });

describe('resolveLearnerKey', () => {
  it('defaults a learner to themselves', async () => {
    const result = await resolveLearnerKey(learnerActor, undefined, guardians);

    expect(result.ok && result.value).toBe('lrn_me');
  });

  it('lets a learner name themselves explicitly', async () => {
    const result = await resolveLearnerKey(learnerActor, 'lrn_me', guardians);

    expect(result.ok && result.value).toBe('lrn_me');
  });

  it('refuses a learner asking about a classmate', async () => {
    const result = await resolveLearnerKey(learnerActor, 'lrn_someone_else', guardians);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('learning.learner_not_accessible');
  });

  it('lets a parent read their verified child', async () => {
    const result = await resolveLearnerKey(parentActor, 'lrn_child_1', guardians);

    expect(result.ok && result.value).toBe('lrn_child_1');
  });

  it("refuses a parent reading someone else's child", async () => {
    // The whole point of deliverable G.
    const result = await resolveLearnerKey(parentActor, 'lrn_child_2', guardians);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('learning.learner_not_accessible');
  });

  it('refuses a parent whose link is not verified', async () => {
    const unverified = actor({ userId: 'parent-9', roles: [{ role: 'PARENT', schoolId: null }] });

    const result = await resolveLearnerKey(unverified, 'lrn_child_1', guardians);

    expect(result.ok).toBe(false);
  });

  it('gives the same refusal for a nonexistent learner as for a forbidden one', async () => {
    // Otherwise the endpoint becomes a learner-key enumerator.
    const forbidden = await resolveLearnerKey(parentActor, 'lrn_child_2', guardians);
    const nonexistent = await resolveLearnerKey(parentActor, 'lrn_no_such_learner', guardians);

    expect(forbidden.ok || nonexistent.ok).toBe(false);
    if (forbidden.ok || nonexistent.ok) return;
    expect(forbidden.error.code).toBe(nonexistent.error.code);
    expect(forbidden.error.message).toBe(nonexistent.error.message);
  });

  it('lets staff read a named learner in their school', async () => {
    const result = await resolveLearnerKey(teacherActor, 'lrn_same_school', guardians);

    expect(result.ok && result.value).toBe('lrn_same_school');
  });

  it('refuses scoped staff reading a learner in another school', async () => {
    const result = await resolveLearnerKey(teacherActor, 'lrn_other_school', guardians);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('learning.learner_not_accessible');
  });

  it('tells a parent with no learner of their own to name one', async () => {
    const result = await resolveLearnerKey(parentActor, undefined, guardians);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('learning.not_a_learner');
  });

  it('rejects an anonymous request', async () => {
    const result = await resolveLearnerKey(undefined, 'lrn_child_1', guardians);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('auth.required');
  });
});

describe('ACT mode — delegation is not impersonation', () => {
  it('lets a learner act as themselves', async () => {
    const result = await requireSelfLearner(learnerActor);

    expect(result.ok && result.value).toBe('lrn_me');
  });

  it('refuses a parent acting as their OWN verified child', async () => {
    // The guardian link is real and READ would succeed. Producing evidence is
    // still refused: mastery is only meaningful if every observation in it
    // came from the learner.
    const read = await resolveLearnerAccess(parentActor, 'lrn_child_1', guardians, 'READ');
    const act = await resolveLearnerAccess(parentActor, 'lrn_child_1', guardians, 'ACT');

    expect(read.ok).toBe(true);
    expect(act.ok).toBe(false);
    if (act.ok) return;
    expect(act.error.code).toBe('learning.cannot_act_for_learner');
  });

  it('refuses a teacher acting as a student', async () => {
    // Staff outrank guardians for reading and still cannot submit work.
    const read = await resolveLearnerAccess(teacherActor, 'lrn_any', guardians, 'READ');
    const act = await resolveLearnerAccess(teacherActor, 'lrn_any', guardians, 'ACT');

    expect(read.ok).toBe(true);
    expect(act.ok).toBe(false);
  });

  it('refuses a non-learner account acting at all', async () => {
    const result = await requireSelfLearner(parentActor);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('learning.not_a_learner');
  });

  it('reports whether access was delegated', async () => {
    const self = await resolveLearnerAccess(learnerActor, undefined, guardians, 'READ');
    const delegated = await resolveLearnerAccess(parentActor, 'lrn_child_1', guardians, 'READ');

    expect(self.ok && self.value.isSelf).toBe(true);
    expect(delegated.ok && delegated.value.isSelf).toBe(false);
  });
});
