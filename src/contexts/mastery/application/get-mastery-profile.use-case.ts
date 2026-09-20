/**
 * Read model for mastery. Applies forgetting AT READ TIME.
 *
 * Nothing stored is "current" — a row written last month describes last month.
 * Decay is therefore never persisted, only projected. That keeps the write path
 * idempotent (see RecomputeMastery) while still giving the UI a truthful number
 * today, with no nightly decay job mutating rows behind everyone's back.
 */

import type { Clock } from '../../../shared/kernel/clock.js';
import { daysBetween } from '../../../shared/kernel/clock.js';
import { Ok, type Result } from '../../../shared/kernel/result.js';
import { estimateConfidence } from '../domain/bkt.js';
import { DEFAULT_MASTERY_THRESHOLD, snapshot } from '../domain/mastery-level.js';
import { applyDecay, daysUntilReview } from '../domain/retention.js';
import type { ConceptMasteryPolicy, MasteryRepository, MasteryView } from './ports.js';

export interface GetMasteryProfileQuery {
  readonly learnerKey: string;
  readonly conceptKeys?: readonly string[];
}

export class GetMasteryProfileUseCase {
  constructor(
    private readonly repository: MasteryRepository,
    private readonly policy: ConceptMasteryPolicy,
    private readonly clock: Clock,
  ) {}

  async execute(query: GetMasteryProfileQuery): Promise<Result<MasteryView[]>> {
    const records = query.conceptKeys
      ? await this.repository.findMany(query.learnerKey, query.conceptKeys)
      : await this.repository.findAllForLearner(query.learnerKey);

    const thresholds = await this.policy.thresholds(records.map((r) => r.conceptKey));
    const now = this.clock.now();

    const views = records.map((record): MasteryView => {
      const elapsed = record.lastObservedAt
        ? Math.max(0, daysBetween(record.lastObservedAt, now))
        : 0;
      const decay = applyDecay(
        { masteryAtObservation: record.mastery, stabilityDays: record.stabilityDays },
        elapsed,
      );
      const threshold = thresholds.get(record.conceptKey) ?? DEFAULT_MASTERY_THRESHOLD;

      return {
        conceptKey: record.conceptKey,
        snapshot: snapshot({
          value: record.mastery,
          confidence: record.confidence || estimateConfidence(record.attemptsCount),
          effective: decay.effectiveMastery,
          threshold,
        }),
        stabilityDays: record.stabilityDays,
        attemptsCount: record.attemptsCount,
        lastObservedAt: record.lastObservedAt,
        daysUntilReview: record.lastObservedAt
          ? Number((daysUntilReview(record.stabilityDays) - elapsed).toFixed(2))
          : null,
      };
    });

    return Ok(views);
  }
}
