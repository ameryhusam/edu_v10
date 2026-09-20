/**
 * XP — the reward algorithm, ported from legacy and corrected.
 *
 * The legacy formula was pedagogically reasonable and is kept exactly:
 *
 *     base       = round(15 + difficulty × 5)
 *     speedBonus = +5 when answered in under 15 seconds
 *     multiplier = min(2.0, 1 + 0.1 × streak)
 *     total      = round((base + speedBonus) × multiplier)
 *
 * Three things about the legacy *implementation* were not kept.
 *
 * **1. The streak arrived from the client.** `handleXPCalculation` read
 * `streakCount` out of `req.body` and multiplied by it. Anyone who could call
 * the endpoint could mint XP at 2× by claiming a streak of ten. Here the streak
 * is derived from the learner's own evidence (see `streakFrom`) and is never an
 * input to the API.
 *
 * **2. The award was not idempotent.** The repository fell back to
 * `xp_${id}_${Date.now()}` when no idempotency key was supplied — a key that is
 * different on every call, so a retried request paid twice. Here the key is
 * derived from what was rewarded, so a replay is free.
 *
 * **3. Wrong answers were worth nothing, including the streak.** That part is
 * kept: XP rewards demonstrated success. But note what it means — a learner
 * cannot farm XP by answering the same easy question repeatedly, because
 * `SubmitAnswer` refuses a second answer to an already-answered question.
 *
 * Nothing here touches mastery. XP is motivation; mastery is measurement.
 * Legacy kept both on `StudentProfile` and the two drifted.
 */

/** Awarded only for a correct answer. */
export interface XpAttempt {
  readonly isCorrect: boolean;
  readonly secondsToAnswer: number | null;
  /** Consecutive correct answers BEFORE this one. */
  readonly streak: number;
  /** 0..1 item difficulty, as stored on the question. */
  readonly difficulty: number;
}

export interface XpBreakdown {
  readonly baseXp: number;
  readonly speedBonus: number;
  readonly streakMultiplier: number;
  readonly totalXp: number;
}

/** Answer faster than this and the speed bonus applies. */
export const SPEED_BONUS_SECONDS = 15;
export const SPEED_BONUS_XP = 5;
/** The streak multiplier stops here, so a long streak cannot run away. */
export const MAX_STREAK_MULTIPLIER = 2;
export const XP_PER_LEVEL = 400;
/**
 * One star per hundred XP — the legacy junior star economy, kept stable so a
 * learner who saw the old board reads the same ladder. A domain rule, not a
 * client display choice: the UI must not divide for itself (FE8).
 */
export const XP_PER_STAR = 100;

/** Stars a total has paid for. The only star rule in the product. */
export function starsFor(totalXp: number): number {
  return Math.max(0, Math.floor(totalXp / XP_PER_STAR));
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

export function calculateXp(attempt: XpAttempt): XpBreakdown {
  if (!attempt.isCorrect) {
    return { baseXp: 0, speedBonus: 0, streakMultiplier: 1, totalXp: 0 };
  }

  const difficulty = Number.isFinite(attempt.difficulty)
    ? Math.max(0, Math.min(1, attempt.difficulty))
    : 0.5;

  const baseXp = Math.round(15 + difficulty * 5);

  // A null time means the client did not report one — not that the answer was
  // instant. Awarding the bonus for missing data would make it free to claim.
  const speedBonus =
    attempt.secondsToAnswer !== null &&
    attempt.secondsToAnswer > 0 &&
    attempt.secondsToAnswer < SPEED_BONUS_SECONDS
      ? SPEED_BONUS_XP
      : 0;

  const streak = Number.isFinite(attempt.streak) ? Math.max(0, Math.floor(attempt.streak)) : 0;
  const streakMultiplier = Math.min(MAX_STREAK_MULTIPLIER, 1 + streak * 0.1);

  return {
    baseXp,
    speedBonus,
    streakMultiplier: round2(streakMultiplier),
    totalXp: Math.round((baseXp + speedBonus) * streakMultiplier),
  };
}

/**
 * The streak implied by a learner's recent answers, most recent first.
 *
 * Derived rather than stored. A stored counter is a second source of truth that
 * drifts the moment anything is backfilled, replayed or corrected — the same
 * failure that produced legacy's four mastery formulas. Recomputing from
 * evidence is cheap and can never disagree with the evidence.
 */
export function streakFrom(recentAnswers: readonly { isCorrect: boolean }[]): number {
  let streak = 0;
  for (const answer of recentAnswers) {
    if (!answer.isCorrect) break;
    streak += 1;
  }
  return streak;
}

/** Levels are a presentation of the total, not a stored field that can drift. */
export function levelFor(totalXp: number): number {
  if (!Number.isFinite(totalXp) || totalXp <= 0) return 1;
  return Math.floor(totalXp / XP_PER_LEVEL) + 1;
}

/** How much further to the next level — the only number a learner asks for. */
export function levelProgress(totalXp: number): {
  level: number;
  intoLevel: number;
  toNextLevel: number;
  /** 0..1 — how much of the current level is earned. Clients draw, never divide. */
  levelCompletion: number;
} {
  const level = levelFor(totalXp);
  const floor = (level - 1) * XP_PER_LEVEL;
  const intoLevel = Math.max(0, totalXp - floor);
  return {
    level,
    intoLevel,
    toNextLevel: Math.max(0, XP_PER_LEVEL - intoLevel),
    levelCompletion: Math.max(0, Math.min(1, intoLevel / XP_PER_LEVEL)),
  };
}
