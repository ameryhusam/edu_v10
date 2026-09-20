/**
 * Provisioning: bringing people into the system and placing them in it.
 *
 * This is the capability whose absence made the seed script load-bearing. There
 * was no way to create a user, grant a role, enrol a learner or link a parent
 * except by editing `seed.ts` and re-seeding, which meant no admin UI could
 * ever be built and every live check depended on fixtures.
 *
 * Three boundaries this service respects:
 *
 * **It decides coherence, not permission.** Whether the actor may provision is
 * a role question answered at the interface by `roles.ts`. Answering it here
 * too would make `ProvisioningService` a second authorization engine — the
 * thing the owner explicitly ruled out for `resolveLearnerKey`.
 *
 * **It does not own placement semantics beyond identity.** A learner's school
 * comes from their current enrolment. Identity owns who someone is; Instruction
 * reads where they study. This service writes the enrolment row because it owns
 * the learner profile it hangs off, but it does not interpret it.
 *
 * **It never writes derived state.** No XP, no mastery, no progress. A
 * provisioned learner starts with nothing to their name because everything else
 * is computed from evidence they have not produced yet.
 */

import { Errors } from '../../../shared/kernel/errors.js';
import { Err, Ok, type Result } from '../../../shared/kernel/result.js';
import {
  enrollmentKeyFor,
  guardianKeyFor,
  learnerKeyFor,
  profilesRequiredFor,
  validateNewUser,
  validateRoleGrant,
  validateStatusChange,
  educatorKeyFor,
} from '../domain/provisioning.js';
import { isRoleName, type RoleName } from '../domain/roles.js';
import type {
  AuditWriter,
  CohortCount,
  EducatorListPage,
  EnrollmentListPage,
  EnrollmentRecord,
  GuardianLinkRecord,
  PasswordHasher,
  ProvisionedUser,
  ProvisioningRepository,
  UserDirectoryPage,
} from './ports.js';

/** Who is performing the act. Authorization already happened at the edge. */
export interface ProvisioningContext {
  readonly actorId: string | null;
  readonly actorKey: string;
}

export class ProvisioningService {
  constructor(
    private readonly repo: ProvisioningRepository,
    private readonly hasher: PasswordHasher,
    private readonly audit: AuditWriter,
  ) {}

