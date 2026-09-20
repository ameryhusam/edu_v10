/**
 * Item bank — authoring questions, exams and learning resources.
 *
 * Orchestration only, in the same shape as `authoring.service.ts`: every rule
 * comes from `domain/`, and this decides what to load and in what order.
 *
 * Three invariants run through the whole file:
 *
 *  1. **Validation happens before the write, not at grading time.** A question
 *     that cannot be graded is never stored as PUBLISHED.
 *  2. **Evidence freezes content.** Once a learner has answered a question or
 *     sat an exam, what they were asked is history and stops being editable.
 *  3. **The owning textbook's lock applies.** Questions and resources belong
 *     to a book; once a book is active in Edu7 its item bank is closed for
 *     structural change,
 *     exactly as its concept tree is.
 */

import { Errors } from '../../../shared/kernel/errors.js';
import { Err, Ok, type Result } from '../../../shared/kernel/result.js';
import type { Clock } from '../../../shared/kernel/clock.js';
import {
  learningResourceKey as buildConceptResourceKey,
  lessonResourceKey as buildLessonResourceKey,
  questionKey as buildQuestionKey,
  normalizeSlug,
  stableKeyFingerprint,
  textbookResourceKey as buildTextbookResourceKey,
  type ConceptKey,
  type LessonKey,
  type TextbookKey,
} from '../../../shared/kernel/identifiers.js';
import {
  checkTransition,
  isStructurallyLocked,
  type PublicationAction,
  type PublicationState,
} from '../domain/publication.js';
import {
  checkQuestionPublishable,
  isAutoGradable,
  resolveProvenance,
  type ConceptLink,
  type DraftAnswerKey,
  type DraftChoice,
  type DraftQuestion,
  type QuestionOrigin,
  type QuestionType,
  type QuestionVisibility,
  type TextbookQuestionRole,
  validateConceptLinks,
  validateQuestion,
} from '../domain/question-authoring.js';
import {
  checkExamComposable,
  checkExamPublishable,
  summariseBlueprint,
  validateExam,
  type Blueprint,
  type ExamDraft,
  type ExamItemDraft,
} from '../domain/exam-authoring.js';
import { IMPORTABLE_RESOURCE_KINDS } from '../domain/export-profile.js';
import type { ContentAuditWriter } from './ports.js';
import type {
  ExamListPage,
  ExamRecord,
  ExamRepository,
  FlashcardRecord,
  FlashcardRepository,
  QuestionBankAccess,
  QuestionBankListQuery,
  QuestionRecord,
  QuestionRepository,
  ResourceRecord,
  ResourceRepository,
} from './item-bank.ports.js';

export interface AuthorContext {
  /** For the audit trail. Authorisation itself is decided at the HTTP boundary. */
  readonly actorKey: string;
  /** DB user id, used only to scope private teacher-bank questions. */
  readonly actorUserId?: string;
  /** Role grants' school ids, used only to scope teacher-bank visibility. */
  readonly schoolIds?: readonly string[];
  /** True for admins/content authors; false for teacher-only question authors. */
  readonly canManageOfficialBank?: boolean;
}

/** An empty key, normalised, so the repository never sees undefined fields. */
const EMPTY_KEY = {
  correctChoiceIds: [] as readonly string[],
  acceptedTexts: [] as readonly string[],
  numericMin: null,
  numericMax: null,
  expectedOrder: [] as readonly string[],
  expectedPairs: null,
  caseSensitive: false,
  allowPartialCredit: true,
  rubric: null,
};

function normaliseKey(key: DraftAnswerKey) {
  return {
    correctChoiceIds: key.correctChoiceIds ?? EMPTY_KEY.correctChoiceIds,
    acceptedTexts: key.acceptedTexts ?? EMPTY_KEY.acceptedTexts,
    numericMin: key.numericMin ?? null,
    numericMax: key.numericMax ?? null,
    expectedOrder: key.expectedOrder ?? EMPTY_KEY.expectedOrder,
    expectedPairs: key.expectedPairs ?? null,
    caseSensitive: key.caseSensitive ?? false,
    allowPartialCredit: key.allowPartialCredit ?? true,
    rubric: key.rubric ?? null,
  };
}

function toDraft(record: QuestionRecord): DraftQuestion {
  return {
    type: record.type,
    text: record.text,
    choices: record.choices.map((c) => ({
      id: c.id,
      text: c.text,
      misconceptionKey: c.misconceptionKey,
      feedback: c.feedback,
    })),
    answerKey: record.answerKey ?? {},
    points: record.points,
    difficulty01: record.difficulty01,
  };
}

function resolveQuestionOwnership(
  ctx: AuthorContext,
  origin: QuestionOrigin,
  requestedVisibility?: QuestionVisibility,
): Result<{ authorUserId: string | null; schoolId: string | null; visibility: QuestionVisibility }> {
  const canManageOfficialBank = ctx.canManageOfficialBank ?? true;
  const schoolId = ctx.schoolIds?.[0] ?? null;

  if (!canManageOfficialBank && origin !== 'TEACHER') {
    return Err(
      Errors.forbidden(
        'question.teacher_origin_only',
        'Teachers may create only teacher-origin questions.',
        { origin },
      ),
    );
  }

  const visibility: QuestionVisibility =
    requestedVisibility ?? (!canManageOfficialBank ? 'PRIVATE' : 'GLOBAL');

  if (!canManageOfficialBank && visibility === 'GLOBAL') {
    return Err(
      Errors.forbidden(
        'question.teacher_global_visibility_forbidden',
        'Teacher questions must be private, school-visible, or submitted for review.',
      ),
    );
  }

  if ((visibility === 'SCHOOL' || visibility === 'SUBMITTED_FOR_REVIEW') && !schoolId) {
    return Err(
      Errors.validation(
        'question.school_scope_required',
        'School-visible teacher questions require a school-scoped role.',
        { visibility },
      ),
    );
  }

  return Ok({
    authorUserId: ctx.actorUserId ?? null,
    schoolId: visibility === 'PRIVATE' ? (schoolId ?? null) : schoolId,
    visibility,
  });
}

function assertQuestionEditAllowed(ctx: AuthorContext, question: QuestionRecord): Result<void> {
  if (ctx.canManageOfficialBank ?? true) return Ok(undefined);
  if (question.origin === 'TEACHER' && question.authorUserId === ctx.actorUserId) {
    return Ok(undefined);
  }
  return Err(
    Errors.forbidden(
      'question.teacher_edit_forbidden',
      'Teachers may edit only their own teacher-origin questions.',
      { questionKey: question.key },
    ),
  );
}

function bankAccess(ctx: AuthorContext): QuestionBankAccess {
  return {
    canReadAll: ctx.canManageOfficialBank ?? true,
    actorUserId: ctx.actorUserId,
    schoolIds: ctx.schoolIds ?? [],
  };
}

