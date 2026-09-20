/**
 * The role → destination matrix.
 *
 * Tested as data, with no DOM, because that is what it is. The cases worth
 * pinning are the ones a reasonable implementation gets wrong: a user with two
 * roles, and the mobile cap.
 */

import { describe, expect, it } from 'vitest';
import { destinationsFor, primaryDestinations } from './navigation';
import { ROLE_NAMES } from '../../shared/types/roles';
import { MESSAGES } from '../../shared/i18n/messages';

describe('destinations by role', () => {
  it('gives a student their own destinations and none of the teacher surface', () => {
    const paths = destinationsFor(['STUDENT']).map((d) => d.to);

    expect(paths).toContain('/');
    expect(paths).toContain('/path');
    expect(paths).toContain('/review');
    expect(paths.some((p) => p.startsWith('/teacher'))).toBe(false);
    expect(paths.some((p) => p.startsWith('/admin'))).toBe(false);
  });

  it('shows the union for a user holding two roles, not one chosen by precedence', () => {
    // A teacher who is also a parent. Picking a "primary" role hides a
    // destination the person actually needs.
    const paths = destinationsFor(['TEACHER', 'PARENT']).map((d) => d.to);

    expect(paths).toContain('/teacher');
    expect(paths).toContain('/parent');
  });

  it('does not repeat a destination two roles share', () => {
    const paths = destinationsFor(['SCHOOL_ADMIN', 'SYSTEM_ADMIN']).map((d) => d.to);
    expect(paths.length).toBe(new Set(paths).size);
  });

  it('returns nothing for a user with no roles rather than guessing', () => {
    expect(destinationsFor([])).toHaveLength(0);
  });
});

describe('the mobile bottom bar', () => {
  it('never exceeds five destinations for any role', () => {
    // Beyond five the targets get too narrow to hit reliably on a phone.
    for (const role of ROLE_NAMES) {
      const primary = primaryDestinations(destinationsFor([role]));
      expect(primary.length, `${role} bottom bar`).toBeLessThanOrEqual(5);
    }
  });

  it('caps a multi-role user at five as well', () => {
    const primary = primaryDestinations(destinationsFor([...ROLE_NAMES]));
    expect(primary.length).toBeLessThanOrEqual(5);
  });
});

describe('labels', () => {
  it('has an Arabic and an English string for every destination', () => {
    // A missing key renders as the key itself — visible, but not something to
    // discover in production.
    for (const role of ROLE_NAMES) {
      for (const destination of destinationsFor([role])) {
        expect(MESSAGES.ar[destination.labelKey], `ar:${destination.labelKey}`).toBeTruthy();
        expect(MESSAGES.en[destination.labelKey], `en:${destination.labelKey}`).toBeTruthy();
      }
    }
  });
});
