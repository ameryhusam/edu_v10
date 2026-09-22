/**
 * Identity policy — one rule for the whole platform.
 *
 * Every aggregate carries TWO identifiers, and they have different jobs:
 *
 *  - `id`  : opaque surrogate primary key. Database-internal, never meaningful,
 *            never parsed, never displayed. Cheap joins.
 *  - `key` : canonical business key. Deterministic, human-readable, stable
 *            across environments and re-imports. This is what appears in URLs,
 *            spreadsheets, exports and cross-system sync.
 *
 * A canonical key is DERIVED, never typed by a human and never invented twice.
 * Given the same identity inputs you MUST get the same key, in any process, on
 * any machine, forever. That makes import idempotent and migrations replayable.
 *
 * ── Two rules learned the hard way (see docs/KEY-IDENTITY-AUDIT.md) ─────────
 *
 * 1. **Identity never encodes position.** Keys are built from a frozen slug,
 *    never from `orderIndex`. Reordering content is a routine authoring
 *    action; if it changed keys, every stored `conceptKey`, decision log,
 *    grounding chunk, saved URL and export would silently rebind to a
 *    different concept. Mastery is read by key, so a stale key would return a
 *    plausible number for the WRONG concept rather than failing loudly.
 *
 * 2. **Identity never encodes a mutable attribute.** A question is parented on
 *    its lesson, not its concept, because concept linkage is optional and may
 *    be changed by an author. This rule is inherited from the legacy generator,
 *    which stated it correctly for questions and then did not apply it to the
 *    hierarchy.
 *
 * A textbook is identified by subject + grade + physical part + **printed edition** —
 * the physical book being taught. Academic year is deliberately NOT part of
 * identity: the same printed edition is used across several years, so keying on
 * the year would mint a new key annually for a book that has not changed.
 * Which years a book is used in is a deployment fact, recorded by adoption.
 */

import { Errors } from './errors.js';
import { Err, Ok, type Result } from './result.js';

/** Branded string type so a ConceptKey can never be passed where a LessonKey belongs. */
export type Brand<T, B extends string> = T & { readonly __brand: B };

export type SubjectCode = Brand<string, 'SubjectCode'>;
export type Slug = Brand<string, 'Slug'>;
export type TextbookKey = Brand<string, 'TextbookKey'>;
export type UnitKey = Brand<string, 'UnitKey'>;
export type LessonKey = Brand<string, 'LessonKey'>;
export type ConceptKey = Brand<string, 'ConceptKey'>;
export type QuestionKey = Brand<string, 'QuestionKey'>;

const SEGMENT = /^[A-Z0-9]+$/;
const MAX_SLUG_LENGTH = 32;

/** Canonical coordinates that identify a printed textbook, uniquely, forever. */
export interface TextbookCoordinates {
  /** Uppercase subject code, e.g. `MATH`. */
  readonly subject: string;
  /** Grade ordinal, 1-based. */
  readonly grade: number;
  /** Physical book coverage. */
  readonly part: 'PART_1' | 'PART_2' | 'BOTH';
  /**
   * Printed edition of the physical book.
   * Not the academic year of use.
   */
  readonly edition: string;
}

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

export function normalizeSubjectCode(raw: string): Result<SubjectCode> {
  const code = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!code) {
    return Err(Errors.validation('identity.subject_code_empty', 'Subject code is required.'));
  }
  if (code.length > 8) {
    return Err(
      Errors.validation('identity.subject_code_too_long', 'Subject code must be 8 chars or fewer.', {
        raw,
      }),
    );
  }
  return Ok(code as SubjectCode);
}

/**
 * Normalise author-supplied text into a stable key segment.
 *
 * Unicode-aware: Arabic is a first-class authoring language here, so letters
 * outside A–Z must survive rather than be stripped to nothing. NFKC first so
 * that visually identical text always normalises to the same slug.
 */
export function normalizeSlug(raw: string): Result<Slug> {
  const slug = String(raw ?? '')
    .normalize('NFKC')
    .trim()
    .toUpperCase()
    .replace(/[\s_]+/g, '-')
    // Keep letters and digits in any script; drop punctuation.
    .replace(/[^\p{L}\p{N}-]+/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!slug) {
    return Err(
      Errors.validation('identity.slug_empty', 'A key slug cannot be derived from this value.', {
        raw,
      }),
    );
  }
  if (slug.length > MAX_SLUG_LENGTH) {
    return Err(
      Errors.validation('identity.slug_too_long', `Slug must be ${MAX_SLUG_LENGTH} chars or fewer.`, {
        slug,
      }),
    );
  }
  return Ok(slug as Slug);
}

