/**
 * Ports owned by the Mastery context.
 *
 * These are declared by the context that USES them, not by the adapter that
 * implements them. That inversion is what keeps Prisma out of the domain, and
 * it is why the mastery estimator can be exercised in a unit test with a Map.
 */

import type { Evidence } from '../../assessment/domain/evidence.js';
import type { MasterySnapshot } from '../domain/mastery-level.js';

/** Persisted mastery record for one (learner, concept) pair. */
export interface MasteryRecord {
  readonly learnerKey: string;
  readonly conceptKey: string;
  readonly mastery: number;
  readonly confidence: number;
  readonly stabilityDays: number;
  readonly attemptsCount: number;
  readonly correctCount: number;
  readonly lastObservedAt: Date | null;
}

/**
 * Derived misconception state for one (learner, concept, misconception).
 *
 * Persisted because resolution has a lifecycle — `firstSeenAt`, `resolvedAt`,
 * "how long did they hold this?" — which a read-time derivation cannot answer,
 * and because `RemediationEpisode` already points at a stable open/closed claim
 * on this side. Deriving one side while persisting the other guarantees they
 * disagree.
 */
export interface MisconceptionRecord {
  readonly learnerKey: string;
  readonly conceptKey: string;
  readonly misconceptionKey: string;
  readonly occurrences: number;
  readonly confidence: number;
  readonly firstSeenAt: Date;
  readonly lastSeenAt: Date;
  readonly isResolved: boolean;
  readonly resolvedAt: Date | null;
}

export interface MasteryRepository {
  findOne(learnerKey: string, conceptKey: string): Promise<MasteryRecord | null>;
  findMany(learnerKey: string, conceptKeys: readonly string[]): Promise<MasteryRecord[]>;
  findAllForLearner(learnerKey: string): Promise<MasteryRecord[]>;
  /**
   * The ONLY write path for mastery in the entire platform. Every other module
   * reads. Enforced by scripts/check-architecture.ts.
   */
  upsertMany(records: readonly MasteryRecord[]): Promise<void>;

  /**
   * The ONLY write path for misconception state, for the same reason
   * `upsertMany` is the only one for mastery: both are derived from the
   * evidence stream, and a second writer means two disagreeing answers.
   * Enforced by rule MW1.
   *
   * Scoped by concept so a partial recompute cannot delete state for concepts
   * it did not examine.
   */
  replaceMisconceptions(
    learnerKey: string,
    conceptKeys: readonly string[],
    records: readonly MisconceptionRecord[],
  ): Promise<void>;
}

/** Read-only access to the ordered evidence stream, owned by Assessment. */
export interface EvidenceReader {
  /** Chronologically ordered evidence for a learner, optionally scoped. */
  forLearner(learnerKey: string, conceptKeys?: readonly string[]): Promise<Evidence[]>;
}

export interface ConceptMasteryPolicy {
  /** Concept-level threshold overrides, keyed by concept key. */
  thresholds(conceptKeys: readonly string[]): Promise<ReadonlyMap<string, number>>;
}

export interface MasteryView {
  readonly conceptKey: string;
  readonly snapshot: MasterySnapshot;
  readonly stabilityDays: number;
  readonly attemptsCount: number;
  readonly lastObservedAt: Date | null;
  readonly daysUntilReview: number | null;
}
