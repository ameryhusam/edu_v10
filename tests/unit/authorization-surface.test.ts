/**
 * The authorization surface, as a whole.
 *
 * Two properties are asserted here that no single route test can see, both of
 * them measured against what the legacy system actually did.
 *
 * **1. Every route file is guarded.** The legacy audit found 14 of 20 route
 * files with no authorization at all — including exams, learning, parent and
 * question routes. That, not coarse roles, was its real exposure. This test
 * fails the moment a new router ships without a guard, which is the failure
 * that actually causes incidents.
 *
 * **2. The R1 permission trigger has not fired.** R1 deferred a
 * `Permission`/`RolePermission` table with a named condition: the moment a
 * check needs finer granularity than the six roles. A document recording that
 * condition is a document nobody re-reads, so the condition is encoded here.
 * If someone introduces a permission-string check, this test fails and forces
 * the decision to be made deliberately — see docs/PERMISSION-TABLE-ANALYSIS.md.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ROLE_NAMES, hasRole } from '../../src/contexts/identity/domain/roles.js';

const HTTP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../src/interface/http');

const routeFiles = readdirSync(HTTP_DIR).filter((f) => f.endsWith('.routes.ts'));

/** Comments describe rules; they must not be mistaken for enforcing them. */
const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

/**
 * The functions that constitute an authorization decision.
 *
 * Derived from `learner-access.ts` rather than hardcoded: the first version of
 * this test listed the guards by hand, missed `requireSelfLearner`, and
 * reported `tutoring.routes.ts` as unguarded when it is in fact the *most*
 * strictly guarded router in the system — asking the tutor is never delegable.
 * A test that invents holes is worse than no test, because the fix is to
 * weaken the test.
 */
const AUTHORISERS = [
  'hasRole',
  'canReadAnyLearner',
  ...[
    ...readFileSync(resolve(HTTP_DIR, 'learner-access.ts'), 'utf8').matchAll(
      /export\s+(?:async\s+)?function\s+([A-Za-z]+)/g,
    ),
  ].map((m) => m[1]!),
];

describe('authorization surface', () => {
  it('finds the route files at all', () => {
    // A path typo would make every check below vacuously pass.
    expect(routeFiles.length).toBeGreaterThanOrEqual(10);
  });

  it.each(routeFiles)('%s guards every request', (file) => {
    const source = stripComments(readFileSync(resolve(HTTP_DIR, file), 'utf8'));

    // auth.routes is the one legitimate exception: login and refresh are how a
    // caller *becomes* authenticated, so they cannot require authentication.
    if (file === 'auth.routes.ts') {
      expect(source).toMatch(/requireAuth: true/);
      return;
    }

    expect(source, `${file} has no authentication guard`).toMatch(/requireAuth:\s*true/);
    expect(
      AUTHORISERS.some((fn) => new RegExp(`\\b${fn}\\s*\\(`).test(source)),
      `${file} authenticates but never authorises — every logged-in user can call it. ` +
        `Expected one of: ${AUTHORISERS.join(', ')}`,
    ).toBe(true);
  });

  it('has not started encoding permissions as strings (R1 trigger)', () => {
    // The trigger for introducing a Permission table. If this fails, read
    // docs/PERMISSION-TABLE-ANALYSIS.md before adding a table *or* deleting
    // this test: the question is whether the need is real granularity, or
    // scope/relationship wearing a permission costume.
    const offenders: string[] = [];
    for (const file of routeFiles) {
      const source = stripComments(readFileSync(resolve(HTTP_DIR, file), 'utf8'));
      // Legacy shape: requirePermission('users:update') / hasPermission(...)
      if (/\b(requirePermission|requireAnyPermission|hasPermission)\s*\(/.test(source)) {
        offenders.push(file);
      }
    }
    expect(offenders, 'permission-style checks appeared; R1 must be revisited').toEqual([]);
  });

  it('keeps every role name a compile-time value, not a free string', () => {
    // This is the property a permission table would give up: an invalid role is
    // a type error today, whereas an invalid permission string is a runtime
    // no-op that silently allows or denies.
    expect([...ROLE_NAMES].sort()).toEqual(
      ['CONTENT_AUTHOR', 'PARENT', 'SCHOOL_ADMIN', 'STUDENT', 'SYSTEM_ADMIN', 'TEACHER'].sort(),
    );
  });
});

describe('scope is part of the authorization decision', () => {
  const A = 'school-a';
  const B = 'school-b';

  it('does not let a teacher at one school act on another', () => {
    const teacherAtA = [{ role: 'TEACHER' as const, schoolId: A }];
    expect(hasRole(teacherAtA, ['TEACHER'], A)).toBe(true);
    // The R2 hole: a flat `includes` would return true here.
    expect(hasRole(teacherAtA, ['TEACHER'], B)).toBe(false);
  });

  it('treats SYSTEM_ADMIN as platform-wide and SCHOOL_ADMIN as bound', () => {
    const system = [{ role: 'SYSTEM_ADMIN' as const, schoolId: null }];
    const school = [{ role: 'SCHOOL_ADMIN' as const, schoolId: A }];

    expect(hasRole(system, ['SYSTEM_ADMIN'], B)).toBe(true);
    // The distinction the user insisted on, asserted rather than described.
    expect(hasRole(school, ['SCHOOL_ADMIN'], B)).toBe(false);
    expect(hasRole(school, ['SCHOOL_ADMIN'], A)).toBe(true);
  });

  it('never satisfies a role check the actor does not hold', () => {
    const student = [{ role: 'STUDENT' as const, schoolId: A }];
    expect(hasRole(student, ['TEACHER', 'SCHOOL_ADMIN'], A)).toBe(false);
    expect(hasRole(student, ['TEACHER'], null)).toBe(false);
  });
});
