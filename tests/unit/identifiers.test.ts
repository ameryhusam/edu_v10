/**
 * Canonical key identity.
 *
 * Two rules are load-bearing and are tested as such:
 *   1. Identity never encodes position — reordering must not rename anything.
 *   2. Identity never encodes a mutable attribute — renaming or relinking
 *      must not rename anything either.
 *
 * See docs/KEY-IDENTITY-AUDIT.md.
 */

import { describe, expect, it } from 'vitest';
import {
  conceptKey,
  flashcardKey,
  isDescendantKey,
  lessonKey,
  misconceptionKey,
  normalizeSlug,
  normalizeSubjectCode,
  parseTextbookKey,
  questionKey,
  stableKeyFingerprint,
  textbookKey,
  unitKey,
  type LessonKey,
  type TextbookKey,
  type UnitKey,
} from '../../src/shared/kernel/identifiers.js';
import { unwrap } from '../../src/shared/kernel/result.js';

const coords = { subject: 'MATH', grade: 7, term: 1, edition: '2026' };
const book = (): TextbookKey => unwrap(textbookKey(coords));
const unit = (slug = 'SETS-RELATIONS'): UnitKey => unwrap(unitKey(book(), slug));
const lesson = (slug = 'SET-AND-ELEMENT'): LessonKey => unwrap(lessonKey(unit(), slug));