  /**
   * Create a person, with their roles and any profile those roles imply.
   *
   * Roles are part of creation rather than a follow-up call because a user with
   * no role can log in and do nothing, and a STUDENT with no `LearnerProfile`
   * can log in and fail at every learner-scoped route. Both are states an admin
   * would have to notice and repair by hand.
   */
  async provisionUser(
    ctx: ProvisioningContext,
    input: {
      username: string;
      fullName: string;
      password: string;
      email?: string | null;
      phone?: string | null;
      roles: readonly string[];
      /** Required for scoped roles once more than one school exists. */
      schoolKey?: string | null;
      /** Staff fields, stored on the EducatorProfile a TEACHER grant implies. */
      employeeCode?: string | null;
      specialty?: string | null;
      /** Structured subject specialties; a teacher may specialise in many subjects. */
      subjectKeys?: readonly string[];
    },
  ): Promise<Result<ProvisionedUser>> {
    const draft = validateNewUser(input);
    if (!draft.ok) return draft;

    if (input.roles.length === 0) {
      return Err(
        Errors.validation(
          'identity.role_required',
          'A user must be given at least one role; an account with none can sign in and do nothing.',
        ),
      );
    }

    const multiSchool = (await this.repo.countSchools()) > 1;
    const grants: Array<{ role: RoleName; schoolKey: string | null }> = [];
    for (const role of input.roles) {
      const grant = validateRoleGrant({
        role,
        schoolKey: input.schoolKey ?? null,
        multiSchool,
      });
      if (!grant.ok) return grant;
      grants.push(grant.value);
    }

    // Uniqueness is checked before the write so the caller gets a domain
    // refusal naming the field, not a leaked constraint violation. The database
    // still enforces it; this is about the message, not the guarantee.
    if (await this.repo.findUserByUsername(draft.value.username)) {
      return Err(
        Errors.conflict('identity.username_taken', 'That username is already in use.', {
          username: draft.value.username,
        }),
      );
    }
    if (draft.value.email && (await this.repo.findUserKeyByEmail(draft.value.email))) {
      return Err(
        Errors.conflict('identity.email_taken', 'That email address is already in use.', {
          email: draft.value.email,
        }),
      );
    }
    if (await this.repo.findUserByKey(draft.value.key)) {
      return Err(
        Errors.conflict('identity.user_exists', 'A user with that key already exists.', {
          userKey: draft.value.key,
        }),
      );
    }

    const passwordHash = await this.hasher.hash(input.password);

    let user = await this.repo.createUser({
      key: draft.value.key,
      username: draft.value.username,
      fullName: draft.value.fullName,
      email: draft.value.email,
      phone: draft.value.phone,
      passwordHash,
      status: 'ACTIVE',
    });

    for (const grant of grants) {
      user = await this.repo.grantRole({
        userKey: user.key,
        role: grant.role,
        schoolKey: grant.schoolKey,
      });
    }

    // The profile a role implies, created from the same handle as the user key
    // so the identifiers for one person stay recognisably related.
    for (const profile of profilesRequiredFor(grants.map((g) => g.role))) {
      if (profile === 'learner') {
        const key = learnerKeyFor(draft.value.username);
        if (!key.ok) return key;
        user = await this.repo.createLearnerProfile({ userKey: user.key, learnerKey: key.value });
      } else if (profile === 'guardian') {
        const key = guardianKeyFor(draft.value.username);
        if (!key.ok) return key;
        user = await this.repo.createGuardianProfile({ userKey: user.key, guardianKey: key.value });
      } else {
        const key = educatorKeyFor(draft.value.username);
        if (!key.ok) return key;
        user = await this.repo.createEducatorProfile({
          userKey: user.key,
          educatorKey: key.value,
          employeeCode: input.employeeCode ?? null,
          specialty: input.specialty ?? null,
          subjectKeys: input.subjectKeys ?? [],
        });
      }
    }

    await this.log(ctx, 'identity.user_provisioned', user.key, {
      roles: grants.map((g) => g.role),
      learnerKey: user.learnerKey,
      guardianKey: user.guardianKey,
    });
    return Ok(user);
  }

  /** Correct the things about a person that are genuinely mutable. */
  async updateUser(
    ctx: ProvisioningContext,
    userKey: string,
    patch: { fullName?: string; email?: string | null; phone?: string | null },
  ): Promise<Result<ProvisionedUser>> {
    const existing = await this.repo.findUserByKey(userKey);
    if (!existing) return this.noSuchUser(userKey);

    // Username and key are not patchable. The key is a stable identifier other
    // contexts store; renaming it would strand every reference to this person.
    if (patch.fullName !== undefined && patch.fullName.trim().length === 0) {
      return Err(Errors.validation('identity.full_name_required', 'A full name is required.'));
    }
    if (patch.email) {
      const owner = await this.repo.findUserKeyByEmail(patch.email);
      if (owner && owner !== userKey) {
        return Err(
          Errors.conflict('identity.email_taken', 'That email address is already in use.', {
            email: patch.email,
          }),
        );
      }
    }

    const updated = await this.repo.updateUserProfile(userKey, patch);
    await this.log(ctx, 'identity.user_updated', userKey, { fields: Object.keys(patch) });
    return Ok(updated);
  }