function resolveExamOwnership(
  ctx: AuthorContext,
  requestedVisibility?: QuestionVisibility,
): Result<{ authorUserId: string | null; schoolId: string | null; visibility: QuestionVisibility }> {
  const canManageOfficialBank = ctx.canManageOfficialBank ?? true;
  const schoolId = ctx.schoolIds?.[0] ?? null;
  const visibility: QuestionVisibility =
    requestedVisibility ?? (!canManageOfficialBank ? (schoolId ? 'SCHOOL' : 'PRIVATE') : 'GLOBAL');

  if (visibility === 'SUBMITTED_FOR_REVIEW') {
    return Err(
      Errors.validation(
        'exam.visibility_not_review_queue',
        'Exam visibility is either private, school-visible or global; review submission belongs to questions.',
      ),
    );
  }
  if (!canManageOfficialBank && visibility === 'GLOBAL') {
    return Err(
      Errors.forbidden(
        'exam.teacher_global_visibility_forbidden',
        'Classroom and family exam authors may publish only private or school-visible exams, not global official exams.',
      ),
    );
  }
  if (visibility === 'SCHOOL' && !schoolId) {
    return Err(
      Errors.validation('exam.school_scope_required', 'A school-visible exam requires a school-scoped role.'),
    );
  }

  return Ok({
    authorUserId: ctx.actorUserId ?? null,
    schoolId: visibility === 'SCHOOL' ? schoolId : null,
    visibility,
  });
}

function assertExamEditAllowed(ctx: AuthorContext, exam: ExamRecord): Result<void> {
  if (ctx.canManageOfficialBank ?? true) return Ok(undefined);
  if (exam.authorUserId === ctx.actorUserId && exam.visibility !== 'GLOBAL') return Ok(undefined);
  return Err(
    Errors.forbidden('exam.teacher_edit_forbidden', 'Teachers may edit only exams they created.', {
      examKey: exam.key,
    }),
  );
}

function canUseQuestionInExam(ctx: AuthorContext, question: QuestionRecord): boolean {
  if (ctx.canManageOfficialBank ?? true) return true;
  if (question.status === 'PUBLISHED' && question.visibility === 'GLOBAL') return true;
  if (question.origin === 'TEACHER' && question.authorUserId === ctx.actorUserId) return true;
  if (
    question.origin === 'TEACHER' &&
    question.schoolId &&
    (ctx.schoolIds ?? []).includes(question.schoolId) &&
    (question.visibility === 'SCHOOL' || question.visibility === 'SUBMITTED_FOR_REVIEW')
  ) {
    return true;
  }
  return false;
}

function buildQuestionMetadataPatch(
  ctx: AuthorContext,
  existing: QuestionRecord,
  input: {
    origin?: QuestionOrigin;
    textbookRole?: TextbookQuestionRole | null;
    sourceRef?: string | null;
    visibility?: QuestionVisibility;
  },
): Result<{
  origin?: QuestionOrigin;
  textbookRole?: TextbookQuestionRole | null;
  sourceRef?: string | null;
  visibility?: QuestionVisibility;
  schoolId?: string | null;
} | null> {
  const wantsMetadata =
    input.origin !== undefined ||
    input.textbookRole !== undefined ||
    input.sourceRef !== undefined ||
    input.visibility !== undefined;
  if (!wantsMetadata) return Ok(null);

  const origin = input.origin ?? existing.origin;
  const textbookRole = input.textbookRole !== undefined ? input.textbookRole : existing.textbookRole;
  const provenance = resolveProvenance({ origin, textbookRole });
  if (!provenance.ok) return provenance;

  const ownership = resolveQuestionOwnership(
    ctx,
    provenance.value.origin,
    input.visibility ?? existing.visibility ?? 'GLOBAL',
  );
  if (!ownership.ok) return ownership;

  return Ok({
    origin: provenance.value.origin,
    textbookRole: provenance.value.textbookRole,
    ...(input.sourceRef !== undefined ? { sourceRef: input.sourceRef } : {}),
    visibility: ownership.value.visibility,
    schoolId: ownership.value.schoolId,
  });
}

export class ItemBankService {
  constructor(
    private readonly questions: QuestionRepository,
    private readonly exams: ExamRepository,
    private readonly resources: ResourceRepository,
    private readonly clock: Clock,
    private readonly audit?: ContentAuditWriter,
    private readonly flashcards?: FlashcardRepository,
  ) {}

  // ══ Questions ═════════════════════════════════════════════════════════════

