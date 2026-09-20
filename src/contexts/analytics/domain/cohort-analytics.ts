/**
 * Cohort and concept analytics — PURE.
 *
 * Reporting only. Nothing here decides anything: not what a learner does next,
 * not whether an obligation is complete, not what a mastery value is. It reads
 * numbers other contexts own and arranges them so a teacher can see the shape
 * of a class.
 *
 * That restraint is the design. Legacy had a "dashboard service" that computed
 * its own mastery on the way to rendering it, which is how one concept came to
 * show two different masteries on two screens. Analytics is a projection, and
 * a projection that recomputes its source is not a projection.
 */

/** One learner's standing on one concept, as Mastery reports it. */
export interface MasteryPoint {
  readonly learnerKey: string;
  readonly conceptKey: string;
  /** Current mastery with decay already applied, 0..1. */
  readonly mastery: number;
  readonly observations: number;
  /** The threshold this concept is considered mastered at. */
  readonly threshold: number;
}

export interface ConceptSummary {
  readonly conceptKey: string;
  readonly learners: number;
  readonly meanMastery: number;
  readonly medianMastery: number;
  readonly masteredCount: number;
  readonly masteredShare: number;
  /** Learners with evidence but below threshold — the teachable middle. */
  readonly strugglingCount: number;
  /** Learners with no evidence at all. Absence is not weakness. */
  readonly unassessedCount: number;
}

/**
 * Summarise one concept across a cohort.
 *
 * Unassessed learners are counted separately and excluded from the averages
 * throughout. Folding them in as zero is the most common way a class report
 * lies: a topic nobody has started yet reads as a topic everybody failed, and
 * a teacher reteaches something that was never taught.
 */
export function summariseConcept(
  conceptKey: string,
  points: readonly MasteryPoint[],
): ConceptSummary {
  const relevant = points.filter((p) => p.conceptKey === conceptKey);
  const assessed = relevant.filter((p) => p.observations > 0);
  const unassessed = relevant.length - assessed.length;

  if (assessed.length === 0) {
    return {
      conceptKey,
      learners: relevant.length,
      meanMastery: 0,
      medianMastery: 0,
      masteredCount: 0,
      masteredShare: 0,
      strugglingCount: 0,
      unassessedCount: unassessed,
    };
  }

  const values = assessed.map((p) => p.mastery).sort((a, b) => a - b);
  const mastered = assessed.filter((p) => p.mastery >= p.threshold).length;

  return {
    conceptKey,
    learners: relevant.length,
    meanMastery: round(values.reduce((a, b) => a + b, 0) / values.length),
    medianMastery: round(median(values)),
    masteredCount: mastered,
    masteredShare: round(mastered / assessed.length),
    strugglingCount: assessed.length - mastered,
    unassessedCount: unassessed,
  };
}

/**
 * The concepts a class is worst at, for a teacher deciding what to reteach.
 *
 * Ranked by how many learners are struggling rather than by mean mastery: a
 * concept at 0.4 across thirty learners is a lesson to reteach, while one at
 * 0.1 across two is a conversation with two learners.
 */
export function weakestConcepts(
  summaries: readonly ConceptSummary[],
  limit = 5,
): readonly ConceptSummary[] {
  return [...summaries]
    .filter((s) => s.strugglingCount > 0)
    .sort((a, b) => b.strugglingCount - a.strugglingCount || a.meanMastery - b.meanMastery)
    .slice(0, limit);
}

export interface LearnerStanding {
  readonly learnerKey: string;
  readonly conceptsAssessed: number;
  readonly conceptsMastered: number;
  readonly meanMastery: number;
  /** Concepts with evidence, below threshold, ranked weakest first. */
  readonly weakestConcepts: readonly string[];
}

export function summariseLearner(
  learnerKey: string,
  points: readonly MasteryPoint[],
  weakestLimit = 3,
): LearnerStanding {
  const mine = points.filter((p) => p.learnerKey === learnerKey && p.observations > 0);

  if (mine.length === 0) {
    return {
      learnerKey,
      conceptsAssessed: 0,
      conceptsMastered: 0,
      meanMastery: 0,
      weakestConcepts: [],
    };
  }

  const mastered = mine.filter((p) => p.mastery >= p.threshold);

  return {
    learnerKey,
    conceptsAssessed: mine.length,
    conceptsMastered: mastered.length,
    meanMastery: round(mine.reduce((sum, p) => sum + p.mastery, 0) / mine.length),
    weakestConcepts: mine
      .filter((p) => p.mastery < p.threshold)
      .sort((a, b) => a.mastery - b.mastery)
      .slice(0, weakestLimit)
      .map((p) => p.conceptKey),
  };
}

/**
 * How the class is distributed, in bands.
 *
 * A mean hides the shape that matters. Two classes averaging 0.6 can be
 * "everybody is roughly fine" and "half have mastered it, half have not
 * started" — and those need opposite responses from a teacher.
 */
export interface Distribution {
  readonly assessed: number;
  readonly unassessed: number;
  readonly bands: {
    readonly struggling: number;
    readonly developing: number;
    readonly approaching: number;
    readonly mastered: number;
  };
}

export function distribution(points: readonly MasteryPoint[]): Distribution {
  const assessed = points.filter((p) => p.observations > 0);
  const bands = { struggling: 0, developing: 0, approaching: 0, mastered: 0 };

  for (const point of assessed) {
    // The top band is defined by the concept's OWN threshold, not a global
    // constant — a concept can be configured to demand more.
    if (point.mastery >= point.threshold) bands.mastered += 1;
    else if (point.mastery >= 0.6) bands.approaching += 1;
    else if (point.mastery >= 0.3) bands.developing += 1;
    else bands.struggling += 1;
  }

  return { assessed: assessed.length, unassessed: points.length - assessed.length, bands };
}

/**
 * Engagement, counted honestly.
 *
 * `activeLearners` counts learners who produced evidence in the window, not
 * learners who loaded a page. A dashboard that counts logins reports its own
 * traffic back to itself.
 */
export interface ActivitySummary {
  readonly totalLearners: number;
  readonly activeLearners: number;
  readonly activeShare: number;
  readonly totalAttempts: number;
  readonly medianAttemptsPerActiveLearner: number;
  readonly neverActive: readonly string[];
}

export function summariseActivity(
  cohort: readonly string[],
  attemptsByLearner: ReadonlyMap<string, number>,
): ActivitySummary {
  const counts = cohort.map((learnerKey) => attemptsByLearner.get(learnerKey) ?? 0);
  const active = counts.filter((c) => c > 0);

  return {
    totalLearners: cohort.length,
    activeLearners: active.length,
    activeShare: cohort.length === 0 ? 0 : round(active.length / cohort.length),
    totalAttempts: counts.reduce((a, b) => a + b, 0),
    medianAttemptsPerActiveLearner:
      active.length === 0 ? 0 : round(median([...active].sort((a, b) => a - b))),
    // Named, because "12% inactive" is a statistic and a list of names is
    // something a teacher can act on this afternoon.
    neverActive: cohort.filter((k) => (attemptsByLearner.get(k) ?? 0) === 0),
  };
}

function median(sorted: readonly number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
