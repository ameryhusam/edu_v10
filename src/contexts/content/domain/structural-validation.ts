/**
 * Structural validation — PURE.
 *
 * Runs on DRAFT → IN_REVIEW, so a textbook cannot reach review in a state that
 * would break the learning engines at runtime.
 *
 * These checks are about Edu7's own ingested copy — is it complete and
 * internally consistent enough to teach from? They are NOT a judgement on the
 * textbook as a published work: that approval belongs to the ministry or
 * publisher and happens before the book ever reaches Edu7. Adopted from legacy's per-layer
 * review gate (`textbook-content-review.service.ts`), which required unit,
 * lesson and concept layers to be non-empty before publication.
 *
 * Every failure is returned, never just the first. An author who fixes one
 * error per submit is a workflow that wastes their afternoon.
 */

import { detectCycles, type PrerequisiteEdge } from '../../learning/domain/prerequisite-graph.js';

/** Layers legacy reviewed. The first three are required to publish. */
export const CONTENT_LAYERS = [
  'unit',
  'lesson',
  'concept',
  'remedial',
  'misconception',
  'question',
] as const;

export type ContentLayer = (typeof CONTENT_LAYERS)[number];

/** Layers that must be non-empty before content can be served to learners. */
export const REQUIRED_LAYERS: readonly ContentLayer[] = ['unit', 'lesson', 'concept'];

export interface ValidationIssue {
  /** Stable code — switch on this, never on the message. */
  readonly code: string;
  readonly message: string;
  /** Canonical key of the offending node, when one applies. */
  readonly at?: string;
  readonly details?: Record<string, unknown>;
}

/** A flattened view of the tree, as the validator needs it. */
export interface ContentNode {
  readonly key: string;
  readonly parentKey: string | null;
  readonly orderIndex: number;
  readonly isActive: boolean;
}

export interface ConceptNode extends ContentNode {
  readonly masteryThreshold: number;
}

export interface LessonSupportNode {
  readonly lessonKey: string;
  readonly activeResourceCount: number;
  readonly readingResourceCount: number;
}

export interface ConceptSupportNode {
  readonly conceptKey: string;
  readonly publishedQuestionCount: number;
  readonly autoGradableQuestionCount: number;
  readonly flashcardCount: number;
  readonly remedialResourceCount: number;
}

export interface UnlinkedQuestionNode {
  readonly questionKey: string;
  readonly lessonKey: string;
}

export interface TextbookStructure {
  readonly textbookKey: string;
  readonly units: readonly ContentNode[];
  readonly lessons: readonly ContentNode[];
  readonly concepts: readonly ConceptNode[];
  readonly prerequisites: readonly PrerequisiteEdge[];
  /** Authoring-quality support needed before a learner can study the structure. */
  readonly lessonSupport: readonly LessonSupportNode[];
  readonly conceptSupport: readonly ConceptSupportNode[];
  readonly unlinkedQuestions: readonly UnlinkedQuestionNode[];
}

const inRange = (n: number, lo: number, hi: number): boolean =>
  Number.isFinite(n) && n >= lo && n <= hi;

const MIN_AUTO_GRADABLE_CAT_ITEMS = 1;

/**
 * Order indexes must be 1..n with no gaps and no duplicates, per parent.
 *
 * Gaps and duplicates are how display order silently diverges from stored
 * order — two concepts at index 3 render in whatever order the database
 * happens to return, which is not stable between queries.
 */
