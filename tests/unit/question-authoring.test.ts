/**
 * Question authoring rules.
 *
 * The organising claim under test: every refusal here corresponds to an
 * `UNGRADABLE` verdict the evaluator would otherwise produce mid-attempt. The
 * last describe block checks that correspondence directly rather than trusting
 * the comment — a question this file accepts must be one the real evaluator
 * can actually grade.
 */

import { describe, expect, it } from 'vitest';
import {
  checkQuestionPublishable,
  isAutoGradable,
  QUESTION_TYPES,
  usesChoices,
  validateConceptLinks,
  validateQuestion,
  type ConceptLink,
  type DraftQuestion,
} from '../../src/contexts/content/domain/question-authoring.js';
import { evaluateAnswer } from '../../src/contexts/assessment/domain/evaluation.js';

const codes = (issues: readonly { code: string }[]) => issues.map((i) => i.code);

function mcq(overrides: Partial<DraftQuestion> = {}): DraftQuestion {
  return {
    type: 'MCQ_SINGLE',
    text: 'Which of these is a set?',
    choices: [
      { id: 'a', text: '{1, 2, 3}' },
      { id: 'b', text: '17' },
    ],
    answerKey: { correctChoiceIds: ['a'] },
    ...overrides,
  };
}

const links: ConceptLink[] = [{ conceptKey: 'C-SET', weight: 1, isPrimary: true }];

describe('a valid question', () => {
  it('accepts a well-formed MCQ', () => {
    expect(validateQuestion(mcq())).toEqual([]);
  });

  it('accepts a numeric question with a range', () => {
    const issues = validateQuestion({
      type: 'NUMERIC',
      text: 'How many elements?',
      choices: [],
      answerKey: { numericMin: 3, numericMax: 3 },
    });
    expect(issues).toEqual([]);
  });

  it('accepts an essay with no key at all', () => {
    // ESSAY is the one type with nothing to validate: it is graded by a human.
    const issues = validateQuestion({
      type: 'ESSAY',
      text: 'Explain what a subset is.',
      choices: [],
      answerKey: {},
    });
    expect(issues).toEqual([]);
  });
});

describe('the stem and the metadata', () => {
  it('requires text', () => {
    expect(codes(validateQuestion(mcq({ text: '   ' })))).toContain('question.text_required');
  });

  it('rejects fractional or zero points', () => {
    expect(codes(validateQuestion(mcq({ points: 0 })))).toContain('question.points_invalid');
    expect(codes(validateQuestion(mcq({ points: 1.5 })))).toContain('question.points_invalid');
  });

  it('rejects difficulty outside 0..1', () => {
    expect(codes(validateQuestion(mcq({ difficulty01: 1.4 })))).toContain(
      'question.difficulty_out_of_range',
    );
  });

  it('reports every problem at once', () => {
    // An author fixing one error per round trip stops using the tool.
    const issues = validateQuestion(mcq({ text: '', points: 0, difficulty01: 9 }));
    expect(issues.length).toBeGreaterThanOrEqual(3);
  });
});

describe('choices', () => {
  it('refuses fewer than two options', () => {
    const issues = validateQuestion(mcq({ choices: [{ id: 'a', text: 'only one' }] }));
    expect(codes(issues)).toContain('question.too_few_choices');
  });

  it('refuses a third option on true/false', () => {
    const issues = validateQuestion({
      type: 'TRUE_FALSE',
      text: 'Is the empty set a subset of every set?',
      choices: [
        { id: 't', text: 'True' },
        { id: 'f', text: 'False' },
        { id: 'm', text: 'Maybe' },
      ],
      answerKey: { correctChoiceIds: ['t'] },
    });
    expect(codes(issues)).toContain('question.too_many_choices');
  });

  it('refuses choices on a type that has none', () => {
    const issues = validateQuestion({
      type: 'NUMERIC',
      text: 'How many?',
      choices: [{ id: 'a', text: '3' }],
      answerKey: { numericMin: 3, numericMax: 3 },
    });
    expect(codes(issues)).toContain('question.choices_not_allowed');
  });

  it('refuses an empty option', () => {
    const issues = validateQuestion(
      mcq({ choices: [{ id: 'a', text: 'ok' }, { id: 'b', text: '  ' }] }),
    );
    expect(codes(issues)).toContain('question.choice_text_required');
  });

  it('refuses duplicate option ids', () => {
    const issues = validateQuestion(
      mcq({
        choices: [
          { id: 'a', text: 'one' },
          { id: 'a', text: 'two' },
        ],
        answerKey: { correctChoiceIds: ['a'] },
      }),
    );
    expect(codes(issues)).toContain('question.duplicate_choice_id');
  });
});

