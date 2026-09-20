/**
 * Question authoring rules — PURE.
 *
 * The rule this file exists for:
 *
 *     A PUBLISHED QUESTION MUST BE GRADABLE.
 *
 * `evaluateAnswer` can return `UNGRADABLE` — "this answer key cannot decide
 * this answer". That verdict is correct defensive behaviour at grading time,
 * but by then it is far too late: a learner has already spent effort on an
 * item that cannot score them, and an adaptive exam has already spent one of
 * its 25 slots. Legacy discovered these in production, one attempt at a time,
 * because nothing checked the key until someone answered it.
 *
 * So every refusal below is an `UNGRADABLE` (or a silently wrong grade) moved
 * from run time to authoring time. The check is exhaustive over QuestionType
 * for the same reason: a new type must not be publishable until someone has
 * decided what a valid key for it looks like.
 */

import { Errors } from '../../../shared/kernel/errors.js';
import { Err, Ok, type Result } from '../../../shared/kernel/result.js';

/**
 * Mirrors `QuestionType` in the schema and in Assessment's evaluator.
 *
 * Named and exhaustively switched rather than imported so that adding a type
 * in one place produces a compile error here instead of a silent gap.
 */
export const QUESTION_TYPES = [
  'MCQ_SINGLE',
  'MCQ_MULTI',
  'TRUE_FALSE',
  'NUMERIC',
  'SHORT_TEXT',
  'FILL_BLANK',
  'MATCHING',
  'ORDERING',
  'ESSAY',
] as const;

export type QuestionType = (typeof QUESTION_TYPES)[number];

export function isQuestionType(value: string): value is QuestionType {
  return (QUESTION_TYPES as readonly string[]).includes(value);
}

/** A choice as the author wrote it. `id` is the author's local handle. */
export interface DraftChoice {
  readonly id: string;
  readonly text: string;
  readonly misconceptionKey?: string | null;
  readonly feedback?: string | null;
}

/** The answer key as the author wrote it, before it is trusted. */
export interface DraftAnswerKey {
  readonly correctChoiceIds?: readonly string[];
  readonly acceptedTexts?: readonly string[];
  readonly numericMin?: number | null;
  readonly numericMax?: number | null;
  readonly expectedOrder?: readonly string[];
  readonly expectedPairs?: Readonly<Record<string, string>> | null;
  readonly caseSensitive?: boolean;
  readonly allowPartialCredit?: boolean;
  readonly rubric?: unknown;
}

export interface DraftQuestion {
  readonly type: QuestionType;
  readonly text: string;
  readonly choices: readonly DraftChoice[];
  readonly answerKey: DraftAnswerKey;
  readonly points?: number;
  readonly difficulty01?: number;
}

/** One thing wrong with a draft, in the author's terms. */
export interface AuthoringIssue {
  readonly code: string;
  readonly message: string;
  readonly field: string;
}

const CHOICE_BASED: ReadonlySet<QuestionType> = new Set([
  'MCQ_SINGLE',
  'MCQ_MULTI',
  'TRUE_FALSE',
]);

/** Does this type present a fixed list of options to the learner? */
export function usesChoices(type: QuestionType): boolean {
  return CHOICE_BASED.has(type);
}

/**
 * Is this item gradable without a human?
 *
 * ESSAY is the sole exception, and it is an explicit one: the evaluator
 * returns REQUIRES_MANUAL_REVIEW rather than a score. Treating that as an
 * authoring failure would ban essays; treating every other UNGRADABLE as
 * acceptable would ban nothing.
 */
export function isAutoGradable(type: QuestionType): boolean {
  return type !== 'ESSAY';
}

/**
 * Validate a draft question against its own type.
 *
 * Returns every problem rather than the first, because an author fixing a
 * question one error per round trip is an author who stops using the tool.
 */
export function validateQuestion(draft: DraftQuestion): readonly AuthoringIssue[] {
  const issues: AuthoringIssue[] = [];
  const key = draft.answerKey;

  if (!draft.text.trim()) {
    issues.push({
      code: 'question.text_required',
      message: 'A question needs a stem.',
      field: 'text',
    });
  }

  if (draft.points !== undefined && (!Number.isInteger(draft.points) || draft.points < 1)) {
    issues.push({
      code: 'question.points_invalid',
      message: 'Points must be a whole number of at least 1.',
      field: 'points',
    });
  }

  if (
    draft.difficulty01 !== undefined &&
    (!Number.isFinite(draft.difficulty01) || draft.difficulty01 < 0 || draft.difficulty01 > 1)
  ) {
    issues.push({
      code: 'question.difficulty_out_of_range',
      message: 'Authored difficulty is a proportion between 0 and 1.',
      field: 'difficulty01',
    });
  }

  issues.push(...validateChoices(draft));
  issues.push(...validateKeyForType(draft, key));

  return issues;
}

