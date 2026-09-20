/**
 * The Learning capability, as the UI sees it.
 *
 * Types here mirror what the backend actually returns — they are not a
 * redesign of it, and nothing is computed on the way through. If a number is
 * wrong, it is wrong in one place and that place is the server.
 *
 * `education/` rather than `features/` because these are the product's domain
 * concepts. A feature is a screen; a concept outlives the screen that shows it.
 */

import { api } from '../../shared/api/client';

/** Matches PathNode.state on the server. The five states are exhaustive. */
export type MasteryState =
  | 'MASTERED'
  | 'IN_PROGRESS'
  | 'STRUGGLING'
  | 'LOCKED'
  | 'NOT_STARTED';

/** Matches ActivityType. The order of preference lives on the server. */
export type ActivityType =
  | 'REMEDIATE'
  | 'REVIEW'
  | 'UNBLOCK'
  | 'LEARN'
  | 'ASSESS'
  | 'PRACTISE'
  | 'ADVANCE';

export type ResourceKind =
  | 'READING'
  | 'VIDEO'
  | 'WORKED_EXAMPLE'
  | 'FLASHCARD_DECK'
  | 'REMEDIAL'
  | 'TEXTBOOK_PAGE';

export interface LearnerTextbook {
  readonly key: string;
  readonly title: string;
  readonly subjectKey: string;
  readonly subjectName: string;
  readonly gradeKey: string;
  readonly gradeName: string;
  readonly termKey: string;
  readonly termName: string;
  readonly academicYearKey: string;
  readonly edition: string;
  readonly totalPages: number | null;
}

export interface LearningResource {
  readonly kind: ResourceKind;
  readonly title: string;
  readonly url?: string | null;
  readonly conceptKey?: string;
}

export interface PathNode {
  readonly conceptKey: string;
  readonly name: string;
  readonly lessonKey: string;
  readonly lessonName: string;
  readonly unitKey: string;
  readonly unitName: string;
  readonly state: MasteryState;
  /**
   * Already has forgetting applied by the server. Null means no evidence yet,
   * which is not the same as zero and must never render as 0%.
   */
  readonly effectiveMastery: number | null;
  readonly masteryThreshold: number;
  readonly attemptsCount: number;
  readonly blockedBy: readonly string[];
}

export interface NextStep {
  readonly activity: ActivityType;
  readonly conceptKey: string;
  readonly conceptName: string;
  /** The machine-readable reason. `rationale` is the human sentence. */
  readonly rule: string;
  readonly rationale: string;
  readonly resources: readonly LearningResource[];
  readonly targetDifficulty: number | null;
}

export interface NextStepResult {
  readonly step: NextStep | null;
  readonly decision: string;
  readonly progress: NextStepProgress;
}

/**
 * A flashcard deck, ordered hardest-trouble-first. There is deliberately no
 * companion "record a review" call: flipping a card is not evidence, and the
 * server refuses to let the client grade itself.
 */
export interface DeckView {
  readonly scope: { readonly lessonKey?: string; readonly conceptKey?: string };
  readonly cards: readonly DeckCard[];
  /** Tier counts, so a client can show "3 needing work" without recounting. */
  readonly byTier: Readonly<Record<string, number>>;
}

export interface DeckCard {
  readonly front: string;
  readonly back: string;
  readonly conceptKey?: string;
  readonly tier: string;
  readonly reason: string;
}

/**
 * A roll-up over some scope — the whole book, one unit, or one lesson.
 *
 * Verified against the live API rather than assumed: the counts are per
 * mastery state and mirror PathNode.state exactly, so a bar built from them
 * cannot disagree with the node badges beside it.
 *
 * `averageMastery` is present but deliberately unused in the UI. Averaging
 * mastery across concepts produces a number that looks meaningful and answers
 * no question a learner has; completion is the honest progress measure.
 */
export interface ProgressScope {
  readonly key: string;
  readonly total: number;
  readonly mastered: number;
  readonly inProgress: number;
  readonly struggling: number;
  readonly locked: number;
  readonly notStarted: number;
  /** 0..1, already computed by the server. */
  readonly completion: number;
  readonly averageMastery: number;
}

/** What /learning/path returns. */
export interface JourneyProgress {
  readonly overall: ProgressScope;
  readonly units: readonly ProgressScope[];
  readonly lessons: readonly ProgressScope[];
  readonly concepts: readonly ProgressScope[];
}

/**
 * What /learning/next-step returns — a different, smaller shape than the
 * journey's. Kept separate rather than merged: pretending one type covers both
 * would mean optional fields everywhere and a component that cannot tell which
 * source it is rendering.
 */
export interface NextStepProgress {
  readonly totalConcepts: number;
  readonly masteredConcepts: number;
  /** Already a percentage, 0..100, one decimal. */
  readonly percentComplete: number;
}