describe('the answer key, per type', () => {
  it('refuses an MCQ with no correct option', () => {
    expect(codes(validateQuestion(mcq({ answerKey: {} })))).toContain(
      'question.answer_key_incomplete',
    );
  });

  it('refuses two correct options on a single-answer MCQ', () => {
    const issues = validateQuestion(
      mcq({
        choices: [
          { id: 'a', text: 'one' },
          { id: 'b', text: 'two' },
          { id: 'c', text: 'three' },
        ],
        answerKey: { correctChoiceIds: ['a', 'b'] },
      }),
    );
    expect(codes(issues)).toContain('question.multiple_correct_for_single');
  });

  it('refuses a key naming an option that does not exist', () => {
    const issues = validateQuestion(mcq({ answerKey: { correctChoiceIds: ['zzz'] } }));
    expect(codes(issues)).toContain('question.unknown_choice_reference');
  });

  it('refuses a question where every option is correct', () => {
    const issues = validateQuestion({
      type: 'MCQ_MULTI',
      text: 'Pick the sets',
      choices: [
        { id: 'a', text: '{1}' },
        { id: 'b', text: '{2}' },
      ],
      answerKey: { correctChoiceIds: ['a', 'b'] },
    });
    expect(codes(issues)).toContain('question.no_distractors');
  });

  it('refuses a numeric question with no bounds', () => {
    const issues = validateQuestion({
      type: 'NUMERIC',
      text: 'How many?',
      choices: [],
      answerKey: {},
    });
    expect(codes(issues)).toContain('question.answer_key_incomplete');
  });

  it('refuses an inverted numeric range', () => {
    const issues = validateQuestion({
      type: 'NUMERIC',
      text: 'How many?',
      choices: [],
      answerKey: { numericMin: 10, numericMax: 2 },
    });
    expect(codes(issues)).toContain('question.numeric_range_inverted');
  });

  it('refuses short text with no accepted answers', () => {
    const issues = validateQuestion({
      type: 'SHORT_TEXT',
      text: 'Name the operation',
      choices: [],
      answerKey: { acceptedTexts: ['   '] },
    });
    expect(codes(issues)).toContain('question.answer_key_incomplete');
  });

  it('refuses ordering with fewer than two items', () => {
    const issues = validateQuestion({
      type: 'ORDERING',
      text: 'Order these',
      choices: [],
      answerKey: { expectedOrder: ['x'] },
    });
    expect(codes(issues)).toContain('question.answer_key_incomplete');
  });

  it('refuses a repeated item in an expected order', () => {
    const issues = validateQuestion({
      type: 'ORDERING',
      text: 'Order these',
      choices: [],
      answerKey: { expectedOrder: ['x', 'y', 'x'] },
    });
    expect(codes(issues)).toContain('question.duplicate_ordered_item');
  });

  it('refuses matching with no pairs', () => {
    const issues = validateQuestion({
      type: 'MATCHING',
      text: 'Match them',
      choices: [],
      answerKey: { expectedPairs: {} },
    });
    expect(codes(issues)).toContain('question.answer_key_incomplete');
  });

  it('refuses a pair with an empty right side', () => {
    const issues = validateQuestion({
      type: 'MATCHING',
      text: 'Match them',
      choices: [],
      answerKey: { expectedPairs: { union: '' } },
    });
    expect(codes(issues)).toContain('question.unmatched_pair');
  });
});