function validateChoices(draft: DraftQuestion): readonly AuthoringIssue[] {
  const issues: AuthoringIssue[] = [];
  const { type, choices } = draft;

  if (!usesChoices(type)) {
    // A stray choice list on a NUMERIC item is a copy-paste error, and the
    // learner would never be shown it — better to say so than to store it.
    if (choices.length > 0) {
      issues.push({
        code: 'question.choices_not_allowed',
        message: `A ${type} question is not answered by picking from a list.`,
        field: 'choices',
      });
    }
    return issues;
  }

  const minimum = type === 'TRUE_FALSE' ? 2 : 2;
  if (choices.length < minimum) {
    issues.push({
      code: 'question.too_few_choices',
      message: `A ${type} question needs at least ${minimum} options.`,
      field: 'choices',
    });
  }

  if (type === 'TRUE_FALSE' && choices.length > 2) {
    issues.push({
      code: 'question.too_many_choices',
      message: 'A true/false question has exactly two options.',
      field: 'choices',
    });
  }

  const seen = new Set<string>();
  for (const choice of choices) {
    if (!choice.text.trim()) {
      issues.push({
        code: 'question.choice_text_required',
        message: 'Every option needs text.',
        field: `choices.${choice.id}`,
      });
    }
    if (seen.has(choice.id)) {
      issues.push({
        code: 'question.duplicate_choice_id',
        message: `Two options share the id "${choice.id}".`,
        field: 'choices',
      });
    }
    seen.add(choice.id);
  }

  return issues;
}

/**
 * The exhaustive part: what a valid key looks like, per type.
 *
 * Each branch answers one question — "given this key, can the evaluator reach
 * a verdict for every possible answer?" Where it cannot, the author hears
 * about it now.
 */
function validateKeyForType(
  draft: DraftQuestion,
  key: DraftAnswerKey,
): readonly AuthoringIssue[] {
  const issues: AuthoringIssue[] = [];
  const choiceIds = new Set(draft.choices.map((c) => c.id));

  switch (draft.type) {
    case 'MCQ_SINGLE':
    case 'TRUE_FALSE': {
      const correct = key.correctChoiceIds ?? [];
      if (correct.length === 0) {
        issues.push(missingKey('correctChoiceIds', 'Mark exactly one option correct.'));
      } else if (correct.length > 1) {
        issues.push({
          code: 'question.multiple_correct_for_single',
          message: 'This type accepts exactly one correct option; use MCQ_MULTI for more.',
          field: 'answerKey.correctChoiceIds',
        });
      }
      issues.push(...unknownChoiceRefs(correct, choiceIds));

      // Every option correct means the item measures nothing.
      if (correct.length > 0 && correct.length === draft.choices.length) {
        issues.push(everyOptionCorrect());
      }
      break;
    }

    case 'MCQ_MULTI': {
      const correct = key.correctChoiceIds ?? [];
      if (correct.length === 0) {
        issues.push(missingKey('correctChoiceIds', 'Mark at least one option correct.'));
      }
      issues.push(...unknownChoiceRefs(correct, choiceIds));
      if (correct.length > 0 && correct.length === draft.choices.length) {
        issues.push(everyOptionCorrect());
      }
      if (new Set(correct).size !== correct.length) {
        issues.push({
          code: 'question.duplicate_correct_choice',
          message: 'An option is marked correct twice.',
          field: 'answerKey.correctChoiceIds',
        });
      }
      break;
    }

    case 'NUMERIC': {
      const { numericMin: min, numericMax: max } = key;
      if (min == null || max == null) {
        // The evaluator's exact `numeric_range_missing_bounds` UNGRADABLE.
        issues.push(
          missingKey(
            'numericRange',
            'Give an accepted range. A single exact value is a range with equal bounds.',
          ),
        );
      } else if (!Number.isFinite(min) || !Number.isFinite(max)) {
        issues.push({
          code: 'question.numeric_bound_invalid',
          message: 'Numeric bounds must be finite numbers.',
          field: 'answerKey.numericRange',
        });
      } else if (min > max) {
        issues.push({
          code: 'question.numeric_range_inverted',
          message: 'The lower bound is above the upper bound, so nothing can be correct.',
          field: 'answerKey.numericRange',
        });
      }
      break;
    }

    case 'SHORT_TEXT':
    case 'FILL_BLANK': {
      const accepted = (key.acceptedTexts ?? []).filter((t) => t.trim() !== '');
      if (accepted.length === 0) {
        issues.push(missingKey('acceptedTexts', 'List at least one accepted answer.'));
      }
      break;
    }

    case 'ORDERING': {
      const order = key.expectedOrder ?? [];
      if (order.length < 2) {
        issues.push(
          missingKey('expectedOrder', 'An ordering question needs at least two items in sequence.'),
        );
      }
      if (new Set(order).size !== order.length) {
        issues.push({
          code: 'question.duplicate_ordered_item',
          message: 'The expected order lists the same item twice.',
          field: 'answerKey.expectedOrder',
        });
      }
      break;
    }

    case 'MATCHING': {
      const pairs = key.expectedPairs ?? {};
      if (Object.keys(pairs).length === 0) {
        issues.push(missingKey('expectedPairs', 'A matching question needs at least one pair.'));
      }
      for (const [left, right] of Object.entries(pairs)) {
        if (!String(right ?? '').trim()) {
          issues.push({
            code: 'question.unmatched_pair',
            message: `"${left}" has nothing to match with.`,
            field: 'answerKey.expectedPairs',
          });
        }
      }
      break;
    }

    case 'ESSAY': {
      // No auto-grading, so no key to validate. A rubric is what makes the
      // manual (or AI-assisted) review consistent, so its absence is worth
      // saying — but it is not a refusal, because a teacher marking by hand
      // needs no rubric row in the database.
      break;
    }
  }

  return issues;
}