  /**
   * Author a question.
   *
   * Validated on the way in even though it lands as DRAFT: storing a knowingly
   * broken item helps nobody, and the author is here now to fix it. What a
   * draft is allowed to be is *incomplete later* — an author can save a
   * question and add concepts before publishing — so linkage is checked at
   * publication, while gradability is checked here.
   */
  async createQuestion(
    ctx: AuthorContext,
    input: {
      type: QuestionType;
      text: string;
      hint?: string | null;
      explanation?: string | null;
      points?: number;
      difficulty01?: number;
      origin?: QuestionOrigin;
      textbookRole?: TextbookQuestionRole | null;
      sourceRef?: string | null;
      visibility?: QuestionVisibility;
      choices?: readonly DraftChoice[];
      answerKey?: DraftAnswerKey;
      /**
       * Where the question lives. Mandatory.
       *
       * Previously implied by the primary concept's lesson, which forced every
       * question to carry a concept for a structural reason rather than a
       * pedagogical one.
       */
      lessonKey: string;
      /** What it measures. Optional — may be empty while diagnosis is pending. */
      concepts?: readonly ConceptLink[];
    },
  ): Promise<Result<QuestionRecord>> {
    const draft: DraftQuestion = {
      type: input.type,
      text: input.text,
      choices: input.choices ?? [],
      answerKey: input.answerKey ?? {},
      points: input.points ?? 1,
      difficulty01: input.difficulty01 ?? 0.5,
    };

    const issues = validateQuestion(draft);
    if (issues.length > 0) {
      return Err(
        Errors.validation('question.invalid', 'This question cannot be stored as written.', {
          issues,
        }),
      );
    }

    // Links are optional at creation; when present they must still be coherent
    // (one primary, no duplicates, weights in range).
    const links = input.concepts ?? [];
    const linkIssues = validateConceptLinks(links);
    if (linkIssues.length > 0) {
      return Err(
        Errors.validation('question.invalid', 'This question cannot be stored as written.', {
          issues: linkIssues,
        }),
      );
    }

    const scope = await this.resolveConceptScope(links);
    if (!scope.ok) return scope;

    const tags = await this.assertMisconceptionsExist(draft.choices);
    if (!tags.ok) return tags;

    // Resolved here, with the other refusals, so an impossible claim — an AI
    // item carrying a printed textbook role — is rejected before anything is
    // written, rather than silently nulled.
    const provenance = resolveProvenance({
      origin: input.origin,
      textbookRole: input.textbookRole,
    });
    if (!provenance.ok) return provenance;

    const ownership = resolveQuestionOwnership(ctx, provenance.value.origin, input.visibility);
    if (!ownership.ok) return ownership;

    // Placement is stated, not inferred. When links are present the lesson must
    // agree with them: a question filed under one lesson while measuring a
    // concept from another is a mistake worth refusing, not reconciling.
    const lessonKey = input.lessonKey;
    if (!(await this.questions.lessonExists(lessonKey))) {
      return Err(
        Errors.notFound('question.lesson_not_found', 'The lesson does not exist.', { lessonKey }),
      );
    }

    for (const link of links) {
      const owner = await this.questions.lessonKeyForConcept(link.conceptKey);
      if (!owner) {
        return Err(
          Errors.notFound('question.concept_not_found', 'A linked concept does not exist.', {
            conceptKey: link.conceptKey,
          }),
        );
      }
      if (owner !== lessonKey) {
        return Err(
          Errors.validation(
            'question.concept_outside_lesson',
            'A linked concept belongs to a different lesson than the question.',
            { conceptKey: link.conceptKey, conceptLesson: owner, questionLesson: lessonKey },
          ),
        );
      }
    }

    const locked = await this.assertLessonBankWritable(lessonKey);
    if (!locked.ok) return locked;

    // Identity from content, not from a counter: the same stem authored twice
    // against the same lesson produces the same key, which makes re-imports
    // and re-runs idempotent instead of duplicating the bank.
    const key = buildQuestionKey(lessonKey as LessonKey, draft.text);
    if (!key.ok) return key;

    // The same stem against the same lesson derives the same key, so a repeat
    // is a duplicate rather than a new item. Refused here, in the domain's
    // vocabulary: without this the unique constraint surfaced as an unhandled
    // 500, which tells an author nothing and gives a re-run no way to tell
    // "already present" apart from "broken".
    const clash = await this.questions.findQuestion(key.value);
    if (clash) {
      return Err(
        Errors.conflict(
          'question.exists',
          'This lesson already has a question with this exact text.',
          { questionKey: key.value },
        ),
      );
    }

    const created = await this.questions.createQuestion({
      key: key.value,
      type: draft.type,
      text: draft.text,
      hint: input.hint ?? null,
      explanation: input.explanation ?? null,
      points: draft.points!,
      difficulty01: draft.difficulty01!,
      origin: provenance.value.origin,
      textbookRole: provenance.value.textbookRole,
      sourceRef: input.sourceRef ?? null,
      authorUserId: ownership.value.authorUserId,
      schoolId: ownership.value.schoolId,
      visibility: ownership.value.visibility,
      choices: draft.choices.map((c, index) => ({
        id: c.id,
        text: c.text,
        orderIndex: index,
        misconceptionKey: c.misconceptionKey ?? null,
        feedback: c.feedback ?? null,
      })),
      answerKey: normaliseKey(draft.answerKey),
      lessonKey,
      concepts: links.map((c) => ({ ...c })),
    });

    await this.log(ctx, 'question.created', key.value, {
      type: draft.type,
      origin: provenance.value.origin,
      textbookRole: provenance.value.textbookRole,
    });
    return Ok(created);
  }

  /**
   * Rewrite a draft question.
   *
   * Refused once anyone has answered it. A response is a record of what a
   * specific learner was asked; editing the stem afterwards turns their
   * evidence into a claim about a question that never existed.
   */
  async updateQuestion(
    ctx: AuthorContext,
    questionKey: string,
    input: {
      text?: string;
      hint?: string | null;
      explanation?: string | null;
      points?: number;
      difficulty01?: number;
      origin?: QuestionOrigin;
      textbookRole?: TextbookQuestionRole | null;
      sourceRef?: string | null;
      visibility?: QuestionVisibility;
      choices?: readonly DraftChoice[];
      answerKey?: DraftAnswerKey;
    },
  ): Promise<Result<QuestionRecord>> {
    const existing = await this.questions.findQuestion(questionKey);
    if (!existing) return questionNotFound(questionKey);

    const access = assertQuestionEditAllowed(ctx, existing);
    if (!access.ok) return access;

    const frozen = await this.assertQuestionMutable(existing);
    if (!frozen.ok) return frozen;

    const merged: DraftQuestion = {
      type: existing.type,
      text: input.text ?? existing.text,
      choices: input.choices ?? toDraft(existing).choices,
      answerKey: input.answerKey ?? existing.answerKey ?? {},
      points: input.points ?? existing.points,
      difficulty01: input.difficulty01 ?? existing.difficulty01,
    };

    // The whole merged item is revalidated, not just the changed fields: a new
    // option list can invalidate an untouched answer key.
    const issues = validateQuestion(merged);
    if (issues.length > 0) {
      return Err(
        Errors.validation('question.invalid', 'This edit would leave the question ungradable.', {
          issues,
        }),
      );
    }

    const tags = await this.assertMisconceptionsExist(merged.choices);
    if (!tags.ok) return tags;

    await this.questions.replaceQuestionContent(questionKey, {
      text: merged.text,
      hint: input.hint !== undefined ? input.hint : existing.hint,
      explanation: input.explanation !== undefined ? input.explanation : existing.explanation,
      points: merged.points!,
      difficulty01: merged.difficulty01!,
      choices: merged.choices.map((c, index) => ({
        id: c.id,
        text: c.text,
        orderIndex: index,
        misconceptionKey: c.misconceptionKey ?? null,
        feedback: c.feedback ?? null,
      })),
      answerKey: normaliseKey(merged.answerKey),
    });

    const metadataPatch = buildQuestionMetadataPatch(ctx, existing, input);
    if (!metadataPatch.ok) return metadataPatch;
    if (metadataPatch.value && this.questions.updateQuestionMetadata) {
      await this.questions.updateQuestionMetadata(questionKey, metadataPatch.value);
    } else if (metadataPatch.value) {
      return Err(
        Errors.unavailable(
          'question.metadata_update_unavailable',
          'This question repository cannot update provenance metadata.',
        ),
      );
    }

    await this.log(ctx, 'question.updated', questionKey, { fields: Object.keys(input) });

    const updated = await this.questions.findQuestion(questionKey);
    return updated ? Ok(updated) : questionNotFound(questionKey);
  }