  /**
   * Suspend, reinstate or archive.
   *
   * The lifecycle operation an admin actually needs: there is no delete. A
   * person who has answered a question is part of the evidence record, and
   * removing the row would turn their history into references to nothing.
   */
  async changeUserStatus(
    ctx: ProvisioningContext,
    userKey: string,
    status: string,
  ): Promise<Result<ProvisionedUser>> {
    const existing = await this.repo.findUserByKey(userKey);
    if (!existing) return this.noSuchUser(userKey);

    const decided = validateStatusChange(existing.status, status);
    if (!decided.ok) return decided;

    const updated = await this.repo.setUserStatus(userKey, decided.value);
    await this.log(ctx, 'identity.user_status_changed', userKey, {
      from: existing.status,
      to: decided.value,
    });
    return Ok(updated);
  }

  async grantRole(
    ctx: ProvisioningContext,
    input: { userKey: string; role: string; schoolKey?: string | null },
  ): Promise<Result<ProvisionedUser>> {
    const existing = await this.repo.findUserByKey(input.userKey);
    if (!existing) return this.noSuchUser(input.userKey);

    const multiSchool = (await this.repo.countSchools()) > 1;
    const grant = validateRoleGrant({
      role: input.role,
      schoolKey: input.schoolKey ?? null,
      multiSchool,
    });
    if (!grant.ok) return grant;

    if (
      existing.roles.some((r) => r.role === grant.value.role && r.schoolKey === grant.value.schoolKey)
    ) {
      return Err(
        Errors.conflict('identity.role_already_granted', 'The user already holds that role.', {
          role: grant.value.role,
        }),
      );
    }

    let user = await this.repo.grantRole({
      userKey: input.userKey,
      role: grant.value.role,
      schoolKey: grant.value.schoolKey,
    });

    // Granting STUDENT to someone who has no learner profile leaves them able
    // to log in and fail everywhere, so the profile follows the role here too.
    for (const profile of profilesRequiredFor([grant.value.role])) {
      if (profile === 'learner' && !user.learnerKey) {
        const key = learnerKeyFor(user.username);
        if (!key.ok) return key;
        user = await this.repo.createLearnerProfile({ userKey: user.key, learnerKey: key.value });
      }
      if (profile === 'guardian' && !user.guardianKey) {
        const key = guardianKeyFor(user.username);
        if (!key.ok) return key;
        user = await this.repo.createGuardianProfile({ userKey: user.key, guardianKey: key.value });
      }
      if (profile === 'educator' && !user.educatorKey) {
        const key = educatorKeyFor(user.username);
        if (!key.ok) return key;
        user = await this.repo.createEducatorProfile({ userKey: user.key, educatorKey: key.value });
      }
    }

    await this.log(ctx, 'identity.role_granted', input.userKey, {
      role: grant.value.role,
      schoolKey: grant.value.schoolKey,
    });
    return Ok(user);
  }

  /**
   * The teacher's school link and staff fields.
   *
   * A teacher belongs to one school at a time: linking to a new school moves
   * the TEACHER grant (revoke the old scoped grants, grant the new one)
   * rather than adding a second scope — a teacher visible in two schools is
   * a data bug every roster screen would inherit. Staff fields (employee
   * code, specialty) are corrected on the profile, created if missing.
   */
  async updateEducator(
    ctx: ProvisioningContext,
    input: {
      userKey: string;
      schoolKey?: string | null;
      employeeCode?: string | null;
      specialty?: string | null;
      subjectKeys?: readonly string[];
    },
  ): Promise<Result<ProvisionedUser>> {
    let user = await this.repo.findUserByKey(input.userKey);
    if (!user) return this.noSuchUser(input.userKey);

    if (
      input.employeeCode !== undefined ||
      input.specialty !== undefined ||
      input.subjectKeys !== undefined
    ) {
      user = await this.repo.updateEducatorProfile(input.userKey, {
        ...(input.employeeCode !== undefined ? { employeeCode: input.employeeCode } : {}),
        ...(input.specialty !== undefined ? { specialty: input.specialty } : {}),
        ...(input.subjectKeys !== undefined ? { subjectKeys: input.subjectKeys } : {}),
      });
    }

    if (input.schoolKey !== undefined && input.schoolKey !== null) {
      const currentTeacherGrants = user.roles.filter((r) => r.role === 'TEACHER');
      const already = currentTeacherGrants.some((r) => r.schoolKey === input.schoolKey);
      if (!already) {
        for (const grant of currentTeacherGrants) {
          if (grant.schoolKey === null) continue;
          const revoked = await this.revokeRole(ctx, {
            userKey: input.userKey,
            role: 'TEACHER',
            schoolKey: grant.schoolKey,
          });
          if (!revoked.ok) return revoked;
        }
        const granted = await this.grantRole(ctx, {
          userKey: input.userKey,
          role: 'TEACHER',
          schoolKey: input.schoolKey,
        });
        if (!granted.ok) return granted;
        user = granted.value;
      }
    }

    await this.log(ctx, 'identity.educator_updated', input.userKey, {
      schoolKey: input.schoolKey ?? undefined,
      subjectKeys: input.subjectKeys ?? undefined,
    });
    return Ok(user);
  }