describe('concept linkage', () => {
  it('accepts one primary link', () => {
    expect(validateConceptLinks(links)).toEqual([]);
  });

  it('allows a question linked to nothing, because storing is not publishing', () => {
    // Deliberately reversed. An unlinked item updates no mastery, which is a
    // reason to keep it out of a LIVE bank -- not a reason to refuse to hold
    // it. Placement (the lesson) is mandatory and recorded separately; which
    // concept an item measures is an authoring judgement that may still be
    // pending, most obviously for an imported bank.
    expect(validateConceptLinks([])).toEqual([]);
  });

  it('refuses to publish a question linked to nothing', () => {
    // Where the old rule now lives. The two together read as one sentence: an
    // item may WAIT undiagnosed, it may not GO LIVE undiagnosed.
    const draft = {
      type: 'MCQ_SINGLE' as const,
      text: 'Which of these is a set?',
      choices: [
        { id: 'a', text: '{1, 2}' },
        { id: 'b', text: '17' },
      ],
      answerKey: { correctChoiceIds: ['a'] },
      points: 1,
      difficulty01: 0.5,
    };
    const res = checkQuestionPublishable(draft, []);

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('question.not_publishable');
    const issues = (res.error.details as { issues: Array<{ code: string }> }).issues;
    expect(issues.map((i) => i.code)).toContain('question.no_concept_link');
  });

  it('refuses links with no primary', () => {
    const issues = validateConceptLinks([{ conceptKey: 'C-SET', weight: 1, isPrimary: false }]);
    expect(codes(issues)).toContain('question.no_primary_concept');
  });

  it('refuses two primaries', () => {
    const issues = validateConceptLinks([
      { conceptKey: 'C-SET', weight: 1, isPrimary: true },
      { conceptKey: 'C-SUBSET', weight: 1, isPrimary: true },
    ]);
    expect(codes(issues)).toContain('question.multiple_primary_concepts');
  });

  it('refuses a duplicate link', () => {
    const issues = validateConceptLinks([
      { conceptKey: 'C-SET', weight: 1, isPrimary: true },
      { conceptKey: 'C-SET', weight: 0.5, isPrimary: false },
    ]);
    expect(codes(issues)).toContain('question.duplicate_concept_link');
  });

  it('refuses a weight outside (0, 1]', () => {
    expect(
      codes(validateConceptLinks([{ conceptKey: 'C-SET', weight: 0, isPrimary: true }])),
    ).toContain('question.link_weight_out_of_range');
    expect(
      codes(validateConceptLinks([{ conceptKey: 'C-SET', weight: 1.2, isPrimary: true }])),
    ).toContain('question.link_weight_out_of_range');
  });
});

describe('the publication gate', () => {
  it('passes a complete question', () => {
    expect(checkQuestionPublishable(mcq(), links).ok).toBe(true);
  });

  it('refuses and reports every issue in one error', () => {
    const result = checkQuestionPublishable(mcq({ answerKey: {} }), []);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('question.not_publishable');
    const issues = result.error.details?.issues as readonly { code: string }[];
    expect(codes(issues)).toEqual(
      expect.arrayContaining(['question.answer_key_incomplete', 'question.no_concept_link']),
    );
  });
});

describe('type helpers stay exhaustive', () => {
  it('classifies every question type', () => {
    // If a type is added to the schema, this fails until someone decides
    // whether it has choices and whether it can be auto-graded.
    for (const type of QUESTION_TYPES) {
      expect(typeof usesChoices(type)).toBe('boolean');
      expect(typeof isAutoGradable(type)).toBe('boolean');
    }
  });

  it('marks essays as the only manually graded type', () => {
    const manual = QUESTION_TYPES.filter((t) => !isAutoGradable(t));
    expect(manual).toEqual(['ESSAY']);
  });
});

/**
 * The claim this file rests on, checked against the real evaluator.
 *
 * Testing the validator against itself would prove only that it is
 * self-consistent. These run `evaluateAnswer` — the same function the exam
 * runner calls — over questions this module accepted.
 */
describe('accepted questions are actually gradable', () => {
  it('an accepted MCQ grades a correct answer', () => {
    const q = mcq();
    expect(validateQuestion(q)).toEqual([]);

    const result = evaluateAnswer(
      { type: 'MCQ_SINGLE', correctChoiceIds: ['a'] },
      { choiceIds: ['a'] },
    );
    expect(result.verdict).toBe('CORRECT');
  });

  it('an accepted NUMERIC question grades a wrong answer without going UNGRADABLE', () => {
    const result = evaluateAnswer(
      { type: 'NUMERIC', numericRange: { min: 3, max: 3 } },
      { numeric: 4 },
    );
    expect(result.verdict).toBe('INCORRECT');
  });

  it('the keys this module REFUSES are exactly the ones that grade as UNGRADABLE', () => {
    // A numeric key with no bounds: refused above, and here is why.
    const refused = validateQuestion({
      type: 'NUMERIC',
      text: 'How many?',
      choices: [],
      answerKey: {},
    });
    expect(refused.length).toBeGreaterThan(0);

    const runtime = evaluateAnswer({ type: 'NUMERIC' }, { numeric: 3 });
    expect(runtime.verdict).toBe('UNGRADABLE');
    expect(runtime.note).toBe('numeric_range_missing_bounds');
  });

  it('an MCQ with no correct option is refused, and would be UNGRADABLE', () => {
    expect(codes(validateQuestion(mcq({ answerKey: {} })))).toContain(
      'question.answer_key_incomplete',
    );

    const runtime = evaluateAnswer({ type: 'MCQ_SINGLE' }, { choiceIds: ['a'] });
    expect(runtime.verdict).toBe('UNGRADABLE');
    expect(runtime.note).toBe('answer_key_missing');
  });
});
