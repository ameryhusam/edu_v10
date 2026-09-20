/**
 * The prerequisite graph — readiness, not just ordering.
 *
 * PURE. A textbook is a DAG of concepts, and "can this learner start here?"
 * is a graph question, not a service question. Putting it in the domain means
 * the same answer is given by the web UI, the mobile client and the nightly
 * planner.
 *
 * Cycles are treated as data defects and reported, never silently tolerated:
 * a cycle means the content author made a mistake and a learner could be
 * locked out of their own course forever.
 */

export interface PrerequisiteEdge {
  /** The concept that is gated. */
  readonly conceptKey: string;
  /** The concept that must come first. */
  readonly prerequisiteKey: string;
  /** How strongly the gate applies, in [0,1]. 1 = hard gate. */
  readonly strength: number;
  /** Mastery required on the prerequisite before the gate opens. */
  readonly requiredMastery: number;
}

export type ReadinessStatus = 'READY' | 'BLOCKED' | 'RECOMMENDED_REVIEW';

export interface UnmetPrerequisite {
  readonly prerequisiteKey: string;
  readonly requiredMastery: number;
  readonly actualMastery: number;
  readonly gap: number;
  readonly isHardGate: boolean;
}

export interface Readiness {
  readonly conceptKey: string;
  readonly status: ReadinessStatus;
  /** 0..1 — how prepared the learner is across all prerequisites. */
  readonly readinessScore: number;
  readonly unmet: readonly UnmetPrerequisite[];
}

/** Above this strength an unmet prerequisite blocks rather than warns. */
const HARD_GATE_STRENGTH = 0.7;

export function assessReadiness(
  conceptKey: string,
  edges: readonly PrerequisiteEdge[],
  masteryByConcept: ReadonlyMap<string, number>,
): Readiness {
  const relevant = edges.filter((e) => e.conceptKey === conceptKey);
  if (relevant.length === 0) {
    return { conceptKey, status: 'READY', readinessScore: 1, unmet: [] };
  }

  const unmet: UnmetPrerequisite[] = [];
  let weighted = 0;
  let weightTotal = 0;

  for (const edge of relevant) {
    const actual = masteryByConcept.get(edge.prerequisiteKey) ?? 0;
    const satisfaction = Math.min(1, edge.requiredMastery > 0 ? actual / edge.requiredMastery : 1);
    weighted += satisfaction * edge.strength;
    weightTotal += edge.strength;

    if (actual < edge.requiredMastery) {
      unmet.push({
        prerequisiteKey: edge.prerequisiteKey,
        requiredMastery: edge.requiredMastery,
        actualMastery: actual,
        gap: Number((edge.requiredMastery - actual).toFixed(4)),
        isHardGate: edge.strength >= HARD_GATE_STRENGTH,
      });
    }
  }

  const readinessScore = weightTotal > 0 ? Number((weighted / weightTotal).toFixed(4)) : 1;
  const status: ReadinessStatus =
    unmet.some((u) => u.isHardGate) ? 'BLOCKED' : unmet.length > 0 ? 'RECOMMENDED_REVIEW' : 'READY';

  return { conceptKey, status, readinessScore, unmet };
}

/**
 * Deepest unmet prerequisite first — the true root cause.
 *
 * If a learner fails "solving equations", telling them to revise "solving
 * equations" is useless. Walking the graph down to the deepest unmet ancestor
 * (say, "additive inverse") is the difference between remediation and repetition.
 */
export function findRootGaps(
  conceptKey: string,
  edges: readonly PrerequisiteEdge[],
  masteryByConcept: ReadonlyMap<string, number>,
  maxDepth = 6,
): string[] {
  const byConcept = new Map<string, PrerequisiteEdge[]>();
  for (const e of edges) {
    const list = byConcept.get(e.conceptKey);
    if (list) list.push(e);
    else byConcept.set(e.conceptKey, [e]);
  }

  const roots: string[] = [];
  const visited = new Set<string>();

  const walk = (key: string, depth: number): void => {
    if (depth > maxDepth || visited.has(key)) return;
    visited.add(key);

    const parents = byConcept.get(key) ?? [];
    const unmetParents = parents.filter(
      (e) => (masteryByConcept.get(e.prerequisiteKey) ?? 0) < e.requiredMastery,
    );

    if (unmetParents.length === 0) {
      if (depth > 0) roots.push(key);
      return;
    }
    for (const parent of unmetParents) walk(parent.prerequisiteKey, depth + 1);
  };

  walk(conceptKey, 0);
  return roots;
}

/** Topological order for planning a learning path. Fails loudly on cycles. */
export function topologicalOrder(
  conceptKeys: readonly string[],
  edges: readonly PrerequisiteEdge[],
): { order: string[]; cycles: string[][] } {
  const nodes = new Set(conceptKeys);
  const incoming = new Map<string, Set<string>>();
  const outgoing = new Map<string, Set<string>>();

  for (const key of nodes) {
    incoming.set(key, new Set());
    outgoing.set(key, new Set());
  }
  for (const e of edges) {
    if (!nodes.has(e.conceptKey) || !nodes.has(e.prerequisiteKey)) continue;
    incoming.get(e.conceptKey)!.add(e.prerequisiteKey);
    outgoing.get(e.prerequisiteKey)!.add(e.conceptKey);
  }

  const queue = [...nodes].filter((k) => incoming.get(k)!.size === 0).sort();
  const order: string[] = [];

  while (queue.length > 0) {
    const key = queue.shift()!;
    order.push(key);
    for (const child of outgoing.get(key) ?? []) {
      const deps = incoming.get(child)!;
      deps.delete(key);
      if (deps.size === 0) queue.push(child);
    }
  }

  const remaining = [...nodes].filter((k) => !order.includes(k));
  return { order, cycles: remaining.length > 0 ? [remaining] : [] };
}

export function detectCycles(edges: readonly PrerequisiteEdge[]): string[][] {
  const keys = new Set<string>();
  for (const e of edges) {
    keys.add(e.conceptKey);
    keys.add(e.prerequisiteKey);
  }
  return topologicalOrder([...keys], edges).cycles;
}
