import { describe, expect, it } from 'vitest';
import { GetDiagnosticPlacementUseCase } from '../../src/contexts/learning/application/get-diagnostic-placement.use-case.js';
import type {
  ConceptDescriptor,
  ContentReader,
  MasteryReader,
} from '../../src/contexts/learning/application/ports.js';

const concepts: ConceptDescriptor[] = [
  {
    conceptKey: 'C-1',
    name: 'First concept',
    lessonKey: 'L-1',
    lessonName: 'Lesson 1',
    unitKey: 'U-1',
    unitName: 'Unit 1',
    orderIndex: 1,
    masteryThreshold: 0.75,
    isCore: true,
  },
  {
    conceptKey: 'C-2',
    name: 'Second concept',
    lessonKey: 'L-2',
    lessonName: 'Lesson 2',
    unitKey: 'U-1',
    unitName: 'Unit 1',
    orderIndex: 2,
    masteryThreshold: 0.75,
    isCore: true,
  },
];

const content: ContentReader = {
  conceptsInLesson: async () => [],
  conceptsInTextbook: async () => concepts,
  prerequisitesFor: async () => [],
  lessonExists: async () => true,
  lessonView: async () => null,
  lessonShelf: async () => [],
};

function mastery(rows: Record<string, { effectiveMastery: number; attemptsCount: number }>): MasteryReader {
  return {
    profileFor: async (_learner, keys) =>
      new Map(
        keys.flatMap((key) => {
          const row = rows[key];
          return row
            ? [
                [
                  key,
                  {
                    mastery: row.effectiveMastery,
                    effectiveMastery: row.effectiveMastery,
                    confidence: row.attemptsCount > 0 ? 0.8 : 0,
                    retrievability: 1,
                    attemptsCount: row.attemptsCount,
                  },
                ] as const,
              ]
            : [];
        }),
      ),
  };
}

describe('diagnostic placement', () => {
  it('asks for a diagnostic before there is any evidence', async () => {
    const result = await new GetDiagnosticPlacementUseCase(content, mastery({})).execute({
      learnerKey: 'LRN-1',
      textbookKey: 'TB-1',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('NEEDS_DIAGNOSTIC');
    expect(result.value.placement).toBeNull();
  });

  it('places the learner at the first unmastered concept after diagnostic evidence', async () => {
    const result = await new GetDiagnosticPlacementUseCase(
      content,
      mastery({
        'C-1': { effectiveMastery: 0.9, attemptsCount: 3 },
        'C-2': { effectiveMastery: 0.4, attemptsCount: 2 },
      }),
    ).execute({ learnerKey: 'LRN-1', textbookKey: 'TB-1' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('PLACED');
    expect(result.value.placement?.conceptKey).toBe('C-2');
    expect(result.value.summary).toMatchObject({ masteredConcepts: 1, attemptedConcepts: 2 });
  });
});
