/**
 * ItemBankService against in-memory adapters.
 *
 * The domain tests already cover the rules. These cover the orchestration
 * decisions that only exist at this layer: what is validated when, which lock
 * is consulted first, and the two irreversible freezes (a question that has
 * been answered, an exam that has been sat).
 */

import { describe, expect, it } from 'vitest';
import {
  ItemBankService,
  type AuthorContext,
} from '../../src/contexts/content/application/item-bank.service.js';
import type {
  ExamRecord,
  ExamRepository,
  QuestionRecord,
  QuestionRepository,
  ResourceRecord,
  ResourceRepository,
} from '../../src/contexts/content/application/item-bank.ports.js';
import type { PublicationState } from '../../src/contexts/content/domain/publication.js';
import type { ConceptLink } from '../../src/contexts/content/domain/question-authoring.js';

const CTX: AuthorContext = { actorKey: 'usr_author' };
const clock = { now: () => new Date('2026-09-11T12:00:00.000Z') };

const TEXTBOOK = 'EDU-MATH-G07-T1-ED2026';
const LESSON = `${TEXTBOOK}-U-SETS-L-BASICS`;
const CONCEPT = `${LESSON}-C-SET`;
const OTHER_CONCEPT = `${LESSON}-C-SUBSET`;

const links: ConceptLink[] = [{ conceptKey: CONCEPT, weight: 1, isPrimary: true }];

class FakeQuestions implements QuestionRepository {
  rows = new Map<string, QuestionRecord>();
  responses = new Set<string>();
  textbookStatus: PublicationState = 'DRAFT';
  conceptBook = new Map<string, string>([
    [CONCEPT, 'BOOK-A'],
    [OTHER_CONCEPT, 'BOOK-A'],
  ]);

  async findQuestion(key: string) {
    return this.rows.get(key) ?? null;
  }
  /** Which lesson owns a concept. Defaults to LESSON; override per concept to
   * model a concept living in a different lesson. */
  conceptLesson = new Map<string, string>();
  async lessonKeyForConcept(conceptKey: string) {
    if (!this.conceptBook.has(conceptKey)) return null;
    return this.conceptLesson.get(conceptKey) ?? LESSON;
  }
  async textbookStatusForConcept(conceptKey: string) {
    return this.conceptBook.has(conceptKey) ? this.textbookStatus : null;
  }
  async lessonExists(lessonKey: string) {
    return lessonKey === LESSON;
  }
  async textbookStatusForLesson(lessonKey: string) {
    return lessonKey === LESSON ? this.textbookStatus : null;
  }
  async questionsForLesson(lessonKey: string) {
    return [...this.rows.values()].filter((q) => q.lessonKey === lessonKey);
  }
  async listQuestions() {
    return { rows: [...this.rows.values()], total: this.rows.size };
  }
  async conceptsForLesson(lessonKey: string) {
    return [...this.conceptBook.keys()]
      .filter((key) => (this.conceptLesson.get(key) ?? LESSON) === lessonKey)
      .map((key) => ({ key, name: key }));
  }
  async createQuestion(input: Parameters<QuestionRepository['createQuestion']>[0]) {
    const record: QuestionRecord = {
      key: input.key,
      lessonKey: input.lessonKey,
      sourceRef: input.sourceRef ?? null,
      type: input.type,
      text: input.text,
      hint: input.hint,
      explanation: input.explanation,
      points: input.points,
      difficulty01: input.difficulty01,
      irtDifficulty: 0,
      status: 'DRAFT',
      origin: input.origin,
      textbookRole: input.textbookRole,
      choices: input.choices.map((c) => ({
        id: c.id,
        text: c.text,
        orderIndex: c.orderIndex,
        misconceptionKey: c.misconceptionKey,
        feedback: c.feedback,
      })),
      answerKey: { ...input.answerKey },
      concepts: input.concepts.map((c) => ({ ...c })),
    };
    this.rows.set(record.key, record);
    return record;
  }
  async replaceQuestionContent(
    key: string,
    input: Parameters<QuestionRepository['replaceQuestionContent']>[1],
  ) {
    const row = this.rows.get(key);
    if (!row) return;
    this.rows.set(key, {
      ...row,
      text: input.text,
      hint: input.hint,
      explanation: input.explanation,
      points: input.points,
      difficulty01: input.difficulty01,
      choices: input.choices.map((c) => ({
        id: c.id,
        text: c.text,
        orderIndex: c.orderIndex,
        misconceptionKey: c.misconceptionKey,
        feedback: c.feedback,
      })),
      answerKey: { ...input.answerKey },
    });
  }
  async setQuestionConcepts(key: string, concepts: readonly ConceptLink[]) {
    const row = this.rows.get(key);
    if (row) this.rows.set(key, { ...row, concepts: concepts.map((c) => ({ ...c })) });
  }
  async setQuestionStatus(key: string, status: PublicationState) {
    const row = this.rows.get(key);
    if (row) this.rows.set(key, { ...row, status });
  }
  async questionHasResponses(key: string) {
    return this.responses.has(key);
  }
  async resolveConcepts(conceptKeys: readonly string[]) {
    return conceptKeys
      .filter((k) => this.conceptBook.has(k))
      .map((k) => ({ conceptKey: k, textbookKey: this.conceptBook.get(k)! }));
  }
  /** The misconception catalogue. Only these keys exist. */
  misconceptions = new Set<string>();
  async resolveMisconceptions(keys: readonly string[]) {
    return keys.filter((k) => this.misconceptions.has(k));
  }
}

