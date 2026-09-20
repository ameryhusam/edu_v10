/**
 * XP — the ported algorithm and the three legacy defects it corrects.
 */

import { describe, expect, it } from 'vitest';
import {
  calculateXp,
  levelFor,
  levelProgress,
  streakFrom,
  MAX_STREAK_MULTIPLIER,
} from '../../src/contexts/engagement/domain/xp.js';

const attempt = (over: Partial<Parameters<typeof calculateXp>[0]> = {}) =>
  calculateXp({
    isCorrect: true,
    secondsToAnswer: 30,
    streak: 0,
    difficulty: 0.5,
    ...over,
  });

describe('the ported formula', () => {
  it('scales the base with difficulty exactly as legacy did', () => {
    // round(15 + 0 × 5) = 15, round(15 + 1 × 5) = 20.
    expect(attempt({ difficulty: 0 }).baseXp).toBe(15);
    expect(attempt({ difficulty: 1 }).baseXp).toBe(20);
  });

  it('pays a speed bonus under fifteen seconds', () => {
    expect(attempt({ secondsToAnswer: 14 }).speedBonus).toBe(5);
    expect(attempt({ secondsToAnswer: 15 }).speedBonus).toBe(0);
  });

  it('applies ten percent per consecutive correct answer', () => {
    expect(attempt({ streak: 3 }).streakMultiplier).toBe(1.3);
  });

  it('caps the multiplier so a long streak cannot run away', () => {
    expect(attempt({ streak: 500 }).streakMultiplier).toBe(MAX_STREAK_MULTIPLIER);
  });

  it('pays nothing at all for a wrong answer', () => {
    const wrong = attempt({ isCorrect: false, streak: 9, secondsToAnswer: 2 });
    expect(wrong.totalXp).toBe(0);
    expect(wrong.baseXp).toBe(0);
  });
});

describe('the corrections', () => {
  it('does not pay the speed bonus when no time was reported', () => {
    // Legacy defaulted the missing value to 10 seconds at the controller, which
    // made the bonus free for any client that simply omitted the field.
    expect(attempt({ secondsToAnswer: null }).speedBonus).toBe(0);
  });

  it('ignores a nonsensical negative time', () => {
    expect(attempt({ secondsToAnswer: -5 }).speedBonus).toBe(0);
  });

  it('clamps a difficulty outside the unit range', () => {
    expect(attempt({ difficulty: 99 }).baseXp).toBe(20);
    expect(attempt({ difficulty: Number.NaN }).baseXp).toBe(18);
  });

  it('treats a negative streak as no streak', () => {
    expect(attempt({ streak: -4 }).streakMultiplier).toBe(1);
  });
});

describe('streaks are derived, never supplied', () => {
  it('counts consecutive correct answers from the most recent', () => {
    expect(
      streakFrom([{ isCorrect: true }, { isCorrect: true }, { isCorrect: false }]),
    ).toBe(2);
  });

  it('stops at the first wrong answer', () => {
    expect(streakFrom([{ isCorrect: false }, { isCorrect: true }])).toBe(0);
  });

  it('is zero for a learner with no history', () => {
    expect(streakFrom([])).toBe(0);
  });
});

describe('levels', () => {
  it('starts at level one', () => {
    expect(levelFor(0)).toBe(1);
    expect(levelFor(399)).toBe(1);
  });

  it('advances every four hundred points', () => {
    expect(levelFor(400)).toBe(2);
    expect(levelFor(800)).toBe(3);
  });

  it('never returns a level below one, even for corrupt input', () => {
    expect(levelFor(-100)).toBe(1);
    expect(levelFor(Number.NaN)).toBe(1);
  });

  it('reports how far into the level the learner is', () => {
    // levelCompletion is included so clients can draw the level bar without
    // dividing anything themselves (FE8).
    expect(levelProgress(450)).toEqual({
      level: 2,
      intoLevel: 50,
      toNextLevel: 350,
      levelCompletion: 0.125,
    });
  });

  it('clamps the level completion inside 0..1 for corrupt totals', () => {
    expect(levelProgress(0).levelCompletion).toBe(0);
    expect(levelProgress(-50).levelCompletion).toBe(0);
  });
});