  /**
   * Withdraw a role.
   *
   * The profile is deliberately left in place. A learner profile owns mastery,
   * evidence and attempts; deleting it because someone lost the STUDENT role
   * would destroy a history that is still true.
   */
  async revokeRole(
    ctx: ProvisioningContext,
    input: { userKey: string; role: string; schoolKey?: string | null },
  ): Promise<Result<ProvisionedUser>> {
    const existing = await this.repo.findUserByKey(input.userKey);
    if (!existing) return this.noSuchUser(input.userKey);

    if (!isRoleName(input.role)) {
      return Err(
        Errors.validation('identity.unknown_role', 'That is not a role this system grants.', {
          role: input.role,
        }),
      );
    }

    const schoolKey = input.schoolKey ?? null;
    if (!existing.roles.some((r) => r.role === input.role && r.schoolKey === schoolKey)) {
      return Err(
        Errors.notFound('identity.role_not_granted', 'The user does not hold that role.', {
          role: input.role,
          schoolKey,
        }),
      );
    }

    // Removing the last role would leave an account that can sign in and do
    // nothing, which reads as a broken system rather than a withdrawn one.
    // Archiving the user is the operation that means "no longer has access".
    if (existing.roles.length === 1) {
      return Err(
        Errors.conflict(
          'identity.last_role',
          'This is the user\u2019s only role; archive the user instead of leaving them with none.',
          { role: input.role },
        ),
      );
    }

    const user = await this.repo.revokeRole({ userKey: input.userKey, role: input.role, schoolKey });
    await this.log(ctx, 'identity.role_revoked', input.userKey, { role: input.role, schoolKey });
    return Ok(user);
  }

