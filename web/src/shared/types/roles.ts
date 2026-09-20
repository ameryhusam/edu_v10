/**
 * Role vocabulary, mirrored from the backend's `RoleName` enum.
 *
 * Declared rather than imported: FE7 forbids the frontend importing backend
 * source, because that would couple a browser bundle to Node-only modules and
 * to Prisma's generated client. The list is small, stable and enum-shaped —
 * duplicating six strings is the lesser cost. A backend change that adds a
 * role will surface here as a missing translation key, which is a visible
 * failure rather than a silent one.
 */

export const ROLE_NAMES = [
  'SYSTEM_ADMIN',
  'SCHOOL_ADMIN',
  'TEACHER',
  'STUDENT',
  'PARENT',
  'CONTENT_AUTHOR',
] as const;

export type RoleName = (typeof ROLE_NAMES)[number];

/**
 * A role grant, valid either platform-wide or within one school.
 *
 * `schoolId: null` means platform-wide. The client uses this only to decide
 * what to show and which school scope to send on staff analytics calls; the
 * backend re-checks every grant on every request.
 */
export interface ScopedRole {
  readonly role: RoleName;
  readonly schoolId: string | null;
}

/**
 * Presentation profiles (§20, §46).
 *
 * Deliberately NOT roles. A profile changes information density and wording;
 * it grants nothing and gates nothing. Keeping it in a separate type from
 * `RoleName` is what stops it drifting into an authorization concept.
 */
export const EXPERIENCE_PROFILES = ['EARLY_LEARNER', 'SCHOOL_LEARNER', 'ADULT_LEARNER'] as const;
export type ExperienceProfile = (typeof EXPERIENCE_PROFILES)[number];