class FakeExams implements ExamRepository {
  rows = new Map<string, ExamRecord>();
  attempts = new Set<string>();

  async findExam(key: string) {
    return this.rows.get(key) ?? null;
  }
  async createExam(input: Parameters<ExamRepository['createExam']>[0]) {
    const record: ExamRecord = { ...input, status: 'DRAFT', items: [] };
    this.rows.set(record.key, record);
    return record;
  }
  async updateExam(key: string, fields: Record<string, unknown>) {
    const row = this.rows.get(key);
    if (row) this.rows.set(key, { ...row, ...fields } as ExamRecord);
  }
  async setExamStatus(key: string, status: PublicationState) {
    const row = this.rows.get(key);
    if (row) this.rows.set(key, { ...row, status });
  }
  async setExamItems(
    key: string,
    items: ReadonlyArray<{ questionKey: string; orderIndex: number; points: number }>,
  ) {
    const row = this.rows.get(key);
    if (!row) return;
    this.rows.set(key, {
      ...row,
      items: items.map((i) => ({
        ...i,
        questionStatus: 'PUBLISHED' as PublicationState,
        questionType: 'MCQ_SINGLE' as const,
        irtDifficulty: 0,
        conceptKeys: [CONCEPT],
      })),
    });
  }
  async examHasAttempts(key: string) {
    return this.attempts.has(key);
  }
}

class FakeResources implements ResourceRepository {
  rows = new Map<string, ResourceRecord>();
  textbookStatus: PublicationState = 'DRAFT';
  knownConcepts = new Set([CONCEPT]);
  knownTextbooks = new Set([TEXTBOOK]);

  async findResource(key: string) {
    return this.rows.get(key) ?? null;
  }
  async createResource(input: Parameters<ResourceRepository['createResource']>[0]) {
    const record: ResourceRecord = { ...input, isActive: true };
    this.rows.set(record.key, record);
    return record;
  }
  async updateResource(key: string, fields: Record<string, unknown>) {
    const row = this.rows.get(key);
    if (row) this.rows.set(key, { ...row, ...fields } as ResourceRecord);
  }
  async setResourceActive(key: string, isActive: boolean) {
    const row = this.rows.get(key);
    if (row) this.rows.set(key, { ...row, isActive });
  }
  async listForConcept(conceptKey: string) {
    return [...this.rows.values()].filter((r) => r.conceptKey === conceptKey);
  }
  async listForTextbook(textbookKey: string) {
    if (!this.knownTextbooks.has(textbookKey)) return null;
    return [...this.rows.values()].filter(
      (r) => r.textbookKey === textbookKey && r.lessonKey === null && r.conceptKey === null,
    );
  }
  async textbookStatusForResource(input: { textbookKey?: string | null; lessonKey?: string | null; conceptKey?: string | null }) {
    if (input.conceptKey && !this.knownConcepts.has(input.conceptKey)) return null;
    if (input.lessonKey && input.lessonKey !== LESSON) return null;
    return this.textbookStatus;
  }
}

function setup() {
  const questions = new FakeQuestions();
  const exams = new FakeExams();
  const resources = new FakeResources();
  return {
    questions,
    exams,
    resources,
    service: new ItemBankService(questions, exams, resources, clock),
  };
}

const MCQ = {
  type: 'MCQ_SINGLE' as const,
  lessonKey: LESSON,
  text: 'Which of these is a set?',
  choices: [
    { id: 'a', text: '{1, 2, 3}' },
    { id: 'b', text: '17' },
  ],
  answerKey: { correctChoiceIds: ['a'] },
  concepts: links,
};

async function published(s: ReturnType<typeof setup>) {
  const created = await s.service.createQuestion(CTX, MCQ);
  if (!created.ok) throw new Error('setup failed');
  await s.service.transitionQuestion(CTX, created.value.key, 'SUBMIT');
  await s.service.transitionQuestion(CTX, created.value.key, 'APPROVE');
  return created.value.key;
}