/**
 * Stable non-cryptographic fingerprint — FNV-1a over NFKC-normalised text.
 *
 * Ported verbatim in behaviour from the legacy generator, which used it for
 * questions, misconceptions, remedial content and flashcards. Deterministic
 * across runtimes and processes: no timestamp, no random, no database id.
 * Used when content arrives without an author-assigned slug (imports).
 */
export function stableKeyFingerprint(value: string, length = 8): string {
  const normalized = String(value ?? '').trim().normalize('NFKC').toLowerCase();
  let hash = 2166136261;
  for (let i = 0; i < normalized.length; i += 1) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0').slice(0, length);
}

function normalizeEdition(raw: string): Result<string> {
  const edition = String(raw ?? '').trim();
  if (!edition) {
    return Err(
      Errors.validation('identity.edition_required', 'Printed edition is required for a textbook key.'),
    );
  }
  // A year or year span keeps its digits; anything else is slugified.
  if (/^\d{4}([/-]\d{4})?$/.test(edition)) {
    return Ok(`ED${edition.replace(/[/]/g, '-')}`);
  }
  const slug = normalizeSlug(edition);
  return slug.ok ? Ok(`ED${slug.value}`) : slug;
}

function validateCoordinates(c: TextbookCoordinates): Result<TextbookCoordinates> {
  if (!['PART_1', 'PART_2', 'BOTH'].includes(c.part)) {
    return Err(Errors.validation(
      'identity.bad_part',
      'Textbook part must be PART_1, PART_2, or BOTH.',
    ));
  }
  if (!Number.isInteger(c.grade) || c.grade < 1 || c.grade > 12) {
    return Err(Errors.validation('identity.bad_grade', 'Grade must be an integer between 1 and 12.'));
  }
  const subject = normalizeSubjectCode(c.subject);
  if (!subject.ok) return subject;
  const edition = normalizeEdition(c.edition);
  if (!edition.ok) return edition;
  return Ok({ ...c, subject: subject.value });
}

/**
 * `EDU-MATH-G07-P1-ED2026`
 *
 * Subject + grade + physical part + printed edition. Sorting is by subject then grade,
 * which is how a catalogue is browsed.
 */
export function textbookKey(coords: TextbookCoordinates): Result<TextbookKey> {
  const v = validateCoordinates(coords);
  if (!v.ok) return v;
  const edition = normalizeEdition(v.value.edition);
  if (!edition.ok) return edition;
  const { subject, grade, part, edition } = v.value;
  const partCode = part === 'PART_1' ? 'P1' : part === 'PART_2' ? 'P2' : 'PB';
  return Ok(`EDU-${subject}-G${pad(grade)}-${partCode}-${edition.value}` as TextbookKey);
}

/** Build a `<parent>-<marker><slug>` child key. */
function childKey<K extends string>(parent: string, marker: string, slug: string): Result<K> {
  const s = normalizeSlug(slug);
  if (!s.ok) return s;
  return Ok(`${parent}-${marker}${s.value}` as K);
}

/**
 * `<textbookKey>-U-ALGEBRA`
 *
 * Takes a slug, never an order. Reordering units must not rename them.
 */
export function unitKey(parent: TextbookKey, slug: string): Result<UnitKey> {
  return childKey<UnitKey>(parent, 'U-', slug);
}

/** `<unitKey>-L-LINEAR-EQUATIONS` */
export function lessonKey(parent: UnitKey, slug: string): Result<LessonKey> {
  return childKey<LessonKey>(parent, 'L-', slug);
}

/** `<lessonKey>-C-SET-UNION` */
export function conceptKey(parent: LessonKey, slug: string): Result<ConceptKey> {
  return childKey<ConceptKey>(parent, 'C-', slug);
}

/**
 * `<lessonKey>-Q1a2b3c4d`
 *
 * Parented on the LESSON, not the concept: concept linkage is optional and an
 * author may relink a question, which must not rename it. The fingerprint is
 * taken over a stable identity supplied by the caller (the question's source
 * reference, or its text when nothing better exists).
 */
