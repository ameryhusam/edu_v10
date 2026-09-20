/**
 * RecomputeMastery — the single write path for learner mastery.
 *
 * Design decision: mastery is RECOMPUTED from the evidence stream, never
 * incrementally patched in place. It costs more reads, and it buys three things
 * that incremental updates cannot:
 *
 *   - Idempotence. Running it twice changes nothing, so a retried webhook or a
 *     replayed queue message cannot inflate a learner's mastery.
 *   - Auditability. The stored value is always a pure function of stored
 *     evidence, so any number can be re-derived and defended.
 *   - Safe evolution. Change BKT parameters, replay, done. No migration that
 *     tries to reinterpret numbers whose provenance is unknown.
 *
 * This is the direct answer to the legacy problem of four competing mastery
 * formulas writing the same column from five call sites.
 */

import type { Clock } from '../../../shared/kernel/clock.js';
import { daysBetween } from '../../../shared/kernel/clock.js';
import { Ok, type Result } from '../../../shared/kernel/result.js';
import { bktReplay, estimateConfidence, DEFAULT_BKT_PARAMETERS, type BktParameters } from '../domain/bkt.js';
import { snapshot, DEFAULT_MASTERY_THRESHOLD } from '../domain/mastery-level.js';
import { applyDecay, daysUntilReview, nextStability } from '../domain/retention.js';
import { deriveMisconceptionStates } from '../domain/misconception-state.js';
import type {
  ConceptMasteryPolicy,
  EvidenceReader,
  MasteryRecord,
  MasteryRepository,
  MasteryView,
  MisconceptionRecord,
} from './ports.js';

/** Baseline memory stability, in days, before any review has occurred. */
const INITIAL_STABILITY_DAYS = 1;

export interface RecomputeMasteryCommand {
  readonly learnerKey: string;
  /** Limit the recomputation to these concepts. Omit to recompute everything. */
  readonly conceptKeys?: readonly string[];
}

export class RecomputeMasteryUseCase {
  constructor(
    private readonly evidence: EvidenceReader,
    private readonly repository: MasteryRepository,
    private readonly policy: ConceptMasteryPolicy,
    private readonly clock: Clock,
    private readonly params: BktParameters = DEFAULT_BKT_PARAMETERS,
  ) {}

  async execute(command: RecomputeMasteryCommand): Promise<Result<MasteryView[]>> {
    const stream = await this.evidence.forLearner(command.learnerKey, command.conceptKeys);
    const now = this.clock.now();

    // Group by concept, preserving chronological order within each group.
    const byConcept = new Map<string, typeof stream>();
    for (const e of stream) {
      const list = byConcept.get(e.conceptKey);
      if (list) list.push(e);
      else byConcept.set(e.conceptKey, [e]);
    }

    const conceptKeys = [...byConcept.keys()];
    const thresholds = await this.policy.thresholds(conceptKeys);

    // Note: the existing stored record is deliberately NOT read here. The whole
    // point of this use case is that mastery is a pure function of evidence, so
    // reading the previous output as an input would reintroduce path dependence.

    const records: MasteryRecord[] = [];
    const views: MasteryView[] = [];
    const misconceptions: MisconceptionRecord[] = [];

    for (const [conceptKey, evidence] of byConcept) {
      const ordered = [...evidence].sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime());
      const scored = ordered.filter((e) => e.weight > 0);

      const trace = bktReplay(
        ordered.map((e) => ({ isCorrect: e.isCorrect, weight: e.weight })),
        this.params,
      );

      const lastObservedAt = ordered.length > 0 ? ordered[ordered.length - 1]!.observedAt : null;
      const confidence = estimateConfidence(scored.length);

      // Misconception state is derived from the SAME ordered stream, in the
      // same pass. It lives here rather than in its own trigger because two
      // things reacting to one answer would run in an order nobody controls —
      // and the remediation trigger, which chains after this recompute, must
      // see state produced by the answer that woke it, not the previous one.
      for (const state of deriveMisconceptionStates(ordered)) {
        misconceptions.push({
          learnerKey: command.learnerKey,
          conceptKey,
          ...state,
        });
      }

      // Stability is earned review by review, folded forward across the whole
      // ordered stream.
      //
      // It MUST start from a constant, never from the previously stored value:
      // seeding it with `existing.stabilityDays` would make each recompute
      // compound on the last, so the same evidence would yield a different
      // answer every run. That is exactly the kind of silent drift this whole
      // recompute-from-evidence design exists to prevent.
      let stability = INITIAL_STABILITY_DAYS;
      let previousAt: Date | null = null;
      for (const e of scored) {
        const gap = previousAt ? daysBetween(previousAt, e.observedAt) : 0;
        const r = gap > 0 ? applyDecay({ masteryAtObservation: 1, stabilityDays: stability }, gap).retrievability : 1;
        stability = nextStability(stability, e.isCorrect, r);
        previousAt = e.observedAt;
      }

      const elapsed = lastObservedAt ? Math.max(0, daysBetween(lastObservedAt, now)) : 0;
      const decay = applyDecay(
        { masteryAtObservation: trace.finalPosterior, stabilityDays: stability },
        elapsed,
      );
      const threshold = thresholds.get(conceptKey) ?? DEFAULT_MASTERY_THRESHOLD;

      records.push({
        learnerKey: command.learnerKey,
        conceptKey,
        mastery: Number(trace.finalPosterior.toFixed(6)),
        confidence,
        stabilityDays: stability,
        attemptsCount: scored.length,
        correctCount: scored.filter((e) => e.isCorrect).length,
        lastObservedAt,
      });

      views.push({
        conceptKey,
        snapshot: snapshot({
          value: trace.finalPosterior,
          confidence,
          effective: decay.effectiveMastery,
          threshold,
        }),
        stabilityDays: stability,
        attemptsCount: scored.length,
        lastObservedAt,
        daysUntilReview: lastObservedAt ? daysUntilReview(stability) - elapsed : null,
      });
    }

    if (records.length > 0) {
      await this.repository.upsertMany(records);
    }

    // Written even when empty: a learner whose last misconception just cleared
    // must have the stale row updated, and `conceptKeys` scopes the write so a
    // partial recompute cannot touch concepts it never examined.
    if (conceptKeys.length > 0) {
      await this.repository.replaceMisconceptions(
        command.learnerKey,
        conceptKeys,
        misconceptions,
      );
    }

    return Ok(views);
  }
}
