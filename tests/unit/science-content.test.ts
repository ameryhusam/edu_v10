/**
 * The science book's JSON, held to its own invariants.
 *
 * The authoring script asserts these when it generates the file, but the
 * file is what the seed reads — and a hand edit (a new question, a renamed
 * slug) can break them silently. This test is the gate between "the JSON
 * looks fine" and "the seed will run": unique slugs, exactly one correct
 * choice per question, distractor misconceptions that exist on the same
 * concept, prerequisites that precede their users, and a reading for every
 * lesson — the contract the loader walks.
 */

import { describe, expect, it } from 'vitest';
import { readTextbookSpec } from '../../prisma/seed/load-textbook.js';

const spec = readTextbookSpec('science-g07.json');

describe('the science book spec', () => {
  it('is the Yemeni G07 science book: 9 units, 31 lessons, a reading each', () => {
    expect(spec.subjectKey).toBe('SCI');
    expect(spec.gradeKey).toBe('G07');
    expect(spec.units).toHaveLength(9);

    const lessons = spec.units.flatMap((u) => u.lessons);
    expect(lessons).toHaveLength(31);
    // The lesson text is the first thing the learner reads; a lesson without
    // one renders an honest empty state, so the book should simply not have one.
    for (const lesson of lessons) {
      expect(lesson.reading.length, lesson.slug).toBeGreaterThan(80);
    }

    // Page numbers as printed in the book's index.
    expect(spec.units[0]!.name).toBe('تركيب المادة');
    expect(spec.units[0]!.lessons[0]!.startPage).toBe(8);
    expect(spec.units[8]!.lessons[1]!.startPage).toBe(164);
  });

  it('authors exactly two questions per concept, each with one correct answer', () => {
    const concepts = spec.units.flatMap((u) => u.lessons.flatMap((l) => l.concepts));
    expect(concepts.length).toBeGreaterThanOrEqual(50);

    const slugs = new Set<string>();
    for (const c of concepts) {
      expect(slugs.has(c.slug), `duplicate concept slug ${c.slug}`).toBe(false);
      slugs.add(c.slug);
      expect(c.questions, c.slug).toHaveLength(2);
      for (const q of c.questions) {
        expect(q.choices).toHaveLength(4);
        expect(q.choices.filter((ch) => ch.correct)).toHaveLength(1);
        // A distractor may expose a misconception — but only one the same
        // concept actually carries, or the remediation cannot fire.
        const mine = new Set(c.misconceptions.map((m) => m.slug));
        for (const ch of q.choices) {
          if (ch.misconception) expect(mine.has(ch.misconception), ch.misconception).toBe(true);
        }
      }
    }
  });

  it('resolves every prerequisite inside the book, backwards', () => {
    const seen = new Set<string>();
    for (const unit of spec.units) {
      for (const lesson of unit.lessons) {
        for (const c of lesson.concepts) {
          for (const p of c.prerequisites) {
            expect(seen.has(p), `${c.slug} depends on ${p}, authored later or missing`).toBe(true);
          }
          seen.add(c.slug);
        }
      }
    }
  });

  it('gives every misconception a remediation, in the book\u2019s voice', () => {
    const misconceptions = spec.units
      .flatMap((u) => u.lessons.flatMap((l) => l.concepts))
      .flatMap((c) => c.misconceptions);
    expect(misconceptions.length).toBeGreaterThanOrEqual(40);
    for (const m of misconceptions) {
      expect(m.remediation.length, m.slug).toBeGreaterThan(60);
      expect(m.description.length, m.slug).toBeGreaterThan(30);
    }
  });
});
