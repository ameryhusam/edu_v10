/**
 * Engagement — XP, streaks and levels.
 *
 * A deliberately small context. It reads evidence and writes a ledger; it never
 * writes mastery, never grades, and nothing it does can change what a learner
 * is believed to know. Legacy kept `xpPoints` and `level` on `StudentProfile`
 * next to the mastery fields, which is how a motivation feature ended up able
 * to corrupt a measurement one.
 *
 * The award is driven by Assessment through a port, in exactly the way mastery
 * recompute is: Assessment says "this answer happened", and does not know that
 * XP exists.
 */

import { Errors } from '../../../shared/kernel/errors.js';
import { Err, Ok, type Result } from '../../../shared/kernel/result.js';
import { stableKeyFingerprint } from '../../../shared/kernel/identifiers.js';
import {
  calculateXp,
  levelProgress,
  starsFor,
  streakFrom,
  type XpBreakdown,
} from '../domain/xp.js';
import type {
  AnswerHistoryReader,
  XpEntryRecord,
  XpLedger,
} from './engagement.ports.js';

/** How far back to look when computing a streak. */
const STREAK_WINDOW = 20;

export interface XpSummary {
  readonly learnerKey: string;
  readonly totalXp: number;
  readonly level: number;
  readonly intoLevel: number;
  readonly toNextLevel: number;
  /** 0..1 — the share of the current level already earned. */
  readonly levelCompletion: number;
  /** Stars the total has paid for, at one per hundred XP. */
  readonly stars: number;
  readonly currentStreak: number;
  readonly recent: readonly XpEntryRecord[];
}

export interface AwardOutcome extends XpBreakdown {
  /** True when this exact award had already been recorded. */
  readonly duplicate: boolean;
  readonly streak: number;
}

export class EngagementService {
  constructor(
    private readonly ledger: XpLedger,
    private readonly history: AnswerHistoryReader,
  ) {}

  /**
   * Reward a graded answer.
   *
   * The caller supplies what *happened* — was it right, how long did it take,
   * how hard was the item. It does not supply the streak and cannot supply the
   * amount: legacy read `streakCount` straight out of the request body, so any
   * client could mint XP at double rate by claiming a streak of ten.
   */
  async rewardAnswer(input: {
    learnerKey: string;
    questionKey: string;
    attemptKey: string;
    isCorrect: boolean;
    secondsToAnswer: number | null;
    difficulty: number;
  }): Promise<Result<AwardOutcome>> {
    // The streak is the run of correct answers BEFORE this one, and this answer
    // is already in the evidence stream by the time we are called — so the
    // first entry is dropped. Counting it would give every correct answer a
    // free extra 10%.
    const recent = await this.history.recentAnswers(input.learnerKey, STREAK_WINDOW + 1);
    const streak = streakFrom(recent.slice(1));

    const breakdown = calculateXp({
      isCorrect: input.isCorrect,
      secondsToAnswer: input.secondsToAnswer,
      streak,
      difficulty: input.difficulty,
    });

    if (breakdown.totalXp === 0) {
      // Nothing to record. Writing a zero row would bloat the ledger and make
      // "how many awards has this learner earned" meaningless.
      return Ok({ ...breakdown, duplicate: false, streak });
    }

    // Derived from the answer itself, so a retry of the same submission lands
    // on the same key and is rejected by the unique constraint. Legacy's
    // fallback embedded Date.now(), which is unique every time — the opposite
    // of an idempotency key.
    const idempotencyKey = `xp:${stableKeyFingerprint(
      `${input.learnerKey}:${input.attemptKey}:${input.questionKey}`,
    )}`;

    const written = await this.ledger.append({
      learnerKey: input.learnerKey,
      amount: breakdown.totalXp,
      reason: 'answer.correct',
      sourceKey: input.questionKey,
      idempotencyKey,
    });

    return Ok({ ...breakdown, duplicate: !written, streak });
  }

  /** Everything a learner's XP panel needs, in one read. */
  async summaryFor(learnerKey: string): Promise<Result<XpSummary>> {
    const [totalXp, recent, answers] = await Promise.all([
      this.ledger.totalFor(learnerKey),
      this.ledger.recentFor(learnerKey, 10),
      this.history.recentAnswers(learnerKey, STREAK_WINDOW),
    ]);

    const progress = levelProgress(totalXp);

    return Ok({
      learnerKey,
      totalXp,
      ...progress,
      stars: starsFor(totalXp),
      currentStreak: streakFrom(answers),
      recent,
    });
  }

  /**
   * A leaderboard over an explicit cohort.
   *
   * Scoped to learners the caller already has the right to see, never "top N
   * globally": a platform-wide ranking exposes one school's learners to another
   * and turns a motivation feature into a data leak.
   */
  async leaderboard(input: {
    learnerKeys: readonly string[];
    limit?: number;
  }): Promise<Result<{ learnerKey: string; totalXp: number; level: number; rank: number }[]>> {
    if (input.learnerKeys.length === 0) {
      return Err(
        Errors.notFound('engagement.empty_cohort', 'No learners in scope.'),
      );
    }

    const totals = await this.ledger.totalsFor(input.learnerKeys);

    const rows = input.learnerKeys
      // Learners with no XP are included at zero rather than omitted: a
      // leaderboard that hides the bottom is how a learner discovers they are
      // invisible rather than last.
      .map((learnerKey) => ({ learnerKey, totalXp: totals.get(learnerKey) ?? 0 }))
      .sort((a, b) => b.totalXp - a.totalXp || a.learnerKey.localeCompare(b.learnerKey));

    return Ok(
      rows.slice(0, input.limit ?? 20).map((row, index) => ({
        ...row,
        level: levelProgress(row.totalXp).level,
        rank: index + 1,
      })),
    );
  }
}
