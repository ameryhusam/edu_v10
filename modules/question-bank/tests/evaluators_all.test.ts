import { describe, it, expect } from 'vitest';
import { evaluateMCQ } from '../src/evaluators/mcq';
import { evaluateTrueFalse } from '../src/evaluators/truefalse';
import { evaluateNumeric } from '../src/evaluators/numeric';
import { evaluateShortText } from '../src/evaluators/shorttext';
import { evaluateMatching } from '../src/evaluators/matching';
import { evaluateOrdering } from '../src/evaluators/ordering';
import { evaluateFillBlank } from '../src/evaluators/fillblank';
import { evaluateEssay } from '../src/evaluators/essay';
import type { CanonicalQuestion } from '../src/canonical';

const mcq: CanonicalQuestion = {
  id: 'q1', subject: { id: 's1' }, grade: { id: 'g1' }, unit: { id: 'u1' }, lesson: { id: 'l1' }, type: 'MCQ_SINGLE', text: 'Q', points: 1, answerData: { options: [{ id: 'A', text: 'a' }, { id: 'B', text: 'b' }], correctOptions: ['B'] }, status: 'PUBLISHED'
};

const tf: CanonicalQuestion = { id: 'q2', subject: { id: 's1' }, grade: { id: 'g1' }, unit: { id: 'u1' }, lesson: { id: 'l1' }, type: 'TRUE_FALSE', text: 'Q', points: 1, answerData: { value: true }, status: 'PUBLISHED' };
const num: CanonicalQuestion = { id: 'q3', subject: { id: 's1' }, grade: { id: 'g1' }, unit: { id: 'u1' }, lesson: { id: 'l1' }, type: 'NUMERIC', text: 'Q', points: 2, answerData: { min: 10, max: 12 }, status: 'PUBLISHED' };
const st: CanonicalQuestion = { id: 'q4', subject: { id: 's1' }, grade: { id: 'g1' }, unit: { id: 'u1' }, lesson: { id: 'l1' }, type: 'SHORT_TEXT', text: 'Q', points: 2, answerData: { accepted: ['Hello'] }, status: 'PUBLISHED' };
const match: CanonicalQuestion = { id: 'q5', subject: { id: 's1' }, grade: { id: 'g1' }, unit: { id: 'u1' }, lesson: { id: 'l1' }, type: 'MATCHING', text: 'Q', points: 3, answerData: { left: [{ id: 'L1', text: 'A' }], right: [{ id: 'R1', text: 'B' }], pairs: [{ leftId: 'L1', rightId: 'R1' }] }, status: 'PUBLISHED' };
const ord: CanonicalQuestion = { id: 'q6', subject: { id: 's1' }, grade: { id: 'g1' }, unit: { id: 'u1' }, lesson: { id: 'l1' }, type: 'ORDERING', text: 'Q', points: 4, answerData: { items: [{ id: 'I1', text: '1' }, { id: 'I2', text: '2' }], correctOrder: ['I1', 'I2'] }, status: 'PUBLISHED' };
const fb: CanonicalQuestion = { id: 'q7', subject: { id: 's1' }, grade: { id: 'g1' }, unit: { id: 'u1' }, lesson: { id: 'l1' }, type: 'FILL_BLANK', text: 'Q', points: 2, answerData: { blanks: [{ index: 0, accepted: ['x'] }, { index: 1, accepted: ['y'] }] }, status: 'PUBLISHED' };
const es: CanonicalQuestion = { id: 'q8', subject: { id: 's1' }, grade: { id: 'g1' }, unit: { id: 'u1' }, lesson: { id: 'l1' }, type: 'ESSAY', text: 'Q', points: 5, answerData: { rubric: {} }, status: 'PUBLISHED' };

describe('evaluators', () => {
  it('mcq works', () => {
    const r = evaluateMCQ(mcq, 'B');
    expect(r.verdict).toBe('CORRECT');
  });
  it('true/false works', () => {
    const r = evaluateTrueFalse(tf, true);
    expect(r.verdict).toBe('CORRECT');
  });
  it('numeric works', () => {
    const r = evaluateNumeric(num, 11);
    expect(r.verdict).toBe('CORRECT');
  });
  it('short text works', () => {
    const r = evaluateShortText(st, 'hello');
    expect(r.verdict).toBe('CORRECT');
  });
  it('matching works', () => {
    const r = evaluateMatching(match, [{ leftId: 'L1', rightId: 'R1' }]);
    expect(r.verdict).toBe('CORRECT');
  });
  it('ordering works', () => {
    const r = evaluateOrdering(ord, ['I1', 'I2']);
    expect(r.verdict).toBe('CORRECT');
  });
  it('fill blank works', () => {
    const r = evaluateFillBlank(fb, ['x', 'y']);
    expect(r.verdict).toBe('CORRECT');
  });
  it('essay requires manual review', () => {
    const r = evaluateEssay(es, 'some text');
    expect(r.verdict).toBe('REQUIRES_MANUAL_REVIEW');
  });
});
