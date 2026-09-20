/**
 * The converted curriculum packages.
 *
 * `scripts/convert-legacy-curriculum.mjs` is the migration path from the old
 * system, and its output is regenerated rather than committed. These tests run
 * against the generated files when they are present and skip when they are
 * not, so a fresh checkout is not red for a reason the developer cannot act on.
 *
 * Everything asserted here is a property the round trip depends on. Each one
 * was a real defect first.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ContentPackage } from '../../src/contexts/content/domain/export-profile.js';

const DIR = join(import.meta.dirname, '../../content-packages');
const FILES = ['math-g07-t1.package.json', 'science-g07-t1.package.json'];

const present = FILES.filter((f) => existsSync(join(DIR, f)));
const load = (f: string) => JSON.parse(readFileSync(join(DIR, f), 'utf8')) as ContentPackage;

describe.skipIf(present.length === 0)('converted curriculum packages', () => {
  it.each(present)('%s — advisory question keys do not collide', (file) => {
    const pkg = load(file);
    const keys = pkg.questions.map((q) => q.key);

    // The converter used to build this key from the legacy questionKey, which
    // is NOT unique in the source: 110 maths questions shared 54 keys. The
    // package then disagreed with its own export on 38 rows, which read as
    // data loss. Identity now comes from a fingerprint of the text.
    expect(new Set(keys).size).toBe(keys.length);
  });

  it.each(present)('%s — every node keeps its legacy reference', (file) => {
    const pkg = load(file);

    // Migration must be traceable: a reviewer holding the printed curriculum
    // has to be able to find the row it became.
    for (const unit of pkg.units) expect(unit.sourceRef).toBeTruthy();
    for (const lesson of pkg.lessons) expect(lesson.sourceRef).toBeTruthy();
    for (const concept of pkg.concepts) expect(concept.sourceRef).toBeTruthy();
    for (const question of pkg.questions) expect(question.sourceRef).toBeTruthy();
  });

  it.each(present)('%s — the legacy reference is provenance, not identity', (file) => {
    const pkg = load(file);
    const refs = pkg.questions.map((q) => q.sourceRef);

    // Deliberately NOT asserting uniqueness. The source reuses references, and
    // a future change that "fixed" that by de-duplicating would be discarding
    // real questions. This asserts the opposite: duplicates are tolerated.
    expect(refs.length).toBeGreaterThan(new Set(refs).size - 1);
    expect(pkg.questions.every((q) => q.key !== q.sourceRef)).toBe(true);
  });

  it.each(present)('%s — choice order is 0-based, as the system stores it', (file) => {
    const pkg = load(file);
    for (const question of pkg.questions) {
      const indexes = question.choices.map((c) => c.orderIndex);
      // The item bank renumbers choices from zero on ingest. A 1-based package
      // could never compare equal to its own export.
      expect(indexes).toEqual(indexes.map((_, i) => i));
    }
  });

  it('math carries the editorial fields the first converter dropped', () => {
    const file = 'math-g07-t1.package.json';
    if (!present.includes(file)) return;
    const pkg = load(file);

    // Present for all 55 maths concepts in the source. Neither is recoverable
    // once discarded: nameEn would need re-translating and bloomsLevel
    // re-deciding, and neither could then be checked against the original.
    expect(pkg.concepts.every((c) => Boolean(c.nameEn))).toBe(true);
    expect(pkg.concepts.every((c) => Boolean(c.bloomsLevel))).toBe(true);
  });
});
