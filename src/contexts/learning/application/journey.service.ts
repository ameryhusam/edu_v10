/**
 * The learner's journey — where am I, what is done, what is left.
 *
 * Three ledger items share one service because they are three views of one
 * question, and splitting them would mean three separate walks of the same
 * concept list with three chances to disagree:
 *
 *   · **Path** (item 1)       the ordered map, and where the learner stands on it
 *   · **Completion** (item 8) may this learner move past this lesson
 *   · **Progress** (item 9)   the roll-up at concept / lesson / unit level
 *
 * All of it is derived. Nothing here is stored, and there is no endpoint that
 * marks a lesson complete: completion is a *reading* of evidence, exactly as
 * remediation is. That is the correction of the legacy dashboard service, which
 * recomputed mastery while rendering it and wrote the result back — the reason
 * architecture rule AW1 exists.
 *
 * The prerequisite gate is applied here rather than in the pure functions
 * because blocking depends on the whole graph, not on one concept. `progress.ts`
 * takes `isBlocked` as an input for that reason: it must not have to know how
 * the graph works.
 */

import { Ok, type Result } from '../../../shared/kernel/result.js';
import { Errors } from '../../../shared/kernel/errors.js';
import { Err } from '../../../shared/kernel/result.js';
import {
  evaluateCompletion,
  type CompletionResult,
} from '../domain/completion-policy.js';
import {
  summariseProgress,
  type ConceptProgressInput,
  type ProgressSummary,
} from '../domain/progress.js';
import { assessReadiness, type PrerequisiteEdge } from '../domain/prerequisite-graph.js';
import type { ContentReader, MasteryReader } from './ports.js';

/** One stop on the map. */
export interface PathNode {
  readonly conceptKey: string;
  readonly name: string;
  readonly lessonKey: string;
  readonly lessonName: string;
  readonly unitKey: string;
  readonly unitName: string;
  readonly state: 'MASTERED' | 'IN_PROGRESS' | 'STRUGGLING' | 'LOCKED' | 'NOT_STARTED';
  /**
   * Null means *no evidence yet* — not zero.
   *
   * A concept nobody has attempted has no mastery value, and collapsing that
   * into 0 tells a learner they scored nothing on work they never did. The
   * distinction only matters for display: the gating calculations below
   * deliberately treat absent as 0, because an unmeasured prerequisite must
   * not unlock the concept behind it.
   */
  readonly effectiveMastery: number | null;
  readonly masteryThreshold: number;
  readonly attemptsCount: number;
  /** Which prerequisites are holding this concept shut, if any. */
  readonly blockedBy: readonly string[];
}

/**
 * The book's structure, flat and ordered. The path is concept-grained; a
 * screen that wants to draw LESSONS (as the learner-facing path does) groups
 * these by unit and nests the concept stations inside, without a second
 * request and without re-deriving order.
 */
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
  readonly progress: ProgressSummary;
  readonly path: readonly PathNode[];
  readonly units: readonly UnitStop[];
  readonly lessons: readonly LessonStop[];
  /**
   * Where the learner actually is: the first concept that is neither mastered
   * nor locked. Null once the book is finished — which is a real answer, not a
   * missing one, so it is reported rather than omitted.
   */
  readonly currentConceptKey: string | null;
}

export class JourneyService {
  constructor(
    private readonly content: ContentReader,
    private readonly mastery: MasteryReader,
  ) {}

  /**
   * The whole map, in textbook order, with the learner's position on it.
   */
  async path(input: { learnerKey: string; textbookKey: string }): Promise<Result<JourneyView>> {
    const concepts = await this.content.conceptsInTextbook(input.textbookKey);
    if (concepts.length === 0) {
      // An empty book is far more likely to be the wrong key, or a book that
      // was never published, than a genuinely empty one. Saying "no concepts"
      // would send the caller looking for a content bug that is not there.
      return Err(
        Errors.notFound(
          'learning.textbook_not_available',
          'No published concepts found for this textbook.',
          { textbookKey: input.textbookKey },
        ),
      );
    }

    const conceptKeys = concepts.map((c) => c.conceptKey);
    const [profile, edges] = await Promise.all([
      this.mastery.profileFor(input.learnerKey, conceptKeys),
      this.content.prerequisitesFor(conceptKeys),
    ]);

    const blocked = this.blockedMap(conceptKeys, edges, profile);

    const inputs: ConceptProgressInput[] = concepts.map((concept) => {
      const m = profile.get(concept.conceptKey);
      return {
        conceptKey: concept.conceptKey,
        lessonKey: concept.lessonKey,
        unitKey: concept.unitKey,
        effectiveMastery: m?.effectiveMastery ?? 0,
        masteryThreshold: concept.masteryThreshold,
        attemptsCount: m?.attemptsCount ?? 0,
        isBlocked: blocked.has(concept.conceptKey),
      };
    });

    const progress = summariseProgress(inputs);
    const stateByKey = new Map(progress.concepts.map((c) => [c.conceptKey, c.state]));

    const path: PathNode[] = concepts.map((concept) => {
      const m = profile.get(concept.conceptKey);
      return {
        conceptKey: concept.conceptKey,
        name: concept.name,
        lessonKey: concept.lessonKey,
        lessonName: concept.lessonName,
        unitKey: concept.unitKey,
        unitName: concept.unitName,
        state: stateByKey.get(concept.conceptKey) ?? 'NOT_STARTED',
        // Null, not 0 — see the field docs. `attemptsCount` alone cannot carry
        // this: a learner can have attempts recorded with no mastery computed.
        effectiveMastery: m?.effectiveMastery ?? null,
        masteryThreshold: concept.masteryThreshold,
        attemptsCount: m?.attemptsCount ?? 0,
        blockedBy: blocked.get(concept.conceptKey) ?? [],
      };
    });

    // Textbook order is already the order `conceptsInTextbook` returns, so
    // "first" here means first in the book, not first by mastery.
    const current = path.find((n) => n.state !== 'MASTERED' && n.state !== 'LOCKED');

    // The structural directories, deduplicated in the same walk order. Page
    // spans and minutes are not on the descriptor — they are lesson-shelf
    // data, so this is the one extra read the journey makes for screens.
    const units: UnitStop[] = [];
    const lessons: LessonStop[] = [];
    const shelf = await this.content.lessonShelf(input.textbookKey);
    for (const stop of shelf) {
      if (units.length === 0 || units[units.length - 1]!.key !== stop.unitKey) {
        units.push({ key: stop.unitKey, name: stop.unitName, order: units.length + 1 });
      }
      if (lessons.length === 0 || lessons[lessons.length - 1]!.key !== stop.lessonKey) {
        lessons.push({
          key: stop.lessonKey,
          name: stop.lessonName,
          unitKey: stop.unitKey,
          order: lessons.length + 1,
          startPage: stop.startPage,
          endPage: stop.endPage,
          estimatedMins: stop.estimatedMins,
        });
      }
    }

    return Ok({
      textbookKey: input.textbookKey,
      progress,
      path,
      units,
      lessons,
      currentConceptKey: current?.conceptKey ?? null,
    });
  }

