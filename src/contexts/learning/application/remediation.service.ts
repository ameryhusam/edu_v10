/**
 * Remediation — detecting, tracking and closing learner gaps.
 *
 * Orchestration only. Every rule about what counts as a gap, what closes one,
 * and which resource to suggest lives in `domain/remediation.ts`.
 *
 * The service exposes no way to close an episode by hand. `refresh` is the only
 * write path, and it applies the output of a pure function of current evidence.
 * A teacher who disagrees with an episode cannot dismiss it; the learner's next
 * attempt either closes it or confirms it.
 */

import { Errors } from '../../../shared/kernel/errors.js';
import { Err, Ok, type Result } from '../../../shared/kernel/result.js';
import type { Clock } from '../../../shared/kernel/clock.js';
import { stableKeyFingerprint } from '../../../shared/kernel/identifiers.js';
import {
  detectEpisodes,
  recommendForEpisode,
  summariseEpisodes,
  type CandidateResource,
  type Recommendation,
  type RemediationSummary,
  type RemediationTrigger,
} from '../domain/remediation.js';
import { daysBetween } from '../../../shared/kernel/clock.js';
import type { ResourceReader } from './ports.js';
import type {
  EpisodeRecord,
  GapEvidenceReader,
  RemediationRepository,
} from './remediation.ports.js';

/**
 * What a caller sees.
 *
 * `ageDays` and `durationDays` are derived here rather than left to each UI:
 * "open since the 3rd" requires the reader to do arithmetic before they can
 * tell whether it is urgent, and two clients doing that arithmetic differently
 * is how the legacy dashboards ended up disagreeing with each other.
 */
export interface EpisodeView extends EpisodeRecord {
  readonly recommendations: readonly Recommendation[];
  /** Days since the gap was detected. */
  readonly ageDays: number;
  /** Days from open to close; null while still open. */
  readonly durationDays: number | null;
  /** The numbers the decision was made on, surfaced under a stable name. */
  readonly evidence: Record<string, unknown>;
}

/** One learner's slice of the cohort tracker. */
export interface TrackerRow {
  readonly learnerKey: string;
  readonly openCount: number;
  readonly episodes: readonly EpisodeView[];
}

const TRIGGER_INITIAL: Record<RemediationTrigger, string> = {
  MISCONCEPTION: 'C',
  MASTERY_GAP: 'G',
};

export class RemediationService {
  constructor(
    private readonly episodes: RemediationRepository,
    private readonly evidence: GapEvidenceReader,
    private readonly resources: ResourceReader,
    private readonly clock: Clock,
  ) {}

  /**
   * Re-derive this learner's episodes from current evidence.
   *
   * Idempotent, and idempotent in the strong sense: it reads the evidence and
   * the currently open episodes, and never reads its own previous conclusions
   * as an input to recomputing them. Running it twice in a row opens nothing
   * the second time — proven by test, and backstopped by the partial unique
   * index on open episodes.
   */
  async refresh(input: {
    learnerKey: string;
    conceptKeys?: readonly string[];
    textbookKey?: string | null;
  }): Promise<Result<{ opened: number; resolved: number }>> {
    const [evidence, open] = await Promise.all([
      this.evidence.forLearner({
        learnerKey: input.learnerKey,
        ...(input.conceptKeys?.length ? { conceptKeys: input.conceptKeys } : {}),
        textbookKey: input.textbookKey ?? null,
      }),
      this.episodes.openEpisodesFor(input.learnerKey),
    ]);

    const detection = detectEpisodes(evidence, open);
    const at = this.clock.now();

    const toOpen = detection.toOpen.map((episode) => ({
      ...episode,
      episodeKey: this.episodeKey({
        learnerKey: input.learnerKey,
        conceptKey: episode.conceptKey,
        trigger: episode.trigger,
        // Two misconceptions diagnosed on the same concept in the same
        // millisecond would otherwise derive the same key and the second
        // insert would be dropped as a duplicate.
        misconceptionKey: episode.misconceptionKey,
        at,
      }),
    }));

    const applied = await this.episodes.applyDetection({
      learnerKey: input.learnerKey,
      toOpen,
      toResolve: detection.toResolve,
      at,
    });

    return Ok(applied);
  }

  /**
   * A learner's open gaps, each with what to do about them.
   *
   * Recommendations are computed here rather than stored: a persisted
   * suggestion is stale the moment the content changes or the mastery moves.
   * What is worth persisting is the problem, not the advice.
   */
  async openEpisodes(input: {
    learnerKey: string;
    withRecommendations?: boolean;
    limit?: number;
  }): Promise<Result<EpisodeView[]>> {
    const episodes = await this.episodes.forLearner(input.learnerKey, true);
    const now = this.clock.now();

    if (input.withRecommendations === false) {
      return Ok(episodes.map((e) => this.view(e, [], now)));
    }

    const out: EpisodeView[] = [];
    for (const episode of episodes.slice(0, input.limit ?? 20)) {
      out.push(this.view(episode, await this.recommendationsFor(episode), now));
    }

    return Ok(out);
  }