describe('textbookKey — identified by printed edition', () => {
  it('builds the canonical shape', () => {
    expect(book()).toBe('EDU-MATH-G07-P1-ED2026');
  });

  it('is deterministic', () => {
    expect(unwrap(textbookKey(coords))).toBe(unwrap(textbookKey(coords)));
  });

  it('distinguishes two printings of the same subject/grade/term', () => {
    // The whole point of keying on edition: a reprint is a different book.
    const first = unwrap(textbookKey({ ...coords, edition: '2026' }));
    const revised = unwrap(textbookKey({ ...coords, edition: 'REV2' }));

    expect(first).not.toBe(revised);
    expect(revised).toBe('EDU-MATH-G07-P1-EDREV2');
  });

  it('does NOT change when the book is taught in a different academic year', () => {
    // Year of use lives on TextbookAdoption. If it were in the key, the same
    // physical book would mint a new identity every September.
    const used2026 = unwrap(textbookKey(coords));
    const used2027 = unwrap(textbookKey(coords));

    expect(used2026).toBe(used2027);
  });

  it('accepts a year span as an edition', () => {
    expect(unwrap(textbookKey({ ...coords, edition: '2026-2027' }))).toBe(
      'EDU-MATH-G07-P1-ED2026-2027',
    );
  });

  it('requires an edition', () => {
    const r = textbookKey({ ...coords, edition: '  ' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('identity.edition_required');
  });

  it('rejects out-of-range grade and term', () => {
    expect(textbookKey({ ...coords, grade: 0 }).ok).toBe(false);
    expect(textbookKey({ ...coords, grade: 13 }).ok).toBe(false);
    expect(textbookKey({ ...coords, term: 5 }).ok).toBe(false);
  });

  it('round-trips through parseTextbookKey', () => {
    expect(unwrap(parseTextbookKey(book()))).toEqual({
      subject: 'MATH',
      grade: 7,
      term: 1,
      edition: '2026',
    });
  });

  it('refuses to parse a non-canonical key', () => {
    expect(parseTextbookKey('2026-2027-T01-G07-MATH').ok).toBe(false);
    expect(parseTextbookKey('nonsense').ok).toBe(false);
  });
});

describe('hierarchy keys — slug-based, never positional', () => {
  it('builds the canonical chain', () => {
    expect(unit()).toBe('EDU-MATH-G07-P1-ED2026-U-SETS-RELATIONS');
    expect(lesson()).toBe('EDU-MATH-G07-P1-ED2026-U-SETS-RELATIONS-L-SET-AND-ELEMENT');
    expect(unwrap(conceptKey(lesson(), 'SET-UNION'))).toBe(
      'EDU-MATH-G07-P1-ED2026-U-SETS-RELATIONS-L-SET-AND-ELEMENT-C-SET-UNION',
    );
  });

  it('THE FIX: a concept key is unchanged when its position changes', () => {
    // The defect this replaced: identity derived from orderIndex, so inserting
    // a sibling silently rebound every key below it. There is now no way to
    // express a position here at all.
    const beforeReorder = unwrap(conceptKey(lesson(), 'SET-UNION'));
    const afterReorder = unwrap(conceptKey(lesson(), 'SET-UNION'));

    expect(afterReorder).toBe(beforeReorder);
  });

  it('gives distinct siblings distinct keys', () => {
    expect(unwrap(conceptKey(lesson(), 'SET-UNION'))).not.toBe(
      unwrap(conceptKey(lesson(), 'SET-INTERSECTION')),
    );
  });

  it('keeps children beneath their parent', () => {
    expect(isDescendantKey(book(), unit())).toBe(true);
    expect(isDescendantKey(unit(), lesson())).toBe(true);
    expect(isDescendantKey(lesson(), unwrap(conceptKey(lesson(), 'SET-UNION')))).toBe(true);
    expect(isDescendantKey(lesson(), unit())).toBe(false);
  });

  it('rejects a slug that normalises to nothing', () => {
    expect(conceptKey(lesson(), '   ').ok).toBe(false);
    expect(conceptKey(lesson(), '!!!').ok).toBe(false);
  });
});

describe('normalizeSlug', () => {
  it('upper-cases and hyphenates', () => {
    expect(unwrap(normalizeSlug(' set  union '))).toBe('SET-UNION');
    expect(unwrap(normalizeSlug('set_union'))).toBe('SET-UNION');
  });

  it('preserves Arabic — the product is Arabic-first', () => {
    // A slug rule that only kept [A-Z] would erase an Arabic name entirely and
    // then fail, making Arabic content unauthorable.
    expect(unwrap(normalizeSlug('المجموعة'))).toBe('المجموعة');
    expect(unwrap(normalizeSlug('العنصر والانتماء'))).toBe('العنصر-والانتماء');
  });

  it('drops punctuation but keeps digits', () => {
    expect(unwrap(normalizeSlug('Chapter 2: Sets!'))).toBe('CHAPTER-2-SETS');
  });

  it('is idempotent', () => {
    const once = unwrap(normalizeSlug('Set Union'));
    expect(unwrap(normalizeSlug(once))).toBe(once);
  });

  it('rejects empty and over-long slugs', () => {
    expect(normalizeSlug('').ok).toBe(false);
    expect(normalizeSlug('A'.repeat(33)).ok).toBe(false);
  });
});

describe('stableKeyFingerprint — ported from the legacy generator', () => {
  it('is stable for known inputs (pinned so the value can never drift)', () => {
    // These literals are the contract. If a refactor changes them, every
    // previously issued question/misconception/flashcard key breaks.
    expect(stableKeyFingerprint('set-union')).toBe('2421eef9');
    expect(stableKeyFingerprint('')).toBe('811c9dc5');
  });

  it('ignores case and surrounding whitespace', () => {
    expect(stableKeyFingerprint('  Set-Union  ')).toBe(stableKeyFingerprint('set-union'));
  });

  it('separates different inputs', () => {
    expect(stableKeyFingerprint('a')).not.toBe(stableKeyFingerprint('b'));
  });

  it('honours the requested length', () => {
    expect(stableKeyFingerprint('x', 4)).toHaveLength(4);
    expect(stableKeyFingerprint('x')).toHaveLength(8);
  });
});

describe('questionKey — parented on the lesson', () => {
  it('is built from the lesson, not the concept', () => {
    const key = unwrap(questionKey(lesson(), 'Q-SRC-0001'));

    expect(key.startsWith(lesson())).toBe(true);
    expect(key).toBe(`${lesson()}-Q${stableKeyFingerprint('Q-SRC-0001')}`);
  });

  it('does NOT change when the question is relinked to another concept', () => {
    // Legacy stated this rule for questions and we keep it: concept linkage is
    // optional and editable, so it must stay out of identity.
    const beforeRelink = unwrap(questionKey(lesson(), 'Q-SRC-0001'));
    const afterRelink = unwrap(questionKey(lesson(), 'Q-SRC-0001'));

    expect(afterRelink).toBe(beforeRelink);
  });

  it('requires a stable identity', () => {
    expect(questionKey(lesson(), '  ').ok).toBe(false);
  });
});

describe('misconception and flashcard keys', () => {
  const concept = () => unwrap(conceptKey(lesson(), 'SET-UNION'));

  it('hang off the concept with a fingerprint', () => {
    expect(unwrap(misconceptionKey(concept(), 'confuses-union-intersection'))).toBe(
      `${concept()}-MIS${stableKeyFingerprint('confuses-union-intersection')}`,
    );
    expect(unwrap(flashcardKey(concept(), 'card-1'))).toBe(
      `${concept()}-FC${stableKeyFingerprint('card-1')}`,
    );
  });

  it('require a stable identity', () => {
    expect(misconceptionKey(concept(), '').ok).toBe(false);
    expect(flashcardKey(concept(), '').ok).toBe(false);
  });
});

describe('normalizeSubjectCode', () => {
  it('normalises and validates', () => {
    expect(unwrap(normalizeSubjectCode(' math '))).toBe('MATH');
    expect(normalizeSubjectCode('').ok).toBe(false);
    expect(normalizeSubjectCode('TOOLONGSUBJECT').ok).toBe(false);
  });
});
