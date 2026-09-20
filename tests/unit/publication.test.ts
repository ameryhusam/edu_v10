/**
 * Publication lifecycle.
 *
 * The transition table is tested EXHAUSTIVELY — every state × every action, 20
 * cases — rather than by sampling. A lifecycle bug is not a wrong answer; it
 * is content escaping review, or published content silently becoming editable.
 */

import { describe, expect, it } from 'vitest';
import {
  PUBLICATION_ACTIONS,
  PUBLICATION_STATES,
  checkEditable,
  checkTransition,
  isPresentationalField,
  isPublicationAction,
  isPublicationState,
  isStructurallyLocked,
  isVisibleToLearners,
  type PublicationAction,
  type PublicationState,
} from '../../src/contexts/content/domain/publication.js';

/** The complete intended table. Anything not listed here must be refused. */
const ALLOWED: ReadonlyArray<[PublicationState, PublicationAction, PublicationState]> = [
  ['DRAFT', 'SUBMIT', 'IN_REVIEW'],
  ['IN_REVIEW', 'REJECT', 'DRAFT'],
  ['IN_REVIEW', 'APPROVE', 'PUBLISHED'],
  ['PUBLISHED', 'ARCHIVE', 'ARCHIVED'],
  ['ARCHIVED', 'RESTORE', 'PUBLISHED'],
];

const isAllowed = (from: PublicationState, action: PublicationAction) =>
  ALLOWED.find(([f, a]) => f === from && a === action);

describe('transition table — exhaustive over all 20 state × action pairs', () => {
  for (const from of PUBLICATION_STATES) {
    for (const action of PUBLICATION_ACTIONS) {
      const expected = isAllowed(from, action);

      it(`${from} + ${action} → ${expected ? expected[2] : 'REFUSED'}`, () => {
        const outcome = checkTransition(from, action);

        if (expected) {
          expect(outcome.allowed).toBe(true);
          if (!outcome.allowed) return;
          expect(outcome.to).toBe(expected[2]);
        } else {
          expect(outcome.allowed).toBe(false);
          if (outcome.allowed) return;
          // Every refusal is named and explained; "invalid transition" alone
          // tells an author nothing about what to do next.
          expect(outcome.code).toMatch(/^content\./);
          expect(outcome.reason.length).toBeGreaterThan(10);
        }
      });
    }
  }

  it('allows exactly five transitions and no more', () => {
    const allowed = PUBLICATION_STATES.flatMap((from) =>
      PUBLICATION_ACTIONS.filter((a) => checkTransition(from, a).allowed).map((a) => `${from}+${a}`),
    );

    expect(allowed).toHaveLength(5);
  });
});

describe('the transitions that must never exist', () => {
  it('refuses PUBLISHED → DRAFT', () => {
    // Un-publishing content learners were assessed against would retroactively
    // change what their evidence was about.
    const outcome = checkTransition('PUBLISHED', 'REJECT');

    expect(outcome.allowed).toBe(false);
    if (outcome.allowed) return;
    expect(outcome.code).toBe('content.published_cannot_return_to_draft');
  });

  it('refuses ARCHIVED → DRAFT', () => {
    const outcome = checkTransition('ARCHIVED', 'SUBMIT');

    expect(outcome.allowed).toBe(false);
    if (outcome.allowed) return;
    expect(outcome.code).toBe('content.published_cannot_return_to_draft');
  });

  it('refuses DRAFT → PUBLISHED: review is not optional', () => {
    const outcome = checkTransition('DRAFT', 'APPROVE');

    expect(outcome.allowed).toBe(false);
    if (outcome.allowed) return;
    expect(outcome.code).toBe('content.review_required');
  });

  it('refuses no-op transitions rather than silently succeeding', () => {
    // A no-op that reports success hides the bug that caused it.
    expect(checkTransition('PUBLISHED', 'RESTORE').allowed).toBe(false);
    expect(checkTransition('ARCHIVED', 'ARCHIVE').allowed).toBe(false);
  });

  it('never lands in DRAFT except by explicit rejection from review', () => {
    const reachDraft = PUBLICATION_STATES.flatMap((from) =>
      PUBLICATION_ACTIONS.map((a) => [from, a, checkTransition(from, a)] as const),
    ).filter(([, , o]) => o.allowed && o.to === 'DRAFT');

    expect(reachDraft).toHaveLength(1);
    expect(reachDraft[0]![0]).toBe('IN_REVIEW');
    expect(reachDraft[0]![1]).toBe('REJECT');
  });

  it('sets publishedAt only when approving', () => {
    const approve = checkTransition('IN_REVIEW', 'APPROVE');
    const restore = checkTransition('ARCHIVED', 'RESTORE');

    expect(approve.allowed && approve.publishes).toBe(true);
    // Restoring is not first publication; publishedAt must not be rewritten.
    expect(restore.allowed && restore.publishes).toBe(false);
  });
});

describe('structural lock', () => {
  it('locks published and archived, leaves draft and review open', () => {
    expect(isStructurallyLocked('PUBLISHED')).toBe(true);
    expect(isStructurallyLocked('ARCHIVED')).toBe(true);
    expect(isStructurallyLocked('DRAFT')).toBe(false);
    expect(isStructurallyLocked('IN_REVIEW')).toBe(false);
  });

  it('refuses edits to anything the engines read', () => {
    // Mastery is computed from these; changing them would rewrite the meaning
    // of evidence already collected.
    const refused = checkEditable('PUBLISHED', [
      'masteryThreshold',
      'difficulty',
      'orderIndex',
      'slug',
    ]);

    expect(refused).toEqual(['masteryThreshold', 'difficulty', 'orderIndex', 'slug']);
  });

  it('permits presentational fixes to published content', () => {
    // Legacy locked everything, which pushed authors into workarounds. A typo
    // in a title changes nothing the engines compute.
    expect(checkEditable('PUBLISHED', ['title', 'name', 'description'])).toEqual([]);
    expect(isPresentationalField('name')).toBe(true);
    expect(isPresentationalField('masteryThreshold')).toBe(false);
  });

  it('reports every refused field at once', () => {
    const refused = checkEditable('PUBLISHED', ['title', 'difficulty', 'name', 'slug']);

    expect(refused).toEqual(['difficulty', 'slug']);
  });

  it('permits everything while in draft', () => {
    expect(checkEditable('DRAFT', ['slug', 'orderIndex', 'masteryThreshold'])).toEqual([]);
  });
});

describe('learner visibility', () => {
  it('shows published content only', () => {
    // Today a DRAFT textbook is fully teachable. That is the live defect this
    // closes.
    expect(isVisibleToLearners('PUBLISHED')).toBe(true);
    expect(isVisibleToLearners('DRAFT')).toBe(false);
    expect(isVisibleToLearners('IN_REVIEW')).toBe(false);
    expect(isVisibleToLearners('ARCHIVED')).toBe(false);
  });
});

describe('guards', () => {
  it('validates states and actions', () => {
    expect(isPublicationState('PUBLISHED')).toBe(true);
    expect(isPublicationState('ACTIVE')).toBe(false); // legacy's fifth state
    expect(isPublicationAction('APPROVE')).toBe(true);
    expect(isPublicationAction('UNPUBLISH')).toBe(false);
  });
});