describe('authoring a question', () => {
  it('creates a draft', async () => {
    const s = setup();
    const created = await s.service.createQuestion(CTX, MCQ);

    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.status).toBe('DRAFT');
    expect(created.value.key.startsWith(LESSON)).toBe(true);
  });

  it('derives the same key from the same stem in the same lesson', async () => {
    // Idempotent re-authoring: a re-import must not duplicate the bank.
    const a = await setup().service.createQuestion(CTX, MCQ);
    const b = await setup().service.createQuestion(CTX, MCQ);
    expect(a.ok && b.ok && a.value.key).toBe(b.ok ? b.value.key : '');
  });

  it('refuses an ungradable draft rather than storing it', async () => {
    const s = setup();
    const created = await s.service.createQuestion(CTX, { ...MCQ, answerKey: {} });

    expect(created.ok).toBe(false);
    if (created.ok) return;
    expect(created.error.code).toBe('question.invalid');
    expect(s.questions.rows.size).toBe(0);
  });

  it('stores a question that measures nothing yet, because diagnosis can lag placement', async () => {
    // Changed deliberately. This used to be a refusal, on the reasoning that an
    // unlinked item can never update mastery — true, but the wrong remedy. It
    // forced every question to carry a concept for a STRUCTURAL reason (the key
    // was derived through the primary concept's lesson), so a bank imported
    // from elsewhere could only be stored by inventing links. A wrong link
    // silently corrupts mastery; a missing one is visible and fixable.
    const s = setup();
    const created = await s.service.createQuestion(CTX, { ...MCQ, concepts: [] });

    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.concepts).toEqual([]);
    // Still placed: the lesson is what makes it findable and re-linkable.
    expect(created.value.lessonKey).toBe(LESSON);
  });

  it('refuses to PUBLISH a question that measures nothing', async () => {
    // The rule the old test was reaching for, enforced where it belongs: an
    // item may wait undiagnosed, it may not go live undiagnosed.
    const s = setup();
    const created = await s.service.createQuestion(CTX, { ...MCQ, concepts: [] });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // SUBMIT only moves it into review; APPROVE is the transition that makes it
    // live, and therefore the one the publish gate guards.
    const submitted = await s.service.transitionQuestion(CTX, created.value.key, 'SUBMIT');
    expect(submitted.ok).toBe(true);

    const approved = await s.service.transitionQuestion(CTX, created.value.key, 'APPROVE');

    expect(approved.ok).toBe(false);
    if (approved.ok) return;
    expect(approved.error.code).toBe('question.not_publishable');
  });

  it('lists a lesson bank and counts what still needs diagnosis', async () => {
    // Backs the re-linking screen. The count is computed in the service so the
    // list and its badge cannot disagree.
    const s = setup();
    await s.service.createQuestion(CTX, { ...MCQ, text: 'Linked one', concepts: links });
    await s.service.createQuestion(CTX, { ...MCQ, text: 'Unlinked one', concepts: [] });

    const bank = await s.service.lessonQuestionBank(CTX, LESSON);

    expect(bank.ok).toBe(true);
    if (!bank.ok) return;
    expect(bank.value.questions).toHaveLength(2);
    expect(bank.value.unlinkedCount).toBe(1);
  });

  it('offers only concepts from the same lesson as link candidates', async () => {
    // The screen builds its checkbox list from this. If it ever included a
    // concept from another lesson, the author would be offered a choice that
    // saving then refuses with `concept_outside_lesson` — which reads as the
    // product breaking rather than as a rule being applied.
    const s = setup();
    s.questions.conceptLesson.set(OTHER_CONCEPT, `${LESSON}-ELSEWHERE`);

    const bank = await s.service.lessonQuestionBank(CTX, LESSON);

    expect(bank.ok).toBe(true);
    if (!bank.ok) return;
    expect(bank.value.concepts.map((c) => c.key)).toEqual([CONCEPT]);
  });

  it('re-links an unlinked question, which is the whole point of the modal', async () => {
    const s = setup();
    const created = await s.service.createQuestion(CTX, { ...MCQ, concepts: [] });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const relinked = await s.service.setQuestionConcepts(CTX, created.value.key, links);

    expect(relinked.ok).toBe(true);
    if (!relinked.ok) return;
    expect(relinked.value.concepts.map((c) => c.conceptKey)).toEqual([CONCEPT]);

    // And it becomes publishable, which is the state change that matters.
    await s.service.transitionQuestion(CTX, created.value.key, 'SUBMIT');
    const approved = await s.service.transitionQuestion(CTX, created.value.key, 'APPROVE');
    expect(approved.ok).toBe(true);
  });

  it('lets a reviewer detach a wrong link without inventing a replacement', async () => {
    const s = setup();
    const created = await s.service.createQuestion(CTX, { ...MCQ, concepts: links });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const cleared = await s.service.setQuestionConcepts(CTX, created.value.key, []);

    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    expect(cleared.value.concepts).toEqual([]);
    // Still placed: unlinking is not unfiling.
    expect(cleared.value.lessonKey).toBe(LESSON);
  });

  it('refuses to re-link a question onto another lesson\'s concept', async () => {
    const s = setup();
    s.questions.conceptBook.set('FOREIGN-CONCEPT', 'BOOK-A');
    s.questions.conceptLesson.set('FOREIGN-CONCEPT', 'EDU-MATH-G07-T1-ED2026-U-SETS-L-ELSEWHERE');
    const created = await s.service.createQuestion(CTX, { ...MCQ, concepts: [] });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const res = await s.service.setQuestionConcepts(CTX, created.value.key, [
      { conceptKey: 'FOREIGN-CONCEPT', weight: 1, isPrimary: true },
    ]);

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('question.concept_outside_lesson');
  });

  it('refuses a concept that belongs to a different lesson than the question', async () => {
    // Placement and diagnosis must agree. Filing an item under one lesson while
    // claiming it measures another lesson's concept is a mistake worth
    // refusing rather than quietly reconciling.
    const s = setup();
    s.questions.conceptBook.set('OTHER-LESSON-CONCEPT', 'BOOK-A');
    s.questions.conceptLesson.set('OTHER-LESSON-CONCEPT', 'EDU-MATH-G07-T1-ED2026-U-SETS-L-OTHER');
    const created = await s.service.createQuestion(CTX, {
      ...MCQ,
      lessonKey: LESSON,
      concepts: [{ conceptKey: 'OTHER-LESSON-CONCEPT', weight: 1, isPrimary: true }],
    });

    expect(created.ok).toBe(false);
    if (created.ok) return;
    expect(created.error.code).toBe('question.concept_outside_lesson');
  });

  it('refuses an unknown concept', async () => {
    const s = setup();
    const created = await s.service.createQuestion(CTX, {
      ...MCQ,
      concepts: [{ conceptKey: 'NOPE', weight: 1, isPrimary: true }],
    });
    expect(created.ok).toBe(false);
    if (created.ok) return;
    expect(created.error.code).toBe('question.concept_not_found');
  });

  it('refuses concepts from two different textbooks', async () => {
    const s = setup();
    s.questions.conceptBook.set(OTHER_CONCEPT, 'BOOK-B');

    const created = await s.service.createQuestion(CTX, {
      ...MCQ,
      concepts: [
        { conceptKey: CONCEPT, weight: 1, isPrimary: true },
        { conceptKey: OTHER_CONCEPT, weight: 0.5, isPrimary: false },
      ],
    });
    expect(created.ok).toBe(false);
    if (created.ok) return;
    expect(created.error.code).toBe('question.concepts_span_textbooks');
  });

  it('refuses adding to a published textbook', async () => {
    const s = setup();
    s.questions.textbookStatus = 'PUBLISHED';

    const created = await s.service.createQuestion(CTX, MCQ);
    expect(created.ok).toBe(false);
    if (created.ok) return;
    expect(created.error.code).toBe('content.textbook_locked');
  });

  it('lands an AI-drafted question as DRAFT', async () => {
    const s = setup();
    const created = await s.service.createQuestion(CTX, { ...MCQ, origin: 'AI' as const });

    expect(created.ok).toBe(true);
    if (!created.ok) return;
    // An AI cannot be accountable for what a learner is assessed on.
    expect(created.value.status).toBe('DRAFT');
    expect(created.value.origin).toBe('AI');
  });
});

