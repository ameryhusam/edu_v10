/**
 * Adaptive flashcard ordering.
 *
 * Storage and presentation are split exactly as specified:
 *
 *   Content   → the card is content, stored once against a concept.
 *   Mastery   → supplies the signals (effective mastery, active misconception).
 *   Learning  → THIS FILE decides the order.
 *   Frontend  → flips, marks, and animates. It does not decide anything.
 *
 * The legacy behaviour is preserved because it was pedagogically sound: cards
 * are banded by how much trouble the learner is in, hardest trouble first.
 *
 *   tier 0  active misconception   — a wrong model is worse than a weak one
 *   tier 1  mastery < 0.50         — genuinely not known
 *   tier 2  mastery < 0.75         — shaky
 *   tier 3  mastered, or no signal — general review
 *
 * The one correction: in the legacy system this ran inside a React component,
 * so it could not be tested, could not be reused by another client, and could
 * drift from the server's idea of "weak". Here it is a pure function with the
 * thresholds stated once.
 *
 * Note the deliberate absence of SM-2. Spaced repetition already exists in
 * `mastery/domain/retention.ts`. A second scheduler owned by flashcards would
 * produce two competing answers to "when should this be reviewed?" — the exact
 * class of duplication that produced four mastery formulas in the legacy code.
 */

/** Ordering thresholds, named so they are not mistaken for magic numbers. */
export const FLASHCARD_TIERS = {
  /** Below this, the concept is treated as not known. */
  notKnown: 0.5,
  /** Below this, the concept is shaky. */
  shaky: 0.75,
} as const;

export interface FlashcardSignal {
  readonly conceptKey: string;
  /** Decay-adjusted mastery. Null when the concept has never been measured. */
  readonly effectiveMastery: number | null;
  readonly hasActiveMisconception: boolean;
}

export interface FlashcardCandidate {
  readonly cardKey: string;
  readonly conceptKey: string | null;
  /** Author-set weight, used to break ties within a tier. */
  readonly reviewPriority: number;
  readonly difficulty: number;
}

export type FlashcardTier = 0 | 1 | 2 | 3;

/** What ordering adds to a card. */
export interface FlashcardPlacement {
  readonly tier: FlashcardTier;
  /** Why this card is where it is. Surfaced to the learner as a badge. */
  readonly reason:
    | 'active_misconception'
    | 'low_mastery'
    | 'needs_improvement'
    | 'general_review';
}

export type OrderedFlashcard = FlashcardCandidate & FlashcardPlacement;

const REASON_BY_TIER = {
  0: 'active_misconception',
  1: 'low_mastery',
  2: 'needs_improvement',
  3: 'general_review',
} as const;

export function tierOf(
  conceptKey: string | null,
  signals: ReadonlyMap<string, FlashcardSignal>,
): FlashcardTier {
  if (conceptKey === null) return 3;
  const signal = signals.get(conceptKey);
  // No signal means unmeasured, not mastered — but it is not evidence of
  // trouble either, so it sits in general review rather than jumping the queue.
  if (!signal) return 3;

  if (signal.hasActiveMisconception) return 0;
  if (signal.effectiveMastery === null) return 3;
  if (signal.effectiveMastery < FLASHCARD_TIERS.notKnown) return 1;
  if (signal.effectiveMastery < FLASHCARD_TIERS.shaky) return 2;
  return 3;
}

/**
 * Order a deck. Pure and total: the same inputs always give the same deck,
 * which matters because a learner who reloads mid-session must not be handed a
 * reshuffled pile.
 */
/**
 * Generic in the card type so the caller's own fields — front, back, anything
 * an adapter carries — survive ordering. Narrowing to `FlashcardCandidate`
 * would return a deck of keys and weights with no content on it, and the
 * endpoint would have to re-fetch every card it had just sorted.
 */
export function orderFlashcards<T extends FlashcardCandidate>(
  cards: readonly T[],
  signals: readonly FlashcardSignal[],
): (T & FlashcardPlacement)[] {
  const byConcept = new Map(signals.map((s) => [s.conceptKey, s]));

  return cards
    .map((card) => {
      const tier = tierOf(card.conceptKey, byConcept);
      return { ...card, tier, reason: REASON_BY_TIER[tier] };
    })
    .sort(
      (a, b) =>
        a.tier - b.tier ||
        b.reviewPriority - a.reviewPriority ||
        b.difficulty - a.difficulty ||
        // Final tiebreak on the key so the order is fully deterministic.
        a.cardKey.localeCompare(b.cardKey),
    );
}
