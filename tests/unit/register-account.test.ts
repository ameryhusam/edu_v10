/**
 * Self-service registration.
 *
 * The rule worth defending here is a privilege boundary: a stranger with a
 * browser must not be able to type "SYSTEM_ADMIN" into a form field and become
 * one. That is an authorization decision, so it lives in the domain and is
 * tested here rather than only at the HTTP edge — a rule enforced solely in a
 * route stops being enforced the moment a second caller appears.
 *
 * The second rule is subtler and matters just as much: registration must write
 * through the SAME path an administrator uses. A private user-creating branch
 * would skip the uniqueness refusals, the profile a role implies, the key
 * derivation and the audit entry, and every one of those omissions produces an
 * account that looks fine until something fails much later.
 */

import { describe, expect, it, vi } from 'vitest';
import { RegisterAccountUseCase } from '../../src/contexts/identity/application/register-account.use-case.js';
import {
  SELF_SERVICE_ROLES,
  validateSelfServiceRole,
} from '../../src/contexts/identity/domain/provisioning.js';
import type { ProvisioningService } from '../../src/contexts/identity/application/provisioning.service.js';
import type { ProvisioningRepository } from '../../src/contexts/identity/application/ports.js';
import { Ok } from '../../src/shared/kernel/result.js';

function harness(options: { schoolCount?: number } = {}) {
  const provisionUser = vi.fn(async () =>
    Ok({
      key: 'usr_x',
      username: 'x',
      fullName: 'X',
      email: null,
      phone: null,
      status: 'ACTIVE',
      roles: [{ role: 'STUDENT', schoolKey: null }],
      learnerKey: 'lrn_x',
      guardianKey: null,
    }),
  );

  const provisioning = { provisionUser } as unknown as ProvisioningService;
  const repo = {
    countSchools: async () => options.schoolCount ?? 1,
  } as unknown as ProvisioningRepository;

  return { useCase: new RegisterAccountUseCase(provisioning, repo), provisionUser };
}

const VALID = {
  username: 'newperson',
  fullName: 'New Person',
  password: 'demo1234',
  role: 'STUDENT',
};

describe('the self-service role list', () => {
  it('contains only roles that carry no authority over other people', () => {
    expect([...SELF_SERVICE_ROLES].sort()).toEqual(['PARENT', 'STUDENT', 'TEACHER']);
  });

  it.each(['SYSTEM_ADMIN', 'SCHOOL_ADMIN', 'CONTENT_AUTHOR'])(
    'refuses %s as a self-assigned role',
    (role) => {
      const result = validateSelfServiceRole(role);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe('FORBIDDEN');
      expect(result.error.code).toBe('identity.role_not_self_service');
    },
  );

  it('refuses a role that does not exist rather than ignoring it', () => {
    const result = validateSelfServiceRole('WIZARD');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('identity.unknown_role');
  });
});

describe('registration', () => {
  it('writes through the same provisioning service an administrator uses', async () => {
    const { useCase, provisionUser } = harness();

    const result = await useCase.execute(VALID);

    expect(result.ok).toBe(true);
    // Not "a user was created" — that the canonical path created it.
    expect(provisionUser).toHaveBeenCalledTimes(1);
  });

  it('never forwards a school named by the registrant', async () => {
    const { useCase, provisionUser } = harness();

    // A caller sending extra fields must not be able to scope their own grant:
    // hasRole reads a null school as platform-wide, so a school chosen by the
    // registrant is a cross-tenant access decision made by the attacker.
    await useCase.execute({ ...VALID, ...({ schoolKey: 'sch_other' } as object) });

    const [, input] = provisionUser.mock.calls[0] as unknown as [
      unknown,
      { schoolKey: string | null; roles: readonly string[] },
    ];
    expect(input.schoolKey).toBeNull();
  });

  it('grants exactly the one requested role, never a list', async () => {
    const { useCase, provisionUser } = harness();

    await useCase.execute({ ...VALID, ...({ roles: ['SYSTEM_ADMIN'] } as object) });

    const [, input] = provisionUser.mock.calls[0] as unknown as [
      unknown,
      { roles: readonly string[] },
    ];
    expect(input.roles).toEqual(['STUDENT']);
  });

  it('attributes the audit entry to the registration itself, not to an admin', async () => {
    const { useCase, provisionUser } = harness();

    await useCase.execute(VALID);

    const [ctx] = provisionUser.mock.calls[0] as unknown as [
      { actorId: string | null; actorKey: string },
    ];
    // Inventing an admin actor would falsify the trail.
    expect(ctx.actorId).toBeNull();
    expect(ctx.actorKey).toBe('self-registration');
  });

  it('refuses a privileged role before touching provisioning at all', async () => {
    const { useCase, provisionUser } = harness();

    const result = await useCase.execute({ ...VALID, role: 'SYSTEM_ADMIN' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('identity.role_not_self_service');
    expect(provisionUser).not.toHaveBeenCalled();
  });

  it('refuses registration entirely once more than one school exists', async () => {
    // The grant becomes ambiguous, and guessing a school would hand a stranger
    // access to one. Refusing is the honest answer.
    const { useCase, provisionUser } = harness({ schoolCount: 2 });

    const result = await useCase.execute(VALID);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('identity.registration_requires_invitation');
      expect(result.error.kind).toBe('PRECONDITION');
    }
    expect(provisionUser).not.toHaveBeenCalled();
  });
});
