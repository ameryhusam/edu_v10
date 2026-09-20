/**
 * EngagementService — the wiring around the XP formula.
 *
 * The formula itself is covered in `xp.test.ts`. What is tested here is the
 * part legacy got wrong: where the streak comes from, whether a replay pays
 * twice, and whether a learner with no points is visible.
 */

import { describe, expect, it } from 'vitest';
import { EngagementService } from '../../src/contexts/engagement/application/engagement.service.js';
import type {
  AnswerHistoryReader,
  XpAward,
  XpEntryRecord,
  XpLedger,
} from '../../src/contexts/engagement/application/engagement.ports.js';

const LEARNER = 'lrn_demo_student';

class FakeLedger implements XpLedger {
  rows: XpAward[] = [];
  /** Mirrors the unique constraint the real table carries. */
  private seen = new Set<string>();

  async append(award: XpAward) {
    if (this.seen.has(award.idempotencyKey)) return false;
    this.seen.add(award.idempotencyKey);
    this.rows.push(award);
    return true;
  }
  async totalFor(learnerKey: string) {
    return this.rows
      .filter((r) => r.learnerKey === learnerKey)
      .reduce((sum, r) => sum + r.amount, 0);
  }
  async recentFor(learnerKey: string, limit: number): Promise<XpEntryRecord[]> {
    return this.rows
      .filter((r) => r.learnerKey === learnerKey)
      .slice(-limit)
      .map((r) => ({
        amount: r.amount,
        reason: r.reason,
        sourceKey: r.sourceKey,
        awardedAt: new Date('2026-09-12T10:00:00Z'),
      }));
  }
  async totalsFor(learnerKeys: readonly string[]) {
    const out = new Map<string, number>();
    for (const key of learnerKeys) {
      const total = await this.totalFor(key);
      if (total > 0) out.set(key, total);
    }
    return out;
  }
}

class FakeHistory implements AnswerHistoryReader {
  answers: { isCorrect: boolean }[] = [];
  async recentAnswers(_l: string, limit: number) {
    return this.answers.slice(0, limit);
  }
}

function setup() {
  const ledger = new FakeLedger();
  const history = new FakeHistory();
  return { ledger, history, service: new EngagementService(ledger, history) };
}

const answer = (over: Record<string, unknown> = {}) => ({
  learnerKey: LEARNER,
  questionKey: 'Q-1',
  attemptKey: 'att-1',
  isCorrect: true,
  secondsToAnswer: 30,
  difficulty: 0.5,
  ...over,
});

describe('rewarding an answer', () => {
  it('awards XP for a correct answer', async () => {
    const s = setup();
    s.history.answers = [{ isCorrect: true }];

    const result = await s.service.rewardAnswer(answer());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.totalXp).toBeGreaterThan(0);
    expect(s.ledger.rows).toHaveLength(1);
  });

  it('records nothing at all for a wrong answer', async () => {
    // A zero row would bloat the ledger and make "how many awards" meaningless.
    const s = setup();
    const result = await s.service.rewardAnswer(answer({ isCorrect: false }));
    if (!result.ok) return;

    expect(result.value.totalXp).toBe(0);
    expect(s.ledger.rows).toEqual([]);
  });

  it('derives the streak from evidence, not from the caller', async () => {
    // The legacy hole: `streakCount` came from req.body, so any client could
    // claim a streak of ten and mint XP at 2x. There is no way to pass one in.
    const s = setup();
    s.history.answers = [
      { isCorrect: true }, // the answer just recorded
      { isCorrect: true },
      { isCorrect: true },
    ];

    const result = await s.service.rewardAnswer(answer());
    if (!result.ok) return;
    expect(result.value.streak).toBe(2);
  });

  it('does not count the answer being rewarded in its own streak', async () => {
    // Otherwise every correct answer silently earns a free extra 10%.
    const s = setup();
    s.history.answers = [{ isCorrect: true }];

    const result = await s.service.rewardAnswer(answer());
    if (!result.ok) return;
    expect(result.value.streak).toBe(0);
    expect(result.value.streakMultiplier).toBe(1);
  });

  it('breaks the streak at the most recent wrong answer', async () => {
    const s = setup();
    s.history.answers = [{ isCorrect: true }, { isCorrect: false }, { isCorrect: true }];

    const result = await s.service.rewardAnswer(answer());
    if (!result.ok) return;
    expect(result.value.streak).toBe(0);
  });

  it('pays a replayed submission exactly once', async () => {
    // Legacy's fallback key embedded Date.now(), so a retry paid twice.
    const s = setup();
    s.history.answers = [{ isCorrect: true }];

    const first = await s.service.rewardAnswer(answer());
    const second = await s.service.rewardAnswer(answer());
    if (!first.ok || !second.ok) return;

    expect(first.value.duplicate).toBe(false);
    expect(second.value.duplicate).toBe(true);
    expect(s.ledger.rows).toHaveLength(1);
    expect(await s.ledger.totalFor(LEARNER)).toBe(first.value.totalXp);
  });

  it('treats a different question in the same attempt as a separate award', async () => {
    const s = setup();
    s.history.answers = [{ isCorrect: true }];

    await s.service.rewardAnswer(answer({ questionKey: 'Q-1' }));
    await s.service.rewardAnswer(answer({ questionKey: 'Q-2' }));
    expect(s.ledger.rows).toHaveLength(2);
  });
});