function missingKey(field: string, message: string): AuthoringIssue {
  return { code: 'question.answer_key_incomplete', message, field: `answerKey.${field}` };
}

function everyOptionCorrect(): AuthoringIssue {
  return {
    code: 'question.no_distractors',
    message: 'Every option is marked correct, so the question cannot distinguish anything.',
    field: 'answerKey.correctChoiceIds',
  };
}

function unknownChoiceRefs(
  referenced: readonly string[],
  known: ReadonlySet<string>,
): readonly AuthoringIssue[] {
  return referenced
    .filter((id) => !known.has(id))
    .map((id) => ({
      code: 'question.unknown_choice_reference',
      message: `The answer key names option "${id}", which is not one of the options.`,
      field: 'answerKey.correctChoiceIds',
    }));
}

/**
 * Concept linkage — what a question is evidence *about*.
 *
 * This is the join that makes an answer mean something: without it a correct
 * response updates no mastery and the adaptive engine cannot select the item.
 * An unlinked question is not a question, it is a quiz curiosity.
 */
export interface ConceptLink {
  readonly conceptKey: string;
  readonly weight: number;
  readonly isPrimary: boolean;
}

export function validateConceptLinks(links: readonly ConceptLink[]): readonly AuthoringIssue[] {
  const issues: AuthoringIssue[] = [];

  // No links is ALLOWED, and is not the same as invalid.
  //
  // A question's placement (its lesson) is mandatory and recorded separately.
  // Its diagnosis (which concept it measures) is an authoring judgement that
  // may still be pending — most obviously for a bank imported from elsewhere.
  // Refusing to store such an item would mean the only way to hold it is to
  // invent a concept link, which is worse: a wrong link silently corrupts
  // mastery, whereas a missing one is visible and fixable.
  //
  // The consequence is enforced elsewhere rather than here: an unlinked item
  // produces no mastery evidence and `checkQuestionPublishable` refuses it, so
  // it cannot reach a learner while still undiagnosed.
  if (links.length === 0) return issues;

  const seen = new Set<string>();
  for (const link of links) {
    if (seen.has(link.conceptKey)) {
      issues.push({
        code: 'question.duplicate_concept_link',
        message: `The question is linked to ${link.conceptKey} twice.`,
        field: 'concepts',
      });
    }
    seen.add(link.conceptKey);

    if (!Number.isFinite(link.weight) || link.weight <= 0 || link.weight > 1) {
      issues.push({
        code: 'question.link_weight_out_of_range',
        message: 'Evidence weight is a proportion in (0, 1].',
        field: `concepts.${link.conceptKey}.weight`,
      });
    }
  }

  const primaries = links.filter((l) => l.isPrimary);
  if (primaries.length === 0) {
    issues.push({
      code: 'question.no_primary_concept',
      message: 'Exactly one linked concept must be the primary one this question is about.',
      field: 'concepts',
    });
  } else if (primaries.length > 1) {
    // Adaptive selection asks "what is this item for?" and needs one answer.
    issues.push({
      code: 'question.multiple_primary_concepts',
      message: 'Only one concept can be primary; the others carry partial weight.',
      field: 'concepts',
    });
  }

  return issues;
}

