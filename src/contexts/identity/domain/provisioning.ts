/**
 * Rules for bringing people into the system.
 *
 * PURE. No database, no hashing, no clock. Everything here is a decision that
 * must give the same answer at every call site, which is exactly the property
 * that four competing mastery formulas in the legacy system did not have.
 *
 * Two things this module deliberately does NOT do:
 *
 * **It does not decide authorization.** Whether an actor may provision anyone
 * is a role question, answered by `roles.ts` and enforced at the interface.
 * Mixing "may this actor act?" into "is this data coherent?" is how a
 * provisioning service turns into a second authorization engine.
 *
 * **It does not own the learner's school.** A learner's school comes from their
 * current enrolment, which belongs to Instruction. Identity owns who a person
 * is, not where they study.
 */

import { Errors } from '../../../shared/kernel/errors.js';
import { Err, Ok, type Result } from '../../../shared/kernel/result.js';
import { ROLE_NAMES, type RoleName } from './roles.js';

/** Mirrors the Prisma `UserStatus` enum. */
export const USER_STATUSES = ['ACTIVE', 'SUSPENDED', 'INVITED', 'ARCHIVED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/**
 * Key prefixes, one per kind of person-record.
 *
 * These are the formats already in the database (`usr_demo_student`,
 * `lrn_demo_student`, `gdn_demo_parent`, `enr_…`). They are re-declared here
 * rather than invented: the seed authored them, and changing the shape now
 * would orphan every existing row and every fixture that names one.
 */
export const KEY_PREFIX = {
  user: 'usr_',
  learner: 'lrn_',
  guardian: 'gdn_',
  educator: 'edu_',
  enrollment: 'enr_',
} as const;

/**
 * Turn a human-supplied handle into the stable part of a key.
 *
 * Lowercase, underscore-separated, ASCII. A key ends up in URLs, log lines and
 * fixtures, so it must not carry spaces, case that varies by keyboard, or
 * characters that need escaping. Arabic names are common here and transliterate
 * to nothing useful, which is why the *username* is the basis rather than the
 * display name.
 */
export function normalizeHandle(raw: string): Result<string> {
  const trimmed = (raw ?? '').trim().toLowerCase();
  if (trimmed.length === 0) {
    return Err(Errors.validation('identity.handle_required', 'A username is required.'));
  }

  const slug = trimmed
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_');

  if (slug.length === 0) {
    return Err(
      Errors.validation(
        'identity.handle_unusable',
        'A username must contain at least one letter or digit that can appear in a key.',
        { username: raw },
      ),
    );
  }
  if (slug.length > 40) {
    return Err(
      Errors.validation('identity.handle_too_long', 'A username may be at most 40 characters.', {
        length: slug.length,
      }),
    );
  }
  return Ok(slug);
}

export function userKeyFor(handle: string): Result<string> {
  const slug = normalizeHandle(handle);
  return slug.ok ? Ok(`${KEY_PREFIX.user}${slug.value}`) : slug;
}

export function learnerKeyFor(handle: string): Result<string> {
  const slug = normalizeHandle(handle);
  return slug.ok ? Ok(`${KEY_PREFIX.learner}${slug.value}`) : slug;
}

export function guardianKeyFor(handle: string): Result<string> {
  const slug = normalizeHandle(handle);
  return slug.ok ? Ok(`${KEY_PREFIX.guardian}${slug.value}`) : slug;
}

/**
 * The staff handle: `edu_<username>`. Same shape as the learner and guardian
 * keys so one person's three identifiers stay recognisably related.
 */
export function educatorKeyFor(handle: string): Result<string> {
  const slug = normalizeHandle(handle);
  return slug.ok ? Ok(`${KEY_PREFIX.educator}${slug.value}`) : slug;
}

/**
 * An enrolment key names the whole coordinate, not a counter.
 *
 * `enr_<learner>_<year>_T<nn>` is the format the seed already writes. It is
 * derived from the same tuple the unique constraint uses, so two attempts to
 * enrol the same learner in the same term collide on the key as well as on the
 * constraint — the duplicate is caught by identity, not only by the database.
 */
export function enrollmentKeyFor(input: {
  learnerKey: string;
  academicYearKey: string;
  termOrdinal: number;
}): Result<string> {
  if (!Number.isInteger(input.termOrdinal) || input.termOrdinal < 1) {
    return Err(
      Errors.validation('identity.term_ordinal_invalid', 'A term ordinal must be 1 or greater.', {
        termOrdinal: input.termOrdinal,
      }),
    );
  }
  const ordinal = String(input.termOrdinal).padStart(2, '0');
  return Ok(`${KEY_PREFIX.enrollment}${input.learnerKey}_${input.academicYearKey}_T${ordinal}`);
}

/**
 * Minimum password length at the point of provisioning.
 *
 * Deliberately the only password rule here. Composition rules (a digit, a
 * symbol) push users toward predictable substitutions and are not what makes a
 * credential strong; length is. Hashing is infrastructure's job, not this
 * module's.
 */
export const MIN_PASSWORD_LENGTH = 8;

export interface NewUserDraft {
  readonly username: string;
  readonly fullName: string;
  readonly password: string;
  readonly email?: string | null;
  readonly phone?: string | null;
}

export interface ValidatedUser {
  readonly key: string;
  readonly username: string;
  readonly fullName: string;
  readonly email: string | null;
  readonly phone: string | null;
}

/**
 * Is this a person we can actually create?
 *
 * Returns the derived key alongside the cleaned fields, because the caller must
 * never compose a key itself — that would be a second definition of identity.
 */
export function validateNewUser(draft: NewUserDraft): Result<ValidatedUser> {
  const fullName = (draft.fullName ?? '').trim();
  if (fullName.length === 0) {
    return Err(Errors.validation('identity.full_name_required', 'A full name is required.'));
  }

  const key = userKeyFor(draft.username);
  if (!key.ok) return key;

  if ((draft.password ?? '').length < MIN_PASSWORD_LENGTH) {
    return Err(
      Errors.validation(
        'identity.password_too_short',
        `A password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
        { minimum: MIN_PASSWORD_LENGTH },
      ),
    );
  }

  const email = (draft.email ?? '').trim();
  if (email.length > 0 && !/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email)) {
    return Err(
      Errors.validation('identity.email_invalid', 'That email address is not usable.', { email }),
    );
  }

  const username = (draft.username ?? '').trim().toLowerCase();
  return Ok({
    key: key.value,
    username,
    fullName,
    email: email.length > 0 ? email : null,
    phone: ((draft.phone ?? '').trim() || null) as string | null,
  });
}

/**
 * Which roles imply a profile row, and which profile.
 *
 * A STUDENT without a `LearnerProfile` can log in and then fail at every
 * learner-scoped route, because `learnerKey` resolves to nothing. A PARENT
 * without a `GuardianProfile` cannot be linked to a child. Making this a
 * declared mapping rather than an `if` in the service means the rule is stated
 * once and can be asserted against.
 */
export const PROFILE_FOR_ROLE: Readonly<
  Partial<Record<RoleName, 'learner' | 'guardian' | 'educator'>>
> = {
  STUDENT: 'learner',
  PARENT: 'guardian',
  TEACHER: 'educator',
};

export function profilesRequiredFor(
  roles: readonly RoleName[],
): ReadonlyArray<'learner' | 'guardian' | 'educator'> {
  const needed = new Set<'learner' | 'guardian' | 'educator'>();
  for (const role of roles) {
    const profile = PROFILE_FOR_ROLE[role];
    if (profile) needed.add(profile);
  }
  return [...needed];
}

/**
 * A role grant must name a school, unless it is genuinely platform-wide.
 *
 * SYSTEM_ADMIN and CONTENT_AUTHOR are platform roles: a content author writes
 * books, not books-for-one-school. Everything else is scoped, and a grant that
 * forgets its school silently becomes cross-tenant access — `hasRole` treats a
 * null school as platform-wide, which is correct for a single-school
 * deployment and dangerous for a multi-school one.
 */
export const PLATFORM_WIDE_ROLES: readonly RoleName[] = ['SYSTEM_ADMIN', 'CONTENT_AUTHOR'];

/**
 * Roles a person may claim for themselves when creating their own account.
 *
 * The list is deliberately short, and the reasoning is the same for each
 * exclusion: a role that grants authority over *other people's* data cannot be
 * self-asserted. SCHOOL_ADMIN reads every learner in a school, CONTENT_AUTHOR
 * writes the textbooks every learner is taught from, and SYSTEM_ADMIN is
 * unbounded. Anyone could type the word.
 *
 * TEACHER is included, which looks inconsistent until you notice what a
 * freshly self-registered teacher can actually reach: nothing, until an
 * administrator enrols them against a school and a class. The role name alone
 * carries no roster.
 *
 * Enforced here rather than in the HTTP layer so that every caller — the
 * public endpoint today, an invitation flow tomorrow — gets the same answer.
 */
export const SELF_SERVICE_ROLES: readonly RoleName[] = ['STUDENT', 'TEACHER', 'PARENT'];

/**
 * May an anonymous person create an account with this role?
 *
 * Returns a refusal rather than a boolean so the caller cannot accidentally
 * treat "not allowed" as a validation detail to be reported inconsistently.
 */
export function validateSelfServiceRole(role: string): Result<RoleName> {
  if (!(ROLE_NAMES as readonly string[]).includes(role)) {
    return Err(
      Errors.validation('identity.unknown_role', 'That is not a role this system grants.', {
        role,
      }),
    );
  }

  if (!SELF_SERVICE_ROLES.includes(role as RoleName)) {
    // Deliberately a refusal, not a silent downgrade to STUDENT: quietly
    // giving someone a different role than they asked for is worse than
    // telling them no.
    return Err(
      Errors.forbidden(
        'identity.role_not_self_service',
        'That role is assigned by an administrator and cannot be self-registered.',
        { role, selfServiceRoles: SELF_SERVICE_ROLES },
      ),
    );
  }

  return Ok(role as RoleName);
}

export function validateRoleGrant(input: {
  role: string;
  schoolKey: string | null;
  /** True when the deployment has more than one school on record. */
  multiSchool: boolean;
}): Result<{ role: RoleName; schoolKey: string | null }> {
  if (!(ROLE_NAMES as readonly string[]).includes(input.role)) {
    return Err(
      Errors.validation('identity.unknown_role', 'That is not a role this system grants.', {
        role: input.role,
        known: ROLE_NAMES,
      }),
    );
  }
  const role = input.role as RoleName;

  if (PLATFORM_WIDE_ROLES.includes(role)) {
    if (input.schoolKey !== null) {
      return Err(
        Errors.validation(
          'identity.role_not_school_scoped',
          `${role} is a platform role and cannot be granted for a single school.`,
          { role },
        ),
      );
    }
    return Ok({ role, schoolKey: null });
  }

  // In a single-school deployment an unscoped grant is the established
  // convention (the seed writes them), so requiring a school there would break
  // existing data for no safety gain. Once a second school exists the same
  // grant is ambiguous, and ambiguity here means cross-tenant access.
  if (input.schoolKey === null && input.multiSchool) {
    return Err(
      Errors.validation(
        'identity.school_required',
        `${role} must be granted for a specific school once more than one school exists.`,
        { role },
      ),
    );
  }

  return Ok({ role, schoolKey: input.schoolKey });
}

/**
 * May this status change happen?
 *
 * ARCHIVED is terminal. Reviving an archived person by flipping a column would
 * silently restore every role and guardian link they had, which is not a
 * decision a status field should be able to make on its own.
 */
export function validateStatusChange(from: string, to: string): Result<UserStatus> {
  if (!(USER_STATUSES as readonly string[]).includes(to)) {
    return Err(
      Errors.validation('identity.unknown_status', 'That is not a status a user can have.', {
        status: to,
        known: USER_STATUSES,
      }),
    );
  }
  if (from === to) {
    return Err(
      Errors.conflict('identity.status_unchanged', 'The user already has that status.', {
        status: to,
      }),
    );
  }
  if (from === 'ARCHIVED') {
    return Err(
      Errors.conflict(
        'identity.user_archived',
        'An archived user cannot be reinstated by changing status; provision them again.',
        { status: from },
      ),
    );
  }
  return Ok(to as UserStatus);
}
