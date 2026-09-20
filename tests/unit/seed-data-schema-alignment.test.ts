/**
 * The seed's JSON must name things exactly as the database does.
 *
 * Every other test in this folder checks what the data *says*. This one checks
 * that the data can still be understood: each top-level section is a real
 * Prisma model, and each field is a real column on that model — verified
 * against the generated schema rather than against a list kept by hand, which
 * would just be a second thing to forget to update.
 *
 * Why it is worth a test. The data file is read by hand-written mapping code,
 * so a name that disagrees with the schema is not automatically an outage —
 * `verified` in the JSON worked for as long as the TypeScript interface also
 * said `verified`. That is exactly what makes it worth catching: the mismatch
 * is invisible while it is harmless, and it stops being harmless the moment
 * someone changes one side. Then it fails in one of two ways:
 *
 *   - The field is quietly ignored and the row takes a default, which for a
 *     flag like `isVerified` means the seed reports success having written
 *     the opposite of what the file says.
 *   - It fails deep inside the driver with a message about a column, leaving
 *     the reader to work out which of several hundred JSON entries produced it.
 *
 * Naming the model and the column identically removes the class of problem
 * rather than the instance.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';

const DATA = resolve(dirname(fileURLToPath(import.meta.url)), '../../prisma/seed/data');
const read = (file: string): Record<string, unknown> =>
  JSON.parse(readFileSync(resolve(DATA, file), 'utf8')) as Record<string, unknown>;

/** Scalar columns of a model, from the schema Prisma actually generated. */
function columnsOf(model: string): string[] {
  const found = Prisma.dmmf.datamodel.models.find((candidate) => candidate.name === model);
  if (!found) throw new Error(`no Prisma model named ${model}`);
  return found.fields.filter((field) => field.kind !== 'object').map((field) => field.name);
}

const modelNames = new Set(Prisma.dmmf.datamodel.models.map((model) => model.name));

/**
 * Fields the seed resolves itself instead of storing verbatim.
 *
 * A JSON file cannot carry `academicYearId` — that uuid does not exist until
 * Postgres generates it. So a reference is written as `<something>Key` and the
 * seed looks it up. These are the only names allowed to not be columns, and
 * each is listed with the model it points at so the indirection stays readable.
 */
const REFERENCES: Record<string, string> = {
  academicYearKey: 'AcademicYear',
  schoolKey: 'School',
  gradeKey: 'Grade',
  learnerKey: 'LearnerProfile',
};

/** Nested objects that create a row in another model. */
const NESTED: Record<string, string> = {
  learnerProfile: 'LearnerProfile',
  educatorProfile: 'EducatorProfile',
  guardianProfile: 'GuardianProfile',
};

/** Keys that are seed instructions rather than data. */
const META = new Set(['$comment', 'password', 'roles', 'children']);

function assertFieldsExist(model: string, row: Record<string, unknown>, where: string): void {
  const columns = columnsOf(model);
  for (const field of Object.keys(row)) {
    if (META.has(field) || field in NESTED) continue;

    if (field in REFERENCES) {
      // A reference must point at a model that exists, and that model must
      // really have the `key` the seed intends to look it up by.
      expect(columnsOf(REFERENCES[field]!), `${where}: ${field} -> ${REFERENCES[field]}`).toContain(
        'key',
      );
      continue;
    }

    expect(columns, `${where}: "${field}" is not a column on ${model}`).toContain(field);
  }
}

describe('seed data sections are named after Prisma models', () => {
  for (const file of ['academic-structure.json', 'subjects.json', 'demo-users.json']) {
    it(`${file} uses only real model names as sections`, () => {
      for (const section of Object.keys(read(file))) {
        if (META.has(section)) continue;
        expect(modelNames, `"${section}" in ${file} is not a Prisma model`).toContain(section);
      }
    });
  }
});

describe('seed data fields are real columns', () => {
  it('academic-structure.json matches AcademicYear, Term, Grade and School', () => {
    const structure = read('academic-structure.json');
    for (const model of ['AcademicYear', 'Term', 'Grade', 'School']) {
      const rows = structure[model] as Array<Record<string, unknown>>;
      expect(Array.isArray(rows), `${model} must be a list`).toBe(true);
      rows.forEach((row, index) => assertFieldsExist(model, row, `${model}[${index}]`));
    }
  });

  it('subjects.json matches Subject', () => {
    const rows = read('subjects.json').Subject as Array<Record<string, unknown>>;
    rows.forEach((row, index) => assertFieldsExist('Subject', row, `Subject[${index}]`));
  });

  it('demo-users.json matches User and its nested profiles', () => {
    const users = read('demo-users.json').User as Array<Record<string, unknown>>;

    users.forEach((user, index) => {
      assertFieldsExist('User', user, `User[${index}]`);

      for (const [key, model] of Object.entries(NESTED)) {
        const nested = user[key] as Record<string, unknown> | undefined;
        if (nested) assertFieldsExist(model, nested, `User[${index}].${key}`);
      }

      const guardian = user.guardianProfile as { children?: Array<Record<string, unknown>> };
      for (const child of guardian?.children ?? []) {
        // Guardian children become GuardianLink rows.
        assertFieldsExist('GuardianLink', child, `User[${index}] guardian child`);
      }
    });
  });

  it('role grants match UserRole', () => {
    const users = read('demo-users.json').User as Array<Record<string, unknown>>;
    for (const user of users) {
      for (const grant of user.roles as Array<Record<string, unknown>>) {
        assertFieldsExist('UserRole', grant, `${String(user.username)} role grant`);
      }
    }
  });
});

describe('references resolve within the seed data', () => {
  it('every Term names an AcademicYear that the same file defines', () => {
    const structure = read('academic-structure.json');
    const years = new Set(
      (structure.AcademicYear as Array<{ key: string }>).map((year) => year.key),
    );
    for (const term of structure.Term as Array<{ key: string; academicYearKey: string }>) {
      expect(years, `term ${term.key}`).toContain(term.academicYearKey);
    }
  });

  it('guardian links are explicit about verification', () => {
    // The column is `isVerified`. `verified` read correctly only because the
    // mapping code translated it; once the JSON matches the schema, nothing
    // has to translate, and nothing can translate it wrongly.
    const users = read('demo-users.json').User as Array<{
      guardianProfile?: { children: Array<Record<string, unknown>> };
    }>;
    const children = users.flatMap((user) => user.guardianProfile?.children ?? []);
    expect(children.length).toBeGreaterThan(0);
    for (const child of children) {
      expect(child).toHaveProperty('isVerified');
      expect(child).not.toHaveProperty('verified');
    }
  });
});
