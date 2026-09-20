/**
 * The flashcard service — the seam between stored cards and derived order.
 *
 * The pure ordering rules are already tested in `completion-progress.test.ts`.
 * What is tested here is the wiring, where the plausible mistakes live:
 * unmeasured concepts being treated as failures, misconception signals never
 * reaching the ordering function, and card content being dropped on the way
 * through the sort.
 */

import { describe, expect, it } from 'vitest';
import { FlashcardService } from '../../src/contexts/learning/application/flashcard.service.js';
import type {
  AuthoredFlashcard,
  FlashcardReader,
} from '../../src/contexts/learning/application/flashcard.ports.js';
import type {
  MasteryReader,
  MisconceptionReader,
} from '../../src/contexts/learning/application/ports.js';

const LESSON = 'EDU-MATH-G07-T1-ED2026-U-SETS-L-BASICS';
const C_SET = `${LESSON}-C-SET`;
const C_UNION = `${LESSON}-C-UNION`;
const LEARNER = 'lrn_demo_student';

function card(key: string, conceptKey: string, priority = 0.5): AuthoredFlashcard {
  return {
    cardKey: key,
    conceptKey,
    reviewPriority: priority,
    difficulty: 0.5,
    front: `front of ${key}`,
    back: `back of ${key}`,
  };
}

class FakeCards implements FlashcardReader {
  rows: AuthoredFlashcard[] = [];
  async forLesson() {
    return this.rows;
  }
  async forConcept(conceptKey: string) {
    return this.rows.filter((r) => r.conceptKey === conceptKey);
  }
}

class FakeMastery implements MasteryReader {
  rows = new Map<string, number>();
  async profileFor(_l: string, conceptKeys: readonly string[]) {
    const out = new Map<
      string,
      {
        mastery: number;
        effectiveMastery: number;
        confidence: number;
        retrievability: number;
        attemptsCount: number;
      }
    >();
    for (const key of conceptKeys) {
      const m = this.rows.get(key);
      if (m === undefined) continue;
      out.set(key, {
        mastery: m,
        effectiveMastery: m,
        confidence: 0.8,
        retrievability: 1,
        attemptsCount: 5,
      });
    }
    return out;
  }
}

class FakeMisconceptions implements MisconceptionReader {
  open = new Map<string, string[]>();
  async openForLearner() {
    return this.open;
  }
}

function setup() {
  const cards = new FakeCards();
  const mastery = new FakeMastery();
  const misconceptions = new FakeMisconceptions();
  return {
    cards,
    mastery,
    misconceptions,
    service: new FlashcardService(cards, mastery, misconceptions),
  };
}