export function questionKey(parent: LessonKey, stableIdentity: string): Result<QuestionKey> {
  const identity = String(stableIdentity ?? '').trim();
  if (!identity) {
    return Err(
      Errors.validation('identity.question_identity_required', 'A stable identity is required for a question key.'),
    );
  }
  return Ok(`${parent}-Q${stableKeyFingerprint(identity)}` as QuestionKey);
}

/** `<conceptKey>-MIS1a2b3c4d` */
export function misconceptionKey(parent: ConceptKey, stableIdentity: string): Result<string> {
  const identity = String(stableIdentity ?? '').trim();
  if (!identity) {
    return Err(
      Errors.validation('identity.misconception_identity_required', 'A stable identity is required.'),
    );
  }
  return Ok(`${parent}-MIS${stableKeyFingerprint(identity)}`);
}

/**
 * `<conceptKey>-RES1a2b3c4d`
 *
 * Fingerprinted like a misconception rather than slugged like a concept: a
 * resource has no order-independent human identifier an author would type, and
 * two resources on one concept must not collide. The caller supplies the
 * stable identity (a slug, or the title when nothing better exists).
 */
export function learningResourceKey(parent: ConceptKey, stableIdentity: string): Result<string> {
  const identity = String(stableIdentity ?? '').trim();
  if (!identity) {
    return Err(
      Errors.validation('identity.resource_identity_required', 'A stable identity is required.'),
    );
  }
  return Ok(`${parent}-RES${stableKeyFingerprint(identity)}`);
}

/** `<lessonKey>-RES1a2b3c4d` for lesson-scoped reading and media. */
export function lessonResourceKey(parent: LessonKey, stableIdentity: string): Result<string> {
  const identity = String(stableIdentity ?? '').trim();
  if (!identity) {
    return Err(
      Errors.validation('identity.resource_identity_required', 'A stable identity is required.'),
    );
  }
  return Ok(`${parent}-RES${stableKeyFingerprint(identity)}`);
}

/** `<textbookKey>-RES1a2b3c4d` for book-wide references and attachments. */
export function textbookResourceKey(parent: TextbookKey, stableIdentity: string): Result<string> {
  const identity = String(stableIdentity ?? '').trim();
  if (!identity) {
    return Err(
      Errors.validation('identity.resource_identity_required', 'A stable identity is required.'),
    );
  }
  return Ok(`${parent}-RES${stableKeyFingerprint(identity)}`);
}

/** `<parentKey>-AST1a2b3c4d` for textbook/unit/lesson/concept assets. */
export function contentAssetKey(parent: string, stableIdentity: string): Result<string> {
  const identity = String(stableIdentity ?? '').trim();
  if (!identity) {
    return Err(
      Errors.validation('identity.asset_identity_required', 'A stable identity is required for an asset key.'),
    );
  }
  return Ok(`${parent}-AST${stableKeyFingerprint(identity)}`);
}

/** `<conceptKey>-FC1a2b3c4d` */
export function flashcardKey(parent: ConceptKey, stableIdentity: string): Result<string> {
  const identity = String(stableIdentity ?? '').trim();
  if (!identity) {
    return Err(
      Errors.validation('identity.flashcard_identity_required', 'A stable identity is required.'),
    );
  }
  return Ok(`${parent}-FC${stableKeyFingerprint(identity)}`);
}

/** Parse a canonical textbook key back into its coordinates. */
export function parseTextbookKey(key: string): Result<TextbookCoordinates> {
  const m = /^EDU-([A-Z0-9]+)-G(\d{2})-(P1|P2|PB)-ED(.+)$/.exec(key);
  if (!m) {
    return Err(Errors.validation('identity.unparseable_key', 'Not a canonical textbook key.', { key }));
  }
  return Ok({
    subject: m[1]!,
    grade: Number(m[2]),
    part: m[3] === 'P1' ? 'PART_1' : m[3] === 'P2' ? 'PART_2' : 'BOTH',
    edition: m[4]!,
  });
}

/** True when `child` sits anywhere beneath `ancestor` in the canonical tree. */
export function isDescendantKey(ancestor: string, child: string): boolean {
  return child.startsWith(`${ancestor}-`);
}

export function isCanonicalSegment(segment: string): boolean {
  return SEGMENT.test(segment);
}