describe('the summary', () => {
  it('reports total, level and current streak together', async () => {
    const s = setup();
    s.history.answers = [{ isCorrect: true }, { isCorrect: true }];
    await s.service.rewardAnswer(answer());

    const summary = await s.service.summaryFor(LEARNER);
    expect(summary.ok).toBe(true);
    if (!summary.ok) return;

    expect(summary.value.totalXp).toBeGreaterThan(0);
    expect(summary.value.level).toBe(1);
    expect(summary.value.currentStreak).toBe(2);
    // Stars and the level fill are decided here, not drawn in the client.
    expect(summary.value.stars).toBe(Math.floor(summary.value.totalXp / 100));
    expect(summary.value.levelCompletion).toBeGreaterThanOrEqual(0);
    expect(summary.value.levelCompletion).toBeLessThanOrEqual(1);
  });

  it('reports a learner with no XP as zero rather than failing', async () => {
    const summary = await setup().service.summaryFor('lrn-new');
    if (!summary.ok) return;
    expect(summary.value.totalXp).toBe(0);
    expect(summary.value.level).toBe(1);
    expect(summary.value.stars).toBe(0);
    expect(summary.value.levelCompletion).toBe(0);
  });
});

describe('the leaderboard', () => {
  it('ranks a cohort by total', async () => {
    const s = setup();
    s.history.answers = [{ isCorrect: true }];
    await s.service.rewardAnswer(answer({ learnerKey: 'a', attemptKey: 'x' }));
    await s.service.rewardAnswer(answer({ learnerKey: 'b', attemptKey: 'y' }));
    await s.service.rewardAnswer(answer({ learnerKey: 'b', attemptKey: 'z' }));

    const board = await s.service.leaderboard({ learnerKeys: ['a', 'b'] });
    if (!board.ok) return;

    expect(board.value[0]).toMatchObject({ learnerKey: 'b', rank: 1 });
    expect(board.value[1]).toMatchObject({ learnerKey: 'a', rank: 2 });
  });

  it('includes a learner with no XP rather than hiding them', async () => {
    // Otherwise a learner discovers they are invisible instead of last.
    const s = setup();
    const board = await s.service.leaderboard({ learnerKeys: ['a', 'b'] });
    if (!board.ok) return;
    expect(board.value).toHaveLength(2);
    expect(board.value.every((r) => r.totalXp === 0)).toBe(true);
  });

  it('refuses an empty cohort rather than reporting an empty board', async () => {
    const board = await setup().service.leaderboard({ learnerKeys: [] });
    expect(board.ok).toBe(false);
    if (board.ok) return;
    expect(board.error.code).toBe('engagement.empty_cohort');
  });
});

describe('what Engagement must not do', () => {
  it('exposes no way to set a total or spend points', () => {
    const s = setup();
    const surface = Object.getOwnPropertyNames(Object.getPrototypeOf(s.service));
    expect(surface.filter((m) => /set|spend|deduct|adjust|reset/i.test(m))).toEqual([]);
  });
});
