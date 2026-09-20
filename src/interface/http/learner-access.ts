/**
 * Who is this request allowed to act on, and in which capacity?
 *
 * Deliverable G says a parent sees their own children and nobody else's, and
 * that this is checked on the server on every request — a `learnerKey` in a
 * JWT is a claim, and a claim that is only ever compared against itself is not
 * an authorisation check.
 *
 * Every learner-scoped route resolves its subject through here rather than
 * reading `actor.learnerKey` directly, so there is one place to audit and one
 * place to change.
 *
 * Scope note: this resolver answers exactly one question — *may this actor
 * touch this learner, in this mode*. It is deliberately not a general policy
 * engine. Anything that needs to know what a learner may do *next* is a
 * Learning decision, and anything that needs to know whether an activity was
 * assigned is an Instruction decision; neither belongs here.
 */

import { Errors } from '../../shared/kernel/errors.js';
import { Err, Ok, type Result } from '../../shared/kernel/result.js';
import { canReadAnyLearner } from '../../contexts/identity/domain/roles.js';
import type { GuardianLinkReader } from '../../contexts/identity/application/ports.js';
import type { Actor } from './middleware/context.js';

/**
 * READ — observing a learner's data.
 *
 * Delegable: staff and verified guardians may read a learner they are
 * responsible for.
 *
 * ACT — producing evidence or consuming the learner's resources: submitting an
 * answer, opening an attempt, spending AI tutor quota.
 *
 * Never delegable. A parent submitting answers as their child would corrupt
 * the evidence stream that mastery is computed from, and mastery is only
 * meaningful because every observation in it came from the learner. This is a
 * pedagogical integrity rule before it is a security rule.
 */
export type AccessMode = 'READ' | 'ACT';

/** The authorised subject of a request, plus how it was obtained. */
export interface LearnerAccess {
  readonly learnerKey: string;
  /** True when the actor is the learner. False for delegated reads. */
  readonly isSelf: boolean;
}

/**
 * Resolve the learner a request is about.
 *
 * With no `requestedLearnerKey` the answer is "myself", which is the common
 * case and needs no lookup. Naming someone else requires either a staff role
 * or a *verified* guardian link; an unverified link grants nothing, because
 * anyone can assert they are a child's parent.
 */
export async function resolveLearnerAccess(
  actor: Actor | undefined,
  requestedLearnerKey: string | undefined,
  guardians: GuardianLinkReader,
  mode: AccessMode = 'READ',
): Promise<Result<LearnerAccess>> {
  if (!actor) {
    return Err(Errors.unauthenticated('auth.required', 'Authentication is required.'));
  }

  const own = actor.learnerKey;
  const isSelfRequest = !requestedLearnerKey || requestedLearnerKey === own;

  if (isSelfRequest) {
    if (!own) {
      return Err(
        Errors.forbidden(
          'learning.not_a_learner',
          'Only learner accounts have a learning path. Specify a learner to view.',
        ),
      );
    }
    return Ok({ learnerKey: own, isSelf: true });
  }

  // Acting *as* someone else is refused for everyone, including staff: the
  // evidence stream must record what the learner actually did.
  if (mode === 'ACT') {
    return Err(
      Errors.forbidden(
        'learning.cannot_act_for_learner',
        'You cannot perform this action on behalf of another learner.',
      ),
    );
  }

  // Staff read is scoped to the learner's CURRENT school. The token carries
  // role scopes as school ids, so a scoped teacher must be compared with the
  // learner's current enrolment before the request is delegated.
  const hasPlatformStaffGrant = actor.roles.some(
    (grant) =>
      grant.role === 'SYSTEM_ADMIN' ||
      (grant.schoolId === null && ['SCHOOL_ADMIN', 'TEACHER'].includes(grant.role)),
  );
  if (hasPlatformStaffGrant) {
    return Ok({ learnerKey: requestedLearnerKey, isSelf: false });
  }

  const learnerSchoolId = await guardians.currentEnrollmentSchoolIdFor?.(requestedLearnerKey);
  if (learnerSchoolId && canReadAnyLearner(actor.roles, learnerSchoolId)) {
    return Ok({ learnerKey: requestedLearnerKey, isSelf: false });
  }

  if (await guardians.isVerifiedGuardianOf(actor.userId, requestedLearnerKey)) {
    return Ok({ learnerKey: requestedLearnerKey, isSelf: false });
  }

  // Deliberately the same answer whether the learner does not exist or simply
  // is not this actor's child: otherwise the endpoint enumerates learner keys.
  return Err(
    Errors.forbidden(
      'learning.learner_not_accessible',
      'You do not have access to this learner.',
    ),
  );
}

/**
 * The learner this actor is acting as, for endpoints that produce evidence or
 * spend the learner's own resources.
 *
 * Takes no requested key at all: the only correct answer is "yourself", so the
 * route has no way to express anything else.
 */
export async function requireSelfLearner(actor: Actor | undefined): Promise<Result<string>> {
  const access = await resolveLearnerAccess(actor, undefined, NO_GUARDIANS, 'ACT');
  return access.ok ? Ok(access.value.learnerKey) : Err(access.error);
}

/** A self-only resolution never consults guardian links. */
const NO_GUARDIANS: GuardianLinkReader = {
  async isVerifiedGuardianOf() {
    return false;
  },
  async learnerKeysFor() {
    return [];
  },
  async childrenFor() {
    return [];
  },
};

/** Convenience wrapper for read endpoints that only need the key. */
export async function resolveLearnerKey(
  actor: Actor | undefined,
  requestedLearnerKey: string | undefined,
  guardians: GuardianLinkReader,
): Promise<Result<string>> {
  const access = await resolveLearnerAccess(actor, requestedLearnerKey, guardians, 'READ');
  return access.ok ? Ok(access.value.learnerKey) : Err(access.error);
}
