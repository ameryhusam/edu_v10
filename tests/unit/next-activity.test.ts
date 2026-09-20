import { describe, expect, it } from 'vitest';
import {
  decideNextActivity,
  targetDifficultyFor,
  type ConceptState,
} from '../../src/contexts/learning/domain/next-activity.js';
import type { PrerequisiteEdge } from '../../src/contexts/learning/domain/prerequisite-graph.js';

const concept = (over: Partial<ConceptState> & { conceptKey: string }): ConceptState => ({
  orderIndex: 1,
  mastery: 0,
  effectiveMastery: 0,
  confidence: 0,
  retrievability: 1,
  attemptsCount: 0,
  openMisconceptionKeys: [],
  masteryThreshold: 0.85,
  ...over,
});

describe('next activity priority order', () => {
  it('remediates an open misconception before anything else', () => {
    const decision = decideNextActivity({
      concepts: [
        concept({ conceptKey: 'C1', mastery: 0.9, effectiveMastery: 0.9, attemptsCount: 10 }),
        concept({
          conceptKey: 'C2',
          orderIndex: 2,
          mastery: 0.5,
          effectiveMastery: 0.5,
          attemptsCount: 3,
          openMisconceptionKeys: ['C2-MIS01'],
        }),
      ],
      prerequisites: [],
    });
    expect(decision.activity).toBe('REMEDIATE');
    expect(decision.conceptKey).toBe('C2');
    expect(decision.rule).toBe('open_misconception_first');
  });

  it('schedules review when a mastered concept has decayed', () => {
    const decision = decideNextActivity({
      concepts: [
        concept({
          conceptKey: 'C1',
          mastery: 0.95,
          effectiveMastery: 0.4,
          retrievability: 0.42,
          attemptsCount: 12,
        }),
        concept({ conceptKey: 'C2', orderIndex: 2 }),
      ],
      prerequisites: [],
    });
    expect(decision.activity).toBe('REVIEW');
    expect(decision.conceptKey).toBe('C1');
  });

  it('routes to the DEEPEST unmet prerequisite, not the surface concept', () => {
    // C3 needs C2, C2 needs C1. The learner knows none of them.
    const prerequisites: PrerequisiteEdge[] = [
      { conceptKey: 'C3', prerequisiteKey: 'C2', strength: 1, requiredMastery: 0.7 },
      { conceptKey: 'C2', prerequisiteKey: 'C1', strength: 1, requiredMastery: 0.7 },
    ];
    const decision = decideNextActivity({
      concepts: [
        concept({ conceptKey: 'C3', orderIndex: 1, attemptsCount: 4, mastery: 0.2, effectiveMastery: 0.2 }),
        concept({ conceptKey: 'C2', orderIndex: 2, attemptsCount: 1 }),
        concept({ conceptKey: 'C1', orderIndex: 3, attemptsCount: 0 }),
      ],
      prerequisites,
    });
    expect(decision.activity).toBe('UNBLOCK');
    expect(decision.conceptKey).toBe('C1');
  });

  it('teaches a concept the learner has never attempted', () => {
    const decision = decideNextActivity({
      concepts: [concept({ conceptKey: 'C1', attemptsCount: 0 })],
      prerequisites: [],
    });
    expect(decision.activity).toBe('LEARN');
  });

  it('confirms a high estimate that rests on too little evidence', () => {
    const decision = decideNextActivity({
      concepts: [
        concept({
          conceptKey: 'C1',
          mastery: 0.8,
          effectiveMastery: 0.8,
          confidence: 0.3,
          attemptsCount: 2,
        }),
      ],
      prerequisites: [],
    });
    expect(decision.activity).toBe('ASSESS');
    expect(decision.rule).toBe('confirm_low_confidence_mastery');
  });

  it('practises the earliest unmastered ready concept', () => {
    const decision = decideNextActivity({
      concepts: [
        concept({ conceptKey: 'C1', mastery: 0.95, effectiveMastery: 0.95, attemptsCount: 9 }),
        concept({
          conceptKey: 'C2',
          orderIndex: 2,
          mastery: 0.5,
          effectiveMastery: 0.5,
          attemptsCount: 6,
        }),
      ],
      prerequisites: [],
    });
    expect(decision.activity).toBe('PRACTISE');
    expect(decision.conceptKey).toBe('C2');
  });

  it('advances when everything in scope is mastered and fresh', () => {
    const decision = decideNextActivity({
      concepts: [
        concept({ conceptKey: 'C1', mastery: 0.95, effectiveMastery: 0.95, attemptsCount: 8 }),
      ],
      prerequisites: [],
    });
    expect(decision.activity).toBe('ADVANCE');
    expect(decision.conceptKey).toBeNull();
  });
});

describe('explainability', () => {
  it('always returns a rule id, a rationale and supporting evidence', () => {
    const decision = decideNextActivity({
      concepts: [concept({ conceptKey: 'C1' })],
      prerequisites: [],
    });
    expect(decision.rule).toBeTruthy();
    expect(decision.rationale.length).toBeGreaterThan(20);
    expect(decision.evidence).toBeTypeOf('object');
  });
});

describe('target difficulty', () => {
  it('aims just above current mastery, inside safe bounds', () => {
    expect(targetDifficultyFor(0.5)).toBeCloseTo(0.6, 5);
    expect(targetDifficultyFor(0)).toBeGreaterThanOrEqual(0.15);
    expect(targetDifficultyFor(1)).toBeLessThanOrEqual(0.95);
  });
});