function checkOrdering(nodes: readonly ContentNode[], layer: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const byParent = new Map<string, ContentNode[]>();

  for (const node of nodes) {
    const parent = node.parentKey ?? '__root__';
    const siblings = byParent.get(parent);
    if (siblings) siblings.push(node);
    else byParent.set(parent, [node]);
  }

  for (const [parent, siblings] of byParent) {
    const seen = new Map<number, string>();
    for (const node of siblings) {
      const duplicate = seen.get(node.orderIndex);
      if (duplicate) {
        issues.push({
          code: 'content.duplicate_order_index',
          message: `Two ${layer}s share order index ${node.orderIndex}; display order would be arbitrary.`,
          at: node.key,
          details: { parent, conflictsWith: duplicate, orderIndex: node.orderIndex },
        });
      } else {
        seen.set(node.orderIndex, node.key);
      }
    }

    const ordered = [...seen.keys()].sort((a, b) => a - b);
    for (let i = 0; i < ordered.length; i += 1) {
      const expected = i + 1;
      if (ordered[i] !== expected) {
        issues.push({
          code: 'content.non_contiguous_order',
          message: `${layer} order indexes must run 1..n with no gaps; expected ${expected} but found ${ordered[i]}.`,
          at: seen.get(ordered[i]!),
          details: { parent, expected, found: ordered[i] },
        });
        break; // One report per parent; listing every subsequent shift is noise.
      }
    }
  }

  return issues;
}

/**
 * Is this textbook structurally publishable?
 *
 * Pure: takes a flattened structure, returns every problem found.
 */