describe('editing a question', () => {
  it('revalidates the whole item, not just the changed field', async () => {
    const s = setup();
    const created = await s.service.createQuestion(CTX, MCQ);
    if (!created.ok) return;

    // New options that no longer contain the option the untouched key names.
    const updated = await s.service.updateQuestion(CTX, created.value.key, {
      choices: [
        { id: 'x', text: 'one' },
        { id: 'y', text: 'two' },
      ],
    });

    expect(updated.ok).toBe(false);
    if (updated.ok) return;
    expect(updated.error.code).toBe('question.invalid');
    const issues = updated.error.details?.issues as readonly { code: string }[];
    expect(issues.map((i) => i.code)).toContain('question.unknown_choice_reference');
  });

  it('accepts a consistent rewrite', async () => {
    const s = setup();
    const created = await s.service.createQuestion(CTX, MCQ);
    if (!created.ok) return;

    const updated = await s.service.updateQuestion(CTX, created.value.key, {
      text: 'Which one is a set?',
      choices: [
        { id: 'x', text: '{1}' },
        { id: 'y', text: '5' },
      ],
      answerKey: { correctChoiceIds: ['x'] },
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.value.text).toBe('Which one is a set?');
  });

  it('refuses to rewrite a question learners have answered', async () => {
    const s = setup();
    const created = await s.service.createQuestion(CTX, MCQ);
    if (!created.ok) return;
    s.questions.responses.add(created.value.key);

    const updated = await s.service.updateQuestion(CTX, created.value.key, { text: 'Changed' });
    expect(updated.ok).toBe(false);
    if (updated.ok) return;
    expect(updated.error.code).toBe('question.has_responses');
  });

  it('reports the response freeze before the publication lock', async () => {
    // Publication can be reversed by a reviewer; evidence cannot.
    const s = setup();
    const key = await published(s);
    s.questions.responses.add(key);

    const updated = await s.service.updateQuestion(CTX, key, { text: 'Changed' });
    expect(updated.ok).toBe(false);
    if (updated.ok) return;
    expect(updated.error.code).toBe('question.has_responses');
  });

  it('refuses to rewrite a published question', async () => {
    const s = setup();
    const key = await published(s);

    const updated = await s.service.updateQuestion(CTX, key, { text: 'Changed' });
    expect(updated.ok).toBe(false);
    if (updated.ok) return;
    expect(updated.error.code).toBe('question.locked');
  });

  it('re-points a draft at different concepts', async () => {
    const s = setup();
    const created = await s.service.createQuestion(CTX, MCQ);
    if (!created.ok) return;

    const relinked = await s.service.setQuestionConcepts(CTX, created.value.key, [
      { conceptKey: OTHER_CONCEPT, weight: 1, isPrimary: true },
    ]);
    expect(relinked.ok).toBe(true);
    if (!relinked.ok) return;
    expect(relinked.value.concepts[0]?.conceptKey).toBe(OTHER_CONCEPT);
  });
});

describe('publishing a question', () => {
  it('walks DRAFT to PUBLISHED through review', async () => {
    const s = setup();
    const created = await s.service.createQuestion(CTX, MCQ);
    if (!created.ok) return;

    const submitted = await s.service.transitionQuestion(CTX, created.value.key, 'SUBMIT');
    expect(submitted.ok && submitted.value.status).toBe('IN_REVIEW');

    const approved = await s.service.transitionQuestion(CTX, created.value.key, 'APPROVE');
    expect(approved.ok && approved.value.status).toBe('PUBLISHED');
  });

  it('refuses to publish straight from draft', async () => {
    const s = setup();
    const created = await s.service.createQuestion(CTX, MCQ);
    if (!created.ok) return;

    const approved = await s.service.transitionQuestion(CTX, created.value.key, 'APPROVE');
    expect(approved.ok).toBe(false);
    if (approved.ok) return;
    expect(approved.error.code).toBe('content.review_required');
  });

  it('refuses to publish a question with no primary concept', async () => {
    // The gate's last chance: linkage is only required to go live.
    const s = setup();
    const created = await s.service.createQuestion(CTX, MCQ);
    if (!created.ok) return;

    // Bypass the service to model a row that lost its links some other way.
    s.questions.rows.set(created.value.key, {
      ...s.questions.rows.get(created.value.key)!,
      concepts: [],
    });

    await s.service.transitionQuestion(CTX, created.value.key, 'SUBMIT');
    const approved = await s.service.transitionQuestion(CTX, created.value.key, 'APPROVE');

    expect(approved.ok).toBe(false);
    if (approved.ok) return;
    expect(approved.error.code).toBe('question.not_publishable');
  });

  it('never returns a published question to draft', async () => {
    const s = setup();
    const key = await published(s);

    const rejected = await s.service.transitionQuestion(CTX, key, 'REJECT');
    expect(rejected.ok).toBe(false);
  });
});

describe('assembling an exam', () => {
  async function examWith(s: ReturnType<typeof setup>, isAdaptive = false) {
    const created = await s.service.createExam(CTX, { title: 'Unit check', isAdaptive });
    if (!created.ok) throw new Error('setup failed');
    return created.value.key;
  }

  it('creates a draft exam', async () => {
    const s = setup();
    const created = await s.service.createExam(CTX, { title: 'Unit check' });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.status).toBe('DRAFT');
    expect(created.value.key.startsWith('EXAM-')).toBe(true);
  });

  it('sets items from published questions', async () => {
    const s = setup();
    const examKey = await examWith(s);
    const q = await published(s);

    const result = await s.service.setExamItems(CTX, examKey, [{ questionKey: q }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items).toHaveLength(1);
  });

  it('refuses an item that does not exist', async () => {
    const s = setup();
    const examKey = await examWith(s);

    const result = await s.service.setExamItems(CTX, examKey, [{ questionKey: 'NOPE' }]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('exam.question_not_found');
  });

  it('refuses a draft question on an exam', async () => {
    const s = setup();
    const examKey = await examWith(s);
    const created = await s.service.createQuestion(CTX, MCQ);
    if (!created.ok) return;

    const result = await s.service.setExamItems(CTX, examKey, [
      { questionKey: created.value.key },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('exam.invalid');
    const issues = result.error.details?.issues as readonly { code: string }[];
    expect(issues.map((i) => i.code)).toContain('exam.unpublished_item');
  });

  it('refuses recomposing an exam learners have sat', async () => {
    const s = setup();
    const examKey = await examWith(s);
    const q = await published(s);
    s.exams.attempts.add(examKey);

    const result = await s.service.setExamItems(CTX, examKey, [{ questionKey: q }]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('exam.has_attempts');
  });

  it('refuses an adaptive exam whose pool is too small', async () => {
    const s = setup();
    const examKey = await examWith(s, true);
    const q = await published(s);

    const result = await s.service.setExamItems(CTX, examKey, [{ questionKey: q }]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const issues = result.error.details?.issues as readonly { code: string }[];
    expect(issues.map((i) => i.code)).toContain('exam.pool_below_minimum');
  });

  it('reports a blueprint', async () => {
    const s = setup();
    const examKey = await examWith(s);
    const q = await published(s);
    await s.service.setExamItems(CTX, examKey, [{ questionKey: q, points: 3 }]);

    const blueprint = await s.service.examBlueprint(examKey);
    expect(blueprint.ok).toBe(true);
    if (!blueprint.ok) return;
    expect(blueprint.value.totalItems).toBe(1);
    expect(blueprint.value.totalPoints).toBe(3);
    expect(blueprint.value.conceptCoverage[0]?.conceptKey).toBe(CONCEPT);
  });

  it('refuses to publish an empty exam', async () => {
    const s = setup();
    const examKey = await examWith(s);

    await s.service.transitionExam(CTX, examKey, 'SUBMIT');
    const approved = await s.service.transitionExam(CTX, examKey, 'APPROVE');

    expect(approved.ok).toBe(false);
    if (approved.ok) return;
    expect(approved.error.code).toBe('exam.not_publishable');
  });

  it('publishes a complete exam', async () => {
    const s = setup();
    const examKey = await examWith(s);
    const q = await published(s);
    await s.service.setExamItems(CTX, examKey, [{ questionKey: q }]);

    await s.service.transitionExam(CTX, examKey, 'SUBMIT');
    const approved = await s.service.transitionExam(CTX, examKey, 'APPROVE');
    expect(approved.ok && approved.value.status).toBe('PUBLISHED');
  });
});

describe('learning resources', () => {
  const RESOURCE = {
    kind: 'VIDEO',
    title: 'Sets explained',
    url: 'https://example.org/sets',
    conceptKey: CONCEPT,
  };

  it('attaches a resource to a concept', async () => {
    const s = setup();
    const created = await s.service.createResource(CTX, RESOURCE);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.isActive).toBe(true);
    expect(created.value.conceptKey).toBe(CONCEPT);
  });

  it('refuses a resource attached to nothing', async () => {
    // Unattached, the next-step engine can never surface it.
    const s = setup();
    const created = await s.service.createResource(CTX, { ...RESOURCE, conceptKey: null });
    expect(created.ok).toBe(false);
    if (created.ok) return;
    expect(created.error.code).toBe('resource.unattached');
  });

  it('refuses a resource with neither URL nor body', async () => {
    const s = setup();
    const created = await s.service.createResource(CTX, { ...RESOURCE, url: null });
    expect(created.ok).toBe(false);
    if (created.ok) return;
    expect(created.error.code).toBe('resource.empty');
  });

  it('refuses an inverted page range', async () => {
    const s = setup();
    const created = await s.service.createResource(CTX, {
      ...RESOURCE,
      pageStart: 40,
      pageEnd: 12,
    });
    expect(created.ok).toBe(false);
    if (created.ok) return;
    expect(created.error.code).toBe('resource.page_range_inverted');
  });

  it('refuses an unknown concept', async () => {
    const s = setup();
    const created = await s.service.createResource(CTX, { ...RESOURCE, conceptKey: 'NOPE' });
    expect(created.ok).toBe(false);
    if (created.ok) return;
    expect(created.error.code).toBe('resource.target_not_found');
  });

  it('allows support media on an active textbook', async () => {
    const s = setup();
    s.resources.textbookStatus = 'PUBLISHED';

    const created = await s.service.createResource(CTX, RESOURCE);
    expect(created.ok).toBe(true);
  });

  it('refuses support media on an archived textbook', async () => {
    const s = setup();
    s.resources.textbookStatus = 'ARCHIVED';

    const created = await s.service.createResource(CTX, RESOURCE);
    expect(created.ok).toBe(false);
    if (created.ok) return;
    expect(created.error.code).toBe('content.textbook_archived');
  });

  it('retires rather than deletes', async () => {
    // A decision log line points at this row; deleting would orphan history.
    const s = setup();
    const created = await s.service.createResource(CTX, RESOURCE);
    if (!created.ok) return;

    const retired = await s.service.retireResource(CTX, created.value.key);
    expect(retired.ok && retired.value.isActive).toBe(false);
    expect(s.resources.rows.has(created.value.key)).toBe(true);
  });

  it('validates the page range on update too', async () => {
    const s = setup();
    const created = await s.service.createResource(CTX, { ...RESOURCE, pageStart: 10, pageEnd: 20 });
    if (!created.ok) return;

    const updated = await s.service.updateResource(CTX, created.value.key, { pageEnd: 2 });
    expect(updated.ok).toBe(false);
    if (updated.ok) return;
    expect(updated.error.code).toBe('resource.page_range_inverted');
  });

  it('lists a concept\'s resources', async () => {
    const s = setup();
    await s.service.createResource(CTX, RESOURCE);

    const listed = await s.service.listResourcesForConcept(CONCEPT);
    expect(listed.ok && listed.value).toHaveLength(1);
  });

  it('lists a textbook\'s own resources, not its lessons\' or concepts\'', async () => {
    const s = setup();
    await s.service.createResource(CTX, {
      kind: 'TEXTBOOK_PAGE',
      title: 'Full book PDF',
      url: 'https://example.org/book.pdf',
      textbookKey: TEXTBOOK,
    });
    await s.service.createResource(CTX, RESOURCE); // concept-scoped, from the fixture

    const listed = await s.service.listResourcesForTextbook(TEXTBOOK);
    expect(listed.ok && listed.value).toHaveLength(1);
    expect(listed.ok && listed.value[0]?.textbookKey).toBe(TEXTBOOK);
  });

  it('reports a textbook that does not exist', async () => {
    const s = setup();
    const listed = await s.service.listResourcesForTextbook('NO-SUCH-BOOK');
    expect(listed.ok).toBe(false);
    if (listed.ok) return;
    expect(listed.error.code).toBe('content.textbook_not_found');
  });
});

/**
 * The silent-drop defect.
 *
 * Before this guard the adapter resolved `misconceptionKey` → `misconceptionId`
 * and fell back to `null` when the catalogue had no such key. The write
 * succeeded, the author got 201, and the choice carried no misconception. Every
 * downstream hop then behaved "correctly" on empty input: nothing was ever
 * diagnosed, no learner_misconceptions row was written, remediation never
 * fired. The capability was dead for that question and no one was told.
 *
 * These tests pin the refusal at the layer that owns it.
 */
describe('misconception tagging', () => {
  const taggedMcq = (misconceptionKey: string) => ({
    ...MCQ,
    choices: [
      { id: 'a', text: '{1, 2, 3}' },
      { id: 'b', text: '17', misconceptionKey },
    ],
  });

  it('refuses a distractor tagged with an unknown misconception', async () => {
    const s = setup();

    const created = await s.service.createQuestion(CTX, taggedMcq('MIS-TYPO'));

    expect(created.ok).toBe(false);
    if (created.ok) throw new Error('expected refusal');
    expect(created.error.code).toBe('question.misconception_not_found');
    expect(created.error.details).toMatchObject({ misconceptionKeys: ['MIS-TYPO'] });
  });

  it('does not write the question when the tag is unknown', async () => {
    const s = setup();

    await s.service.createQuestion(CTX, taggedMcq('MIS-TYPO'));

    // The old behaviour stored it with misconceptionId = null.
    expect(s.questions.rows.size).toBe(0);
  });

  it('accepts a distractor tagged with a catalogued misconception', async () => {
    const s = setup();
    s.questions.misconceptions.add('MIS-REAL');

    const created = await s.service.createQuestion(CTX, taggedMcq('MIS-REAL'));

    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.error.code);
    const stored = s.questions.rows.get(created.value.key);
    expect(stored?.choices.find((c) => c.id === 'b')?.misconceptionKey).toBe('MIS-REAL');
  });

  it('leaves untagged distractors alone', async () => {
    const s = setup();

    const created = await s.service.createQuestion(CTX, MCQ);

    expect(created.ok).toBe(true);
  });

  it('refuses an unknown tag introduced by an edit', async () => {
    const s = setup();
    const created = await s.service.createQuestion(CTX, MCQ);
    if (!created.ok) throw new Error('setup failed');

    const edited = await s.service.updateQuestion(CTX, created.value.key, {
      choices: [
        { id: 'a', text: '{1, 2, 3}' },
        { id: 'b', text: '17', misconceptionKey: 'MIS-TYPO' },
      ],
      answerKey: { correctChoiceIds: ['a'] },
    });

    expect(edited.ok).toBe(false);
    if (edited.ok) throw new Error('expected refusal');
    expect(edited.error.code).toBe('question.misconception_not_found');
  });

  it('reports every unknown key at once, not just the first', async () => {
    const s = setup();
    s.questions.misconceptions.add('MIS-REAL');

    const created = await s.service.createQuestion(CTX, {
      ...MCQ,
      choices: [
        { id: 'a', text: '{1, 2, 3}' },
        { id: 'b', text: '17', misconceptionKey: 'MIS-GONE-1' },
        { id: 'c', text: '42', misconceptionKey: 'MIS-REAL' },
        { id: 'd', text: '7', misconceptionKey: 'MIS-GONE-2' },
      ],
      answerKey: { correctChoiceIds: ['a'] },
    });

    expect(created.ok).toBe(false);
    if (created.ok) throw new Error('expected refusal');
    expect(created.error.details).toMatchObject({
      misconceptionKeys: ['MIS-GONE-1', 'MIS-GONE-2'],
    });
  });
});

/**
 * Provenance at the service boundary.
 *
 * The domain rule is tested in question-provenance.test.ts; this pins that the
 * service actually applies it, and that three differently-sourced questions can
 * share one lesson and concept without any of them claiming to be book content.
 */
describe('question provenance', () => {
  it('records a textbook question with its printed role', async () => {
    const s = setup();

    const created = await s.service.createQuestion(CTX, {
      ...MCQ,
      origin: 'TEXTBOOK' as const,
      textbookRole: 'EXERCISE' as const,
    });

    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.error.code);
    expect(created.value.origin).toBe('TEXTBOOK');
    expect(created.value.textbookRole).toBe('EXERCISE');
  });

  it('records a teacher question with no printed role', async () => {
    const s = setup();

    const created = await s.service.createQuestion(CTX, {
      ...MCQ,
      origin: 'TEACHER' as const,
    });

    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.error.code);
    expect(created.value.origin).toBe('TEACHER');
    expect(created.value.textbookRole).toBeNull();
  });

  it('defaults an unstated origin to UNKNOWN, never to TEXTBOOK', async () => {
    const s = setup();

    const created = await s.service.createQuestion(CTX, MCQ);

    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.error.code);
    expect(created.value.origin).toBe('UNKNOWN');
  });

  it('refuses an AI question claiming a printed textbook role', async () => {
    const s = setup();

    const created = await s.service.createQuestion(CTX, {
      ...MCQ,
      origin: 'AI' as const,
      textbookRole: 'EXERCISE' as const,
    });

    expect(created.ok).toBe(false);
    if (created.ok) throw new Error('expected refusal');
    expect(created.error.code).toBe('question.textbook_role_requires_textbook_origin');
  });

  it('does not write the question when provenance is impossible', async () => {
    const s = setup();

    await s.service.createQuestion(CTX, {
      ...MCQ,
      origin: 'AI' as const,
      textbookRole: 'REVIEW' as const,
    });

    expect(s.questions.rows.size).toBe(0);
  });

  it('lets teacher, AI and textbook questions share one lesson and concept', async () => {
    const s = setup();

    const book = await s.service.createQuestion(CTX, {
      ...MCQ,
      text: 'Printed in the book',
      origin: 'TEXTBOOK' as const,
      textbookRole: 'EXERCISE' as const,
    });
    const teacher = await s.service.createQuestion(CTX, {
      ...MCQ,
      text: 'Written by the teacher',
      origin: 'TEACHER' as const,
    });
    const ai = await s.service.createQuestion(CTX, {
      ...MCQ,
      text: 'Generated for this lesson',
      origin: 'AI' as const,
    });

    expect([book.ok, teacher.ok, ai.ok]).toEqual([true, true, true]);
    if (!book.ok || !teacher.ok || !ai.ok) return;

    // Same concept links on all three: alignment is identical.
    for (const q of [book, teacher, ai]) {
      expect(q.value.concepts.map((c) => c.conceptKey)).toEqual(
        MCQ.concepts.map((c) => c.conceptKey),
      );
    }
    // Provenance is what separates them.
    expect([book.value.origin, teacher.value.origin, ai.value.origin]).toEqual([
      'TEXTBOOK',
      'TEACHER',
      'AI',
    ]);
    expect([teacher.value.textbookRole, ai.value.textbookRole]).toEqual([null, null]);
  });

  it('does not let origin change the question key', async () => {
    const s = setup();

    const book = await s.service.createQuestion(CTX, {
      ...MCQ,
      text: 'Identical stem',
      origin: 'TEXTBOOK' as const,
    });
    // Same stem, same lesson, different origin — the key must collide, proving
    // origin is not part of identity.
    const ai = await s.service.createQuestion(CTX, {
      ...MCQ,
      text: 'Identical stem',
      origin: 'AI' as const,
    });

    expect(book.ok).toBe(true);
    if (!book.ok || !ai.ok) {
      // A duplicate-key refusal is equally valid proof; what must not happen is
      // two different keys.
      expect(ai.ok).toBe(false);
      return;
    }
    expect(ai.value.key).toBe(book.value.key);
  });
});
