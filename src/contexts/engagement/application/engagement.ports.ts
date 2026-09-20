/**
 * Ports for Engagement.
 *
 * Note what is absent: no `setTotalXp`, no `adjustBalance`, no way to write a
 * total. The ledger is append-only and the total is a sum of it, so there is no
 * second number that can disagree with the entries.
 */

export interface XpAward {
  readonly learnerKey: string;
  readonly amount: number;
  readonly reason: string;
  readonly sourceKey: string | null;
  readonly idempotencyKey: string;
}

export interface XpEntryRecord {
  readonly amount: number;
  readonly reason: string;
  readonly sourceKey: string | null;
  readonly awardedAt: Date;
}

export interface XpLedger {
  /**
   * Append an award.
   *
   * Returns `false` when the idempotency key has already been used, so the
   * caller can tell a fresh award from a replay without a second query.
   * Implementations must rely on the unique constraint rather than a read
   * followed by a write: two concurrent submissions of the same answer would
   * both pass the read.
   */
  append(award: XpAward): Promise<boolean>;

  totalFor(learnerKey: string): Promise<number>;

  recentFor(learnerKey: string, limit: number): Promise<XpEntryRecord[]>;

  /** Totals for a set of learners, for the leaderboard. */
  totalsFor(learnerKeys: readonly string[]): Promise<Map<string, number>>;
}

/**
 * The learner's recent answers, most recent first — the basis of the streak.
 *
 * Read from the evidence stream rather than from a stored counter, so the
 * streak can never disagree with what the learner actually did.
 */
export interface AnswerHistoryReader {
  recentAnswers(learnerKey: string, limit: number): Promise<{ isCorrect: boolean }[]>;
}
