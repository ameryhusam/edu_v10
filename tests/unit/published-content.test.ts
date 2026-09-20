/**
 * The learner-visible content filter.
 *
 * The end-to-end proof lives in scripts/check-published-only.mjs, which drives
 * the real API through every publication state. These tests cover the part
 * that is easy to break silently later: the filter must stay derived from the
 * domain rule rather than hardcoding a status string.
 */

import { describe, expect, it } from 'vitest';
import {
  LEARNER_VISIBLE_STATES,
  publishedConcept,
  publishedLesson,
  publishedTextbook,
  publishedUnit,
} from '../../src/infrastructure/database/published-content.js';
import {
  PUBLICATION_STATES,
  isVisibleToLearners,
} from '../../src/contexts/content/domain/publication.js';

describe('learner-visible states', () => {
  it('is exactly PUBLISHED today', () => {
    expect(LEARNER_VISIBLE_STATES).toEqual(['PUBLISHED']);
  });

  it('agrees with the domain predicate for every state', () => {
    // If someone makes ARCHIVED readable in the domain, this filter follows
    // automatically instead of quietly disagreeing with it.
    for (const state of PUBLICATION_STATES) {
      expect(LEARNER_VISIBLE_STATES.includes(state)).toBe(isVisibleToLearners(state));
    }
  });
});

describe('filter fragments', () => {
  it('filters textbooks by visible status', () => {
    expect(publishedTextbook).toEqual({ status: { in: ['PUBLISHED'] } });
  });

  it('walks the whole ancestor chain up to the textbook', () => {
    // A concept is visible only if its lesson, unit and book all are; checking
    // the concept alone is what let draft books stay teachable in legacy.
    expect(publishedConcept).toEqual({
      isActive: true,
      lesson: {
        isActive: true,
        unit: { isActive: true, textbook: { status: { in: ['PUBLISHED'] } } },
      },
    });
  });

  it('requires isActive at every level as well as a published book', () => {
    for (const fragment of [publishedUnit, publishedLesson, publishedConcept]) {
      expect(fragment).toHaveProperty('isActive', true);
    }
  });
});
