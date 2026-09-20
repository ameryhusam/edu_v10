/**
 * Provisioning rules — the pure ones.
 *
 * These tests are about decisions, not plumbing: what makes a key, which roles
 * imply a profile, when a scoped grant is ambiguous, and which status changes
 * are honest. Everything here must give the same answer at every call site,
 * because provisioning is where a person's access originates.
 */

import { describe, expect, it } from 'vitest';

import {
  KEY_PREFIX,
  MIN_PASSWORD_LENGTH,
  PLATFORM_WIDE_ROLES,
  enrollmentKeyFor,
  guardianKeyFor,
  learnerKeyFor,
  normalizeHandle,
  profilesRequiredFor,
  userKeyFor,
  validateNewUser,
  validateRoleGrant,
  validateStatusChange,
} from '../../src/contexts/identity/domain/provisioning.js';

const ok = <T>(r: { ok: boolean; value?: T }) => {
  expect(r.ok).toBe(true);
  return (r as { value: T }).value;
};
const err = (r: { ok: boolean; error?: { code: string } }) => {
  expect(r.ok).toBe(false);
  return (r as { error: { code: string } }).error;
};

describe('provisioning — keys are derived from the handle', () => {
  it('produces the prefixes the database already uses', () => {
    // Not a new format: these are the keys seed.ts authored. Inventing a
    // different shape now would orphan every existing row and fixture.
    expect(ok(userKeyFor('demo_student'))).toBe('usr_demo_student');
    expect(ok(learnerKeyFor('demo_student'))).toBe('lrn_demo_student');
    expect(ok(guardianKeyFor('demo_parent'))).toBe('gdn_demo_parent');
    expect(KEY_PREFIX.enrollment).toBe('enr_');
  });

  it('normalises case, spaces and punctuation to one canonical form', () => {
    expect(ok(normalizeHandle('  Sara.Ali-99  '))).toBe('sara_ali_99');
    expect(ok(normalizeHandle('a--b__c'))).toBe('a_b_c');
  });

  it('refuses a handle that would leave nothing usable in a key', () => {
    // Arabic display names are normal here and transliterate to nothing, which
    // is exactly why the username is the basis rather than the full name.
    expect(err(normalizeHandle('أحمد')).code).toBe('identity.handle_unusable');
    expect(err(normalizeHandle('   ')).code).toBe('identity.handle_required');
  });

  it('refuses a handle too long to live in a url or a log line', () => {
    expect(err(normalizeHandle('x'.repeat(41))).code).toBe('identity.handle_too_long');
  });

  it('derives an enrolment key from the coordinate, not a counter', () => {
    // The same tuple the unique constraint uses, so a duplicate enrolment
    // collides on the key too and is caught by identity, not only by the DB.
    expect(
      ok(enrollmentKeyFor({ learnerKey: 'lrn_demo_student', academicYearKey: '2026-2027', termOrdinal: 1 })),
    ).toBe('enr_lrn_demo_student_2026-2027_T01');
  });

  it('refuses an enrolment key for a term that cannot exist', () => {
    expect(
      err(enrollmentKeyFor({ learnerKey: 'lrn_x', academicYearKey: '2026-2027', termOrdinal: 0 })).code,
    ).toBe('identity.term_ordinal_invalid');
  });
});

describe('provisioning — a person we can actually create', () => {
  const draft = {
    username: 'Sara.Ali',
    fullName: 'Sara Ali',
    password: 'correct horse',
    email: 'sara@example.com',
  };

  it('returns the derived key with the cleaned fields', () => {
    const user = ok(validateNewUser(draft));
    expect(user.key).toBe('usr_sara_ali');
    expect(user.username).toBe('sara.ali');
    expect(user.email).toBe('sara@example.com');
    expect(user.phone).toBeNull();
  });

  it('requires a full name', () => {
    expect(err(validateNewUser({ ...draft, fullName: '  ' })).code).toBe(
      'identity.full_name_required',
    );
  });

  it('enforces length as the only password rule', () => {
    expect(err(validateNewUser({ ...draft, password: 'short' })).code).toBe(
      'identity.password_too_short',
    );
    expect(ok(validateNewUser({ ...draft, password: 'x'.repeat(MIN_PASSWORD_LENGTH) })).key).toBe(
      'usr_sara_ali',
    );
  });

  it('treats a blank email as absent rather than invalid', () => {
    expect(ok(validateNewUser({ ...draft, email: '' })).email).toBeNull();
  });

  it('refuses an email that is not usable', () => {
    expect(err(validateNewUser({ ...draft, email: 'sara@localhost' })).code).toBe(
      'identity.email_invalid',
    );
  });
});

