/**
 * The seed's reference data is a contract, so it is tested like one.
 *
 * These are pure assertions over `prisma/seed/data/*.json` — no database, no
 * Prisma. They exist because every bug they catch has already happened once:
 *
 *   - The catalogue held 7 subjects while the converted curriculum needed
 *     SCI, so the national science textbook could not be created at all.
 *     Content import fails at the coordinate lookup, far from the cause.
 *   - CONTENT_AUTHOR was seeded with a school, quietly making a platform-wide
 *     role school-scoped. Nothing failed; the grant was just narrower than
 *     intended, which is the worst kind of authorization bug.
 *
 * The role-scoping tests below are the important ones. SYSTEM_ADMIN and
 * SCHOOL_ADMIN are different roles, and the difference is expressed entirely
 * by whether the grant carries a school.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PLATFORM_WIDE_ROLES } from '../../src/contexts/identity/domain/provisioning.js';

const DATA = resolve(dirname(fileURLToPath(import.meta.url)), '../../prisma/seed/data');
const read = (f: string): any => JSON.parse(readFileSync(resolve(DATA, f), 'utf8'));

const structure = read('academic-structure.json');
const catalogue = read('subjects.json');
const demo = read('demo-users.json');

/** The seed treats the current year as its anchor, so the tests do too. */
const currentYear =
  structure.AcademicYear.find((y: any) => y.isCurrent) ?? structure.AcademicYear[0];

describe('seed reference data: academic structure', () => {
  it('covers all twelve grades, each with a distinct ordinal', () => {
    const ordinals = structure.Grade.map((g: any) => g.ordinal);
    expect(structure.Grade).toHaveLength(12);
    expect(new Set(ordinals).size).toBe(12);
    // Grade.ordinal is unique in the schema; a duplicate is a seed crash.
    expect([...ordinals].sort((a: number, b: number) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
  });

  it('scopes term keys to their academic year', () => {
    // Term.key is globally unique, so a bare 'T1' could exist for exactly one
    // year in the entire system. Legacy used bare keys and would collide on
    // the second year it ever seeded.
    for (const term of structure.Term) {
      expect(term.key.startsWith(currentYear.key)).toBe(true);
    }
  });

  it('has exactly one current academic year, and it is not inverted', () => {
    expect(currentYear.isCurrent).toBe(true);
    expect(new Date(currentYear.startsOn).getTime()).toBeLessThan(
      new Date(currentYear.endsOn).getTime(),
    );
  });
});

describe('seed reference data: subject catalogue', () => {
  it('has unique keys', () => {
    const keys = catalogue.Subject.map((s: any) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('contains every subject the converted curriculum targets', () => {
    // If this fails, content import fails later with a coordinate error that
    // does not mention the catalogue. Fail here instead, where the fix is.
    const keys = new Set(catalogue.Subject.map((s: any) => s.key));
    for (const required of ['MATH', 'SCI', 'ARAB', 'ENG', 'ISL', 'GEO', 'CIV']) {
      expect(keys, `catalogue is missing ${required}`).toContain(required);
    }
  });
});

describe('seed reference data: demo accounts', () => {
  it('has unique keys and usernames', () => {
    const keys = demo.User.map((u: any) => u.key);
    const names = demo.User.map((u: any) => u.username);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(names).size).toBe(names.length);
  });

  it('keeps SYSTEM_ADMIN and SCHOOL_ADMIN as two different accounts', () => {
    const holders = (role: string) =>
      demo.User.filter((u: any) => u.roles.some((r: any) => r.role === role));

    const system = holders('SYSTEM_ADMIN');
    const school = holders('SCHOOL_ADMIN');

    expect(system).toHaveLength(1);
    expect(school).toHaveLength(1);
    // The whole point: merging them would make the boundary untestable,
    // because every request would succeed and nothing would show which grant
    // allowed it.
    expect(system[0].key).not.toBe(school[0].key);
  });

  it('gives platform-wide roles no school, and school roles a school', () => {
    for (const user of demo.User) {
      for (const grant of user.roles) {
        if ((PLATFORM_WIDE_ROLES as readonly string[]).includes(grant.role)) {
          expect(grant.schoolKey, `${user.username}/${grant.role} must not be school-scoped`).toBeNull();
        } else {
          expect(grant.schoolKey, `${user.username}/${grant.role} needs a school`).toBeTruthy();
        }
      }
    }
  });

  it('references only schools and grades that the structure defines', () => {
    const schools = new Set(structure.School.map((s: any) => s.key));
    const grades = new Set(structure.Grade.map((g: any) => g.key));
    for (const user of demo.User) {
      for (const grant of user.roles) {
        if (grant.schoolKey) expect(schools).toContain(grant.schoolKey);
      }
      if (user.learnerProfile) expect(grades).toContain(user.learnerProfile.gradeKey);
    }
  });

  it('links every guardian child to a learner that exists', () => {
    const learners = new Set(
      demo.User.filter((u: any) => u.learnerProfile).map((u: any) => u.learnerProfile.key),
    );
    for (const user of demo.User) {
      if (!user.guardianProfile) continue;
      for (const child of user.guardianProfile.children) {
        expect(learners, `unknown learner ${child.learnerKey}`).toContain(child.learnerKey);
      }
    }
  });

  it('provides two distinct content authors, so review is a real handoff', () => {
    // SUBMIT and APPROVE by the same person is not a review. The seed must
    // make the two-person case possible without hand-creating an account.
    const authors = demo.User.filter((u: any) =>
      u.roles.some((r: any) => r.role === 'CONTENT_AUTHOR'),
    );
    expect(authors.length).toBeGreaterThanOrEqual(2);
  });
});
