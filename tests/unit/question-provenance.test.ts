import { describe, expect, it } from 'vitest';
import {
  QUESTION_ORIGINS,
  TEXTBOOK_QUESTION_ROLES,
  resolveProvenance,
} from '../../src/contexts/content/domain/question-authoring.js';

/**
 * The distinction under test:
 *
 *     ALIGNMENT IS NOT ORIGIN.
 *
 * A teacher's item and an AI's item can be aligned to exactly the same lesson
 * and concept as a question printed in the textbook. Only one of them is book
 * content. These tests pin that separation in the domain, where it cannot be
 * bypassed by a caller.
 */
describe('question origin — the supported space', () => {
  it('supports textbook, teacher, ministerial, AI and unknown', () => {
    expect([...QUESTION_ORIGINS]).toEqual(['TEXTBOOK', 'TEACHER', 'MINISTERIAL', 'AI', 'UNKNOWN']);
  });

  it('does not treat import as an origin', () => {
    // Importing is HOW a question entered Edu7, not WHERE it came from. A
    // textbook question that arrives in a file is still TEXTBOOK; the importer
    // states the real origin. Batch/file bookkeeping belongs to Imports.
    expect(QUESTION_ORIGINS).not.toContain('IMPORT');
    expect(QUESTION_ORIGINS).not.toContain('IMPORTED');
  });

  it('accepts every origin on its own', () => {
    for (const origin of QUESTION_ORIGINS) {
      const r = resolveProvenance({ origin });
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      expect(r.value.origin).toBe(origin);
      expect(r.value.textbookRole).toBeNull();
    }
  });

  it('defaults to UNKNOWN rather than guessing', () => {
    const r = resolveProvenance({});

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Not TEXTBOOK. A caller that says nothing has not told us it is book
    // content, and inferring that from alignment is the fabrication this model
    // exists to prevent.
    expect(r.value.origin).toBe('UNKNOWN');
  });
});

describe('textbook role — only for printed questions', () => {
  it('accepts every printed role on a textbook question', () => {
    for (const textbookRole of TEXTBOOK_QUESTION_ROLES) {
      const r = resolveProvenance({ origin: 'TEXTBOOK', textbookRole });
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      expect(r.value.textbookRole).toBe(textbookRole);
    }
  });

  it('refuses a printed role on an AI question', () => {
    const r = resolveProvenance({ origin: 'AI', textbookRole: 'EXERCISE' });

    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected refusal');
    expect(r.error.code).toBe('question.textbook_role_requires_textbook_origin');
  });

  it('refuses a printed role on a teacher question', () => {
    const r = resolveProvenance({ origin: 'TEACHER', textbookRole: 'SELF_TEST' });

    expect(r.ok).toBe(false);
  });

  it('refuses a printed role on a ministerial question', () => {
    const r = resolveProvenance({ origin: 'MINISTERIAL', textbookRole: 'REVIEW' });

    expect(r.ok).toBe(false);
  });

  it('refuses a printed role when the origin is unknown', () => {
    // The dangerous case: claiming a printed role while admitting the origin is
    // unknown would assert book provenance through the back door.
    const r = resolveProvenance({ textbookRole: 'REVIEW' });

    expect(r.ok).toBe(false);
  });

  it('refuses rather than silently nulling the impossible role', () => {
    // Dropping the role and returning ok would hide the author's mistake.
    const r = resolveProvenance({ origin: 'AI', textbookRole: 'EXERCISE' });

    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected refusal');
    expect(r.error.details).toMatchObject({ origin: 'AI', textbookRole: 'EXERCISE' });
  });

  it('allows a textbook question with no role recorded', () => {
    // We know it is from the book but not what it was printed as.
    const r = resolveProvenance({ origin: 'TEXTBOOK' });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.textbookRole).toBeNull();
  });

  it('treats an explicit null role as absent', () => {
    const r = resolveProvenance({ origin: 'TEACHER', textbookRole: null });

    expect(r.ok).toBe(true);
  });
});

describe('origin is provenance, not alignment and not identity', () => {
  it('carries no textbook, unit, lesson or concept reference', () => {
    const r = resolveProvenance({ origin: 'TEXTBOOK', textbookRole: 'EXERCISE' });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Alignment lives in QuestionConcept and the lesson chain. If provenance
    // grew its own pointers they would be a second, drifting answer to "what is
    // this question about".
    expect(Object.keys(r.value).sort()).toEqual(['origin', 'textbookRole']);
  });

  it('is not part of the question key', async () => {
    const { questionKey } = await import('../../src/shared/kernel/identifiers.js');
    const lesson = 'EDU-MATH-G07-T1-ED2026-U-A-L-B' as never;

    const a = questionKey(lesson, 'same stem');
    const b = questionKey(lesson, 'same stem');

    // The key is lesson + fingerprint(stem). Two questions with the same stem
    // in the same lesson collide regardless of who wrote them — origin must
    // never enter identity, or re-imports would stop being idempotent.
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.value).toBe(b.value);
  });
});
