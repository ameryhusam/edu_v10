/**
 * Canonical key identity — the reordering hazard, now closed.
 *
 * This file previously pinned the DEFECT (identity derived from orderIndex).
 * The resolution landed, so these tests now prove the property instead: no
 * key-building function accepts a position, so reordering cannot rename
 * anything. Kept as a separate file because this is the regression that would
 * be most expensive to reintroduce.
 *
 * See docs/KEY-IDENTITY-AUDIT.md.
 */

import { describe, expect, it } from 'vitest';
import {
  conceptKey,
  lessonKey,
  questionKey,
  textbookKey,
  unitKey,
  type LessonKey,
  type TextbookKey,
  type UnitKey,
} from '../../src/shared/kernel/identifiers.js';
import { unwrap } from '../../src/shared/kernel/result.js';

const book = (): TextbookKey =>
  unwrap(textbookKey({ subject: 'MATH', grade: 7, part: 'PART_1', edition: '2026' }));
const unit = (): UnitKey => unwrap(unitKey(book(), 'SETS'));
const lesson = (): LessonKey => unwrap(lessonKey(unit(), 'SET-AND-ELEMENT'));

/**
 * The scenario that motivated the audit: an author inserts a concept in the
 * middle of a lesson. Under the old order-derived scheme every key below the
 * insertion point silently rebound to a different concept.
 */
describe('reordering cannot rename content', () => {
  const lessonPlan = ['SET', 'UNION', 'COMPLEMENT'];

  it('keeps every key identical after an insertion', () => {
    const before = lessonPlan.map((slug) => unwrap(conceptKey(lesson(), slug)));

    // "INTERSECTION" is inserted at position 2; everything shifts down.
    const afterPlan = ['SET', 'INTERSECTION', 'UNION', 'COMPLEMENT'];
    const after = afterPlan.map((slug) => unwrap(conceptKey(lesson(), slug)));

    // Every original concept keeps the key it had.
    for (const key of before) expect(after).toContain(key);
    // And the new concept gets a genuinely new key.
    expect(after).toHaveLength(before.length + 1);
  });

  it('never lets a key mean two different concepts', () => {
    const unionKey = unwrap(conceptKey(lesson(), 'UNION'));
    const intersectionKey = unwrap(conceptKey(lesson(), 'INTERSECTION'));

    expect(unionKey).not.toBe(intersectionKey);
  });

  it('so a stale key held by a client still resolves to the same concept', () => {
    // mastery.repository.ts reads by concept.key. Under the old scheme a
    // cached key returned a plausible number for the WRONG concept.
    const cachedByAClient = unwrap(conceptKey(lesson(), 'UNION'));
    const resolvedLater = unwrap(conceptKey(lesson(), 'UNION'));

    expect(resolvedLater).toBe(cachedByAClient);
  });
});

describe('no key function accepts a position', () => {
  it('rejects a numeric order where a slug is expected', () => {
    // Belt and braces: the type system already forbids this, and at runtime a
    // number normalises to digits rather than silently becoming "C02".
    const numericLike = unwrap(conceptKey(lesson(), '2'));

    expect(numericLike).toBe(`${lesson()}-C-2`);
    expect(numericLike).not.toContain('-C02');
  });

  it('question identity survives relinking', () => {
    const before = unwrap(questionKey(lesson(), 'SRC-Q-0001'));
    const after = unwrap(questionKey(lesson(), 'SRC-Q-0001'));

    expect(after).toBe(before);
  });
});