  /**
   * Everything on record for one learner, open or closed.
   *
   * Closed episodes are the point: "this took eleven days to fix" is the only
   * evidence anyone has that remediation is working at all.
   */
  async history(learnerKey: string): Promise<Result<EpisodeView[]>> {
    const now = this.clock.now();
    const episodes = await this.episodes.forLearner(learnerKey, false);
    return Ok(episodes.map((e) => this.view(e, [], now)));
  }

  /**
   * The teacher's tracker.
   *
   * Reports `stale` by name rather than only as a count: "12% overdue" is a
   * statistic, while a list of episodes open for a fortnight is something a
   * teacher can act on this afternoon.
   */
  async cohortTracker(input: {
    learnerKeys: readonly string[];
    staleAfterDays?: number;
  }): Promise<Result<{ learners: readonly TrackerRow[]; summary: RemediationSummary }>> {
    if (input.learnerKeys.length === 0) {
      return Err(
        Errors.notFound('remediation.empty_cohort', 'No learners in scope.'),
      );
    }

    const episodes = await this.episodes.forLearners({ learnerKeys: input.learnerKeys });
    const now = this.clock.now();

    // Grouped by learner, because the teacher's question is "who needs me?",
    // not "how many episodes exist". A flat list makes them do the grouping.
    const byLearner = new Map<string, EpisodeView[]>();
    for (const episode of episodes) {
      const list = byLearner.get(episode.learnerKey) ?? [];
      list.push(this.view(episode, [], now));
      byLearner.set(episode.learnerKey, list);
    }

    const learners: TrackerRow[] = [...byLearner.entries()]
      .map(([learnerKey, rows]) => ({
        learnerKey,
        openCount: rows.filter((r) => r.status === 'OPEN').length,
        episodes: rows,
      }))
      // Most open gaps first: the tracker should lead with the learner in most
      // trouble, not with whoever sorts first alphabetically.
      .sort((a, b) => b.openCount - a.openCount || a.learnerKey.localeCompare(b.learnerKey));

    return Ok({
      learners,
      summary: summariseEpisodes(
        episodes.map((e) => ({
          episodeKey: e.episodeKey,
          conceptKey: e.conceptKey,
          trigger: e.trigger,
          openedAt: e.openedAt,
          resolvedAt: e.resolvedAt,
        })),
        now,
        input.staleAfterDays ?? 14,
      ),
    });
  }

  /**
   * Retire episodes whose concept has left the book.
   *
   * SUPERSEDED rather than RESOLVED, because the gap did not close — the
   * question stopped being meaningful. Recording it as a resolution would
   * inflate the "we fixed it" figure every time a textbook was reorganised.
   */
  async supersedeForConcepts(conceptKeys: readonly string[]): Promise<Result<number>> {
    if (conceptKeys.length === 0) return Ok(0);
    return Ok(await this.episodes.supersedeForConcepts(conceptKeys, this.clock.now()));
  }

  private async recommendationsFor(episode: EpisodeRecord): Promise<readonly Recommendation[]> {
    // The resource reader already filters to published, active content, so a
    // remediation can never point a learner at a draft dead end.
    const available = await this.resources.forConcept(episode.conceptKey);

    const candidates: CandidateResource[] = available.map((resource) => ({
      resourceKey: resource.resourceKey,
      kind: resource.kind,
      title: resource.title,
      estimatedMins: resource.estimatedMinutes,
    }));

    return recommendForEpisode(episode.trigger, candidates);
  }

  /**
   * Episode identity.
   *
   * Includes the opening timestamp so that a gap which closes and later
   * reappears gets a genuinely new key. Deriving it from learner + concept +
   * trigger alone would collide with the resolved episode and destroy the
   * record of how long the first one took to close.
   */
  private episodeKey(input: {
    learnerKey: string;
    conceptKey: string;
    trigger: RemediationTrigger;
    misconceptionKey: string | null;
    at: Date;
  }): string {
    const fingerprint = stableKeyFingerprint(
      [
        input.learnerKey,
        input.conceptKey,
        input.trigger,
        input.misconceptionKey ?? '',
        input.at.toISOString(),
      ].join(':'),
    );
    return `REM-${TRIGGER_INITIAL[input.trigger]}${fingerprint}`;
  }

  /** Adds the derived fields every reader would otherwise compute itself. */
  private view(
    episode: EpisodeRecord,
    recommendations: readonly Recommendation[],
    now: Date,
  ): EpisodeView {
    return {
      ...episode,
      recommendations,
      ageDays: Math.max(0, Math.floor(daysBetween(episode.openedAt, now))),
      durationDays: episode.resolvedAt
        ? Math.max(0, Math.floor(daysBetween(episode.openedAt, episode.resolvedAt)))
        : null,
      evidence: episode.openedEvidence,
    };
  }
}
