/**
 * Diagnostic placement.
 *
 * A diagnostic attempt writes ordinary Assessment evidence. This use case reads
 * the resulting mastery profile and chooses the first honest starting point in
 * the textbook. It does not write placement state: the learner's path remains
 * derived from evidence, prerequisites and mastery, so a diagnostic can be
 * replayed or improved without migrating a stored "level".
 */

import { Errors } from '../../../shared/kernel/errors.js';
import { Err, Ok, type Result } from '../../../shared/kernel/result.js';
import { DEFAULT_MASTERY_THRESHOLD } from '../../mastery/domain/mastery-level.js';
import type { ConceptDescriptor, ContentReader, MasteryReader } from './ports.js';

export interface DiagnosticPlacementQuery {
  readonly learnerKey: string;
  readonly textbookKey: string;
}

export interface DiagnosticPlacementResult {
  readonly learnerKey: string;
  readonly textbookKey: string;
  readonly status: 'NEEDS_DIAGNOSTIC' | 'PLACED' | 'COMPLETE';
  readonly placement: {
    readonly conceptKey: string;
    readonly conceptName: string;
    readonly lessonKey: string;
    readonly lessonName: string;
    readonly orderIndex: number;
    readonly mastery: number;
    readonly confidence: number;
  } | null;
  readonly summary: {
    readonly totalConcepts: number;
    readonly masteredConcepts: number;
    readonly attemptedConcepts: number;
  };
}

export class GetDiagnosticPlacementUseCase {
  constructor(
    private readonly content: ContentReader,
    private readonly mastery: MasteryReader,
  ) {}

  async execute(query: DiagnosticPlacementQuery): Promise<Result<DiagnosticPlacementResult>> {
    const concepts = await this.content.conceptsInTextbook(query.textbookKey);
    if (concepts.length === 0) {
      return Err(
        Errors.notFound('learning.no_concepts_in_scope', 'No concepts found for the requested textbook.', {
          textbookKey: query.textbookKey,
        }),
      );
    }

    const conceptKeys = concepts.map((concept) => concept.conceptKey);
    const profile = await this.mastery.profileFor(query.learnerKey, conceptKeys);
    const states = concepts.map((concept) => stateFor(concept, profile.get(concept.conceptKey)));
    const attempted = states.filter((state) => state.attemptsCount > 0);
    const mastered = states.filter((state) => state.mastered);

    if (attempted.length === 0) {
      return Ok({
        learnerKey: query.learnerKey,
        textbookKey: query.textbookKey,
        status: 'NEEDS_DIAGNOSTIC',
        placement: null,
        summary: {
          totalConcepts: concepts.length,
          masteredConcepts: 0,
          attemptedConcepts: 0,
        },
      });
    }

    const placement = states.find((state) => !state.mastered) ?? null;
    return Ok({
      learnerKey: query.learnerKey,
      textbookKey: query.textbookKey,
      status: placement ? 'PLACED' : 'COMPLETE',
      placement: placement
        ? {
            conceptKey: placement.concept.conceptKey,
            conceptName: placement.concept.name,
            lessonKey: placement.concept.lessonKey,
            lessonName: placement.concept.lessonName,
            orderIndex: placement.concept.orderIndex,
            mastery: placement.mastery,
            confidence: placement.confidence,
          }
        : null,
      summary: {
        totalConcepts: concepts.length,
        masteredConcepts: mastered.length,
        attemptedConcepts: attempted.length,
      },
    });
  }
}

function stateFor(
  concept: ConceptDescriptor,
  mastery: {
    mastery: number;
    effectiveMastery: number;
    confidence: number;
    retrievability: number;
    attemptsCount: number;
  } | undefined,
) {
  const threshold = concept.masteryThreshold || DEFAULT_MASTERY_THRESHOLD;
  const effectiveMastery = mastery?.effectiveMastery ?? 0;
  return {
    concept,
    mastery: mastery?.mastery ?? 0,
    effectiveMastery,
    confidence: mastery?.confidence ?? 0,
    attemptsCount: mastery?.attemptsCount ?? 0,
    mastered: effectiveMastery >= threshold,
  };
}
