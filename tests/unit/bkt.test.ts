import { describe, expect, it } from 'vitest';
import {
  bktReplay,
  bktUpdate,
  estimateConfidence,
  DEFAULT_BKT_PARAMETERS,
} from '../../src/contexts/mastery/domain/bkt.js';

describe('BKT update', () => {
  it('raises belief after a correct answer and lowers it after a wrong one', () => {
    const up = bktUpdate(0.5, true);
    const down = bktUpdate(0.5, false);
    expect(up.posterior).toBeGreaterThan(0.5);
    expect(down.posterior).toBeLessThan(0.5);
  });

  it('matches the Bayes computation exactly', () => {
    const { pS, pG } = DEFAULT_BKT_PARAMETERS;
    const prior = 0.4;
    const expected = (prior * (1 - pS)) / (prior * (1 - pS) + (1 - prior) * pG);
    expect(bktUpdate(prior, true).posterior).toBeCloseTo(expected, 6);
  });

  it('applies the learning transition so belief can only grow between opportunities', () => {
    const step = bktUpdate(0.5, false);
    expect(step.nextPrior).toBeGreaterThan(step.posterior);
  });

  it('never returns 0 or 1, so the recursion can always recover', () => {
    let p = 0.5;
    for (let i = 0; i < 200; i++) p = bktUpdate(p, false).nextPrior;
    expect(p).toBeGreaterThan(0);

    let q = 0.5;
    for (let i = 0; i < 200; i++) q = bktUpdate(q, true).nextPrior;
    expect(q).toBeLessThan(1);
  });
});

describe('BKT replay', () => {
  it('is order-sensitive — improving beats declining for the same totals', () => {
    const improving = bktReplay([
      { isCorrect: false },
      { isCorrect: false },
      { isCorrect: true },
      { isCorrect: true },
    ]);
    const declining = bktReplay([
      { isCorrect: true },
      { isCorrect: true },
      { isCorrect: false },
      { isCorrect: false },
    ]);
    expect(improving.finalPosterior).toBeGreaterThan(declining.finalPosterior);
  });

  it('is deterministic: identical input yields identical output', () => {
    const obs = [{ isCorrect: true }, { isCorrect: false }, { isCorrect: true }];
    expect(bktReplay(obs).finalPosterior).toBe(bktReplay(obs).finalPosterior);
  });

  it('treats zero-weight observations as carrying no signal', () => {
    const withNoise = bktReplay([
      { isCorrect: true },
      { isCorrect: false, weight: 0 },
      { isCorrect: false, weight: 0 },
    ]);
    const withoutNoise = bktReplay([{ isCorrect: true }]);
    expect(withNoise.finalPosterior).toBeCloseTo(withoutNoise.finalPosterior, 6);
  });

  it('reaches mastery after a run of correct answers', () => {
    const trace = bktReplay(Array.from({ length: 8 }, () => ({ isCorrect: true })));
    expect(trace.finalPosterior).toBeGreaterThan(0.85);
  });

  it('records one trajectory point per observation for explainability', () => {
    const trace = bktReplay([{ isCorrect: true }, { isCorrect: false }, { isCorrect: true }]);
    expect(trace.trajectory).toHaveLength(3);
    expect(trace.observationCount).toBe(3);
  });
});

describe('confidence', () => {
  it('grows with evidence and saturates below 1', () => {
    expect(estimateConfidence(0)).toBe(0);
    expect(estimateConfidence(2)).toBeLessThan(estimateConfidence(10));
    expect(estimateConfidence(1000)).toBeLessThanOrEqual(1);
  });
});
