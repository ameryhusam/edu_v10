/**
 * The academic catalogue: subjects, grades, academic years, terms and schools.
 *
 * This is its own context because the catalogue is owned by nobody else.
 * Content reads it to resolve a textbook coordinate; identity reads it to scope
 * a role grant and place an enrolment; analytics reads it to label a cohort.
 * Three consumers, no owner — so the rules about what a valid subject or a
 * coherent term actually *is* had nowhere to live, and the only way to create
 * one was to edit the seed and re-run it.
 *
 * The domain layer holds those rules and nothing else: no Prisma, no Express,
 * no clock. Every function here is total and deterministic — given the same
 * input it returns the same Result, which is what makes the rules testable
 * without a database.
 */

import { Errors } from '../../../shared/kernel/errors.js';
import { Err, Ok, type Result } from '../../../shared/kernel/result.js';

/**
 * Keys are typed by humans and then embedded in textbook keys, URLs and
 * import packages forever. Constraining the shape here is what keeps
 * `EDU-MATH-G07-T1-ED2026` parseable: a subject key containing a dash would
 * make that key ambiguous to split.
 */
const KEY_PATTERN = /^[A-Z0-9_]{2,24}$/;
const SCHOOL_KEY_PATTERN = /^[a-z0-9_]{3,32}$/;
/** `2026-2027` — two consecutive years. */
const YEAR_KEY_PATTERN = /^(\d{4})-(\d{4})$/;
const GRADE_KEY_PATTERN = /^G\d{2}$/;

export const MAX_NAME_LENGTH = 120;
export const MAX_GRADE_ORDINAL = 12;
export const MAX_TERMS_PER_YEAR = 6;

export interface SubjectInput {
  readonly key: string;
  readonly name: string;
  readonly nameEn?: string | null;
}

export interface GradeInput {
  readonly key: string;
  readonly ordinal: number;
  readonly name: string;
  readonly stage?: string | null;
}

export interface AcademicYearInput {
  readonly key: string;
  readonly startsOn: Date;
  readonly endsOn: Date;
}

export interface TermInput {
  readonly key: string;
  readonly academicYearKey: string;
  readonly ordinal: number;
  readonly name: string;
}

export interface SchoolInput {
  readonly key: string;
  readonly name: string;
  readonly city?: string | null;
}

function requireName(name: string, field = 'name'): Result<string> {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return Err(Errors.validation('catalogue.name_required', `A ${field} is required.`));
  }
  if (trimmed.length > MAX_NAME_LENGTH) {
    return Err(
      Errors.validation(
        'catalogue.name_too_long',
        `A ${field} may not exceed ${MAX_NAME_LENGTH} characters.`,
        { field, length: trimmed.length, max: MAX_NAME_LENGTH },
      ),
    );
  }
  return Ok(trimmed);
}

export function validateSubject(input: SubjectInput): Result<Required<SubjectInput>> {
  const key = input.key.trim().toUpperCase();
  if (!KEY_PATTERN.test(key)) {
    return Err(
      Errors.validation(
        'catalogue.invalid_subject_key',
        'A subject key must be 2-24 characters of A-Z, 0-9 or underscore.',
        { key: input.key },
      ),
    );
  }
  const name = requireName(input.name);
  if (!name.ok) return name;

  const nameEn = input.nameEn?.trim() ?? null;
  if (nameEn !== null && nameEn.length > MAX_NAME_LENGTH) {
    return Err(
      Errors.validation('catalogue.name_too_long', 'The English name is too long.', {
        field: 'nameEn',
      }),
    );
  }

  return Ok({ key, name: name.value, nameEn: nameEn === '' ? null : nameEn });
}

export function validateGrade(input: GradeInput): Result<Required<GradeInput>> {
  const key = input.key.trim().toUpperCase();
  if (!GRADE_KEY_PATTERN.test(key)) {
    return Err(
      Errors.validation(
        'catalogue.invalid_grade_key',
        'A grade key must look like G07 — the letter G and two digits.',
        { key: input.key },
      ),
    );
  }
  if (!Number.isInteger(input.ordinal) || input.ordinal < 1 || input.ordinal > MAX_GRADE_ORDINAL) {
    return Err(
      Errors.validation(
        'catalogue.invalid_grade_ordinal',
        `A grade ordinal must be a whole number between 1 and ${MAX_GRADE_ORDINAL}.`,
        { ordinal: input.ordinal },
      ),
    );
  }
  // The key encodes the ordinal, so disagreement between them is a data bug
  // that would otherwise surface much later as a mis-sorted grade list.
  if (Number(key.slice(1)) !== input.ordinal) {
    return Err(
      Errors.validation(
        'catalogue.grade_key_ordinal_mismatch',
        `Grade key ${key} does not match ordinal ${input.ordinal}.`,
        { key, ordinal: input.ordinal },
      ),
    );
  }
  const name = requireName(input.name);
  if (!name.ok) return name;

  const stage = input.stage?.trim() ?? null;
  return Ok({ key, ordinal: input.ordinal, name: name.value, stage: stage === '' ? null : stage });
}

