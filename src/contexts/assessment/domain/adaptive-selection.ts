/**
 * Computerised adaptive testing: which item next, and when to stop.
 *
 * PURE. This is the single owner of "next item" for exams. The learning context
 * owns "next activity" (read / practise / review / assess) — a different, higher
 * level question. Keeping the two apart is what stops the two engines from
 * silently disagreeing, which is what happened in the legacy code where item
 * choice was done by naive difficulty-distance sorting in a service.
 */

import { itemInformation, standardError, type ItemParameters, type ItemResponse } from './irt.js';

export interface AdaptiveConfig {
  readonly minItems: number;
  readonly maxItems: number;
  /** Stop once SE(theta) drops below this — the precision target. */
  readonly targetStandardError: number;
  /**
   * Exposure control. Rather than always serving the single most informative
   * item (which burns the best items and makes the bank predictable), sample
   * from the top-N. 1 = pure maximum information.
   */
  readonly exposureTopN: number;
  /** Max items drawn from any one content domain, to keep blueprint coverage. */
  readonly domainQuota?: Readonly<Record<string, number>>;
}

export const DEFAULT_ADAPTIVE_CONFIG: AdaptiveConfig = Object.freeze({
  minItems: 5,
  maxItems: 25,
  targetStandardError: 0.3,
  exposureTopN: 3,
});

export interface SelectionContext {
  readonly theta: number;
  readonly pool: readonly ItemParameters[];
  readonly administeredIds: readonly string[];
  readonly domainCounts?: Readonly<Record<string, number>>;
  readonly config?: AdaptiveConfig;
  /** Injected randomness — keeps selection deterministic under test. */
  readonly random?: () => number;
}

export interface SelectionResult {
  readonly item: ItemParameters;
  readonly information: number;
  readonly rank: number;
}

export function selectNextItem(ctx: SelectionContext): SelectionResult | null {
  const config = ctx.config ?? DEFAULT_ADAPTIVE_CONFIG;
  const seen = new Set(ctx.administeredIds);
  const counts = ctx.domainCounts ?? {};

  const candidates = ctx.pool
    .filter((item) => !seen.has(item.id))
    .map((item) => {
      let info = itemInformation(ctx.theta, item);
      const quota = item.domain ? config.domainQuota?.[item.domain] : undefined;
      if (quota !== undefined && (counts[item.domain!] ?? 0) >= quota) {
        info *= 0.25; // deprioritise, never hard-exclude: an empty pool is worse
      }
      return { item, information: info };
    })
    .sort((x, y) => y.information - x.information);

  if (candidates.length === 0) return null;

  const topN = Math.max(1, Math.min(config.exposureTopN, candidates.length));
  const random = ctx.random ?? Math.random;
  const index = topN === 1 ? 0 : Math.floor(random() * topN) % topN;
  const chosen = candidates[index]!;

  return { item: chosen.item, information: chosen.information, rank: index };
}

export type StopReason = 'PRECISION_REACHED' | 'MAX_ITEMS' | 'POOL_EXHAUSTED' | 'CONTINUE';

export interface StopDecision {
  readonly shouldStop: boolean;
  readonly reason: StopReason;
  readonly standardError: number;
}

export function evaluateStoppingRule(input: {
  theta: number;
  administered: readonly ItemParameters[];
  poolRemaining: number;
  config?: AdaptiveConfig;
}): StopDecision {
  const config = input.config ?? DEFAULT_ADAPTIVE_CONFIG;
  const se = standardError(input.theta, input.administered);
  const count = input.administered.length;

  if (count < config.minItems) {
    return { shouldStop: false, reason: 'CONTINUE', standardError: se };
  }
  if (se <= config.targetStandardError) {
    return { shouldStop: true, reason: 'PRECISION_REACHED', standardError: se };
  }
  if (count >= config.maxItems) {
    return { shouldStop: true, reason: 'MAX_ITEMS', standardError: se };
  }
  if (input.poolRemaining <= 0) {
    return { shouldStop: true, reason: 'POOL_EXHAUSTED', standardError: se };
  }
  return { shouldStop: false, reason: 'CONTINUE', standardError: se };
}

/** Convenience: full adaptive session state, recomputed from responses. */
export interface AdaptiveSessionState {
  readonly theta: number;
  readonly standardError: number;
  readonly administeredCount: number;
  readonly responses: readonly ItemResponse[];
}
