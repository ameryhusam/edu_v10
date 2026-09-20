/**
 * GetNextStep — the learner-facing adaptive loop.
 *
 * Orchestration only. It gathers state from other contexts, hands it to the
 * pure decision engine, then dresses the verdict with content the learner can
 * actually open. It contains no thresholds and no pedagogy of its own — every
 * such rule lives in `domain/next-activity.ts`, where it can be unit-tested
 * without a database.
 *
 * That split is the whole point: application code answers "what do I need to
 * load and return", domain code answers "what is educationally right".
 */

import { Errors } from '../../../shared/kernel/errors.js';
import { Err, Ok, type Result } from '../../../shared/kernel/result.js';
import { DEFAULT_MASTERY_THRESHOLD } from '../../mastery/domain/mastery-level.js';
import {
  decideNextActivity,
  targetDifficultyFor,
  type ActivityType,
  type ConceptState,
} from '../domain/next-activity.js';
import type {
  ContentReader,
  DecisionLogWriter,
  LearningResource,
  MasteryReader,
  MisconceptionReader,
  NextStepResult,
  ResourceReader,
} from './ports.js';

export interface GetNextStepQuery {
  readonly learnerKey: string;
  /** Scope the loop to one lesson, or to a whole textbook. */
  readonly lessonKey?: string;
  readonly textbookKey?: string;
}

/** Which resource kinds make sense for each pedagogical activity. */
const RESOURCE_KINDS: Record<ActivityType, readonly LearningResource['kind'][]> = {
  REMEDIATE: ['REMEDIAL', 'WORKED_EXAMPLE'],
  REVIEW: ['FLASHCARD_DECK', 'READING'],
  UNBLOCK: ['READING', 'VIDEO', 'WORKED_EXAMPLE'],
  LEARN: ['READING', 'VIDEO'],
  PRACTISE: ['WORKED_EXAMPLE'],
  ASSESS: [],
  ADVANCE: [],
};

export class GetNextStepUseCase {
  constructor(
    private readonly content: ContentReader,
    private readonly mastery: MasteryReader,
    private readonly misconceptions: MisconceptionReader,
    private readonly resources: ResourceReader,
    /** Optional: absent in tests, present in production wiring. */
    private readonly decisionLog?: DecisionLogWriter,
  ) {}

  async execute(query: GetNextStepQuery): Promise<Result<NextStepResult>> {
    if (!query.lessonKey && !query.textbookKey) {
      return Err(
        Errors.validation('learning.scope_required', 'Either lessonKey or textbookKey must be provided.'),
      );
    }

    const concepts = query.lessonKey
      ? await this.content.conceptsInLesson(query.lessonKey)
      : await this.content.conceptsInTextbook(query.textbookKey!);

    if (concepts.length === 0) {
      return Err(
        Errors.notFound('learning.no_concepts_in_scope', 'No concepts found for the requested scope.', {
          lessonKey: query.lessonKey ?? null,
          textbookKey: query.textbookKey ?? null,
        }),
      );
    }

    const conceptKeys = concepts.map((c) => c.conceptKey);
    const [masteryMap, misconceptionMap, prerequisites] = await Promise.all([
      this.mastery.profileFor(query.learnerKey, conceptKeys),
      this.misconceptions.openForLearner(query.learnerKey, conceptKeys),
      this.content.prerequisitesFor(conceptKeys),
    ]);

    const states: ConceptState[] = concepts.map((c) => {
      const m = masteryMap.get(c.conceptKey);
      return {
        conceptKey: c.conceptKey,
        orderIndex: c.orderIndex,
        mastery: m?.mastery ?? 0,
        effectiveMastery: m?.effectiveMastery ?? 0,
        confidence: m?.confidence ?? 0,
        retrievability: m?.retrievability ?? 1,
        attemptsCount: m?.attemptsCount ?? 0,
        openMisconceptionKeys: misconceptionMap.get(c.conceptKey) ?? [],
        masteryThreshold: c.masteryThreshold || DEFAULT_MASTERY_THRESHOLD,
      };
    });

    const decision = decideNextActivity({ concepts: states, prerequisites });

    const target = decision.conceptKey
      ? concepts.find((c) => c.conceptKey === decision.conceptKey)
      : undefined;

    const kinds = RESOURCE_KINDS[decision.activity];
    const resources =
      decision.conceptKey && kinds.length > 0
        ? await this.resources.forConcept(decision.conceptKey, kinds)
        : [];

    const masteredCount = states.filter(
      (s) => s.effectiveMastery >= (s.masteryThreshold ?? DEFAULT_MASTERY_THRESHOLD),
    ).length;

    const targetState = decision.conceptKey
      ? states.find((s) => s.conceptKey === decision.conceptKey)
      : undefined;

    // Best-effort: an audit write must never cost a learner their next step.
    if (this.decisionLog) {
      try {
        await this.decisionLog.record({
          learnerKey: query.learnerKey,
          activity: decision.activity,
          conceptKey: decision.conceptKey,
          rule: decision.rule,
          rationale: decision.rationale,
          evidence: decision.evidence as Record<string, unknown>,
        });
      } catch {
        // Intentionally swallowed. See DecisionLogWriter.
      }
    }

    return Ok({
      step: {
        activity: decision.activity,
        conceptKey: decision.conceptKey,
        conceptName: target?.name ?? null,
        rule: decision.rule,
        rationale: decision.rationale,
        resources,
        targetDifficulty:
          decision.activity === 'PRACTISE' || decision.activity === 'ASSESS'
            ? targetDifficultyFor(targetState?.effectiveMastery ?? 0)
            : null,
      },
      decision,
      progress: {
        totalConcepts: states.length,
        masteredConcepts: masteredCount,
        percentComplete: Number(((masteredCount / states.length) * 100).toFixed(1)),
      },
    });
  }
}