  /**
   * Place a learner in a school, year, term and grade.
   *
   * Every coordinate is resolved by business key and refused by name if it is
   * missing, because "enrolment failed" with no field is the kind of error an
   * admin cannot act on.
   */
  async enrolLearner(
    ctx: ProvisioningContext,
    input: {
      learnerKey: string;
      schoolKey: string;
      academicYearKey: string;
      termKey: string;
      gradeKey: string;
      /** Default true: an enrolment nobody marked current is invisible to teachers. */
      isCurrent?: boolean;
    },
  ): Promise<Result<EnrollmentRecord>> {
    const resolved = await this.repo.resolveEnrollmentCoordinates(input);
    const missing = (
      [
        ['schoolKey', resolved.schoolKey],
        ['academicYearKey', resolved.academicYearKey],
        ['termKey', resolved.termKey],
        ['gradeKey', resolved.gradeKey],
      ] as const
    )
      .filter(([, value]) => value === null)
      .map(([field]) => field);

    if (missing.length > 0) {
      return Err(
        Errors.notFound('identity.coordinate_not_found', 'Some of those do not exist.', { missing }),
      );
    }

    // A term belongs to exactly one year. Accepting a mismatched pair would
    // produce an enrolment whose key claims one year and whose term says
    // another, and the cohort queries would disagree with the key.
    if (resolved.termAcademicYearKey !== input.academicYearKey) {
      return Err(
        Errors.validation(
          'identity.term_year_mismatch',
          'That term does not belong to that academic year.',
          { termKey: input.termKey, academicYearKey: resolved.termAcademicYearKey },
        ),
      );
    }

    // Lifecycle guards. An inactive school or grade is retired from NEW
    // enrolments; the historical rows keep their references (the delete
    // guards make sure of that). Refusing here is what makes the flag mean
    // something — otherwise it would be a display value only.
    if (resolved.schoolIsActive === false) {
      return Err(
        Errors.validation(
          'identity.school_inactive',
          'That school is inactive and takes no new enrolments.',
          { schoolKey: input.schoolKey },
        ),
      );
    }
    if (resolved.gradeIsActive === false) {
      return Err(
        Errors.validation(
          'identity.grade_inactive',
          'That grade is inactive and takes no new enrolments.',
          { gradeKey: input.gradeKey },
        ),
      );
    }

    const key = enrollmentKeyFor({
      learnerKey: input.learnerKey,
      academicYearKey: input.academicYearKey,
      termOrdinal: resolved.termOrdinal ?? 0,
    });
    if (!key.ok) return key;

    if (await this.repo.findEnrollment(key.value)) {
      return Err(
        Errors.conflict(
          'identity.enrollment_exists',
          'This learner is already enrolled for that term.',
          { enrollmentKey: key.value },
        ),
      );
    }

    const created = await this.repo.createEnrollment({
      key: key.value,
      learnerKey: input.learnerKey,
      schoolKey: input.schoolKey,
      academicYearKey: input.academicYearKey,
      termKey: input.termKey,
      gradeKey: input.gradeKey,
      isCurrent: input.isCurrent ?? true,
    });

    await this.log(ctx, 'identity.learner_enrolled', created.key, {
      learnerKey: input.learnerKey,
      schoolKey: input.schoolKey,
      termKey: input.termKey,
    });
    return Ok(created);
  }

  /**
   * Move a learner's current placement to an enrolment they already have.
   *
   * The operation a new term needs. Standing down the previous current
   * enrolment is the repository's job in one transaction, because "exactly one
   * current" is an invariant and not a sequence of writes.
   */
  async makeEnrollmentCurrent(
    ctx: ProvisioningContext,
    enrollmentKey: string,
  ): Promise<Result<EnrollmentRecord>> {
    const existing = await this.repo.findEnrollment(enrollmentKey);
    if (!existing) {
      return Err(
        Errors.notFound('identity.enrollment_not_found', 'No such enrolment.', { enrollmentKey }),
      );
    }
    if (existing.isCurrent) {
      return Err(
        Errors.conflict('identity.enrollment_already_current', 'That enrolment is already current.', {
          enrollmentKey,
        }),
      );
    }

    const updated = await this.repo.makeEnrollmentCurrent(enrollmentKey);
    await this.log(ctx, 'identity.enrollment_made_current', enrollmentKey, {
      learnerKey: updated.learnerKey,
    });
    return Ok(updated);
  }

  /**
   * End a placement without deleting it.
   *
   * The row stays because analytics and obligations reference the period it
   * describes. A learner with no current enrolment simply falls out of cohort
   * scope, which is the correct effect of having left.
   */
  async endEnrollment(
    ctx: ProvisioningContext,
    enrollmentKey: string,
  ): Promise<Result<EnrollmentRecord>> {
    const existing = await this.repo.findEnrollment(enrollmentKey);
    if (!existing) {
      return Err(
        Errors.notFound('identity.enrollment_not_found', 'No such enrolment.', { enrollmentKey }),
      );
    }
    if (!existing.isCurrent) {
      return Err(
        Errors.conflict('identity.enrollment_not_current', 'That enrolment has already ended.', {
          enrollmentKey,
        }),
      );
    }

    const updated = await this.repo.endEnrollment(enrollmentKey);
    await this.log(ctx, 'identity.enrollment_ended', enrollmentKey, {
      learnerKey: updated.learnerKey,
    });
    return Ok(updated);
  }

