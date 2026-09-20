/**
 * Read-only window onto authored flashcards.
 *
 * Learning consumes cards; it never writes them. Authoring belongs to Content,
 * and the absence of any write method here is how that stays true structurally
 * rather than by agreement.
 */

import type { FlashcardCandidate } from '../domain/flashcard-ordering.js';

/**
 * A card as stored: the ordering inputs, plus the content a learner reads.
 *
 * The domain's `FlashcardCandidate` deliberately knows nothing about front and
 * back — ordering does not depend on them — so the two faces ride along here.
 */
export interface AuthoredFlashcard extends FlashcardCandidate {
  readonly front: string;
  readonly back: string;
}

export interface FlashcardReader {
  /** Active cards for every concept in a lesson, published content only. */
  forLesson(lessonKey: string): Promise<AuthoredFlashcard[]>;
  /** Active cards for one concept. */
  forConcept(conceptKey: string): Promise<AuthoredFlashcard[]>;
}
