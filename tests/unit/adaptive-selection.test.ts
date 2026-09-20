import { describe, expect, it } from 'vitest';
import {
  estimateThetaEAP,
  itemInformation,
  probabilityCorrect,
  standardError,
  type ItemParameters,
} from '../../src/contexts/assessment/domain/irt.js';
import {
  evaluateStoppingRule,
  selectNextItem,
} from '../../src/contexts/assessment/domain/adaptive-selection.js';

const item = (id: string, b: number, a = 1.2, c = 0.25): ItemParameters => ({ id, a, b, c });

describe('IRT', () => {
  it('is monotonic in ability', () => {
    const q = item('q', 0);
    expect(probabilityCorrect(-2, q)).toBeLessThan(probabilityCorrect(0, q));
    expect(probabilityCorrect(0, q)).toBeLessThan(probabilityCorrect(2, q));
  });

  it('never falls below the guessing floor', () => {
    expect(probabilityCorrect(-10, item('q', 0, 1.2, 0.25))).toBeGreaterThanOrEqual(0.25);
  });

  it('is most informative near the item difficulty', () => {
    const q = item('q', 1.0);
    expect(itemInformation(1.0, q)).toBeGreaterThan(itemInformation(-2.0, q));
  });
});

describe('ability estimation', () => {
  it('returns the prior mean with no responses', () => {
    expect(estimateThetaEAP([], new Map()).theta).toBe(0);
  });

  it('places a strong performer above a weak one', () => {
    const pool = new Map([
      ['q1', item('q1', -1)],
      ['q2', item('q2', 0)],
      ['q3', item('q3', 1)],
    ]);
    const strong = estimateThetaEAP(
      [
        { itemId: 'q1', isCorrect: true },
        { itemId: 'q2', isCorrect: true },
        { itemId: 'q3', isCorrect: true },
      ],
      pool,
    );
    const weak = estimateThetaEAP(
      [
        { itemId: 'q1', isCorrect: false },
        { itemId: 'q2', isCorrect: false },
        { itemId: 'q3', isCorrect: false },
      ],
      pool,
    );
    expect(strong.theta).toBeGreaterThan(weak.theta);
  });

  it('stays finite for an all-correct pattern, where MLE would diverge', () => {
    const pool = new Map([['q1', item('q1', 0)]]);
    const result = estimateThetaEAP([{ itemId: 'q1', isCorrect: true }], pool);
    expect(Number.isFinite(result.theta)).toBe(true);
  });
});

describe('adaptive item selection', () => {
  const pool = [item('easy', -2), item('medium', 0), item('hard', 2)];

  it('picks the most informative unseen item', () => {
    const chosen = selectNextItem({
      theta: 2,
      pool,
      administeredIds: [],
      config: { minItems: 1, maxItems: 10, targetStandardError: 0.3, exposureTopN: 1 },
    });
    expect(chosen?.item.id).toBe('hard');
  });

  it('never repeats an administered item', () => {
    const chosen = selectNextItem({
      theta: 2,
      pool,
      administeredIds: ['hard', 'medium'],
      config: { minItems: 1, maxItems: 10, targetStandardError: 0.3, exposureTopN: 1 },
    });
    expect(chosen?.item.id).toBe('easy');
  });

  it('returns null when the pool is exhausted', () => {
    expect(
      selectNextItem({ theta: 0, pool, administeredIds: ['easy', 'medium', 'hard'] }),
    ).toBeNull();
  });

  it('is deterministic when given a deterministic random source', () => {
    const args = { theta: 0, pool, administeredIds: [], random: () => 0.5 };
    expect(selectNextItem(args)?.item.id).toBe(selectNextItem(args)?.item.id);
  });
});

describe('stopping rule', () => {
  const administered = [item('q1', 0), item('q2', 0.2), item('q3', -0.2)];

  it('never stops before the minimum item count', () => {
    const stop = evaluateStoppingRule({ theta: 0, administered: [item('q1', 0)], poolRemaining: 50 });
    expect(stop.shouldStop).toBe(false);
  });

  it('stops once the precision target is met', () => {
    const many = Array.from({ length: 40 }, (_, i) => item(`q${i}`, 0, 2.0));
    const stop = evaluateStoppingRule({ theta: 0, administered: many, poolRemaining: 10 });
    expect(stop.shouldStop).toBe(true);
    expect(stop.reason).toBe('PRECISION_REACHED');
  });

  it('stops at the item ceiling even when imprecise', () => {
    const many = Array.from({ length: 25 }, (_, i) => item(`q${i}`, 3, 0.3));
    const stop = evaluateStoppingRule({ theta: 0, administered: many, poolRemaining: 100 });
    expect(stop.shouldStop).toBe(true);
    expect(stop.reason).toBe('MAX_ITEMS');
  });

  it('reports standard error shrinking as items accumulate', () => {
    const few = standardError(0, administered.slice(0, 1));
    const more = standardError(0, administered);
    expect(more).toBeLessThan(few);
  });
});
