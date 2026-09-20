/**
 * Ports for remediation episodes.
 *
 * The shape to notice: there is no `closeEpisode(key)` and no
 * `dismissEpisode(key)`. Resolution is only reachable through
 * `applyDetection`, which takes the output of a pure function of evidence. The
 * absence is the enforcement — a manual close cannot be added by accident at a
 * call site, only by deliberately widening this interface.
 *
 * That is the direct correction of legacy, where `masteryAchieved` was PATCHable
 * and "did remediation work?" was whatever a human last typed.
 */

import type {
  EpisodeToOpen,
  EpisodeToResolve,
  ExistingEpisode,
  GapEvidence,
  RemediationStatus,
  RemediationTrigger,
} from '../domain/remediation.js';

export interface EpisodeRecord {
  readonly episodeKey: string;
  readonly learnerKey: string;
  readonly conceptKey: string;
  readonly trigger: RemediationTrigger;
  readonly status: RemediationStatus;
  readonly misconceptionKey: string | null;
  readonly openedReason: string;
  readonly resolvedReason: string | null;
  readonly openedEvidence: Readonly<Record<string, unknown>>;
  readonly openedAt: Date;
  readonly resolvedAt: Date | null;
}

export interface RemediationRepository {
  /** Episodes for one learner. `openOnly` is the common case. */
  forLearner(learnerKey: string, openOnly?: boolean): Promise<EpisodeRecord[]>;

  /** The lightweight view detection needs — no evidence payloads. */
  openEpisodesFor(learnerKey: string): Promise<ExistingEpisode[]>;

  /**
   * Apply one detection result atomically.
   *
   * Opens and resolves travel together because they are one reading of one
   * evidence state. Applying them separately would leave a window in which a
   * learner both has an open gap and has recovered from it, and a report
   * rendered in that window contradicts itself.
   */
  applyDetection(input: {
    learnerKey: string;
    toOpen: ReadonlyArray<EpisodeToOpen & { episodeKey: string }>;
    toResolve: readonly EpisodeToResolve[];
    at: Date;
  }): Promise<{ opened: number; resolved: number }>;

  /** Episodes across a cohort, for the teacher's tracker. */
  forLearners(input: {
    learnerKeys: readonly string[];
    openOnly?: boolean;
  }): Promise<EpisodeRecord[]>;

  /**
   * Mark episodes on concepts that have left the published book.
   *
   * SUPERSEDED, not RESOLVED: the gap did not close, the question stopped
   * being meaningful. Conflating them would inflate the "we fixed it" number
   * every time a book was reorganised.
   */
  supersedeForConcepts(conceptKeys: readonly string[], at: Date): Promise<number>;
}

/**
 * Evidence for detection, read from Mastery and Misconception.
 *
 * Learning READS both and writes neither. The port returns the fully formed
 * `GapEvidence` the domain expects, so no context reaches across into another's
 * tables to assemble it.
 */
export interface GapEvidenceReader {
  forLearner(input: {
    learnerKey: string;
    conceptKeys?: readonly string[];
    textbookKey?: string | null;
  }): Promise<GapEvidence[]>;
}