  /**
   * The question bank for one lesson, with its diagnosis state.
   *
   * Backs the re-linking screen. `unlinkedCount` is computed here rather than
   * left to the client so that every caller agrees on what "needs attention"
   * means, and so the number cannot drift between the list and its badge.
   */
  async lessonQuestionBank(
    _ctx: AuthorContext,
    lessonKey: string,
  ): Promise<
    Result<{
      lessonKey: string;
      unlinkedCount: number;
      questions: readonly QuestionRecord[];
      concepts: ReadonlyArray<{ key: string; name: string }>;
    }>
  > {
    if (!(await this.questions.lessonExists(lessonKey))) {
      return Err(
        Errors.notFound('question.lesson_not_found', 'The lesson does not exist.', { lessonKey }),
      );
    }
    const [questions, concepts] = await Promise.all([
      this.questions.questionsForLesson(lessonKey),
      this.questions.conceptsForLesson(lessonKey),
    ]);
    return Ok({
      lessonKey,
      // Counted here, not in the caller, so a list and the badge above it
      // cannot end up disagreeing about what "needs attention" means.
      unlinkedCount: questions.filter((q) => q.concepts.length === 0).length,
      questions,
      // The legal link targets. Shipped with the bank so the re-linking screen
      // cannot offer a concept that `setQuestionConcepts` would then refuse.
      concepts,
    });
  }

  /** General item-bank listing with provenance/type filters and reader scope. */
  async listQuestions(
    ctx: AuthorContext,
    query: Partial<Omit<QuestionBankListQuery, 'limit' | 'offset'>> & {
      limit?: number;
      offset?: number;
    },
  ): Promise<Result<{ rows: readonly QuestionRecord[]; total: number }>> {
    if (!this.questions.listQuestions) {
      return Err(
        Errors.unavailable(
          'question.list_unavailable',
          'This question repository cannot list the full item bank.',
        ),
      );
    }

    const access: QuestionBankAccess = {
      canReadAll: ctx.canManageOfficialBank ?? true,
      ...(ctx.actorUserId ? { actorUserId: ctx.actorUserId } : {}),
      ...(ctx.schoolIds ? { schoolIds: ctx.schoolIds } : {}),
    };

    const page = await this.questions.listQuestions(
      {
        ...query,
        limit: Math.min(Math.max(query.limit ?? 50, 1), 100),
        offset: Math.max(query.offset ?? 0, 0),
      },
      access,
    );
    return Ok(page);
  }

  /** Re-point a question at different concepts. */
  async setQuestionConcepts(
    ctx: AuthorContext,
    questionKey: string,
    concepts: readonly ConceptLink[],
  ): Promise<Result<QuestionRecord>> {
    const existing = await this.questions.findQuestion(questionKey);
    if (!existing) return questionNotFound(questionKey);

    const access = assertQuestionEditAllowed(ctx, existing);
    if (!access.ok) return access;

    const frozen = await this.assertQuestionMutable(existing);
    if (!frozen.ok) return frozen;

    const issues = validateConceptLinks(concepts);
    if (issues.length > 0) {
      return Err(Errors.validation('question.invalid', 'These concept links are not valid.', { issues }));
    }

    const scope = await this.resolveConceptScope(concepts);
    if (!scope.ok) return scope;

    // Same rule as at creation: a re-link may not move an item's diagnosis
    // outside the lesson it is filed under. Without this the modal could
    // quietly produce exactly the mismatch creation refuses.
    for (const link of concepts) {
      const owner = await this.questions.lessonKeyForConcept(link.conceptKey);
      if (owner !== existing.lessonKey) {
        return Err(
          Errors.validation(
            'question.concept_outside_lesson',
            'A linked concept belongs to a different lesson than the question.',
            { conceptKey: link.conceptKey, conceptLesson: owner, questionLesson: existing.lessonKey },
          ),
        );
      }
    }

    await this.questions.setQuestionConcepts(questionKey, concepts.map((c) => ({ ...c })));
    await this.log(ctx, 'question.concepts_set', questionKey, {
      concepts: concepts.map((c) => c.conceptKey),
    });

    const updated = await this.questions.findQuestion(questionKey);
    return updated ? Ok(updated) : questionNotFound(questionKey);
  }

  /**
   * Move a question through the publication lifecycle.
   *
   * The gate runs on APPROVE: this is the last moment an ungradable item can
   * be stopped, and the first moment a learner could be shown it.
   */
  async transitionQuestion(
    ctx: AuthorContext,
    questionKey: string,
    action: PublicationAction,
  ): Promise<Result<{ key: string; status: PublicationState }>> {
    const existing = await this.questions.findQuestion(questionKey);
    if (!existing) return questionNotFound(questionKey);

    const outcome = checkTransition(existing.status, action);
    if (!outcome.allowed) {
      return Err(Errors.conflict(outcome.code, outcome.reason, { questionKey, from: existing.status }));
    }

    if (outcome.publishes) {
      const publishable = checkQuestionPublishable(toDraft(existing), existing.concepts);
      if (!publishable.ok) return publishable;
    }

    await this.questions.setQuestionStatus(questionKey, outcome.to);
    await this.log(ctx, `question.${action.toLowerCase()}`, questionKey, { to: outcome.to });

    return Ok({ key: questionKey, status: outcome.to });
  }

  // ══ Exams ═════════════════════════════════════════════════════════════════

  async listExams(
    ctx: AuthorContext,
    query: {
      search?: string;
      status?: PublicationState;
      textbookKey?: string;
      isAdaptive?: boolean;
      limit?: number;
      offset?: number;
    },
  ): Promise<Result<ExamListPage>> {
    if (!this.exams.listExams) {
      return Err(Errors.internal('exam.list_not_configured', 'Exam listing is not configured.'));
    }
    return Ok(
      await this.exams.listExams(
        {
          ...(query.search ? { search: query.search } : {}),
          ...(query.status ? { status: query.status } : {}),
          ...(query.textbookKey ? { textbookKey: query.textbookKey } : {}),
          ...(query.isAdaptive !== undefined ? { isAdaptive: query.isAdaptive } : {}),
          limit: Math.min(Math.max(query.limit ?? 25, 1), 100),
          offset: Math.max(query.offset ?? 0, 0),
        },
        bankAccess(ctx),
      ),
    );
  }