  async listEnrollments(learnerKey: string): Promise<Result<readonly EnrollmentRecord[]>> {
    return Ok(await this.repo.listEnrollmentsFor(learnerKey));
  }

  /**
   * The enrolment browser: every placement in the installation, filtered and
   * paged by the server. The clamping mirrors `listUsers` — the route
   * protects the wire, the service protects every caller.
   */
  async browseEnrollments(query: {
    schoolKey?: string | undefined;
    academicYearKey?: string | undefined;
    termKey?: string | undefined;
    gradeKey?: string | undefined;
    learnerKey?: string | undefined;
    current?: boolean | undefined;
    limit?: number | undefined;
    offset?: number | undefined;
  }): Promise<Result<EnrollmentListPage>> {
    return Ok(
      await this.repo.listEnrollments({
        ...(query.schoolKey ? { schoolKey: query.schoolKey } : {}),
        ...(query.academicYearKey ? { academicYearKey: query.academicYearKey } : {}),
        ...(query.termKey ? { termKey: query.termKey } : {}),
        ...(query.gradeKey ? { gradeKey: query.gradeKey } : {}),
        ...(query.learnerKey ? { learnerKey: query.learnerKey } : {}),
        ...(query.current !== undefined ? { current: query.current } : {}),
        limit: Math.min(Math.max(query.limit ?? 25, 1), 100),
        offset: Math.max(query.offset ?? 0, 0),
      }),
    );
  }

  /** The teacher directory: person, staff profile, school scope. */
  async listEducators(query: {
    search?: string | undefined;
    schoolKey?: string | undefined;
    limit?: number | undefined;
    offset?: number | undefined;
  }): Promise<Result<EducatorListPage>> {
    return Ok(
      await this.repo.listEducators({
        ...(query.search ? { search: query.search } : {}),
        ...(query.schoolKey ? { schoolKey: query.schoolKey } : {}),
        limit: Math.min(Math.max(query.limit ?? 25, 1), 100),
        offset: Math.max(query.offset ?? 0, 0),
      }),
    );
  }

  /**
   * Cohorts at a school: current enrolments grouped by grade. The
   * "class roster" the domain says must stay a query — this is that query,
   * aggregated server-side.
   */
  async cohorts(
    schoolKey: string,
    academicYearKey?: string | undefined,
  ): Promise<Result<readonly CohortCount[]>> {
    return Ok(await this.repo.cohortCounts(schoolKey, academicYearKey));
  }

  /**
   * Claim a guardian relationship. Unverified until somebody with authority
   * says otherwise.
   *
   * This is the boundary that matters most in this service: `learner-access.ts`
   * grants a parent visibility of a child's work through a **verified** link
   * only. Creating one verified by default would let anyone who can call this
   * endpoint read a learner's record.
   */
  async linkGuardian(
    ctx: ProvisioningContext,
    input: { guardianKey: string; learnerKey: string; relation?: string | null },
  ): Promise<Result<GuardianLinkRecord>> {
    const existing = await this.repo.findGuardianLink({
      guardianKey: input.guardianKey,
      learnerKey: input.learnerKey,
    });
    if (existing) {
      return Err(
        Errors.conflict('identity.guardian_link_exists', 'That guardian is already linked.', {
          guardianKey: input.guardianKey,
          learnerKey: input.learnerKey,
        }),
      );
    }

    const link = await this.repo.linkGuardian({
      guardianKey: input.guardianKey,
      learnerKey: input.learnerKey,
      relation: input.relation ?? null,
    });
    await this.log(ctx, 'identity.guardian_linked', input.learnerKey, {
      guardianKey: input.guardianKey,
      isVerified: link.isVerified,
    });
    return Ok(link);
  }

