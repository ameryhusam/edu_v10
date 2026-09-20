/**
 * Structural validation — the gate a textbook passes on DRAFT → IN_REVIEW.
 *
 * The point is that content which would break the learning engines at runtime
 * cannot reach review at all.
 */

import { describe, expect, it } from 'vitest';
import {
  REQUIRED_LAYERS,
  isReadyToPublish,
  validateStructure,
  type ConceptNode,
  type ContentNode,
  type TextbookStructure,
} from '../../src/contexts/content/domain/structural-validation.js';
import type { PrerequisiteEdge } from '../../src/contexts/learning/domain/prerequisite-graph.js';

const TB = 'EDU-MATH-G07-T1-ED2026';
const U1 = `${TB}-U-SETS`;
const L1 = `${U1}-L-BASICS`;
const C = (slug: string) => `${L1}-C-${slug}`;

const node = (key: string, parentKey: string | null, orderIndex: number, isActive = true): ContentNode => ({
  key,
  parentKey,
  orderIndex,
  isActive,
});

const concept = (slug: string, orderIndex: number, over: Partial<ConceptNode> = {}): ConceptNode => ({
  key: C(slug),
  parentKey: L1,
  orderIndex,
  isActive: true,
  masteryThreshold: 0.85,
  ...over,
});

const lessonSupport = (lessonKey: string) => ({
  lessonKey,
  activeResourceCount: 1,
  readingResourceCount: 1,
});

const conceptSupport = (conceptKey: string) => ({
  conceptKey,
  publishedQuestionCount: 1,
  autoGradableQuestionCount: 1,
  flashcardCount: 1,
  remedialResourceCount: 0,
});

const edge = (conceptSlug: string, prereqSlug: string, over: Partial<PrerequisiteEdge> = {}): PrerequisiteEdge => ({
  conceptKey: C(conceptSlug),
  prerequisiteKey: C(prereqSlug),
  strength: 1,
  requiredMastery: 0.7,
  ...over,
});

/** A minimal textbook that should pass cleanly. */
const valid = (): TextbookStructure => ({
  textbookKey: TB,
  units: [node(U1, null, 1)],
  lessons: [node(L1, U1, 1)],
  concepts: [concept('SET', 1), concept('UNION', 2)],
  prerequisites: [edge('UNION', 'SET')],
  lessonSupport: [lessonSupport(L1)],
  conceptSupport: [conceptSupport(C('SET')), conceptSupport(C('UNION'))],
  unlinkedQuestions: [],
});

const codes = (s: TextbookStructure) => validateStructure(s).map((i) => i.code);

describe('a well-formed textbook', () => {
  it('passes', () => {
    expect(validateStructure(valid())).toEqual([]);
    expect(isReadyToPublish(valid())).toBe(true);
  });

  it('exposes the layers legacy required', () => {
    expect(REQUIRED_LAYERS).toEqual(['unit', 'lesson', 'concept']);
  });
});

describe('required layers must be non-empty', () => {
  it('refuses a textbook with no units, lessons or concepts', () => {
    const empty: TextbookStructure = {
      textbookKey: TB,
      units: [],
      lessons: [],
      concepts: [],
      prerequisites: [],
      lessonSupport: [],
      conceptSupport: [],
      unlinkedQuestions: [],
    };

    expect(codes(empty)).toEqual(
      expect.arrayContaining(['content.no_units', 'content.no_lessons', 'content.no_concepts']),
    );
  });

  it('reports ALL missing layers at once, not just the first', () => {
    // An author fixing one error per submit is a workflow that wastes an
    // afternoon.
    const empty: TextbookStructure = {
      textbookKey: TB,
      units: [],
      lessons: [],
      concepts: [],
      prerequisites: [],
      lessonSupport: [],
      conceptSupport: [],
      unlinkedQuestions: [],
    };

    expect(validateStructure(empty).length).toBeGreaterThanOrEqual(3);
  });
});

describe('ordering', () => {
  it('refuses duplicate order indexes among siblings', () => {
    const s = valid();
    const broken = { ...s, concepts: [concept('SET', 1), concept('UNION', 1)] };

    expect(codes(broken)).toContain('content.duplicate_order_index');
  });

  it('refuses gaps', () => {
    const s = valid();
    const broken = { ...s, concepts: [concept('SET', 1), concept('UNION', 3)] };

    expect(codes(broken)).toContain('content.non_contiguous_order');
  });

  it('scopes ordering to siblings — two lessons may each have a concept at index 1', () => {
    const L2 = `${U1}-L-ADVANCED`;
    const s: TextbookStructure = {
      textbookKey: TB,
      units: [node(U1, null, 1)],
      lessons: [node(L1, U1, 1), node(L2, U1, 2)],
      concepts: [
        concept('SET', 1),
        { ...concept('VENN', 1), key: `${L2}-C-VENN`, parentKey: L2 },
      ],
      prerequisites: [],
      lessonSupport: [lessonSupport(L1), lessonSupport(L2)],
      conceptSupport: [conceptSupport(C('SET')), conceptSupport(`${L2}-C-VENN`)],
      unlinkedQuestions: [],
    };

    expect(validateStructure(s)).toEqual([]);
  });
});

