/**
 * What a learner is allowed to receive while a question is still open.
 *
 * This exists because of a real leak found by calling the live API as a seeded
 * student: `GET /assessment/attempts/:key/next-item` returned every choice with
 * its `misconceptionKey`, and that field is only ever set on a distractor. The
 * question had four options, three of them tagged — so the untagged one was the
 * answer, derivable without reading the question text at all.
 *
 * The use case already stripped `irt` and `conceptLinks`. The gap was that it
 * stripped them with a rest-spread, which removes only the fields it names and
 * passes everything else through, including nested ones.
 */

import { describe, expect, it } from 'vitest';
import { RunAdaptiveExamUseCase } from '../../src/contexts/assessment/application/run-adaptive-exam.use-case.js';
import type {
  AttemptRecord,
  AttemptRepository,
  QuestionRepository,
  QuestionView,
} from '../../src/contexts/assessment/application/ports.js';

const LEARNER = 'lrn_test';
const ATTEMPT = 'att_test';

/**
 * A four-option item authored the way the seed authors them: every wrong
 * option carries the misconception it exposes, the right one carries nothing.
 */
function taggedQuestion(key: string, difficulty: number): QuestionView {
  return {
    key,
    text: 'Which of the following is a well-defined set?',
    type: 'MCQ_SINGLE',
    points: 1,
    hint: null,
    choices: [
      { id: 'c1', text: 'The days of the week', orderIndex: 1 },
      { id: 'c2', text: 'The tall students', orderIndex: 2, misconceptionKey: 'MIS-VAGUE-A' },
      { id: 'c3', text: 'The nice colours', orderIndex: 3, misconceptionKey: 'MIS-VAGUE-B' },
      { id: 'c4', text: 'The tasty foods', orderIndex: 4, misconceptionKey: 'MIS-VAGUE-C' },
    ],
    conceptLinks: [{ conceptKey: 'C-SET', weight: 1, isPrimary: true }],
    irt: { id: key, a: 1.2, b: difficulty, c: 0.25 },
  };
}

function repositories(pool: readonly QuestionView[]): {
  questions: QuestionRepository;
  attempts: AttemptRepository;
} {
  const attempt: AttemptRecord = {
    key: ATTEMPT,
    learnerKey: LEARNER,
    kind: 'PRACTICE',
    lessonKey: 'L-SETS',
    examKey: null,
    status: 'IN_PROGRESS',
    startedAt: new Date('2026-03-01T10:00:00Z'),
    submittedAt: null,
    items: [],
  };

  const questions: QuestionRepository = {
    findByKey: async (key) => pool.find((q) => q.key === key) ?? null,
    findPoolByConcepts: async () => [...pool],
    findAnswerKey: async () => null,
  };

  const attempts = {
    nextKey: () => ATTEMPT,
    findByKey: async (key: string) => (key === ATTEMPT ? attempt : null),
  } as unknown as AttemptRepository;

  return { questions, attempts };
}

describe('the question payload served mid-attempt', () => {
  it('finishes gracefully when the adaptive pool is empty', async () => {
    const { questions, attempts } = repositories([]);

    const result = await new RunAdaptiveExamUseCase(questions, attempts).execute({
      attemptKey: ATTEMPT,
      learnerKey: LEARNER,
      conceptKeys: ['C-EMPTY'],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.finished).toBe(true);
    expect(result.value.reason).toBe('POOL_EXHAUSTED');
    expect(result.value.question).toBeNull();
  });

  it('does not tell the learner which options are distractors', async () => {
    const { questions, attempts } = repositories([
      taggedQuestion('Q-A', 0),
      taggedQuestion('Q-B', 0.5),
    ]);

    const result = await new RunAdaptiveExamUseCase(questions, attempts).execute({
      attemptKey: ATTEMPT,
      learnerKey: LEARNER,
      conceptKeys: ['C-SET'],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const question = result.value.question;
    expect(question).not.toBeNull();
    if (!question) return;

    // The assertion that matters is over the serialised payload: a field can
    // be absent from the type and still be present on the object at runtime,
    // and it is the runtime object that reaches the browser.
    const wire = JSON.stringify(question);
    expect(wire).not.toContain('misconceptionKey');
    expect(wire).not.toContain('MIS-VAGUE-A');

    // The specific inference that was possible: count how many options carry
    // no tag. With the leak present this is 1, which names the answer.
    const untagged = question.choices.filter(
      (choice) => !('misconceptionKey' in choice),
    );
    expect(untagged).toHaveLength(question.choices.length);
  });

  it('still sends what the learner needs to answer', async () => {
    const { questions, attempts } = repositories([taggedQuestion('Q-A', 0)]);

    const result = await new RunAdaptiveExamUseCase(questions, attempts).execute({
      attemptKey: ATTEMPT,
      learnerKey: LEARNER,
      conceptKeys: ['C-SET'],
    });

    expect(result.ok).toBe(true);
    if (!result.ok || !result.value.question) return;
    const question = result.value.question;

    expect(question.key).toBe('Q-A');
    expect(question.text).toContain('well-defined set');
    expect(question.choices).toHaveLength(4);
    expect(question.choices.map((c) => c.text)).toContain('The days of the week');
    expect(question.choices.every((c) => typeof c.id === 'string')).toBe(true);
  });

  it('withholds the psychometric parameters and the concept map', async () => {
    const { questions, attempts } = repositories([taggedQuestion('Q-A', 0)]);

    const result = await new RunAdaptiveExamUseCase(questions, attempts).execute({
      attemptKey: ATTEMPT,
      learnerKey: LEARNER,
      conceptKeys: ['C-SET'],
    });

    expect(result.ok).toBe(true);
    if (!result.ok || !result.value.question) return;

    const wire = JSON.stringify(result.value.question);
    expect(wire).not.toContain('irt');
    expect(wire).not.toContain('conceptLinks');
    // `b` is the difficulty: knowing it tells a learner how hard the item is
    // considered to be, which is not theirs to know mid-test.
    expect(wire).not.toContain('"b"');
  });
});
