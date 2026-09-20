/**
 * Remediation episodes — PURE.
 *
 * A remediation episode is a persisted claim that a specific learner has a
 * specific gap, opened by evidence and closed by evidence.
 *
 * The distinction that justifies it: `decideNextActivity` answers "what should
 * this learner do right now?" and recomputes from scratch every call, keeping
 * nothing. It cannot answer "does this learner have an unresolved gap, since
 * when, and did it close?" — and that second question is the one a teacher
 * actually asks.
 *
 * Legacy answered it with `StudentAssignment.originType = 'REMEDIAL'`, which
 * meant a gap only existed if a human had created an assignment for it, and
 * "did it work?" was whatever someone last typed into a PATCHable
 * `masteryAchieved` field. Both are refused here: episodes open from evidence
 * automatically, and nothing in this module can close one on request.
 *
 * See docs/REMEDIATION-GATE.md.
 */

import { DEFAULT_MASTERY_THRESHOLD } from '../../mastery/domain/mastery-level.js';

/** Why an episode was opened. */
export type RemediationTrigger = 'MISCONCEPTION' | 'MASTERY_GAP';

export type RemediationStatus = 'OPEN' | 'RESOLVED' | 'SUPERSEDED';

/**
 * Minimum observations before a low mastery estimate is believed.
 *
 * Below this the number is mostly the BKT prior (pL0 = 0.10), so every concept
 * a learner has merely glanced at would open an episode. An unstarted concept
 * is not a gap — it is unstarted. Same reasoning as INSUFFICIENT_DATA in item
 * analysis.
 */
export const MIN_OBSERVATIONS_FOR_GAP = 3;

/** Per-concept evidence, as detection sees it. */
export interface GapEvidence {
  readonly conceptKey: string;
  /** Decay-adjusted mastery, 0..1. */
  readonly effectiveMastery: number;
  /** Raw BKT belief, ignoring forgetting. Decay alone is not a gap. */
  readonly mastery: number;
  readonly observations: number;
  readonly masteryThreshold?: number;
  /** Unresolved misconception keys diagnosed on this concept. */
  readonly openMisconceptionKeys: readonly string[];
}

/** An episode already on record. */
export interface ExistingEpisode {
  readonly episodeKey: string;
  readonly conceptKey: string;
  readonly trigger: RemediationTrigger;
  readonly status: RemediationStatus;
  readonly misconceptionKey: string | null;
}

/** An episode detection wants to open. */
export interface EpisodeToOpen {
  readonly conceptKey: string;
  readonly trigger: RemediationTrigger;
  readonly misconceptionKey: string | null;
  /** Why, in stable form — rendered by the interface layer. */
  readonly reason: string;
  /** Supporting numbers, so a teacher can be shown the basis. */
  readonly evidence: Readonly<Record<string, unknown>>;
}

/** An open episode whose gap has closed. */
export interface EpisodeToResolve {
  readonly episodeKey: string;
  readonly reason: string;
  readonly evidence: Readonly<Record<string, unknown>>;
}

export interface DetectionResult {
  readonly toOpen: readonly EpisodeToOpen[];
  readonly toResolve: readonly EpisodeToResolve[];
}

function thresholdFor(evidence: GapEvidence): number {
  return evidence.masteryThreshold ?? DEFAULT_MASTERY_THRESHOLD;
}

/**
 * Detect which episodes should open and which should close.
 *
 * A pure function of (current evidence, currently open episodes) — the same
 * shape as mastery recompute, and for the same reason: running it twice must
 * change nothing. It never reads its own previous output, so a retried job
 * cannot inflate the list.
 *
 * Note what is NOT a trigger. Decay is not: forgetting is normal and
 * self-correcting, and opening an episode whenever retrievability dipped would
 * open one for every learner every week, producing a list nobody reads. A
 * locked prerequisite is not either: the gap is on the prerequisite concept,
 * where an episode is already open, and opening a second on the blocked
 * concept would double-count one problem.
 */