  /**
   * Confirm or withdraw a guardianship claim.
   *
   * Separate from linking, and audited, because this single boolean is what
   * opens a child's record to another account.
   */
  async setGuardianLinkVerified(
    ctx: ProvisioningContext,
    input: { guardianKey: string; learnerKey: string; isVerified: boolean },
  ): Promise<Result<GuardianLinkRecord>> {
    const existing = await this.repo.findGuardianLink(input);
    if (!existing) {
      return Err(
        Errors.notFound('identity.guardian_link_not_found', 'No such guardian link.', {
          guardianKey: input.guardianKey,
          learnerKey: input.learnerKey,
        }),
      );
    }
    if (existing.isVerified === input.isVerified) {
      return Err(
        Errors.conflict('identity.guardian_link_unchanged', 'That link already has that state.', {
          isVerified: input.isVerified,
        }),
      );
    }

    const link = await this.repo.setGuardianLinkVerified(input);
    await this.log(
      ctx,
      input.isVerified ? 'identity.guardian_verified' : 'identity.guardian_unverified',
      input.learnerKey,
      { guardianKey: input.guardianKey },
    );
    return Ok(link);
  }

  async unlinkGuardian(
    ctx: ProvisioningContext,
    input: { guardianKey: string; learnerKey: string },
  ): Promise<Result<void>> {
    const existing = await this.repo.findGuardianLink(input);
    if (!existing) {
      return Err(
        Errors.notFound('identity.guardian_link_not_found', 'No such guardian link.', input),
      );
    }
    await this.repo.unlinkGuardian(input);
    await this.log(ctx, 'identity.guardian_unlinked', input.learnerKey, {
      guardianKey: input.guardianKey,
    });
    return Ok(undefined);
  }

  async listGuardiansOf(learnerKey: string): Promise<Result<readonly GuardianLinkRecord[]>> {
    return Ok(await this.repo.listGuardianLinksForLearner(learnerKey));
  }

  async listChildrenOf(guardianKey: string): Promise<Result<readonly GuardianLinkRecord[]>> {
    return Ok(await this.repo.listGuardianLinksForGuardian(guardianKey));
  }

  /**
   * The user directory (gap G6).
   *
   * `limit` is clamped here rather than trusted from the route: the service is
   * the layer that owns the rule, and a second caller must not be able to ask
   * for the whole table.
   */
  async listUsers(query: {
    search?: string | undefined;
    role?: string | undefined;
    status?: string | undefined;
    schoolKey?: string | undefined;
    limit?: number | undefined;
    offset?: number | undefined;
  }): Promise<Result<UserDirectoryPage>> {
    const page = await this.repo.listUsers({
      ...(query.search ? { search: query.search } : {}),
      ...(query.role ? { role: query.role } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.schoolKey ? { schoolKey: query.schoolKey } : {}),
      limit: Math.min(Math.max(query.limit ?? 25, 1), 100),
      offset: Math.max(query.offset ?? 0, 0),
    });
    return Ok(page);
  }

  async getUser(userKey: string): Promise<Result<ProvisionedUser>> {
    const user = await this.repo.findUserByKey(userKey);
    return user ? Ok(user) : this.noSuchUser(userKey);
  }

  private noSuchUser(userKey: string): Result<never> {
    return Err(Errors.notFound('identity.user_not_found', 'No such user.', { userKey }));
  }

  private async log(
    ctx: ProvisioningContext,
    action: string,
    entityKey: string,
    after: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.audit.record({
        actorId: ctx.actorId,
        action,
        entity: 'identity',
        entityKey,
        after,
      });
    } catch {
      // Best-effort: a lost audit line must not fail the provisioning act.
    }
  }
}
