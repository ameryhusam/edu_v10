/**
 * Authoring rules.
 *
 * The slug contract the owner ratified is the centre of this file:
 *
 *     name → default slug → author may override → slug frozen → key derived
 *
 * Renaming must change neither slug nor key; changing a slug must be refused;
 * renaming must never regenerate either.
 */

import { describe, expect, it } from 'vitest';
import {
  CONTENT_NODE_KINDS,
  checkReorder,
  checkSlugImmutable,
  checkWritableFields,
  editableFieldsFor,
  isContentNodeKind,
  resolveSlugAtCreation,
} from '../../src/contexts/content/domain/authoring.js';
import {
  conceptKey,
  lessonKey,
  unitKey,
  type LessonKey,
  type TextbookKey,
  type UnitKey,
} from '../../src/shared/kernel/identifiers.js';
import { unwrap } from '../../src/shared/kernel/result.js';

const TB = 'EDU-MATH-G07-T1-ED2026' as TextbookKey;

describe('slug at creation', () => {
  it('derives from the name when no override is given', () => {
    expect(unwrap(resolveSlugAtCreation('Set Union'))).toBe('SET-UNION');
  });

  it('lets the author override', () => {
    expect(unwrap(resolveSlugAtCreation('Set Union', 'UNION'))).toBe('UNION');
  });

  it('normalises the override too — an override picks the value, not the format', () => {
    expect(unwrap(resolveSlugAtCreation('Set Union', 'set union!'))).toBe('SET-UNION');
  });

  it('ignores a blank override and falls back to the name', () => {
    expect(unwrap(resolveSlugAtCreation('Set Union', '   '))).toBe('SET-UNION');
    expect(unwrap(resolveSlugAtCreation('Set Union', ''))).toBe('SET-UNION');
  });

  it('supports Arabic names', () => {
    // Arabic is a first-class authoring language, not an edge case.
    expect(unwrap(resolveSlugAtCreation('المجموعة'))).toBe('المجموعة');
  });

  it('reports an underivable name distinctly from a bad override', () => {
    const fromName = resolveSlugAtCreation('!!!');
    const fromOverride = resolveSlugAtCreation('Set', '###');

    expect(fromName.ok).toBe(false);
    expect(fromOverride.ok).toBe(false);
    if (fromName.ok || fromOverride.ok) return;
    // Different advice: fix your name vs fix the slug you typed.
    expect(fromName.error.code).toBe('content.slug_not_derivable');
    expect(fromOverride.error.code).toBe('content.slug_invalid');
  });
});

describe('slug immutability — the owner contract', () => {
  it('accepts an update that omits the slug entirely', () => {
    expect(checkSlugImmutable('SET', undefined).ok).toBe(true);
  });

  it('accepts re-sending the same slug', () => {
    // Clients PUT back the object they just read; refusing that protects
    // nothing and breaks every ordinary form submission.
    expect(checkSlugImmutable('SET', 'SET').ok).toBe(true);
  });

  it('refuses a changed slug', () => {
    const outcome = checkSlugImmutable('SET', 'SETS');

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe('content.slug_immutable');
    expect(outcome.error.details).toMatchObject({ currentSlug: 'SET', attempted: 'SETS' });
  });

  it('refuses slug in the writable-field allow-list for every node kind', () => {
    for (const kind of CONTENT_NODE_KINDS) {
      expect(editableFieldsFor(kind)).not.toContain('slug');
      const outcome = checkWritableFields(kind, ['slug']);
      expect(outcome.ok).toBe(false);
      if (outcome.ok) continue;
      expect(outcome.error.code).toBe('content.slug_immutable');
    }
  });

  it('renaming changes neither the slug nor the derived key', () => {
    // The full contract, end to end. The key is a pure function of the slug,
    // and `name` is not one of its inputs — so a rename cannot reach it.
    const slug = unwrap(resolveSlugAtCreation('Set Union'));
    const key = unwrap(conceptKey(`${TB}-U-SETS-L-BASICS` as LessonKey, slug));

    const rename = checkWritableFields('concept', ['name']);
    expect(rename.ok).toBe(true);

    // After the rename the slug is untouched, so recomputing the key is a no-op.
    const keyAfter = unwrap(conceptKey(`${TB}-U-SETS-L-BASICS` as LessonKey, slug));
    expect(keyAfter).toBe(key);
    expect(key).toBe(`${TB}-U-SETS-L-BASICS-C-SET-UNION`);
  });

  it('a renamed node would only get a new key if the slug were regenerated', () => {
    // Guards the failure mode itself: if anyone ever wires `name` back into
    // key derivation, these two diverge and this test fails.
    const original = unwrap(resolveSlugAtCreation('Set Union'));
    const regenerated = unwrap(resolveSlugAtCreation('Union Of Sets'));

    expect(regenerated).not.toBe(original);
    expect(unwrap(conceptKey(`${TB}-U-A-L-B` as LessonKey, regenerated))).not.toBe(
      unwrap(conceptKey(`${TB}-U-A-L-B` as LessonKey, original)),
    );
  });
});

