/**
 * The Engagement capability, as the UI sees it.
 *
 * XP is a ledger the server owns: every award was recorded for a graded
 * answer, and the summary here (total, level, streak) is computed by the
 * Engagement context — never in this file. The junior hero capsule shows
 * these numbers as they arrive; the day a component starts awarding itself
 * XP for a flipped card is the day the ledger stops meaning anything.
 */

import { api } from '../../shared/api/client';

/** Matches XpSummary on the server, serialised over JSON. */
export interface XpSummary {
  readonly learnerKey: string;
  readonly totalXp: number;
  readonly level: number;
  /** How far into the current level, in XP points. */
  readonly intoLevel: number;
  /** XP still needed to reach the next level. */
  readonly toNextLevel: number;
  /** 0..1 — the share of the current level already earned. Server-computed. */
  readonly levelCompletion: number;
  /** Stars the total has paid for, at one per hundred XP. Server-computed. */
  readonly stars: number;
  readonly currentStreak: number;
  /** The last awards, newest first. Reasons are machine ids, shown via i18n. */
  readonly recent: readonly XpAward[];
}

export interface XpAward {
  readonly amount: number;
  readonly reason: string;
  readonly sourceKey: string | null;
  readonly awardedAt: string;
}

export const engagementApi = {
  /** My XP: total, level, streak, and the last few awards. */
  xp: (scope: { learnerKey?: string } = {}) =>
    api.get<XpSummary>('engagement/xp', { query: scope }),
};