export function validateStructure(structure: TextbookStructure): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { units, lessons, concepts, prerequisites, lessonSupport, conceptSupport, unlinkedQuestions } = structure;

  // ── 1. Required layers are non-empty (legacy REQUIRED_LAYERS) ─────────────
  if (units.length === 0) {
    issues.push({
      code: 'content.no_units',
      message: 'A textbook must contain at least one unit before it can be made available.',
    });
  }
  if (lessons.length === 0) {
    issues.push({
      code: 'content.no_lessons',
      message: 'A textbook must contain at least one lesson before it can be made available.',
    });
  }
  if (concepts.length === 0) {
    issues.push({
      code: 'content.no_concepts',
      message: 'A textbook must contain at least one concept before it can be made available.',
    });
  }

  // ── 2. Ordering is contiguous per parent ──────────────────────────────────
  issues.push(...checkOrdering(units, 'unit'));
  issues.push(...checkOrdering(lessons, 'lesson'));
  issues.push(...checkOrdering(concepts, 'concept'));

  // ── 3. Pedagogical ranges ─────────────────────────────────────────────────
  for (const concept of concepts) {
    if (!(concept.masteryThreshold > 0 && concept.masteryThreshold <= 1)) {
      issues.push({
        code: 'content.mastery_threshold_out_of_range',
        message: 'Mastery threshold must be greater than 0 and at most 1.',
        at: concept.key,
        details: { masteryThreshold: concept.masteryThreshold },
      });
    }
  }

  // ── 4. Prerequisite edges ─────────────────────────────────────────────────
  const conceptKeys = new Set(concepts.map((c) => c.key));

  for (const edge of prerequisites) {
    if (edge.conceptKey === edge.prerequisiteKey) {
      issues.push({
        code: 'content.self_prerequisite',
        message: 'A concept cannot be its own prerequisite.',
        at: edge.conceptKey,
      });
      continue;
    }
    // Scope: legacy rule LD-2 — a named refusal before any write.
    if (!conceptKeys.has(edge.conceptKey) || !conceptKeys.has(edge.prerequisiteKey)) {
      issues.push({
        code: 'content.prerequisite_out_of_scope',
        message: 'A prerequisite must reference a concept in the same textbook.',
        at: edge.conceptKey,
        details: { prerequisiteKey: edge.prerequisiteKey },
      });
    }
    if (!inRange(edge.strength, 0, 1)) {
      issues.push({
        code: 'content.strength_out_of_range',
        message: 'Prerequisite strength must be between 0 and 1.',
        at: edge.conceptKey,
        details: { strength: edge.strength },
      });
    }
    if (!inRange(edge.requiredMastery, 0, 1)) {
      issues.push({
        code: 'content.required_mastery_out_of_range',
        message: 'Prerequisite required mastery must be between 0 and 1.',
        at: edge.conceptKey,
        details: { requiredMastery: edge.requiredMastery },
      });
    }
  }

  // ── 5. No cycles — reuses the tested implementation, never a second one ───
  for (const cycle of detectCycles(prerequisites)) {
    issues.push({
      code: 'content.prerequisite_cycle',
      message:
        'Prerequisites form a cycle, so no learner could ever start this chain. Break the loop.',
      at: cycle[0],
      details: { cycle },
    });
  }

  // ── 6. No orphans under an inactive parent ────────────────────────────────
  const inactiveUnits = new Set(units.filter((u) => !u.isActive).map((u) => u.key));
  const inactiveLessons = new Set(lessons.filter((l) => !l.isActive).map((l) => l.key));

  for (const lesson of lessons) {
    if (lesson.isActive && lesson.parentKey && inactiveUnits.has(lesson.parentKey)) {
      issues.push({
        code: 'content.active_child_of_inactive_parent',
        message: 'An active lesson cannot sit under an inactive unit; learners could never reach it.',
        at: lesson.key,
        details: { parentKey: lesson.parentKey },
      });
    }
  }
  for (const concept of concepts) {
    if (concept.isActive && concept.parentKey && inactiveLessons.has(concept.parentKey)) {
      issues.push({
        code: 'content.active_child_of_inactive_parent',
        message: 'An active concept cannot sit under an inactive lesson; learners could never reach it.',
        at: concept.key,
        details: { parentKey: concept.parentKey },
      });
    }
  }

  // ── 7. Runtime support: lessons teach; concepts can be assessed/reviewed ─
  const lessonSupportByKey = new Map(lessonSupport.map((support) => [support.lessonKey, support]));
  for (const lesson of lessons.filter((candidate) => candidate.isActive)) {
    const support = lessonSupportByKey.get(lesson.key);
    if (!support || support.activeResourceCount === 0) {
      issues.push({
        code: 'content.lesson_no_resources',
        message: 'An active lesson needs at least one authored resource before learners open it.',
        at: lesson.key,
      });
    }
    if (!support || support.readingResourceCount === 0) {
      issues.push({
        code: 'content.lesson_no_reading',
        message: 'An active lesson needs a reading resource so the lesson page is not empty.',
        at: lesson.key,
      });
    }
  }

  const conceptSupportByKey = new Map(
    conceptSupport.map((support) => [support.conceptKey, support]),
  );
  for (const concept of concepts.filter((candidate) => candidate.isActive)) {
    const support = conceptSupportByKey.get(concept.key);
    if (!support || support.publishedQuestionCount === 0) {
      issues.push({
        code: 'content.concept_no_published_questions',
        message: 'An active concept needs at least one published question linked to it.',
        at: concept.key,
      });
    }
    if (!support || support.autoGradableQuestionCount < MIN_AUTO_GRADABLE_CAT_ITEMS) {
      issues.push({
        code: 'content.concept_no_cat_pool',
        message: 'An active concept needs at least one auto-gradable published question for CAT.',
        at: concept.key,
        details: { minimum: MIN_AUTO_GRADABLE_CAT_ITEMS, found: support?.autoGradableQuestionCount ?? 0 },
      });
    }
    if (
      (!support || support.publishedQuestionCount === 0) &&
      (support?.flashcardCount ?? 0) === 0 &&
      (support?.remedialResourceCount ?? 0) === 0
    ) {
      issues.push({
        code: 'content.concept_no_practice_fallback',
        message: 'A concept with no published assessment items needs flashcards or remedial material as a fallback.',
        at: concept.key,
      });
    }
  }

  for (const question of unlinkedQuestions) {
    issues.push({
      code: 'content.question_without_concept_link',
      message: 'A question in this textbook is not linked to any concept, so it cannot produce mastery evidence.',
      at: question.questionKey,
      details: { lessonKey: question.lessonKey },
    });
  }

  return issues;
}

/** Convenience: legacy's `readyForPublish`. */
export function isReadyToPublish(structure: TextbookStructure): boolean {
  return validateStructure(structure).length === 0;
}
