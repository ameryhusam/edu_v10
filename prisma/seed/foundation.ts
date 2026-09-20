/**
 * The reference foundation: calendar, catalogue, schools and demo accounts.
 *
 * Migrated from the legacy `seed.config.ts`, which got one thing importantly
 * right: **the foundation is data, not code**. Adding a grade, a term or a
 * subject must not require editing a script. The first version of the new seed
 * hardcoded a single grade and a single subject, and that is exactly why the
 * converted national science curriculum could not be imported — a textbook
 * cannot be created for a subject the catalogue does not contain.
 *
 * Three rules carried over from legacy, all still correct:
 *
 *   1. **Reference data only.** This file writes no curriculum: no units,
 *      lessons, concepts or questions. Content arrives through the canonical
 *      import path, which enforces validation and review. A seed that can
 *      create content is a second write path.
 *   2. **Idempotent.** Every write is an upsert keyed on the business key, so
 *      re-seeding is safe and never duplicates.
 *   3. **Roles before users**, because a user without a role is unroutable.
 *
 * What legacy got wrong and is not carried over: it seeded `SUPER_ADMIN` and
 * `ADMIN` as interchangeable-looking accounts. Here they are deliberately
 * different things — see `seedDemoAccounts`.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PrismaClient, RoleName, UserStatus } from '@prisma/client';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(HERE, 'data');

function readData<T>(file: string): T {
  return JSON.parse(readFileSync(resolve(DATA, file), 'utf8')) as T;
}

/**
 * The JSON shapes below mirror the Prisma models one-for-one.
 *
 * Each top-level section is named after the model it fills (`AcademicYear`,
 * `Term`, `Grade`, `School`, `Subject`, `User`) and each field is named after
 * a real column on that model. The one deliberate exception is a reference to
 * another row, which is written as `<model>Key` and resolved to an id by the
 * seed — the JSON cannot know a uuid that Postgres has not generated yet.
 *
 * This is not cosmetic. When the data file and the schema use different words
 * for the same thing, every reader has to hold a translation table in their
 * head, and a schema rename leaves the data file silently stale. Keeping the
 * names identical makes a mismatch a compile or test failure instead of a
 * puzzle, which is what `seed-foundation-data.test.ts` now enforces against
 * the generated schema.
 */
interface AcademicStructure {
  AcademicYear: Array<{ key: string; startsOn: string; endsOn: string; isCurrent: boolean }>;
  Term: Array<{ key: string; academicYearKey: string; ordinal: number; name: string }>;
  Grade: Array<{ key: string; ordinal: number; name: string; stage: string; isActive: boolean }>;
  School: Array<{ key: string; name: string; city?: string; isActive: boolean }>;
}

interface SubjectCatalogue {
  Subject: Array<{ key: string; name: string; nameEn?: string; isActive: boolean; standardGradeLevels?: number[] }>;
}

interface DemoUsers {
  password: string;
  User: Array<{
    key: string;
    username: string;
    fullName: string;
    email: string;
    phone?: string;
    status: UserStatus;
    locale: string;
    learnerProfile?: {
      key: string;
      gradeKey: string;
      xpTotal: number;
      level: number;
      streakDays: number;
    };
    educatorProfile?: { key: string; employeeCode?: string; specialty?: string };
    guardianProfile?: {
      key: string;
      children: Array<{ learnerKey: string; relation: string; isVerified: boolean }>;
    };
    roles: Array<{ role: string; schoolKey: string | null }>;
  }>;
}

export interface FoundationReport {
  academicYears: number;
  terms: number;
  grades: number;
  schools: number;
  subjects: number;
  users: number;
  roleGrants: number;
  learners: number;
  educators: number;
  guardianLinks: number;
  enrollments: number;
}

/**
 * Seed the academic calendar, the subject catalogue and the schools.
 *
 * Everything is sequential, and deliberately so. These writes have real
 * ordering dependencies — a term needs its academic year, an enrollment needs
 * its grade and school — so `Promise.all` would not merely be unsafe, it would
 * be wrong. PGlite also executes one statement at a time, so parallelism would
 * buy nothing here even if the dependencies allowed it.
 */