  async createExam(
    ctx: AuthorContext,
    input: {
      title: string;
      description?: string | null;
      textbookKey?: string | null;
      isAdaptive?: boolean;
      passingScore?: number;
      timeLimitMins?: number | null;
      minItems?: number;
      maxItems?: number;
      targetStandardError?: number;
      visibility?: QuestionVisibility;
    },
  ): Promise<Result<ExamRecord>> {
    const ownership = resolveExamOwnership(ctx, input.visibility);
    if (!ownership.ok) return ownership;

    const slug = normalizeSlug(input.title);
    if (!slug.ok) {
      return Err(
        Errors.validation('exam.title_not_usable', 'An exam key cannot be derived from this title.', {
          title: input.title,
        }),
      );
    }

    const key = `EXAM-${slug.value.slice(0, 20)}-${stableKeyFingerprint(
      `${input.textbookKey ?? ''}:${input.title}:${ctx.actorKey}:${this.clock.now().toISOString()}`,
    )}`;

    const created = await this.exams.createExam({
      key,
      title: input.title,
      description: input.description ?? null,
      textbookKey: input.textbookKey ?? null,
      authorUserId: ownership.value.authorUserId,
      schoolId: ownership.value.schoolId,
      visibility: ownership.value.visibility,
      isAdaptive: input.isAdaptive ?? false,
      passingScore: input.passingScore ?? 0.5,
      timeLimitMins: input.timeLimitMins ?? null,
      minItems: input.minItems ?? 5,
      maxItems: input.maxItems ?? 25,
      targetStandardError: input.targetStandardError ?? 0.3,
    });

    await this.log(ctx, 'exam.created', key, { isAdaptive: created.isAdaptive });
    return Ok(created);
  }

  async createAdaptiveExamFromScope(
    ctx: AuthorContext,
    input: {
      title: string;
      description?: string | null;
      textbookKey: string;
      lessonKey?: string | null;
      conceptKeys?: readonly string[];
      type?: QuestionType;
      origin?: QuestionOrigin;
      difficultyMin?: number;
      difficultyMax?: number;
      passingScore?: number;
      timeLimitMins?: number | null;
      minItems?: number;
      maxItems?: number;
      targetStandardError?: number;
      visibility?: QuestionVisibility;
    },
  ): Promise<Result<ExamRecord>> {
    if (!this.questions.listQuestions) {
      return Err(Errors.internal('exam.question_listing_not_configured', 'Question listing is not configured.'));
    }

    const page = await this.questions.listQuestions(
      {
        textbookKey: input.textbookKey,
        ...(input.lessonKey ? { lessonKey: input.lessonKey } : {}),
        status: 'PUBLISHED',
        ...(input.type ? { type: input.type } : {}),
        ...(input.origin ? { origin: input.origin } : {}),
        ...(input.difficultyMin !== undefined ? { difficultyMin: input.difficultyMin } : {}),
        ...(input.difficultyMax !== undefined ? { difficultyMax: input.difficultyMax } : {}),
        limit: 500,
        offset: 0,
      },
      bankAccess(ctx),
    );
    const requiredConcepts = new Set(input.conceptKeys ?? []);
    const candidates = page.rows
      .filter((question) => isAutoGradable(question.type))
      .filter(
        (question) =>
          requiredConcepts.size === 0 ||
          question.concepts.some((link) => requiredConcepts.has(link.conceptKey)),
      )
      .sort((a, b) => a.irtDifficulty - b.irtDifficulty || a.key.localeCompare(b.key));

    const minItems = input.minItems ?? 5;
    const maxItems = input.maxItems ?? 25;
    const targetStandardError = input.targetStandardError ?? 0.3;
    const resolved = candidates.slice(0, Math.max(maxItems * 2, minItems * 2)).map((question, index) => ({
      questionKey: question.key,
      orderIndex: index,
      points: question.points,
      questionStatus: question.status,
      autoGradable: isAutoGradable(question.type),
      irtDifficulty: question.irtDifficulty,
      conceptKeys: question.concepts.map((link) => link.conceptKey),
    }));

    const issues = validateExam({
      title: input.title,
      isAdaptive: true,
      passingScore: input.passingScore ?? 0.5,
      timeLimitMins: input.timeLimitMins ?? null,
      adaptive: { minItems, maxItems, targetStandardError },
      items: resolved,
    });
    if (issues.length > 0) {
      return Err(
        Errors.validation(
          'exam.adaptive_pool_not_ready',
          'There are not enough suitable published auto-gradable questions to create an adaptive exam for this scope.',
          {
            issues,
            candidateCount: candidates.length,
            conceptKeys: [...requiredConcepts],
            type: input.type ?? null,
            origin: input.origin ?? null,
          },
        ),
      );
    }

    const exam = await this.createExam(ctx, {
      title: input.title,
      description: input.description ?? null,
      textbookKey: input.textbookKey,
      isAdaptive: true,
      passingScore: input.passingScore ?? 0.5,
      timeLimitMins: input.timeLimitMins ?? null,
      minItems,
      maxItems,
      targetStandardError,
      visibility: input.visibility,
    });
    if (!exam.ok) return exam;

    return this.setExamItems(
      ctx,
      exam.value.key,
      resolved.map((item) => ({ questionKey: item.questionKey, points: item.points })),
    );
  }

  /**
   * Set the exam's item list.
   *
   * Whole-list replacement rather than add/remove: an exam is a blueprint, and
   * validating one is only meaningful against the complete set. Incremental
   * edits would let a pool pass every individual check and still be unusable.
   */
  async setExamItems(
    ctx: AuthorContext,
    examKey: string,
    items: ReadonlyArray<{ questionKey: string; points?: number }>,
  ): Promise<Result<ExamRecord>> {
    const exam = await this.exams.findExam(examKey);
    if (!exam) return examNotFound(examKey);

    const access = assertExamEditAllowed(ctx, exam);
    if (!access.ok) return access;

    const hasAttempts = await this.exams.examHasAttempts(examKey);
    const composable = checkExamComposable(exam.status, hasAttempts);
    if (!composable.ok) return composable;

    // Resolve each question so the pool checks see real IRT parameters rather
    // than whatever the caller claimed.
    const resolved: ExamItemDraft[] = [];
    for (const [index, entry] of items.entries()) {
      const question = await this.questions.findQuestion(entry.questionKey);
      if (!question) {
        return Err(
          Errors.notFound('exam.question_not_found', 'An item references a question that does not exist.', {
            questionKey: entry.questionKey,
          }),
        );
      }
      if (!canUseQuestionInExam(ctx, question)) {
        return Err(
          Errors.forbidden('exam.question_out_of_scope', 'This question is not available to this exam author.', {
            questionKey: question.key,
          }),
        );
      }
      resolved.push({
        questionKey: question.key,
        orderIndex: index,
        points: entry.points ?? question.points,
        questionStatus: question.status,
        autoGradable: isAutoGradable(question.type),
        irtDifficulty: question.irtDifficulty,
        conceptKeys: question.concepts.map((c) => c.conceptKey),
      });
    }

    const draft = this.toExamDraft(exam, resolved);
    const issues = validateExam(draft);
    if (issues.length > 0) {
      return Err(
        Errors.validation('exam.invalid', 'This item list is not a usable exam.', { issues }),
      );
    }

    await this.exams.setExamItems(
      examKey,
      resolved.map((i) => ({ questionKey: i.questionKey, orderIndex: i.orderIndex, points: i.points })),
    );
    await this.log(ctx, 'exam.items_set', examKey, { count: resolved.length });

    const updated = await this.exams.findExam(examKey);
    return updated ? Ok(updated) : examNotFound(examKey);
  }

