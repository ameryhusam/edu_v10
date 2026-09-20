/**
 * The adaptive decision: what should this learner do next?
 *
 * PURE, and deliberately EXPLAINABLE. Every decision returns the rule that
 * fired and the evidence behind it. A teacher must be able to ask "why is my
 * student being shown this?" and get an answer that is not "the algorithm".
 *
 * Boundary note: this owns the *pedagogical* step (review / remediate / learn /
 * practise / assess). It does NOT choose an exam item — that is CAT's job in
 * the assessment context. Two levels, two owners, no overlap.
 *
 * Priority order encodes the pedagogy, and the order itself is the design:
 *   1 REMEDIATE  a diagnosed misconception poisons everything built on it
 *   2 REVIEW     decayed prior knowledge collapses new learning
 *   3 UNBLOCK    a hard prerequisite gate must open before new material
 *   4 LEARN      teach unseen material
 *   5 PRACTISE   consolidate partially-known material
 *   6 ASSESS     confirm mastery when the estimate is high but under-evidenced
 *   7 ADVANCE    nothing left here; move on
 */

import { DEFAULT_MASTERY_THRESHOLD } from '../../mastery/domain/mastery-level.js';
import { REVIEW_THRESHOLD } from '../../mastery/domain/retention.js';
import { assessReadiness, findRootGaps, type PrerequisiteEdge } from './prerequisite-graph.js';

export type ActivityType =
  | 'REMEDIATE'
  | 'REVIEW'
  | 'UNBLOCK'
  | 'LEARN'
  | 'PRACTISE'
  | 'ASSESS'
  | 'ADVANCE';

/** Per-concept learner state, as seen by the decision engine. */
export interface ConceptState {
  readonly conceptKey: string;
  /** Position within the lesson — ties are broken by textbook order. */
  readonly orderIndex: number;
  /** BKT belief at the last observation, [0,1]. */
  readonly mastery: number;
  /** Mastery discounted by forgetting, [0,1]. */
  readonly effectiveMastery: number;
  /** Certainty in the estimate, [0,1]. Low = not enough evidence yet. */
  readonly confidence: number;
  /** Probability of recall right now, [0,1]. */
  readonly retrievability: number;
  readonly attemptsCount: number;
  /** Unresolved misconceptions diagnosed on this concept. */
  readonly openMisconceptionKeys: readonly string[];
  /** Concept-specific override of the platform mastery threshold. */
  readonly masteryThreshold?: number;
}

export interface DecisionInput {
  readonly concepts: readonly ConceptState[];
  readonly prerequisites: readonly PrerequisiteEdge[];
  /** Minimum observations before a high estimate is trusted without assessment. */
  readonly minEvidenceForMastery?: number;
}

export interface Decision {
  readonly activity: ActivityType;
  readonly conceptKey: string | null;
  /** Stable rule identifier that produced this decision. Logged and testable. */
  readonly rule: string;
  /** Human-readable justification, safe to show to teachers and parents. */
  readonly rationale: string;
  /** 0..1 — how strongly the engine recommends this over the alternatives. */
  readonly priority: number;
  /** Supporting numbers, so the UI can render an explanation panel. */
  readonly evidence: Readonly<Record<string, unknown>>;
}

const DEFAULT_MIN_EVIDENCE = 4;