export async function seedFoundation(prisma: PrismaClient): Promise<{
  report: Pick<FoundationReport, 'academicYears' | 'terms' | 'grades' | 'schools' | 'subjects'>;
  currentYearKey: string;
  firstTermKey: string;
}> {
  const structure = readData<AcademicStructure>('academic-structure.json');
  const catalogue = readData<SubjectCatalogue>('subjects.json');

  // Years first: a term cannot resolve its academicYearKey before the year
  // it names exists.
  const yearIds = new Map<string, string>();
  for (const spec of structure.AcademicYear) {
    const row = await prisma.academicYear.upsert({
      where: { key: spec.key },
      create: {
        key: spec.key,
        startsOn: new Date(spec.startsOn),
        endsOn: new Date(spec.endsOn),
        isCurrent: spec.isCurrent,
      },
      update: { isCurrent: spec.isCurrent },
    });
    yearIds.set(spec.key, row.id);
  }

  for (const term of structure.Term) {
    const academicYearId = yearIds.get(term.academicYearKey);
    if (!academicYearId) {
      // Named loudly here rather than as a foreign-key violation three frames
      // deep in the driver, which says nothing about which term is at fault.
      throw new Error(
        `term ${term.key} references unknown academic year ${term.academicYearKey}`,
      );
    }
    await prisma.term.upsert({
      where: { key: term.key },
      create: {
        key: term.key,
        academicYearId,
        ordinal: term.ordinal,
        name: term.name,
      },
      update: { name: term.name },
    });
  }

  for (const grade of structure.Grade) {
    await prisma.grade.upsert({
      where: { key: grade.key },
      create: {
        key: grade.key,
        ordinal: grade.ordinal,
        name: grade.name,
        stage: grade.stage,
        isActive: grade.isActive,
      },
      update: { name: grade.name, stage: grade.stage, isActive: grade.isActive },
    });
  }

  for (const school of structure.School) {
    await prisma.school.upsert({
      where: { key: school.key },
      create: {
        key: school.key,
        name: school.name,
        city: school.city ?? null,
        isActive: school.isActive,
      },
      update: { name: school.name, city: school.city ?? null, isActive: school.isActive },
    });
  }

  for (const subject of catalogue.Subject) {
    await prisma.subject.upsert({
      where: { key: subject.key },
      create: {
        key: subject.key,
        name: subject.name,
        nameEn: subject.nameEn ?? null,
        isActive: subject.isActive,
        standardGradeLevels: subject.standardGradeLevels ?? [],
      },
      update: { name: subject.name, nameEn: subject.nameEn ?? null, isActive: subject.isActive, standardGradeLevels: subject.standardGradeLevels ?? [] },
    });
  }

  const currentYear =
    structure.AcademicYear.find((candidate) => candidate.isCurrent) ?? structure.AcademicYear[0];
  if (!currentYear) throw new Error('academic-structure.json defines no AcademicYear');

  const firstTerm = structure.Term.filter(
    (term) => term.academicYearKey === currentYear.key,
  ).sort((a, b) => a.ordinal - b.ordinal)[0];
  if (!firstTerm) throw new Error(`no Term defined for academic year ${currentYear.key}`);

  return {
    report: {
      academicYears: structure.AcademicYear.length,
      terms: structure.Term.length,
      grades: structure.Grade.length,
      schools: structure.School.length,
      subjects: catalogue.Subject.length,
    },
    currentYearKey: currentYear.key,
    firstTermKey: firstTerm.key,
  };
}

/**
 * Seed the demo accounts.
 *
 * **`SYSTEM_ADMIN` and `SCHOOL_ADMIN` are different accounts, on purpose.**
 * Legacy seeded `SUPER_ADMIN` and `ADMIN` as two rows that looked alike and
 * were treated alike. In this system the difference is structural, not
 * cosmetic: `PLATFORM_WIDE_ROLES` requires `SYSTEM_ADMIN` to hold a grant with
 * `schoolId: null`, which is what makes it see every school, while
 * `SCHOOL_ADMIN` is bound to one school and must not see others.
 *
 * Giving one demo account both roles would make that boundary untestable —
 * every request would succeed and nothing would prove which grant allowed it.
 */