  /** What the exam measures, for the author to check before publishing. */
  async examBlueprint(examKey: string): Promise<Result<Blueprint>> {
    const exam = await this.exams.findExam(examKey);
    if (!exam) return examNotFound(examKey);
    return Ok(summariseBlueprint(this.toExamDraft(exam, this.itemsOf(exam)).items));
  }

  async transitionExam(
    ctx: AuthorContext,
    examKey: string,
    action: PublicationAction,
  ): Promise<Result<{ key: string; status: PublicationState }>> {
    const exam = await this.exams.findExam(examKey);
    if (!exam) return examNotFound(examKey);

    const access = assertExamEditAllowed(ctx, exam);
    if (!access.ok) return access;

    if (action === 'APPROVE' && !(ctx.canManageOfficialBank ?? true) && exam.visibility === 'GLOBAL') {
      return Err(
        Errors.forbidden('exam.global_approval_forbidden', 'Only administrators can approve global exams.'),
      );
    }

    const outcome = checkTransition(exam.status, action);
    if (!outcome.allowed) {
      return Err(Errors.conflict(outcome.code, outcome.reason, { examKey, from: exam.status }));
    }

    if (outcome.publishes) {
      const publishable = checkExamPublishable(this.toExamDraft(exam, this.itemsOf(exam)));
      if (!publishable.ok) return publishable;
    }

    await this.exams.setExamStatus(
      examKey,
      outcome.to,
      outcome.publishes ? this.clock.now() : undefined,
    );
    await this.log(ctx, `exam.${action.toLowerCase()}`, examKey, { to: outcome.to });

    return Ok({ key: examKey, status: outcome.to });
  }

  private itemsOf(exam: ExamRecord): ExamItemDraft[] {
    return exam.items.map((i) => ({
      questionKey: i.questionKey,
      orderIndex: i.orderIndex,
      points: i.points,
      questionStatus: i.questionStatus,
      autoGradable: isAutoGradable(i.questionType),
      irtDifficulty: i.irtDifficulty,
      conceptKeys: i.conceptKeys,
    }));
  }

  private toExamDraft(exam: ExamRecord, items: readonly ExamItemDraft[]): ExamDraft {
    return {
      title: exam.title,
      isAdaptive: exam.isAdaptive,
      passingScore: exam.passingScore,
      timeLimitMins: exam.timeLimitMins,
      adaptive: {
        minItems: exam.minItems,
        maxItems: exam.maxItems,
        targetStandardError: exam.targetStandardError,
      },
      items,
    };
  }

  // ══ Learning resources ════════════════════════════════════════════════════

  /**
   * Attach a resource to a concept, lesson or book.
   *
   * Resources are what `decideNextActivity` reaches for when it decides a
   * learner should LEARN or REMEDIATE, so an unattached resource is invisible
   * to the engine no matter how good it is. Lesson-scoped rows are the normal
   * pre-reading list; concept-scoped rows support remediation and retrieval.
   */
  async createResource(
    ctx: AuthorContext,
    input: {
      kind: string;
      title: string;
      url?: string | null;
      body?: string | null;
      textbookKey?: string | null;
      lessonKey?: string | null;
      conceptKey?: string | null;
      slug?: string | null;
      orderIndex?: number;
      pageStart?: number | null;
      pageEnd?: number | null;
      estimatedMins?: number | null;
    },
  ): Promise<Result<ResourceRecord>> {
    if (!input.title.trim()) {
      return Err(Errors.validation('resource.title_required', 'A resource needs a title.'));
    }
    if (!(IMPORTABLE_RESOURCE_KINDS as readonly string[]).includes(input.kind)) {
      return Err(
        Errors.validation('resource.unknown_kind', 'Unknown learning resource kind.', {
          kind: input.kind,
          allowed: IMPORTABLE_RESOURCE_KINDS,
        }),
      );
    }

    const targets = [
      input.textbookKey ? { kind: 'textbook' as const, key: input.textbookKey } : null,
      input.lessonKey ? { kind: 'lesson' as const, key: input.lessonKey } : null,
      input.conceptKey ? { kind: 'concept' as const, key: input.conceptKey } : null,
    ].filter((target): target is { kind: 'textbook' | 'lesson' | 'concept'; key: string } => target !== null);

    if (targets.length === 0) {
      return Err(
        Errors.validation(
          'resource.unattached',
          'Attach the resource to a concept, lesson or textbook, or nothing will ever surface it.',
        ),
      );
    }
    if (targets.length > 1) {
      return Err(
        Errors.validation('resource.target_ambiguous', 'Choose exactly one target for a resource.', {
          targets: targets.map((target) => target.kind),
        }),
      );
    }

    if (!input.url && !input.body) {
      return Err(
        Errors.validation('resource.empty', 'A resource needs either a URL or a body.'),
      );
    }
    if (
      input.pageStart != null &&
      input.pageEnd != null &&
      input.pageStart > input.pageEnd
    ) {
      return Err(
        Errors.validation('resource.page_range_inverted', 'The first page is after the last page.', {
          pageStart: input.pageStart,
          pageEnd: input.pageEnd,
        }),
      );
    }

    const target = targets[0]!;
    const status = await this.resources.textbookStatusForResource({
      textbookKey: target.kind === 'textbook' ? target.key : null,
      lessonKey: target.kind === 'lesson' ? target.key : null,
      conceptKey: target.kind === 'concept' ? target.key : null,
    });
    if (status === null) {
      return Err(
        Errors.notFound('resource.target_not_found', 'The concept, lesson or textbook does not exist.', {
          target: target.kind,
          key: target.key,
        }),
      );
    }
    if (status === 'ARCHIVED') {
      return Err(
        Errors.conflict(
          'content.textbook_archived',
          'This textbook is archived; resources cannot be added to it.',
          { status },
        ),
      );
    }

    const slug = normalizeSlug(input.slug?.trim() ? input.slug : input.title);
    if (!slug.ok) return slug;

    const key =
      target.kind === 'concept'
        ? buildConceptResourceKey(target.key as ConceptKey, slug.value)
        : target.kind === 'lesson'
          ? buildLessonResourceKey(target.key as LessonKey, slug.value)
          : buildTextbookResourceKey(target.key as TextbookKey, slug.value);
    if (!key.ok) return key;

    const created = await this.resources.createResource({
      key: key.value,
      kind: input.kind,
      title: input.title,
      url: input.url ?? null,
      body: input.body ?? null,
      textbookKey: target.kind === 'textbook' ? target.key : null,
      lessonKey: target.kind === 'lesson' ? target.key : null,
      conceptKey: target.kind === 'concept' ? target.key : null,
      slug: slug.value,
      orderIndex: input.orderIndex ?? 0,
      pageStart: input.pageStart ?? null,
      pageEnd: input.pageEnd ?? null,
      estimatedMins: input.estimatedMins ?? null,
    });

    await this.log(ctx, 'resource.created', key.value, { kind: input.kind, target: target.kind });
    return Ok(created);
  }

