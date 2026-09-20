/**
 * Self-service account creation.
 *
 * A separate use case from `provisionUser` because the *authorization* story
 * is completely different — anonymous rather than admin — while the *writing*
 * must be identical. So this owns the rules that only apply to an unauthenticated
 * caller and then delegates the entire write to `ProvisioningService`.
 *
 * That delegation is the important part. A second path that created users
 * directly would be a hidden write path: it would skip the uniqueness refusals,
 * the profile creation a role implies, the key derivation, and the audit entry,
 * and every one of those omissions produces an account that looks fine until
 * something fails much later.
 *
 * Three rules belong to this path and nowhere else:
 *
 *  1. **The role must be self-serviceable.** Enforced in the domain, because
 *     "which roles may a stranger claim" is a policy, not a route detail.
 *  2. **No school may be chosen by the registrant.** A person cannot assert
 *     membership of a school; an administrator enrols them.
 *  3. **The actor is the new account itself.** There is no admin to attribute
 *     the audit entry to, and inventing one would falsify the trail.
 */

import { Err, type Result } from '../../../shared/kernel/result.js';
import { Errors } from '../../../shared/kernel/errors.js';
import { validateSelfServiceRole } from '../domain/provisioning.js';
import type { ProvisioningService } from './provisioning.service.js';
import type { ProvisionedUser, ProvisioningRepository } from './ports.js';

export interface RegisterAccountInput {
  readonly username: string;
  readonly fullName: string;
  readonly password: string;
  readonly email?: string | null;
  readonly phone?: string | null;
  readonly role: string;
}

export class RegisterAccountUseCase {
  constructor(
    private readonly provisioning: ProvisioningService,
    private readonly repo: ProvisioningRepository,
  ) {}

  async execute(input: RegisterAccountInput): Promise<Result<ProvisionedUser>> {
    const role = validateSelfServiceRole(input.role);
    if (!role.ok) return role;

    /**
     * Scoped roles need a school, and a registrant cannot name one. In a
     * single-school deployment the grant is unambiguous without it, so
     * `validateRoleGrant` accepts a null school and registration works.
     *
     * Once a second school exists the grant becomes ambiguous, and the honest
     * answer is to refuse rather than to guess a school or silently create an
     * unscoped grant — `hasRole` reads a null school as platform-wide, so
     * guessing here would hand a stranger cross-tenant access.
     */
    if ((await this.repo.countSchools()) > 1) {
      return Err(
        Errors.precondition(
          'identity.registration_requires_invitation',
          'This deployment has multiple schools, so accounts must be created by a school administrator.',
        ),
      );
    }

    // The same canonical write an administrator performs. Note what is NOT
    // forwarded: schoolKey. There is no path by which a registrant's input
    // can name a school.
    return this.provisioning.provisionUser(
      { actorId: null, actorKey: 'self-registration' },
      {
        username: input.username,
        fullName: input.fullName,
        password: input.password,
        email: input.email ?? null,
        phone: input.phone ?? null,
        roles: [role.value],
        schoolKey: null,
      },
    );
  }
}

/** Re-exported so the HTTP layer can describe the choice without importing the domain. */
export { SELF_SERVICE_ROLES } from '../domain/provisioning.js';