describe('provisioning — roles imply profiles', () => {
  it('a student needs a learner profile and a parent needs a guardian one', () => {
    // Without this a STUDENT can log in and then fail at every learner-scoped
    // route, because learnerKey resolves to nothing.
    expect(profilesRequiredFor(['STUDENT'])).toEqual(['learner']);
    expect(profilesRequiredFor(['PARENT'])).toEqual(['guardian']);
  });

  it('a teacher needs an educator profile; an author or admin needs none', () => {
    // TEACHER implies a profile for the same reason STUDENT does: it is where
    // the staff-specific fields (employeeCode, specialty) live, and a teacher
    // without one cannot be linked to a class. CONTENT_AUTHOR and SCHOOL_ADMIN
    // are pure role grants with no profile of their own.
    expect(profilesRequiredFor(['TEACHER'])).toEqual(['educator']);
    expect(profilesRequiredFor(['CONTENT_AUTHOR', 'SCHOOL_ADMIN'])).toEqual([]);
  });

  it('asks for each profile once even when several roles imply it', () => {
    expect(profilesRequiredFor(['STUDENT', 'STUDENT', 'PARENT'])).toEqual(['learner', 'guardian']);
  });
});

describe('provisioning — a role grant must be unambiguous', () => {
  it('refuses a role the system does not have', () => {
    expect(
      err(validateRoleGrant({ role: 'PRINCIPAL', schoolKey: null, multiSchool: false })).code,
    ).toBe('identity.unknown_role');
  });

  it('keeps platform roles platform-wide', () => {
    for (const role of PLATFORM_WIDE_ROLES) {
      expect(
        err(validateRoleGrant({ role, schoolKey: 'SCH-1', multiSchool: true })).code,
      ).toBe('identity.role_not_school_scoped');
    }
  });

  it('allows an unscoped teacher grant while only one school exists', () => {
    // The seed writes unscoped grants and hasRole reads a null school as
    // platform-wide. That is right for a single-school deployment.
    const grant = ok(validateRoleGrant({ role: 'TEACHER', schoolKey: null, multiSchool: false }));
    expect(grant.schoolKey).toBeNull();
  });

  it('refuses the same unscoped grant once a second school exists', () => {
    // The identical grant that was harmless is now cross-tenant access.
    expect(
      err(validateRoleGrant({ role: 'TEACHER', schoolKey: null, multiSchool: true })).code,
    ).toBe('identity.school_required');
  });
});

describe('provisioning — status changes stay honest', () => {
  it('refuses an unknown status', () => {
    expect(err(validateStatusChange('ACTIVE', 'DELETED')).code).toBe('identity.unknown_status');
  });

  it('refuses a change that changes nothing', () => {
    expect(err(validateStatusChange('ACTIVE', 'ACTIVE')).code).toBe('identity.status_unchanged');
  });

  it('treats archived as terminal', () => {
    // Flipping the column back would silently restore every role and guardian
    // link the person had.
    expect(err(validateStatusChange('ARCHIVED', 'ACTIVE')).code).toBe('identity.user_archived');
  });

  it('allows suspend and reinstate', () => {
    expect(ok(validateStatusChange('ACTIVE', 'SUSPENDED'))).toBe('SUSPENDED');
    expect(ok(validateStatusChange('SUSPENDED', 'ACTIVE'))).toBe('ACTIVE');
  });
});