  async updateResource(
    ctx: AuthorContext,
    resourceKey: string,
    fields: {
      title?: string;
      url?: string | null;
      body?: string | null;
      pageStart?: number | null;
      pageEnd?: number | null;
      estimatedMins?: number | null;
    },
  ): Promise<Result<ResourceRecord>> {
    const existing = await this.resources.findResource(resourceKey);
    if (!existing) return resourceNotFound(resourceKey);

    const pageStart = fields.pageStart !== undefined ? fields.pageStart : existing.pageStart;
    const pageEnd = fields.pageEnd !== undefined ? fields.pageEnd : existing.pageEnd;
    if (pageStart != null && pageEnd != null && pageStart > pageEnd) {
      return Err(
        Errors.validation('resource.page_range_inverted', 'The first page is after the last page.'),
      );
    }

    await this.resources.updateResource(resourceKey, fields as Record<string, unknown>);
    await this.log(ctx, 'resource.updated', resourceKey, { fields: Object.keys(fields) });

    const updated = await this.resources.findResource(resourceKey);
    return updated ? Ok(updated) : resourceNotFound(resourceKey);
  }

  /** Retire a resource. Never a delete — decision logs point at it. */
  async retireResource(ctx: AuthorContext, resourceKey: string): Promise<Result<ResourceRecord>> {
    const existing = await this.resources.findResource(resourceKey);
    if (!existing) return resourceNotFound(resourceKey);

    await this.resources.setResourceActive(resourceKey, false);
    await this.log(ctx, 'resource.retired', resourceKey);

    return Ok({ ...existing, isActive: false });
  }

  async listResourcesForConcept(conceptKey: string): Promise<Result<ResourceRecord[]>> {
    return Ok(await this.resources.listForConcept(conceptKey));
  }

  /** The book-wide shelf: resources attached to the textbook itself. */
  async listResourcesForTextbook(textbookKey: string): Promise<Result<ResourceRecord[]>> {
    const rows = await this.resources.listForTextbook(textbookKey);
    if (rows === null) {
      return Err(
        Errors.notFound('content.textbook_not_found', 'No such textbook.', { textbookKey }),
      );
    }
    return Ok(rows);
  }

  // ══ Flashcards ════════════════════════════════════════════════════════════
  //
  // Cards are content, authored against a concept, and carry no scheduling or
  // per-learner state: ordering is derived at read time from mastery the
  // learner already has. See `learning/domain/flashcard-ordering.ts`.

  async createFlashcard(
    ctx: AuthorContext,
    input: {
      conceptKey: string;
      front: string;
      back: string;
      reviewPriority?: number;
      difficulty?: number;
    },
  ): Promise<Result<FlashcardRecord>> {
    const repo = this.requireFlashcards();
    if (!repo.ok) return repo;

    if (!input.front.trim() || !input.back.trim()) {
      return Err(
        Errors.validation(
          'flashcard.incomplete',
          'A card needs both a front and a back.',
        ),
      );
    }

    const status = await repo.value.textbookStatusForConcept(input.conceptKey);
    if (status === null) {
      return Err(
        Errors.notFound('flashcard.concept_not_found', 'That concept does not exist.', {
          conceptKey: input.conceptKey,
        }),
      );
    }
    if (isStructurallyLocked(status)) {
      return Err(
        Errors.conflict(
          'content.textbook_locked',
          `This textbook is ${status.toLowerCase()}; cards cannot be added to it.`,
          { status },
        ),
      );
    }

    // Derived from the concept and the front text, so re-importing the same
    // deck is idempotent rather than duplicating every card — the same rule
    // the question bank uses.
    const key = `${input.conceptKey}-FC${stableKeyFingerprint(input.front)}`;

    const existing = await repo.value.findCard(key);
    if (existing) {
      return Err(
        Errors.conflict('flashcard.duplicate', 'This card already exists on this concept.', {
          key,
        }),
      );
    }

    const created = await repo.value.createCard({
      key,
      conceptKey: input.conceptKey,
      front: input.front,
      back: input.back,
      reviewPriority: clampUnit(input.reviewPriority ?? 0.5),
      difficulty: clampUnit(input.difficulty ?? 0.5),
    });

    await this.log(ctx, 'flashcard.created', key, { conceptKey: input.conceptKey });
    return Ok(created);
  }

  async updateFlashcard(
    ctx: AuthorContext,
    cardKey: string,
    fields: {
      front?: string;
      back?: string;
      reviewPriority?: number;
      difficulty?: number;
    },
  ): Promise<Result<FlashcardRecord>> {
    const repo = this.requireFlashcards();
    if (!repo.ok) return repo;

    const existing = await repo.value.findCard(cardKey);
    if (!existing) {
      return Err(
        Errors.notFound('flashcard.not_found', 'No card with this key.', { cardKey }),
      );
    }

    const status = await repo.value.textbookStatusForConcept(existing.conceptKey);
    if (status && isStructurallyLocked(status)) {
      return Err(
        Errors.conflict(
          'content.textbook_locked',
          `This textbook is ${status.toLowerCase()}; its cards cannot be edited.`,
          { status },
        ),
      );
    }

    const patch: Record<string, unknown> = {};
    if (fields.front !== undefined) patch.front = fields.front;
    if (fields.back !== undefined) patch.back = fields.back;
    if (fields.reviewPriority !== undefined) {
      patch.reviewPriority = clampUnit(fields.reviewPriority);
    }
    if (fields.difficulty !== undefined) patch.difficulty = clampUnit(fields.difficulty);

    if (Object.keys(patch).length === 0) {
      return Ok(existing);
    }

    await repo.value.updateCard(cardKey, patch);
    await this.log(ctx, 'flashcard.updated', cardKey);

    return Ok({ ...existing, ...(patch as Partial<FlashcardRecord>) });
  }

  /** Retire a card. Never a delete — a studied deck stays explicable. */
  async retireFlashcard(ctx: AuthorContext, cardKey: string): Promise<Result<FlashcardRecord>> {
    const repo = this.requireFlashcards();
    if (!repo.ok) return repo;

    const existing = await repo.value.findCard(cardKey);
    if (!existing) {
      return Err(Errors.notFound('flashcard.not_found', 'No card with this key.', { cardKey }));
    }

    await repo.value.setCardActive(cardKey, false);
    await this.log(ctx, 'flashcard.retired', cardKey);

    return Ok({ ...existing, isActive: false });
  }

