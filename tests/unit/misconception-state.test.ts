/**
 * Misconception state derivation.
 *
 * The property that matters most here is idempotence: this replaces a legacy
 * writer that did `confidence + 0.1` on every sighting, which meant replaying
 * the same evidence changed the answer.
 */

import { describe, expect, it } from 'vitest';
import {
  CLEARING_STREAK,
  deriveMisconceptionStates,
  misconceptionConfidence,
  type MisconceptionObservation,
} from '../../src/contexts/mastery/domain/misconception-state.js';

const at = (day: number): Date => new Date(Date.UTC(2026, 8, day));

/** Concise observation builder: `obs(1, false, 'MIS-A')` = wrong on day 1. */
function obs(
  day: number,
  isCorrect: boolean,
  misconceptionKey?: string,
  weight = 1,
): MisconceptionObservation {
  return { observedAt: at(day), isCorrect, weight, misconceptionKey };
}

describe('misconceptionConfidence', () => {
  it('rises with repetition', () => {
    expect(misconceptionConfidence(1)).toBeLessThan(misconceptionConfidence(2));
    expect(misconceptionConfidence(2)).toBeLessThan(misconceptionConfidence(3));
  });

  it('never reaches certainty — a distractor infers thinking, it does not observe it', () => {
    expect(misconceptionConfidence(50)).toBeLessThanOrEqual(0.95);
  });

  it('is zero when never observed', () => {
    expect(misconceptionConfidence(0)).toBe(0);
  });

  it('depends only on the count, not on any previous value', () => {
    // The legacy bug: confidence was `existing + 0.1`, so the answer depended
    // on how many times the writer had run rather than on the evidence.
    expect(misconceptionConfidence(3)).toBe(misconceptionConfidence(3));
  });
});

describe('deriveMisconceptionStates', () => {
  it('promotes a diagnosed distractor into state', () => {
    const states = deriveMisconceptionStates([obs(1, false, 'MIS-A')]);

    expect(states).toHaveLength(1);
    expect(states[0]!.misconceptionKey).toBe('MIS-A');
    expect(states[0]!.occurrences).toBe(1);
    expect(states[0]!.isResolved).toBe(false);
  });

  it('returns nothing when no misconception was ever diagnosed', () => {
    expect(deriveMisconceptionStates([obs(1, true), obs(2, false)])).toEqual([]);
  });

  it('counts repeats rather than incrementing a stored value', () => {
    const states = deriveMisconceptionStates([
      obs(1, false, 'MIS-A'),
      obs(2, false, 'MIS-A'),
      obs(3, false, 'MIS-A'),
    ]);

    expect(states[0]!.occurrences).toBe(3);
    expect(states[0]!.firstSeenAt).toEqual(at(1));
    expect(states[0]!.lastSeenAt).toEqual(at(3));
  });

  it('is idempotent — replaying the same stream gives an identical result', () => {
    const stream = [obs(1, false, 'MIS-A'), obs(2, true), obs(3, false, 'MIS-B')];

    expect(deriveMisconceptionStates(stream)).toEqual(deriveMisconceptionStates(stream));
  });

  it('tracks two different wrong models separately', () => {
    const states = deriveMisconceptionStates([
      obs(1, false, 'MIS-A'),
      obs(2, false, 'MIS-B'),
      obs(3, false, 'MIS-A'),
    ]);

    expect(states.map((s) => s.misconceptionKey)).toEqual(['MIS-A', 'MIS-B']);
    expect(states[0]!.occurrences).toBe(2);
    expect(states[1]!.occurrences).toBe(1);
  });

  it('resolves after a clearing streak of correct answers', () => {
    const states = deriveMisconceptionStates([
      obs(1, false, 'MIS-A'),
      ...Array.from({ length: CLEARING_STREAK }, (_, i) => obs(2 + i, true)),
    ]);

    expect(states[0]!.isResolved).toBe(true);
    expect(states[0]!.resolvedAt).toEqual(at(1 + CLEARING_STREAK));
  });

  it('does NOT resolve on a single correct answer', () => {
    // One right answer is as likely a guess as a corrected model.
    const states = deriveMisconceptionStates([obs(1, false, 'MIS-A'), obs(2, true)]);
    expect(states[0]!.isResolved).toBe(false);
  });

  it('ignores correct answers from BEFORE the last sighting', () => {
    // The learner demonstrated the wrong model more recently than the right one.
    const states = deriveMisconceptionStates([
      obs(1, true),
      obs(2, true),
      obs(3, false, 'MIS-A'),
    ]);

    expect(states[0]!.isResolved).toBe(false);
  });

  it('breaks the streak when the same misconception recurs', () => {
    const states = deriveMisconceptionStates([
      obs(1, false, 'MIS-A'),
      obs(2, true),
      obs(3, false, 'MIS-A'),
      obs(4, true),
    ]);

    expect(states[0]!.occurrences).toBe(2);
    expect(states[0]!.isResolved).toBe(false);
  });

  it('breaks the streak when a DIFFERENT misconception fires on the concept', () => {
    // Still reasoning wrongly about the concept, just differently.
    const states = deriveMisconceptionStates([
      obs(1, false, 'MIS-A'),
      obs(2, true),
      obs(3, false, 'MIS-B'),
      obs(4, true),
    ]);

    const misA = states.find((s) => s.misconceptionKey === 'MIS-A')!;
    expect(misA.isResolved).toBe(false);
  });

  it('breaks the streak on a plain wrong answer', () => {
    const states = deriveMisconceptionStates([
      obs(1, false, 'MIS-A'),
      obs(2, true),
      obs(3, false),
      obs(4, true),
    ]);

    expect(states[0]!.isResolved).toBe(false);
  });

  it('keeps resolved misconceptions on record so history stays readable', () => {
    const states = deriveMisconceptionStates([
      obs(1, false, 'MIS-A'),
      obs(2, true),
      obs(3, true),
    ]);

    // Dropping the row would make a later recurrence look like a first sighting.
    expect(states).toHaveLength(1);
    expect(states[0]!.isResolved).toBe(true);
    expect(states[0]!.firstSeenAt).toEqual(at(1));
  });

  it('re-opens when the wrong model returns after being cleared', () => {
    const states = deriveMisconceptionStates([
      obs(1, false, 'MIS-A'),
      obs(2, true),
      obs(3, true),
      obs(4, false, 'MIS-A'),
    ]);

    expect(states[0]!.isResolved).toBe(false);
    expect(states[0]!.occurrences).toBe(2);
    // The first sighting survives, so "how long has this been going on?" works.
    expect(states[0]!.firstSeenAt).toEqual(at(1));
    expect(states[0]!.lastSeenAt).toEqual(at(4));
  });

  it('ignores zero-weight observations entirely', () => {
    // A skipped or ungradable answer diagnoses nothing.
    expect(deriveMisconceptionStates([obs(1, false, 'MIS-A', 0)])).toEqual([]);
  });

  it('does not let a zero-weight correct answer contribute to clearing', () => {
    const states = deriveMisconceptionStates([
      obs(1, false, 'MIS-A'),
      obs(2, true, undefined, 0),
      obs(3, true),
    ]);

    expect(states[0]!.isResolved).toBe(false);
  });

  it('returns a deterministic order', () => {
    const states = deriveMisconceptionStates([
      obs(1, false, 'MIS-Z'),
      obs(2, false, 'MIS-A'),
    ]);

    expect(states.map((s) => s.misconceptionKey)).toEqual(['MIS-A', 'MIS-Z']);
  });

  it('handles an empty stream', () => {
    expect(deriveMisconceptionStates([])).toEqual([]);
  });
});