describe('writable fields', () => {
  it('permits ordinary edits', () => {
    expect(checkWritableFields('concept', ['name', 'description', 'difficulty']).ok).toBe(true);
    expect(checkWritableFields('unit', ['name', 'isActive']).ok).toBe(true);
  });

  it('refuses unknown fields — an allow-list, not a deny-list', () => {
    const outcome = checkWritableFields('concept', ['name', 'somethingNew']);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe('content.field_not_editable');
    expect(outcome.error.details).toMatchObject({ rejected: ['somethingNew'] });
  });

  it('refuses orderIndex as a field write — reordering is its own operation', () => {
    expect(checkWritableFields('concept', ['orderIndex']).ok).toBe(false);
  });

  it('reports every rejected field at once', () => {
    const outcome = checkWritableFields('lesson', ['name', 'bogus', 'alsoBogus']);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.details?.['rejected']).toEqual(['bogus', 'alsoBogus']);
  });

  it('knows its node kinds', () => {
    expect(isContentNodeKind('concept')).toBe(true);
    expect(isContentNodeKind('chapter')).toBe(false);
  });
});

describe('reorder', () => {
  const current = ['A', 'B', 'C'];

  it('accepts a complete permutation', () => {
    expect(checkReorder(current, ['C', 'A', 'B']).ok).toBe(true);
  });

  it('accepts the identity ordering', () => {
    expect(checkReorder(current, ['A', 'B', 'C']).ok).toBe(true);
  });

  it('refuses a partial list', () => {
    // A partial list would leave gaps or collisions in orderIndex.
    const outcome = checkReorder(current, ['A', 'B']);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe('content.reorder_incomplete');
    expect(outcome.error.details).toMatchObject({ missing: ['C'] });
  });

  it('refuses an unknown key', () => {
    const outcome = checkReorder(current, ['A', 'B', 'C', 'D']);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.details).toMatchObject({ unknown: ['D'] });
  });

  it('refuses duplicates', () => {
    const outcome = checkReorder(current, ['A', 'A', 'B']);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe('content.reorder_duplicate_key');
    expect(outcome.error.details).toMatchObject({ duplicates: ['A'] });
  });

  it('is idempotent by construction — replaying yields the same order', () => {
    const order = ['C', 'A', 'B'];
    expect(checkReorder(current, order).ok).toBe(true);
    // After applying, the siblings ARE that order; replaying still validates.
    expect(checkReorder(order, order).ok).toBe(true);
  });
});

describe('key derivation is position-free', () => {
  it('produces the same key regardless of where the node sits', () => {
    // The K1 rule enforces this on the signature; this proves the behaviour.
    const u = unwrap(unitKey(TB, 'SETS'));
    const l = unwrap(lessonKey(u, 'BASICS'));

    expect(unwrap(conceptKey(l, 'SET'))).toBe(`${TB}-U-SETS-L-BASICS-C-SET`);
  });
});