export function validateAcademicYear(input: AcademicYearInput): Result<Required<AcademicYearInput>> {
  const key = input.key.trim();
  const match = YEAR_KEY_PATTERN.exec(key);
  if (!match) {
    return Err(
      Errors.validation(
        'catalogue.invalid_year_key',
        'An academic year key must look like 2026-2027.',
        { key: input.key },
      ),
    );
  }
  if (Number(match[2]) !== Number(match[1]) + 1) {
    return Err(
      Errors.validation(
        'catalogue.non_consecutive_year',
        'An academic year must span two consecutive calendar years.',
        { key },
      ),
    );
  }
  if (Number.isNaN(input.startsOn.getTime()) || Number.isNaN(input.endsOn.getTime())) {
    return Err(Errors.validation('catalogue.invalid_date', 'The dates are not valid.'));
  }
  if (input.startsOn.getTime() >= input.endsOn.getTime()) {
    return Err(
      Errors.validation(
        'catalogue.inverted_year',
        'An academic year must start before it ends.',
        { startsOn: input.startsOn.toISOString(), endsOn: input.endsOn.toISOString() },
      ),
    );
  }
  return Ok({ key, startsOn: input.startsOn, endsOn: input.endsOn });
}

export function validateTerm(input: TermInput): Result<Required<TermInput>> {
  const academicYearKey = input.academicYearKey.trim();
  const key = input.key.trim();

  if (!Number.isInteger(input.ordinal) || input.ordinal < 1 || input.ordinal > MAX_TERMS_PER_YEAR) {
    return Err(
      Errors.validation(
        'catalogue.invalid_term_ordinal',
        `A term ordinal must be a whole number between 1 and ${MAX_TERMS_PER_YEAR}.`,
        { ordinal: input.ordinal },
      ),
    );
  }
  // Term.key is globally unique in the schema. A bare 'T1' would therefore be
  // claimable by exactly one academic year in the entire system — the legacy
  // seed used bare keys and would have collided on its second year.
  if (!key.startsWith(`${academicYearKey}-`)) {
    return Err(
      Errors.validation(
        'catalogue.term_key_not_scoped',
        `A term key must begin with its academic year, e.g. ${academicYearKey}-T01.`,
        { key, academicYearKey },
      ),
    );
  }
  const name = requireName(input.name);
  if (!name.ok) return name;

  return Ok({ key, academicYearKey, ordinal: input.ordinal, name: name.value });
}

/** The canonical term key for a year and ordinal, so callers need not guess. */
export function termKeyFor(academicYearKey: string, ordinal: number): string {
  return `${academicYearKey}-T${String(ordinal).padStart(2, '0')}`;
}

export function validateSchool(input: SchoolInput): Result<Required<SchoolInput>> {
  const key = input.key.trim().toLowerCase();
  if (!SCHOOL_KEY_PATTERN.test(key)) {
    return Err(
      Errors.validation(
        'catalogue.invalid_school_key',
        'A school key must be 3-32 characters of a-z, 0-9 or underscore.',
        { key: input.key },
      ),
    );
  }
  const name = requireName(input.name);
  if (!name.ok) return name;

  const city = input.city?.trim() ?? null;
  return Ok({ key, name: name.value, city: city === '' ? null : city });
}

/**
 * Whether a catalogue entry may be removed.
 *
 * Deletion is refused whenever anything references the entry. This is the rule
 * that stops a "tidy up the subject list" action from orphaning a textbook, a
 * learner's enrolment, or an entire school's roster — a catalogue row is a
 * coordinate that content and enrolments are pinned to, not a label.
 *
 * The caller passes the counts it found; the domain decides. That keeps the
 * rule testable without a database and identical for every entry type.
 */
export interface ReferenceCount {
  readonly what: string;
  readonly count: number;
}

export function ensureRemovable(
  entity: string,
  key: string,
  references: readonly ReferenceCount[],
): Result<null> {
  const blocking = references.filter((r) => r.count > 0);
  if (blocking.length > 0) {
    return Err(
      Errors.conflict(
        'catalogue.in_use',
        `This ${entity} is still in use and cannot be removed.`,
        {
          key,
          references: blocking.map((r) => ({ what: r.what, count: r.count })),
        },
      ),
    );
  }
  return Ok(null);
}

/**
 * Exactly one academic year may be current.
 *
 * Expressed here rather than left to the database because "current" is a
 * business rule with a consequence: every unscoped read — due work, the active
 * roster, the learner's enrolment — resolves through it. Two current years
 * makes those reads non-deterministic.
 */
export function ensureSingleCurrentYear(
  years: readonly { key: string; isCurrent: boolean }[],
): Result<null> {
  const current = years.filter((y) => y.isCurrent);
  if (current.length > 1) {
    return Err(
      Errors.conflict(
        'catalogue.multiple_current_years',
        'Only one academic year may be current.',
        { keys: current.map((y) => y.key) },
      ),
    );
  }
  return Ok(null);
}
