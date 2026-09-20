/**
 * Progress — how far along is the learner, at every level of the hierarchy.
 *
 * The legacy dashboard reported a single number ("percentComplete") derived
 * from concept counts. That is not enough to answer "where am I?": a learner
 * needs to see the lesson they are in, the unit it belongs to, and what is
 * still locked ahead of them.
 *
 * Two rules that keep the numbers honest:
 *
 *  - **Mastery is per-concept and thresholds are per-concept.** A concept is
 *    mastered against its OWN threshold, not a platform default. Averaging
 *    percentages across concepts with different thresholds would silently
 *    misreport a strict concept as easy.
 *
 *  - **Locked concepts count in the denominator.** Hiding them would make
 *    progress jump backwards as prerequisites unlock and new work appears.
 */

/** Per-concept input. Decay must already be applied by the caller. */
export interface ConceptProgressInput {
  readonly conceptKey: string;
  readonly lessonKey: string;
  readonly unitKey: string;
  readonly effectiveMastery: number;
  readonly masteryThreshold: number;
  readonly attemptsCount: number;
  readonly isBlocked: boolean;
}

export type ConceptProgressState =
  | 'MASTERED'
  | 'IN_PROGRESS'
  | 'STRUGGLING'
  | 'LOCKED'
  | 'NOT_STARTED';

export interface ProgressNode {
  readonly key: string;
  readonly total: number;
  readonly mastered: number;
  readonly inProgress: number;
  readonly struggling: number;
  readonly locked: number;
  readonly notStarted: number;
  /** Mastered ÷ total, 0–1. The only ratio worth showing. */
  readonly completion: number;
  /** Mean effective mastery across the node. Distinct from completion. */
  readonly averageMastery: number;
}

export interface ProgressSummary {
  readonly overall: ProgressNode;
  readonly units: readonly ProgressNode[];
  readonly lessons: readonly ProgressNode[];
  readonly concepts: readonly {
    readonly conceptKey: string;
    readonly state: ConceptProgressState;
    readonly effectiveMastery: number;
  }[];
}

/**
 * Classify one concept.
 *
 * `LOCKED` outranks everything: a learner cannot be "struggling" with material
 * they were never allowed to reach, and reporting it that way would send them
 * to remediation for the wrong concept.
 */
export function classifyConcept(input: ConceptProgressInput): ConceptProgressState {
  if (input.isBlocked) return 'LOCKED';
  if (input.attemptsCount === 0) return 'NOT_STARTED';
  if (input.effectiveMastery >= input.masteryThreshold) return 'MASTERED';
  // Half the concept's own threshold — relative, so a strict concept is not
  // flagged as struggling merely for being strict.
  if (input.effectiveMastery < input.masteryThreshold * 0.5) return 'STRUGGLING';
  return 'IN_PROGRESS';
}

export function summariseProgress(inputs: readonly ConceptProgressInput[]): ProgressSummary {
  const classified = inputs.map((input) => ({
    input,
    state: classifyConcept(input),
  }));

  const node = (key: string, rows: typeof classified): ProgressNode => {
    const total = rows.length;
    const count = (s: ConceptProgressState): number =>
      rows.filter((r) => r.state === s).length;
    const mastered = count('MASTERED');
    const sum = rows.reduce((acc, r) => acc + r.input.effectiveMastery, 0);

    return {
      key,
      total,
      mastered,
      inProgress: count('IN_PROGRESS'),
      struggling: count('STRUGGLING'),
      locked: count('LOCKED'),
      notStarted: count('NOT_STARTED'),
      completion: total > 0 ? round4(mastered / total) : 0,
      averageMastery: total > 0 ? round4(sum / total) : 0,
    };
  };

  const groupBy = (pick: (i: ConceptProgressInput) => string): ProgressNode[] => {
    const groups = new Map<string, typeof classified>();
    for (const row of classified) {
      const key = pick(row.input);
      const bucket = groups.get(key);
      if (bucket) bucket.push(row);
      else groups.set(key, [row]);
    }
    return [...groups.entries()]
      .map(([key, rows]) => node(key, rows))
      // Lexical sort on canonical keys is chronological/structural by design.
      .sort((a, b) => a.key.localeCompare(b.key));
  };

  return {
    overall: node('overall', classified),
    units: groupBy((i) => i.unitKey),
    lessons: groupBy((i) => i.lessonKey),
    concepts: classified.map((r) => ({
      conceptKey: r.input.conceptKey,
      state: r.state,
      effectiveMastery: r.input.effectiveMastery,
    })),
  };
}

const round4 = (n: number): number => Math.round(n * 10_000) / 10_000;
