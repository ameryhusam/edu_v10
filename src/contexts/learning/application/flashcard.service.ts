/**
 * Flashcard decks — stored by Content, ordered by Learning.
 *
 * The split the user insisted on, made structural:
 *
 *   Content   owns the card (front, back, which concept)
 *   Mastery   supplies the signals
 *   Learning  decides the order — `domain/flashcard-ordering.ts`
 *   Frontend  flips and animates, and decides nothing
 *
 * This service is the seam. It fetches cards for a scope, fetches the signals,
 * hands both to the pure ordering function, and returns the deck. It contains
 * no thresholds and no sorting of its own; if a rule appears here rather than
 * in the domain function, the rule has escaped its test.
 *
 * No review is recorded here. A learner flipping a card produces no evidence —
 * self-assessment is not measurement, and treating "I knew that one" as a
 * correct answer is how legacy's flashcard mode inflated mastery without a
 * single graded question.
 */

import { Errors } from '../../../shared/kernel/errors.js';
import { Err, Ok, type Result } from '../../../shared/kernel/result.js';
import {
  orderFlashcards,
  type FlashcardPlacement,
  type FlashcardSignal,
} from '../domain/flashcard-ordering.js';
import type { MasteryReader, MisconceptionReader } from './ports.js';
import type { AuthoredFlashcard, FlashcardReader } from './flashcard.ports.js';

/** A card with its place in the deck and the reason for it. */
export type DeckCard = AuthoredFlashcard & FlashcardPlacement;

/** How many cards one sitting may contain. */
const MAX_DECK = 50;

export interface DeckView {
  readonly scope: { lessonKey?: string; conceptKey?: string };
  readonly cards: readonly DeckCard[];
  /** Tier counts, so a client can show "3 needing work" without recounting. */
  readonly byTier: Readonly<Record<string, number>>;
}

export class FlashcardService {
  constructor(
    private readonly cards: FlashcardReader,
    private readonly mastery: MasteryReader,
    private readonly misconceptions: MisconceptionReader,
  ) {}

  /**
   * A deck for one lesson or one concept, hardest trouble first.
   */
  async deck(input: {
    learnerKey: string;
    lessonKey?: string | undefined;
    conceptKey?: string | undefined;
    limit?: number | undefined;
  }): Promise<Result<DeckView>> {
    if (!input.lessonKey && !input.conceptKey) {
      return Err(
        Errors.validation(
          'flashcards.scope_required',
          'Name a lesson or a concept to build a deck from.',
        ),
      );
    }

    const candidates = input.conceptKey
      ? await this.cards.forConcept(input.conceptKey)
      : await this.cards.forLesson(input.lessonKey!);

    if (candidates.length === 0) {
      // An empty deck is a real answer — the lesson may simply have no cards
      // yet — so it is returned as success with zero cards rather than as a
      // 404 the client has to special-case.
      return Ok({ scope: this.scopeOf(input), cards: [], byTier: {} });
    }

    const conceptKeys = [
      ...new Set(candidates.flatMap((c) => (c.conceptKey ? [c.conceptKey] : []))),
    ];

    const [profile, openMisconceptions] = await Promise.all([
      this.mastery.profileFor(input.learnerKey, conceptKeys),
      this.misconceptions.openForLearner(input.learnerKey, conceptKeys),
    ]);

    const signals: FlashcardSignal[] = conceptKeys.map((conceptKey) => ({
      conceptKey,
      // Null, not zero, when unmeasured. Zero would read as "known to be bad"
      // and promote an untouched concept above one the learner is genuinely
      // failing.
      effectiveMastery: profile.get(conceptKey)?.effectiveMastery ?? null,
      hasActiveMisconception: (openMisconceptions.get(conceptKey) ?? []).length > 0,
    }));

    const ordered = orderFlashcards(candidates, signals);
    const limit = Math.min(input.limit ?? MAX_DECK, MAX_DECK);
    const deck = ordered.slice(0, limit);

    const byTier: Record<string, number> = {};
    for (const card of deck) {
      byTier[card.reason] = (byTier[card.reason] ?? 0) + 1;
    }

    return Ok({ scope: this.scopeOf(input), cards: deck, byTier });
  }

  private scopeOf(input: { lessonKey?: string | undefined; conceptKey?: string | undefined }) {
    return {
      ...(input.lessonKey ? { lessonKey: input.lessonKey } : {}),
      ...(input.conceptKey ? { conceptKey: input.conceptKey } : {}),
    };
  }
}
