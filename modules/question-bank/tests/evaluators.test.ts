import { describe, it, expect } from 'vitest';
import type { CanonicalQuestion } from '../src/canonical';
import { evaluateMCQ } from '../src/evaluators/mcq';
import { selectQuestions } from '../src/exam/builder';

const sampleQuestion: CanonicalQuestion = {
  id: 'q1',
  subject: { id: 's1' },
  grade: { id: 'g1' },
  unit: { id: 'u1' },
  lesson: { id: 'l1' },
  type: 'MCQ_SINGLE',
  text: 'What is 2+2?',
  points: 1,
  answerData: { options: [{ id: 'A', text: '3' }, { id: 'B', text: '4' }], correctOptions: ['B'] },
  status: 'PUBLISHED'
};

describe('MCQ evaluator', () => {
  it('marks correct answer', () => {
    const res = evaluateMCQ(sampleQuestion, 'B');
    expect(res.verdict).toBe('CORRECT');
    expect(res.pointsAwarded).toBe(1);
  });
  it('marks incorrect answer', () => {
    const res = evaluateMCQ(sampleQuestion, 'A');
    expect(res.verdict).toBe('INCORRECT');
    expect(res.pointsAwarded).toBe(0);
  });
});

describe('Exam builder selectQuestions', () => {
  it('selects by count deterministically', () => {
    const pool: CanonicalQuestion[] = Array.from({ length: 10 }, (_, i) => ({
      id: `q${i}`,
      subject: { id: 's1' },
      grade: { id: 'g1' },
      unit: { id: 'u1' },
      lesson: { id: 'l1' },
      type: 'MCQ_SINGLE',
      text: `Question #${i}`,
      points: 1,
      answerData: { options: [{ id: 'A', text: 'x' }], correctOptions: ['A'] },
      status: 'PUBLISHED'
    }));

    const sel1 = selectQuestions(pool, { count: 5, seed: 42 });
    const sel2 = selectQuestions(pool, { count: 5, seed: 42 });
    expect(sel1.map((q) => q.id)).toEqual(sel2.map((q) => q.id));
  });
});