  /**
   * May this learner move past this lesson?
   *
   * Answers with the gate that is unmet, not just yes/no, because "no" without
   * a reason is what made the legacy screen unactionable.
   */
  async lessonCompletion(input: {
    learnerKey: string;
    lessonKey: string;
  }): Promise<
    Result<{
      lessonKey: string;
      result: CompletionResult;
      concepts: readonly { conceptKey: string; result: CompletionResult }[];
    }>
  > {
    const concepts = await this.content.conceptsInLesson(input.lessonKey);
    if (concepts.length === 0) {
      return Err(
        Errors.notFound('learning.lesson_not_available', 'No published concepts in this lesson.', {
          lessonKey: input.lessonKey,
        }),
      );
    }

    const profile = await this.mastery.profileFor(
      input.learnerKey,
      concepts.map((c) => c.conceptKey),
    );

    const perConcept = concepts.map((concept) => {
      const m = profile.get(concept.conceptKey);
      return {
        conceptKey: concept.conceptKey,
        result: evaluateCompletion({
          requiresAssessment: true,
          minimumMastery: concept.masteryThreshold,
          masteryAchieved: m?.effectiveMastery ?? null,
          attempted: (m?.attemptsCount ?? 0) > 0,
          // At concept level the assessment IS the ongoing question stream —
          // there is no separate quiz to sit. So "did they take it" is the
          // attempt count, and "did they pass" is the mastery gate two lines
          // below. Leaving this unset would stop every learner at
          // ASSESSMENT_REQUIRED and never reach the mastery check, reporting
          // REVIEW where the honest answer is REMEDIAL. The distinction
          // matters: REVIEW means go back and do it, REMEDIAL means you did it
          // and need help.
          assessmentPassed: (m?.attemptsCount ?? 0) > 0,
        }),
      };
    });

    // The lesson is gated by its weakest concept. Averaging would let a learner
    // who has mastered four concepts and never touched a fifth pass the lesson
    // on the strength of the four — which is exactly the gap that shows up two
    // lessons later as an unexplained collapse.
    const weakest = perConcept.reduce((worst, candidate) =>
      candidate.result.masteryDeficit > worst.result.masteryDeficit ? candidate : worst,
    );

    return Ok({
      lessonKey: input.lessonKey,
      result: weakest.result,
      concepts: perConcept,
    });
  }

  /**
   * Which concepts are shut, and by what.
   *
   * `blockedConcepts` answers the set; this also keeps the offending
   * prerequisite keys so the UI can say *why* rather than showing a padlock.
   */
  private blockedMap(
    conceptKeys: readonly string[],
    edges: readonly PrerequisiteEdge[],
    profile: ReadonlyMap<string, { effectiveMastery: number }>,
  ): Map<string, string[]> {
    // Reuses the same readiness function the next-step decision uses, so the
    // map and the recommendation can never disagree about whether a concept is
    // reachable. A second implementation of "is this blocked?" is exactly how
    // legacy ended up with four mastery formulas.
    const masteryByConcept = new Map<string, number>(
      conceptKeys.map((key) => [key, profile.get(key)?.effectiveMastery ?? 0]),
    );

    const reasons = new Map<string, string[]>();
    for (const conceptKey of conceptKeys) {
      const readiness = assessReadiness(conceptKey, edges, masteryByConcept);
      // Only BLOCKED closes a concept. RECOMMENDED_REVIEW is advice, and
      // treating it as a lock would wall learners off from work they are
      // allowed to attempt.
      if (readiness.status !== 'BLOCKED') continue;
      reasons.set(
        conceptKey,
        readiness.unmet.filter((u) => u.isHardGate).map((u) => u.prerequisiteKey),
      );
    }
    return reasons;
  }
}