/**
 * The publication gate for a single question.
 *
 * Draft questions may be incomplete — that is what a draft is for. This is the
 * check that runs when someone tries to make it live, and it is the last
 * moment at which an ungradable item can be stopped.
 */
export function checkQuestionPublishable(
  draft: DraftQuestion,
  links: readonly ConceptLink[],
): Result<void> {
  const issues = [...validateQuestion(draft), ...validateConceptLinks(links)];

  // Storing an unlinked question is allowed; publishing one is not.
  //
  // `validateConceptLinks` deliberately tolerates zero links, because a bank
  // may hold items whose diagnosis is still pending. That tolerance must stop
  // exactly here: a published item with no concept can be answered but can
  // never update mastery, so it silently costs the learner effort and returns
  // nothing. The two rules read as one sentence — an item may WAIT undiagnosed,
  // it may not GO LIVE undiagnosed.
  if (links.length === 0) {
    issues.push({
      code: 'question.no_concept_link',
      message:
        'Link the question to at least one concept before publishing, or answering it can never update mastery.',
      field: 'concepts',
    });
  }

  if (issues.length === 0) return Ok(undefined);

  return Err(
    Errors.validation(
      'question.not_publishable',
      'This question is not ready to publish.',
      { issues },
    ),
  );
}

/**
 * Provenance — where a question came from, as opposed to what it is about.
 *
 * The distinction this encodes:
 *
 *     ALIGNMENT IS NOT ORIGIN.
 *
 * A teacher's question and an AI's question can both be aligned to the same
 * lesson and concept as a question printed in the textbook. All three are
 * legitimately "about" that lesson. Only one of them is book content, and a
 * teacher browsing the bank has to be able to tell which.
 *
 * Import is deliberately NOT an origin. Importing is how a question entered
 * Edu7, not where it came from: a textbook question imported from a file is
 * still TEXTBOOK. The importer states the real origin.
 *
 * `UNKNOWN` is a first-class value, not a failure. Historical rows whose
 * provenance cannot be established stay UNKNOWN rather than being guessed into
 * TEXTBOOK because they happen to be aligned to a textbook lesson.
 *
 * CRITICAL BOUNDARY: this is descriptive metadata. It may drive bank filtering,
 * provenance display and reporting. It must NEVER be read as a rule inside
 * adaptive selection, remediation, mastery or any learning decision. "Exclude
 * textbook exercises from practice" is a pedagogical policy and belongs to
 * Learning/Assessment, not to a repository quietly filtering on a column.
 */
export const QUESTION_ORIGINS = ['TEXTBOOK', 'TEACHER', 'MINISTERIAL', 'AI', 'UNKNOWN'] as const;
export type QuestionOrigin = (typeof QUESTION_ORIGINS)[number];

/** Who may see and reuse a question before it joins the official bank. */
export const QUESTION_VISIBILITIES = ['PRIVATE', 'SCHOOL', 'SUBMITTED_FOR_REVIEW', 'GLOBAL'] as const;
export type QuestionVisibility = (typeof QUESTION_VISIBILITIES)[number];

/** What an original textbook question was printed as. */
export const TEXTBOOK_QUESTION_ROLES = ['EXERCISE', 'SELF_TEST', 'REVIEW', 'OTHER'] as const;
export type TextbookQuestionRole = (typeof TEXTBOOK_QUESTION_ROLES)[number];

export interface ProvenanceDraft {
  readonly origin?: QuestionOrigin | undefined;
  readonly textbookRole?: TextbookQuestionRole | null | undefined;
}

export interface Provenance {
  readonly origin: QuestionOrigin;
  readonly textbookRole: TextbookQuestionRole | null;
}

/**
 * The one invariant: a printed role only exists for printed questions.
 *
 * Without this, `origin = AI, textbookRole = EXERCISE` is storable, and it
 * asserts something false — that an AI-written item is an exercise from the
 * book. Silently nulling the role instead would hide the author's mistake, and
 * this project has just finished removing one silent-null defect from this
 * exact file's neighbourhood.
 */
export function resolveProvenance(draft: ProvenanceDraft): Result<Provenance> {
  const origin: QuestionOrigin = draft.origin ?? 'UNKNOWN';
  const role = draft.textbookRole ?? null;

  if (role !== null && origin !== 'TEXTBOOK') {
    return Err(
      Errors.validation(
        'question.textbook_role_requires_textbook_origin',
        'Only a question printed in the textbook can have a textbook role.',
        { origin, textbookRole: role },
      ),
    );
  }

  return Ok({ origin, textbookRole: role });
}