  async listFlashcardsForConcept(conceptKey: string): Promise<Result<FlashcardRecord[]>> {
    const repo = this.requireFlashcards();
    if (!repo.ok) return repo;
    return Ok(await repo.value.listForConcept(conceptKey));
  }

  private requireFlashcards(): Result<FlashcardRepository> {
    // The dependency is optional so that every existing construction of this
    // service keeps compiling. Refusing loudly beats a silent no-op if one is
    // ever wired without it.
    if (!this.flashcards) {
      return Err(
        Errors.validation('flashcard.unavailable', 'Flashcard authoring is not configured.'),
      );
    }
    return Ok(this.flashcards);
  }

  // ══ Shared guards ═════════════════════════════════════════════════════════

  /**
   * All of a question's concepts must live in one textbook.
   *
   * A question spanning two books cannot inherit a single lifecycle, and
   * publishing one book would make it half-live.
   */
  /**
   * Refuse a distractor tagged with a misconception that is not in the
   * catalogue.
   *
   * Without this the adapter resolved the key to `null` and the write
   * succeeded: the author saw 201, the choice carried no misconception, and
   * the diagnosis chain (distractor → evidence → recompute →
   * learner_misconceptions → remediation) silently produced nothing for that
   * question forever. A typo cost the capability with no signal anywhere.
   *
   * Modelled on `resolveConceptScope` — same shape of refusal, same layer.
   * Validation belongs here and not in the adapter: the adapter maps rows,
   * the service decides what is acceptable.
   */
  private async assertMisconceptionsExist(
    choices: readonly { readonly misconceptionKey?: string | null }[],
  ): Promise<Result<void>> {
    const tagged = [
      ...new Set(choices.flatMap((c) => (c.misconceptionKey ? [c.misconceptionKey] : []))),
    ];
    if (tagged.length === 0) return Ok(undefined);

    const known = await this.questions.resolveMisconceptions(tagged);
    const missing = tagged.filter((key) => !known.includes(key));
    if (missing.length > 0) {
      return Err(
        Errors.notFound(
          'question.misconception_not_found',
          'A distractor is tagged with a misconception that does not exist.',
          { misconceptionKeys: missing },
        ),
      );
    }

    return Ok(undefined);
  }

  private async resolveConceptScope(links: readonly ConceptLink[]): Promise<Result<string>> {
    const resolved = await this.questions.resolveConcepts(links.map((l) => l.conceptKey));

    const missing = links
      .map((l) => l.conceptKey)
      .filter((key) => !resolved.some((r) => r.conceptKey === key));
    if (missing.length > 0) {
      return Err(
        Errors.notFound('question.concept_not_found', 'A linked concept does not exist.', {
          conceptKeys: missing,
        }),
      );
    }

    const books = new Set(resolved.map((r) => r.textbookKey));
    if (books.size > 1) {
      return Err(
        Errors.validation(
          'question.concepts_span_textbooks',
          'A question must measure concepts from a single textbook.',
          { textbookKeys: [...books] },
        ),
      );
    }

    return Ok([...books][0]!);
  }

  /** The book's lock, reached through a concept. */
  /**
   * The same lock, reached through the lesson rather than a concept.
   *
   * Needed because a question is now placed by lesson and may carry no
   * concept at all — the concept-scoped check below could not be asked.
   */
  private async assertLessonBankWritable(lessonKey: string): Promise<Result<void>> {
    const status = await this.questions.textbookStatusForLesson(lessonKey);
    if (status === null) {
      return Err(
        Errors.notFound('question.lesson_not_found', 'The lesson does not exist.', { lessonKey }),
      );
    }
    if (isStructurallyLocked(status)) {
      return Err(
        Errors.conflict(
          'content.textbook_locked',
          `This textbook is ${status.toLowerCase()}; its question bank is closed.`,
          { status },
        ),
      );
    }
    return Ok(undefined);
  }

  private async assertBankWritable(conceptKey: string): Promise<Result<void>> {
    const status = await this.questions.textbookStatusForConcept(conceptKey);
    if (status === null) {
      return Err(
        Errors.notFound('question.concept_not_found', 'The concept does not exist.', { conceptKey }),
      );
    }
    if (isStructurallyLocked(status)) {
      return Err(
        Errors.conflict(
          'content.textbook_locked',
          `This textbook is ${status.toLowerCase()}; its question bank is closed.`,
          { status },
        ),
      );
    }
    return Ok(undefined);
  }

  /**
   * Two independent reasons a question stops being editable.
   *
   * Publication is reversible in principle (an admin could reject a review);
   * evidence is not. Both are checked, and the evidence check is reported
   * first because it is the one that can never be undone.
   */
  private async assertQuestionMutable(question: QuestionRecord): Promise<Result<void>> {
    if (await this.questions.questionHasResponses(question.key)) {
      return Err(
        Errors.conflict(
          'question.has_responses',
          'Learners have already answered this question, so its content is frozen. Author a new version instead.',
          { questionKey: question.key },
        ),
      );
    }

    if (question.status === 'PUBLISHED' || question.status === 'ARCHIVED') {
      return Err(
        Errors.conflict(
          'question.locked',
          `A ${question.status.toLowerCase()} question cannot be rewritten.`,
          { questionKey: question.key, status: question.status },
        ),
      );
    }

    return Ok(undefined);
  }

  private async log(
    ctx: AuthorContext,
    action: string,
    targetKey: string,
    details?: Record<string, unknown>,
  ): Promise<void> {
    if (!this.audit) return;
    try {
      await this.audit.record({
        actorKey: ctx.actorKey,
        action,
        targetKey,
        ...(details ? { details } : {}),
      });
    } catch {
      // Best-effort: a lost audit line must not fail an author's write.
    }
  }
}

function questionNotFound(key: string): Result<never> {
  return Err(Errors.notFound('question.not_found', 'No question with this key.', { key }));
}

function examNotFound(key: string): Result<never> {
  return Err(Errors.notFound('exam.not_found', 'No exam with this key.', { key }));
}

/**
 * Clamp an author-supplied weight into 0..1.
 *
 * Clamped rather than rejected: a priority of 5 is a plausible thing for an
 * author to type and means "very important", so honouring the intent beats
 * refusing the card. It cannot promote across tiers in any case — ordering
 * bands by mastery first, and priority only breaks ties inside a band.
 */
function clampUnit(n: number): number {
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}

function resourceNotFound(key: string): Result<never> {
  return Err(Errors.notFound('resource.not_found', 'No resource with this key.', { key }));
}