export function detectEpisodes(
  evidence: readonly GapEvidence[],
  existing: readonly ExistingEpisode[],
): DetectionResult {
  const open = existing.filter((e) => e.status === 'OPEN');
  const toOpen: EpisodeToOpen[] = [];
  const toResolve: EpisodeToResolve[] = [];

  const byConcept = new Map(evidence.map((e) => [e.conceptKey, e]));

  for (const concept of evidence) {
    const threshold = thresholdFor(concept);

    // ── Misconceptions ──────────────────────────────────────────────────────
    // One episode per distinct misconception: two different wrong models about
    // the same concept are two different things to correct, and collapsing
    // them would lose whichever was diagnosed second.
    for (const misconceptionKey of concept.openMisconceptionKeys) {
      const already = open.some(
        (e) =>
          e.conceptKey === concept.conceptKey &&
          e.trigger === 'MISCONCEPTION' &&
          e.misconceptionKey === misconceptionKey,
      );
      if (already) continue;

      toOpen.push({
        conceptKey: concept.conceptKey,
        trigger: 'MISCONCEPTION',
        misconceptionKey,
        reason: 'remediation.misconception_diagnosed',
        evidence: {
          misconceptionKey,
          effectiveMastery: concept.effectiveMastery,
          observations: concept.observations,
        },
      });
    }

    // ── Mastery gaps ────────────────────────────────────────────────────────
    // Judged on RAW mastery, not the decay-adjusted value. A learner who knew
    // this last month and has merely forgotten it needs review, not
    // remediation, and the two are different pedagogical responses.
    const hasGap =
      concept.observations >= MIN_OBSERVATIONS_FOR_GAP && concept.mastery < threshold;

    const openGap = open.find(
      (e) => e.conceptKey === concept.conceptKey && e.trigger === 'MASTERY_GAP',
    );

    if (hasGap && !openGap) {
      toOpen.push({
        conceptKey: concept.conceptKey,
        trigger: 'MASTERY_GAP',
        misconceptionKey: null,
        reason: 'remediation.mastery_below_threshold',
        evidence: {
          mastery: concept.mastery,
          effectiveMastery: concept.effectiveMastery,
          threshold,
          observations: concept.observations,
          deficit: Number((threshold - concept.mastery).toFixed(4)),
        },
      });
    }

    if (!hasGap && openGap && concept.observations >= MIN_OBSERVATIONS_FOR_GAP) {
      toResolve.push({
        episodeKey: openGap.episodeKey,
        reason: 'remediation.mastery_recovered',
        evidence: {
          mastery: concept.mastery,
          threshold,
          observations: concept.observations,
        },
      });
    }
  }

  // ── Misconception episodes whose misconception is gone ────────────────────
  for (const episode of open) {
    if (episode.trigger !== 'MISCONCEPTION') continue;

    const concept = byConcept.get(episode.conceptKey);
    // No evidence for the concept at all means it left this learner's scope,
    // not that the misconception was corrected. Left alone deliberately:
    // SUPERSEDED is the content lifecycle's call, not detection's.
    if (!concept) continue;

    const stillOpen =
      episode.misconceptionKey !== null &&
      concept.openMisconceptionKeys.includes(episode.misconceptionKey);

    if (!stillOpen) {
      toResolve.push({
        episodeKey: episode.episodeKey,
        reason: 'remediation.misconception_resolved',
        evidence: { misconceptionKey: episode.misconceptionKey },
      });
    }
  }

  return { toOpen, toResolve };
}

// ── Recommendations ──────────────────────────────────────────────────────────

export type ResourceKind =
  | 'READING'
  | 'VIDEO'
  | 'WORKED_EXAMPLE'
  | 'FLASHCARD_DECK'
  | 'REMEDIAL'
  | 'TEXTBOOK_PAGE';

export interface CandidateResource {
  readonly resourceKey: string;
  readonly kind: ResourceKind;
  readonly title: string;
  readonly estimatedMins: number | null;
}

export interface Recommendation {
  readonly resourceKey: string;
  readonly kind: ResourceKind;
  readonly title: string;
  readonly estimatedMins: number | null;
  /** Rank position, 0-based. */
  readonly rank: number;
  /** Stable code explaining why this resource was chosen for this gap. */
  readonly reason: string;
}

/**
 * Modality preference per trigger.
 *
 * A misconception needs CORRECTION, not re-exposition: a learner holding a
 * wrong mental model who re-reads the original explanation usually re-derives
 * the same wrong model. So REMEDIAL content leads, and plain READING is last.
 *
 * A mastery gap is different — the learner has typically already read the
 * lesson and still lacks it, so a worked example (a different modality) beats
 * re-reading the same prose.
 */