export function decideNextActivity(input: DecisionInput): Decision {
  const minEvidence = input.minEvidenceForMastery ?? DEFAULT_MIN_EVIDENCE;
  const masteryMap = new Map(input.concepts.map((c) => [c.conceptKey, c.effectiveMastery]));
  const ordered = [...input.concepts].sort((a, b) => a.orderIndex - b.orderIndex);
  const thresholdOf = (c: ConceptState): number => c.masteryThreshold ?? DEFAULT_MASTERY_THRESHOLD;

  // 1 ── An open misconception outranks everything. Practising on top of a
  //      wrong mental model reinforces the wrong mental model.
  const misconceived = ordered.find((c) => c.openMisconceptionKeys.length > 0);
  if (misconceived) {
    return {
      activity: 'REMEDIATE',
      conceptKey: misconceived.conceptKey,
      rule: 'open_misconception_first',
      rationale:
        'An unresolved misconception is recorded on this concept. It is addressed before any new practice so the error is not reinforced.',
      priority: 1,
      evidence: {
        misconceptionKeys: misconceived.openMisconceptionKeys,
        mastery: misconceived.mastery,
      },
    };
  }

  // 2 ── Previously mastered material that has decayed below recall threshold.
  const decayed = ordered
    .filter(
      (c) =>
        c.mastery >= thresholdOf(c) &&
        c.retrievability < REVIEW_THRESHOLD &&
        c.attemptsCount > 0,
    )
    .sort((a, b) => a.retrievability - b.retrievability)[0];
  if (decayed) {
    return {
      activity: 'REVIEW',
      conceptKey: decayed.conceptKey,
      rule: 'spaced_review_due',
      rationale:
        'This concept was mastered earlier but recall probability has fallen below the review threshold. A short review restores it far more cheaply than relearning later.',
      priority: 0.9,
      evidence: {
        retrievability: decayed.retrievability,
        threshold: REVIEW_THRESHOLD,
        masteryAtObservation: decayed.mastery,
        effectiveMastery: decayed.effectiveMastery,
      },
    };
  }

  // 3 ── First not-yet-mastered concept in textbook order drives the rest.
  const target = ordered.find((c) => c.effectiveMastery < thresholdOf(c));

  if (!target) {
    return {
      activity: 'ADVANCE',
      conceptKey: null,
      rule: 'all_concepts_mastered',
      rationale: 'Every concept in scope is mastered and fresh. The learner can move to the next lesson.',
      priority: 0.2,
      evidence: { conceptCount: ordered.length },
    };
  }

  const readiness = assessReadiness(target.conceptKey, input.prerequisites, masteryMap);
  if (readiness.status === 'BLOCKED') {
    const roots = findRootGaps(target.conceptKey, input.prerequisites, masteryMap);
    const blocker = roots[0] ?? readiness.unmet[0]!.prerequisiteKey;
    return {
      activity: 'UNBLOCK',
      conceptKey: blocker,
      rule: 'hard_prerequisite_unmet',
      rationale:
        'A required prerequisite is not yet mastered. The engine routes to the deepest unmet prerequisite rather than the surface concept, so the actual gap is closed.',
      priority: 0.95,
      evidence: {
        blockedConcept: target.conceptKey,
        readinessScore: readiness.readinessScore,
        unmet: readiness.unmet,
        rootGaps: roots,
      },
    };
  }

  // 4 ── Never attempted: teach it.
  if (target.attemptsCount === 0) {
    return {
      activity: 'LEARN',
      conceptKey: target.conceptKey,
      rule: 'unseen_concept',
      rationale:
        'The learner has no recorded attempts on this concept, so instruction comes before assessment.',
      priority: 0.7,
      evidence: {
        readinessScore: readiness.readinessScore,
        softWarnings: readiness.unmet,
      },
    };
  }

  // 5 ── High estimate but thin evidence: confirm rather than assume.
  if (target.effectiveMastery >= thresholdOf(target) * 0.9 && target.attemptsCount < minEvidence) {
    return {
      activity: 'ASSESS',
      conceptKey: target.conceptKey,
      rule: 'confirm_low_confidence_mastery',
      rationale:
        'The mastery estimate is high but rests on few observations. A short check confirms it before the concept is marked mastered.',
      priority: 0.6,
      evidence: {
        mastery: target.effectiveMastery,
        confidence: target.confidence,
        attemptsCount: target.attemptsCount,
        minEvidence,
      },
    };
  }

  // 6 ── Default: deliberate practice on the weakest ready concept.
  return {
    activity: 'PRACTISE',
    conceptKey: target.conceptKey,
    rule: 'practise_weakest_ready_concept',
    rationale:
      'This is the earliest concept in textbook order that is not yet mastered and whose prerequisites are satisfied.',
    priority: 0.8,
    evidence: {
      mastery: target.effectiveMastery,
      threshold: thresholdOf(target),
      attemptsCount: target.attemptsCount,
      readinessScore: readiness.readinessScore,
    },
  };
}

/**
 * Target difficulty for the next practice item.
 *
 * Zone of proximal development: aim slightly ABOVE current ability so the item
 * is informative but not demoralising. ~0.7 success probability is the band
 * most often cited for productive struggle.
 */
export function targetDifficultyFor(mastery: number): number {
  return Number(Math.min(0.95, Math.max(0.15, mastery + 0.1)).toFixed(4));
}
