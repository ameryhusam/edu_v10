/**
 * Roles and authorisation decisions.
 *
 * PURE. Every "may this actor do this?" question is answered here, so the
 * answer cannot drift between call sites — the failure that produced four
 * mastery formulas is just as possible in authorisation, and more dangerous.
 *
 * Scope is part of the decision, not decoration. `UserRole` is stored per
 * school precisely because a TEACHER at school A is not a TEACHER at school B;
 * a check that ignores `schoolId` silently grants cross-tenant access.
 */

/** Mirrors the Prisma `RoleName` enum. Exhaustive by construction. */
export const ROLE_NAMES = [
  'SYSTEM_ADMIN',
  'SCHOOL_ADMIN',
  'TEACHER',
  'STUDENT',
  'PARENT',
  'CONTENT_AUTHOR',
] as const;

export type RoleName = (typeof ROLE_NAMES)[number];

export function isRoleName(value: string): value is RoleName {
  return (ROLE_NAMES as readonly string[]).includes(value);
}

export interface ScopedRoleGrant {
  readonly role: RoleName;
  /** `null` means platform-wide — only ever legitimate for SYSTEM_ADMIN. */
  readonly schoolId: string | null;
}

/**
 * Does the actor hold one of `allowed`, valid in `schoolId`?
 *
 * Rules, in order:
 *  - SYSTEM_ADMIN is platform-wide by definition.
 *  - A grant with `schoolId: null` for any other role is platform-wide too;
 *    this is how a seeded single-school deployment works without ceremony.
 *  - Otherwise the grant's school must match the school being acted upon.
 *  - When the resource has no school (`schoolId: null`), any grant satisfies
 *    the role check — the resource is not school-owned, so scope is not a
 *    meaningful constraint.
 */
export function hasRole(
  grants: readonly ScopedRoleGrant[],
  allowed: readonly RoleName[],
  schoolId: string | null = null,
): boolean {
  return grants.some((grant) => {
    if (!allowed.includes(grant.role)) return false;
    if (grant.role === 'SYSTEM_ADMIN') return true;
    if (grant.schoolId === null) return true;
    if (schoolId === null) return true;
    return grant.schoolId === schoolId;
  });
}

/** Every distinct role the actor holds, ignoring scope. For display only. */
export function roleNames(grants: readonly ScopedRoleGrant[]): RoleName[] {
  return [...new Set(grants.map((g) => g.role))];
}

/**
 * May this actor read another learner's data?
 *
 * Guardianship is NOT decided here — it needs a database lookup, and a domain
 * function that silently returns `false` for a real guardian would be worse
 * than no function. This answers only the part that is knowable from roles;
 * the caller must still verify the guardian link.
 */
export function canReadAnyLearner(
  grants: readonly ScopedRoleGrant[],
  schoolId: string | null = null,
): boolean {
  return hasRole(grants, ['SYSTEM_ADMIN', 'SCHOOL_ADMIN', 'TEACHER'], schoolId);
}