const PREFERENCE: Record<RemediationTrigger, readonly ResourceKind[]> = {
  MISCONCEPTION: ['REMEDIAL', 'WORKED_EXAMPLE', 'VIDEO', 'FLASHCARD_DECK', 'TEXTBOOK_PAGE', 'READING'],
  MASTERY_GAP: ['WORKED_EXAMPLE', 'VIDEO', 'REMEDIAL', 'READING', 'FLASHCARD_DECK', 'TEXTBOOK_PAGE'],
};

/**
 * Rank resources for one episode.
 *
 * Computed at read time and never stored. A persisted recommendation is stale
 * the moment the content changes or the learner's mastery moves; what is worth
 * persisting is the PROBLEM (the episode), not the suggestion. The decision log
 * records what was suggested and why, which is the audit trail.
 */
export function recommendForEpisode(
  trigger: RemediationTrigger,
  candidates: readonly CandidateResource[],
  limit = 3,
): readonly Recommendation[] {
  const order = PREFERENCE[trigger];

  const ranked = [...candidates].sort((a, b) => {
    const byKind = order.indexOf(a.kind) - order.indexOf(b.kind);
    if (byKind !== 0) return byKind;

    // Shorter first: a 5-minute resource that gets attempted beats a 40-minute
    // one that does not. Unknown duration sorts last rather than first, so an
    // unestimated resource cannot jump the queue.
    const aMins = a.estimatedMins ?? Number.MAX_SAFE_INTEGER;
    const bMins = b.estimatedMins ?? Number.MAX_SAFE_INTEGER;
    if (aMins !== bMins) return aMins - bMins;

    // Deterministic tie-break, so the same gap yields the same order twice.
    return a.resourceKey.localeCompare(b.resourceKey);
  });

  return ranked.slice(0, limit).map((resource, rank) => ({
    resourceKey: resource.resourceKey,
    kind: resource.kind,
    title: resource.title,
    estimatedMins: resource.estimatedMins,
    rank,
    reason:
      resource.kind === 'REMEDIAL' && trigger === 'MISCONCEPTION'
        ? 'remediation.corrective_content'
        : resource.kind === 'WORKED_EXAMPLE'
          ? 'remediation.alternative_modality'
          : 'remediation.concept_resource',
  }));
}

// ── Reporting ────────────────────────────────────────────────────────────────

export interface EpisodeAge {
  readonly episodeKey: string;
  readonly conceptKey: string;
  readonly trigger: RemediationTrigger;
  readonly openedAt: Date;
  readonly resolvedAt: Date | null;
}

export interface RemediationSummary {
  readonly open: number;
  readonly resolved: number;
  readonly byTrigger: Readonly<Record<RemediationTrigger, number>>;
  /** Median days an episode stayed open. Null when nothing has closed yet. */
  readonly medianDaysToResolve: number | null;
  /** Open longer than `staleAfterDays`. The list a teacher should act on. */
  readonly stale: readonly string[];
}

/**
 * Summarise a set of episodes.
 *
 * `medianDaysToResolve` covers RESOLVED episodes only. Including open ones by
 * measuring "days so far" would mix two different quantities and make the
 * number improve every time an old gap finally closes badly.
 */
export function summariseEpisodes(
  episodes: readonly EpisodeAge[],
  now: Date,
  staleAfterDays = 14,
): RemediationSummary {
  const open = episodes.filter((e) => e.resolvedAt === null);
  const resolved = episodes.filter((e) => e.resolvedAt !== null);

  const byTrigger: Record<RemediationTrigger, number> = { MISCONCEPTION: 0, MASTERY_GAP: 0 };
  for (const episode of open) byTrigger[episode.trigger] += 1;

  const durations = resolved
    .map((e) => daysBetween(e.openedAt, e.resolvedAt!))
    .sort((a, b) => a - b);

  return {
    open: open.length,
    resolved: resolved.length,
    byTrigger,
    medianDaysToResolve: durations.length === 0 ? null : round(median(durations)),
    stale: open
      .filter((e) => daysBetween(e.openedAt, now) >= staleAfterDays)
      .map((e) => e.episodeKey),
  };
}

function daysBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / 86_400_000;
}

function median(sorted: readonly number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