export async function seedDemoAccounts(
  prisma: PrismaClient,
  hashPassword: (plain: string) => Promise<string>,
  context: { currentYearKey: string; firstTermKey: string },
): Promise<{
  report: Pick<
    FoundationReport,
    'users' | 'roleGrants' | 'learners' | 'educators' | 'guardianLinks' | 'enrollments'
  >;
  password: string;
}> {
  const data = readData<DemoUsers>('demo-users.json');
  const passwordHash = await hashPassword(data.password);

  const year = await prisma.academicYear.findUniqueOrThrow({
    where: { key: context.currentYearKey },
  });
  const term = await prisma.term.findUniqueOrThrow({ where: { key: context.firstTermKey } });

  let roleGrants = 0;
  let learners = 0;
  let educators = 0;
  let guardianLinks = 0;
  let enrollments = 0;

  /** learner key -> row id, so guardian links can resolve in a second pass. */
  const learnerIds = new Map<string, string>();

  for (const spec of data.User) {
    const user = await prisma.user.upsert({
      where: { key: spec.key },
      create: {
        key: spec.key,
        username: spec.username,
        email: spec.email,
        passwordHash,
        fullName: spec.fullName,
        phone: spec.phone ?? null,
        // Taken from the file rather than hardcoded: a suspended demo account
        // is the only way to exercise the suspended-login path by hand.
        status: spec.status,
        locale: spec.locale,
      },
      // Refreshed on every re-seed: the password (so a changed demo credential
      // takes effect) and the descriptive fields, so an existing development
      // database picks up new seed data instead of silently keeping the older,
      // emptier row. `status` is included deliberately — it is how you restore
      // an account you suspended by hand while testing.
      //
      // Not refreshed: anything the running system earns or owns. Engagement
      // counters, sessions and role grants are handled separately below.
      update: {
        passwordHash,
        email: spec.email,
        fullName: spec.fullName,
        phone: spec.phone ?? null,
        status: spec.status,
        locale: spec.locale,
      },
    });

    for (const grant of spec.roles) {
      // A platform-wide role carries no school. Writing one anyway would make
      // the grant school-scoped and silently strip its platform reach.
      const school = grant.schoolKey
        ? await prisma.school.findUniqueOrThrow({ where: { key: grant.schoolKey } })
        : null;

      // A platform-wide grant cannot be upserted on the compound key: Postgres
      // unique indexes do not treat two NULLs as equal, so `schoolId: null`
      // would insert a duplicate row on every re-seed. Find first, then create.
      const existing = await prisma.userRole.findFirst({
        where: { userId: user.id, role: grant.role as RoleName, schoolId: school?.id ?? null },
      });
      if (!existing) {
        await prisma.userRole.create({
          data: { userId: user.id, role: grant.role as RoleName, schoolId: school?.id ?? null },
        });
      }
      roleGrants += 1;
    }

    if (spec.educatorProfile) {
      // A teacher needs a profile row for the same reason a learner does: it
      // is where staff-specific fields live. Nothing seeded one before, so
      // educator_profiles was empty in every development database.
      await prisma.educatorProfile.upsert({
        where: { key: spec.educatorProfile.key },
        create: {
          key: spec.educatorProfile.key,
          userId: user.id,
          employeeCode: spec.educatorProfile.employeeCode ?? null,
          specialty: spec.educatorProfile.specialty ?? null,
        },
        update: {
          employeeCode: spec.educatorProfile.employeeCode ?? null,
          specialty: spec.educatorProfile.specialty ?? null,
        },
      });
      educators += 1;
    }

    if (spec.learnerProfile) {
      const learner = await prisma.learnerProfile.upsert({
        where: { key: spec.learnerProfile.key },
        create: {
          key: spec.learnerProfile.key,
          userId: user.id,
          xpTotal: spec.learnerProfile.xpTotal,
          level: spec.learnerProfile.level,
          streakDays: spec.learnerProfile.streakDays,
        },
        // Engagement counters are NOT reset on re-seed. They are earned state:
        // wiping the XP of a learner you have been clicking through all morning
        // would destroy the very thing you were testing.
        update: {},
      });
      learnerIds.set(spec.learnerProfile.key, learner.id);
      learners += 1;

      const grade = await prisma.grade.findUniqueOrThrow({
        where: { key: spec.learnerProfile.gradeKey },
      });
      const enrollingSchoolKey = spec.roles[0]?.schoolKey;
      if (!enrollingSchoolKey) {
        // Previously this defaulted to 'sch_demo', so a learner whose role
        // carried no school was enrolled somewhere nobody asked for.
        throw new Error(
          `learner ${spec.learnerProfile.key} cannot be enrolled: user ${spec.username} has no school-scoped role`,
        );
      }
      const school = await prisma.school.findUniqueOrThrow({
        where: { key: enrollingSchoolKey },
      });

      await prisma.enrollment.upsert({
        where: {
          learnerId_academicYearId_termId: {
            learnerId: learner.id,
            academicYearId: year.id,
            termId: term.id,
          },
        },
        create: {
          key: `enr_${learner.key}_${context.firstTermKey}`,
          learnerId: learner.id,
          schoolId: school.id,
          gradeId: grade.id,
          academicYearId: year.id,
          termId: term.id,
          isCurrent: true,
        },
        update: { isCurrent: true },
      });
      enrollments += 1;
    }
  }

  // Guardian links in a second pass: a parent may be listed before the child.
  for (const spec of data.User) {
    if (!spec.guardianProfile) continue;
    const user = await prisma.user.findUniqueOrThrow({ where: { key: spec.key } });
    const guardian = await prisma.guardianProfile.upsert({
      where: { key: spec.guardianProfile.key },
      create: { key: spec.guardianProfile.key, userId: user.id },
      update: {},
    });

    for (const child of spec.guardianProfile.children) {
      const learnerId = learnerIds.get(child.learnerKey);
      if (!learnerId) {
        throw new Error(
          `guardian ${spec.guardianProfile.key} references unknown learner ${child.learnerKey}`,
        );
      }
      await prisma.guardianLink.upsert({
        where: { guardianId_learnerId: { guardianId: guardian.id, learnerId } },
        create: {
          guardianId: guardian.id,
          learnerId,
          relation: child.relation,
          isVerified: child.isVerified,
        },
        update: { isVerified: child.isVerified },
      });
      guardianLinks += 1;
    }
  }

  return {
    report: { users: data.User.length, roleGrants, learners, educators, guardianLinks, enrollments },
    password: data.password,
  };
}
