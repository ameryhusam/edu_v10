import { describe, expect, it } from 'vitest';
import { evaluateAnswer, normalizeText } from '../../src/contexts/assessment/domain/evaluation.js';
import { buildEvidence, evidenceWeight } from '../../src/contexts/assessment/domain/evidence.js';

describe('Arabic-aware normalisation', () => {
  it('unifies alef, yeh and teh marbuta and strips diacritics', () => {
    const { value } = normalizeText('أَلْمَدْرَسَة');
    expect(value).toBe('المدرسه');
  });

  it('converts Arabic-Indic digits to Western digits', () => {
    expect(normalizeText('٤٢').value).toBe('42');
  });

  it('reports every step it applied, so a verdict can be explained', () => {
    const { steps } = normalizeText('  إسلام  ');
    expect(steps).toContain('TRIM');
    expect(steps).toContain('UNIFY_ARABIC_ALEF');
  });
});

describe('MCQ grading', () => {
  const key = { type: 'MCQ_SINGLE' as const, correctChoiceIds: ['b'] };

  it('grades correct and incorrect selections', () => {
    expect(evaluateAnswer(key, { choiceIds: ['b'] }).verdict).toBe('CORRECT');
    expect(evaluateAnswer(key, { choiceIds: ['a'] }).verdict).toBe('INCORRECT');
  });

  it('rejects multiple selections on a single-answer item as INVALID, not wrong', () => {
    expect(evaluateAnswer(key, { choiceIds: ['a', 'b'] }).verdict).toBe('INVALID');
  });

  it('returns SKIPPED for an empty answer', () => {
    expect(evaluateAnswer(key, {}).verdict).toBe('SKIPPED');
  });

  it('returns UNGRADABLE when the answer key is missing rather than marking it wrong', () => {
    const result = evaluateAnswer({ type: 'MCQ_SINGLE' }, { choiceIds: ['a'] });
    expect(result.verdict).toBe('UNGRADABLE');
    expect(result.scoreEarned).toBeNull();
  });
});

describe('multi-select partial credit', () => {
  const key = {
    type: 'MCQ_MULTI' as const,
    correctChoiceIds: ['a', 'b'],
    allowPartialCredit: true,
  };

  it('awards partial credit for a subset', () => {
    const result = evaluateAnswer(key, { choiceIds: ['a'] }, 4);
    expect(result.verdict).toBe('PARTIALLY_CORRECT');
    expect(result.scoreEarned).toBe(2);
  });

  it('penalises over-selection so selecting everything cannot score', () => {
    const result = evaluateAnswer(key, { choiceIds: ['a', 'b', 'c', 'd'] }, 4);
    expect(result.scoreEarned).toBe(0);
  });
});

describe('numeric and text grading', () => {
  it('accepts a value inside the tolerance range', () => {
    const key = { type: 'NUMERIC' as const, numericRange: { min: 3.1, max: 3.2 } };
    expect(evaluateAnswer(key, { numeric: 3.14 }).verdict).toBe('CORRECT');
    expect(evaluateAnswer(key, { numeric: 9 }).verdict).toBe('INCORRECT');
  });

  it('flags a missing numeric range as ungradable instead of guessing', () => {
    expect(evaluateAnswer({ type: 'NUMERIC' }, { numeric: 1 }).note).toBe(
      'numeric_range_missing_bounds',
    );
  });

  it('matches short text after normalisation', () => {
    const key = { type: 'SHORT_TEXT' as const, acceptedTexts: ['المدرسة'] };
    expect(evaluateAnswer(key, { text: ' المدرسه ' }).verdict).toBe('CORRECT');
  });
});

describe('essays', () => {
  it('routes to manual review with no score rather than guessing', () => {
    const result = evaluateAnswer({ type: 'ESSAY' }, { text: 'A long answer.' });
    expect(result.verdict).toBe('REQUIRES_MANUAL_REVIEW');
    expect(result.scoreEarned).toBeNull();
  });
});

describe('evidence weighting', () => {
  it('gives zero mastery signal to non-graded verdicts', () => {
    for (const verdict of ['SKIPPED', 'INVALID', 'UNGRADABLE', 'REQUIRES_MANUAL_REVIEW'] as const) {
      const weight = evidenceWeight({
        verdict,
        scoreEarned: null,
        scorePossible: 1,
        normalizedAnswer: null,
        normalizationApplied: [],
        evaluatorVersion: 'canonical-2.0',
      });
      expect(weight).toBe(0);
    }
  });

  it('scales weight by how strongly the question measures the concept', () => {
    const evaluation = {
      verdict: 'CORRECT' as const,
      scoreEarned: 1,
      scorePossible: 1,
      normalizedAnswer: null,
      normalizationApplied: [],
      evaluatorVersion: 'canonical-2.0',
    };
    expect(evidenceWeight(evaluation, 0.5)).toBe(0.5);
  });

  it('marks an essay awaiting review as non-signal evidence', () => {
    const evidence = buildEvidence({
      conceptKey: 'C1',
      questionKey: 'Q1',
      observedAt: new Date('2026-01-01'),
      evaluation: {
        verdict: 'REQUIRES_MANUAL_REVIEW',
        scoreEarned: null,
        scorePossible: 5,
        normalizedAnswer: null,
        normalizationApplied: [],
        evaluatorVersion: 'canonical-2.0',
      },
    });
    expect(evidence.weight).toBe(0);
    expect(evidence.isCorrect).toBe(false);
  });
});