describe('building a deck', () => {
  it('refuses a deck with no scope', async () => {
    const s = setup();
    const deck = await s.service.deck({ learnerKey: LEARNER });
    expect(deck.ok).toBe(false);
    if (deck.ok) return;
    expect(deck.error.code).toBe('flashcards.scope_required');
  });

  it('returns an empty deck as success, not as a 404', async () => {
    // A lesson with no cards yet is a normal state, not an error the client
    // should have to special-case.
    const s = setup();
    const deck = await s.service.deck({ learnerKey: LEARNER, lessonKey: LESSON });
    expect(deck.ok).toBe(true);
    if (!deck.ok) return;
    expect(deck.value.cards).toEqual([]);
  });

  it('carries the card content through the ordering', async () => {
    // The regression this guards: ordering is generic so front/back survive.
    // A deck of keys and weights would force the client to re-fetch every card
    // it had just been given.
    const s = setup();
    s.cards.rows = [card('FC-1', C_SET)];

    const deck = await s.service.deck({ learnerKey: LEARNER, lessonKey: LESSON });
    if (!deck.ok) return;
    expect(deck.value.cards[0]?.front).toBe('front of FC-1');
    expect(deck.value.cards[0]?.back).toBe('back of FC-1');
  });

  it('puts a misconception card first, ahead of a low-mastery one', async () => {
    const s = setup();
    s.cards.rows = [card('FC-WEAK', C_SET), card('FC-WRONG', C_UNION)];
    s.mastery.rows.set(C_SET, 0.1);
    s.mastery.rows.set(C_UNION, 0.9);
    s.misconceptions.open.set(C_UNION, ['MIS-A']);

    const deck = await s.service.deck({ learnerKey: LEARNER, lessonKey: LESSON });
    if (!deck.ok) return;

    // A wrong model outranks a weak one even though its mastery is far higher.
    expect(deck.value.cards[0]?.cardKey).toBe('FC-WRONG');
    expect(deck.value.cards[0]?.reason).toBe('active_misconception');
  });

  it('treats an unmeasured concept as general review, not as a failure', async () => {
    // Mapping "no data" to zero would promote an untouched concept above one
    // the learner is genuinely failing.
    const s = setup();
    s.cards.rows = [card('FC-NEW', C_SET), card('FC-BAD', C_UNION)];
    s.mastery.rows.set(C_UNION, 0.1);

    const deck = await s.service.deck({ learnerKey: LEARNER, lessonKey: LESSON });
    if (!deck.ok) return;

    expect(deck.value.cards[0]?.cardKey).toBe('FC-BAD');
    expect(deck.value.cards.find((c) => c.cardKey === 'FC-NEW')?.reason).toBe('general_review');
  });

  it('summarises the deck by reason', async () => {
    const s = setup();
    s.cards.rows = [card('FC-1', C_SET), card('FC-2', C_UNION)];
    s.mastery.rows.set(C_SET, 0.1);
    s.mastery.rows.set(C_UNION, 0.2);

    const deck = await s.service.deck({ learnerKey: LEARNER, lessonKey: LESSON });
    if (!deck.ok) return;
    expect(deck.value.byTier.low_mastery).toBe(2);
  });

  it('caps the deck at the requested limit', async () => {
    const s = setup();
    s.cards.rows = Array.from({ length: 10 }, (_, i) => card(`FC-${i}`, C_SET));

    const deck = await s.service.deck({ learnerKey: LEARNER, lessonKey: LESSON, limit: 3 });
    if (!deck.ok) return;
    expect(deck.value.cards).toHaveLength(3);
  });

  it('never exceeds the hard maximum however large the request', async () => {
    const s = setup();
    s.cards.rows = Array.from({ length: 80 }, (_, i) => card(`FC-${i}`, C_SET));

    const deck = await s.service.deck({ learnerKey: LEARNER, lessonKey: LESSON, limit: 999 });
    if (!deck.ok) return;
    expect(deck.value.cards.length).toBeLessThanOrEqual(50);
  });

  it('scopes to one concept when asked', async () => {
    const s = setup();
    s.cards.rows = [card('FC-1', C_SET), card('FC-2', C_UNION)];

    const deck = await s.service.deck({ learnerKey: LEARNER, conceptKey: C_UNION });
    if (!deck.ok) return;
    expect(deck.value.cards.map((c) => c.cardKey)).toEqual(['FC-2']);
    expect(deck.value.scope).toEqual({ conceptKey: C_UNION });
  });

  it('is deterministic — a reload does not reshuffle the pile', async () => {
    const s = setup();
    s.cards.rows = [card('FC-B', C_SET), card('FC-A', C_SET), card('FC-C', C_SET)];

    const first = await s.service.deck({ learnerKey: LEARNER, lessonKey: LESSON });
    const second = await s.service.deck({ learnerKey: LEARNER, lessonKey: LESSON });
    if (!first.ok || !second.ok) return;

    expect(first.value.cards.map((c) => c.cardKey)).toEqual(
      second.value.cards.map((c) => c.cardKey),
    );
  });
});

describe('what the service must NOT do', () => {
  it('exposes no way to record a review', () => {
    // Flipping a card is not evidence. Legacy counted "I knew that one" as a
    // correct answer and inflated mastery without a graded question.
    const s = setup();
    const surface = Object.getOwnPropertyNames(Object.getPrototypeOf(s.service));
    expect(surface.filter((m) => /review|answer|grade|record|submit/i.test(m))).toEqual([]);
  });
});