export interface UnitStop {
  readonly key: string;
  readonly name: string;
  readonly order: number;
}

export interface LessonStop {
  readonly key: string;
  readonly name: string;
  readonly unitKey: string;
  readonly order: number;
  readonly startPage: number | null;
  readonly endPage: number | null;
  readonly estimatedMins: number | null;
}

export interface JourneyView {
  readonly textbookKey: string;
  readonly progress: JourneyProgress;
  readonly path: readonly PathNode[];
  readonly units: readonly UnitStop[];
  readonly lessons: readonly LessonStop[];
  readonly currentConceptKey: string | null;
}

/** The lesson's own reading, then whatever else the author offered. */
export interface LessonResource {
  readonly key: string;
  readonly kind: string;
  readonly title: string;
  readonly body: string | null;
  readonly url: string | null;
  readonly orderIndex: number;
  readonly estimatedMins: number | null;
}

/** The completion gate: may this learner move past this lesson? */
export interface LessonCompletion {
  readonly lessonKey: string;
  readonly result: {
    readonly decision: string;
    readonly gate: string;
    readonly allowedNext: boolean;
    readonly threshold: number;
    readonly mastery: number;
    readonly masteryDeficit: number;
  };
}

export interface DiagnosticPlacementResult {
  readonly learnerKey: string;
  readonly textbookKey: string;
  readonly status: 'NEEDS_DIAGNOSTIC' | 'PLACED' | 'COMPLETE';
  readonly placement: {
    readonly conceptKey: string;
    readonly conceptName: string;
    readonly lessonKey: string;
    readonly lessonName: string;
    readonly orderIndex: number;
    readonly mastery: number;
    readonly confidence: number;
  } | null;
  readonly summary: {
    readonly totalConcepts: number;
    readonly masteredConcepts: number;
    readonly attemptedConcepts: number;
  };
}

export interface LessonDetailView {
  readonly lesson: {
    readonly key: string;
    readonly name: string;
    readonly startPage: number | null;
    readonly endPage: number | null;
    readonly estimatedMins: number | null;
    readonly unitKey: string;
    readonly unitName: string;
    readonly textbookKey: string;
    readonly textbookTitle: string;
  };
  readonly resources: readonly LessonResource[];
  readonly concepts: readonly PathNode[];
  readonly progress: ProgressScope | null;
  readonly completion: LessonCompletion;
  readonly currentConceptKey: string | null;
}

/** One subject on the shelf, rolled up across its books. */
export interface SubjectOverview {
  readonly subjectKey: string;
  readonly subjectName: string;
  readonly total: number;
  readonly mastered: number;
  readonly completion: number;
  readonly textbooks: readonly {
    readonly key: string;
    readonly title: string;
    readonly total: number;
    readonly mastered: number;
    readonly completion: number;
  }[];
}

/** A child, as their guardian sees them (gap G2). */
export interface GuardianChild {
  readonly learnerKey: string;
  readonly fullName: string;
  readonly relation: string | null;
  /** Null until the child is enrolled — not an error, and not "unknown grade". */
  readonly gradeName: string | null;
}

export const learningApi = {
  /** Gap G2 — the parent's entry point, as textbooks are the learner's. */
  children: () =>
    api.get<{ children: readonly GuardianChild[] }>('learning/children'),

  /** Gap G1 — the entry point. Every other learning call needs a textbook key. */
  textbooks: (learnerKey?: string) =>
    api.get<{ learnerKey: string; textbooks: readonly LearnerTextbook[] }>(
      'learning/textbooks',
      { query: { learnerKey } },
    ),

  nextStep: (scope: { textbookKey?: string; lessonKey?: string; learnerKey?: string }) =>
    api.get<NextStepResult>('learning/next-step', { query: scope }),

  /** A deck for one lesson or one concept, hardest trouble first (§G6). */
  flashcardDeck: (scope: {
    lessonKey?: string;
    conceptKey?: string;
    limit?: number;
    learnerKey?: string;
  }) => api.get<DeckView>('learning/flashcards', { query: scope }),

  path: (scope: { textbookKey: string; learnerKey?: string }) =>
    api.get<JourneyView>('learning/path', { query: scope }),

  diagnosticPlacement: (scope: { textbookKey: string; learnerKey?: string }) =>
    api.get<DiagnosticPlacementResult>('learning/diagnostic-placement', { query: scope }),

  /** One lesson, opened: the reading, the options, the gate. */
  lesson: (lessonKey: string, learnerKey?: string) =>
    api.get<LessonDetailView>('learning/lesson', { query: { lessonKey, learnerKey } }),

  /** The shelf by subject — mastery above the book level. */
  subjects: (learnerKey?: string) =>
    api.get<{ subjects: readonly SubjectOverview[] }>('learning/subjects', {
      query: { learnerKey },
    }),
};