describe('prerequisites', () => {
  it('refuses a cycle', () => {
    // A → B → A means no learner can ever start; decideNextActivity would not
    // terminate.
    const s = valid();
    const broken = { ...s, prerequisites: [edge('UNION', 'SET'), edge('SET', 'UNION')] };

    const issues = validateStructure(broken);
    expect(issues.map((i) => i.code)).toContain('content.prerequisite_cycle');
    expect(issues.find((i) => i.code === 'content.prerequisite_cycle')?.details).toHaveProperty('cycle');
  });

  it('refuses a self-prerequisite', () => {
    const s = valid();
    const broken = { ...s, prerequisites: [edge('SET', 'SET')] };

    expect(codes(broken)).toContain('content.self_prerequisite');
  });

  it('refuses a prerequisite outside this textbook (legacy LD-2)', () => {
    const s = valid();
    const broken = {
      ...s,
      prerequisites: [
        { ...edge('SET', 'SET'), prerequisiteKey: 'EDU-SCI-G07-T1-ED2026-U-X-L-Y-C-Z' },
      ],
    };

    expect(codes(broken)).toContain('content.prerequisite_out_of_scope');
  });

  it('refuses out-of-range strength and requiredMastery', () => {
    const s = valid();
    const broken = {
      ...s,
      prerequisites: [edge('UNION', 'SET', { strength: 1.5, requiredMastery: -0.2 })],
    };

    expect(codes(broken)).toEqual(
      expect.arrayContaining([
        'content.strength_out_of_range',
        'content.required_mastery_out_of_range',
      ]),
    );
  });
});

describe('pedagogical ranges', () => {
  it('refuses a mastery threshold of 0 or above 1', () => {
    const s = valid();

    expect(codes({ ...s, concepts: [concept('SET', 1, { masteryThreshold: 0 })] })).toContain(
      'content.mastery_threshold_out_of_range',
    );
    expect(codes({ ...s, concepts: [concept('SET', 1, { masteryThreshold: 1.2 })] })).toContain(
      'content.mastery_threshold_out_of_range',
    );
  });

  it('accepts a threshold of exactly 1', () => {
    const s = valid();
    const strict = { ...s, concepts: [concept('SET', 1, { masteryThreshold: 1 })], prerequisites: [] };

    expect(codes(strict)).not.toContain('content.mastery_threshold_out_of_range');
  });
});

describe('authoring support readiness', () => {
  it('reports an active lesson with no reading or material', () => {
    const s = valid();
    const broken = { ...s, lessonSupport: [{ lessonKey: L1, activeResourceCount: 0, readingResourceCount: 0 }] };

    expect(codes(broken)).toEqual(
      expect.arrayContaining(['content.lesson_no_resources', 'content.lesson_no_reading']),
    );
  });

  it('reports concepts that cannot be assessed or reviewed safely', () => {
    const s = valid();
    const broken = {
      ...s,
      conceptSupport: [
        {
          conceptKey: C('SET'),
          publishedQuestionCount: 0,
          autoGradableQuestionCount: 0,
          flashcardCount: 0,
          remedialResourceCount: 0,
        },
        conceptSupport(C('UNION')),
      ],
    };

    expect(codes(broken)).toEqual(
      expect.arrayContaining([
        'content.concept_no_published_questions',
        'content.concept_no_cat_pool',
        'content.concept_no_practice_fallback',
      ]),
    );
  });

  it('reports placed questions that are not linked to any concept', () => {
    const s = valid();
    const broken = {
      ...s,
      unlinkedQuestions: [{ questionKey: `${L1}-Q-ORPHAN`, lessonKey: L1 }],
    };

    expect(codes(broken)).toContain('content.question_without_concept_link');
  });
});

describe('orphans', () => {
  it('refuses an active concept under an inactive lesson', () => {
    // The learner could never reach it, so it is silently dead content.
    const s = valid();
    const broken = { ...s, lessons: [node(L1, U1, 1, false)] };

    expect(codes(broken)).toContain('content.active_child_of_inactive_parent');
  });

  it('refuses an active lesson under an inactive unit', () => {
    const s = valid();
    const broken = { ...s, units: [node(U1, null, 1, false)] };

    expect(codes(broken)).toContain('content.active_child_of_inactive_parent');
  });

  it('allows an inactive concept under an inactive lesson', () => {
    const s = valid();
    const consistent = {
      ...s,
      lessons: [node(L1, U1, 1, false)],
      concepts: [concept('SET', 1, { isActive: false }), concept('UNION', 2, { isActive: false })],
    };

    expect(codes(consistent)).not.toContain('content.active_child_of_inactive_parent');
  });
});

describe('issue shape', () => {
  it('names a stable code and points at the offending node', () => {
    const s = valid();
    const broken = { ...s, concepts: [concept('SET', 1, { masteryThreshold: 5 })] };
    const issue = validateStructure(broken).find(
      (i) => i.code === 'content.mastery_threshold_out_of_range',
    );

    expect(issue?.at).toBe(C('SET'));
    expect(issue?.message).toBeTruthy();
  });
});
