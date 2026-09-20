/**
 * Remediation episodes.
 *
 * The rules that matter most are the ones about what does NOT open an episode.
 * A detector that fires on every dip produces a list of hundreds that a teacher
 * scrolls past, and then the real gap is invisible — which is the same failure
 * mode as an item-analysis report that flags a third of the bank.
 */

import { describe, expect, it } from 'vitest';
import {
  detectEpisodes,
  MIN_OBSERVATIONS_FOR_GAP,
  recommendForEpisode,
  summariseEpisodes,
  type CandidateResource,
  type ExistingEpisode,
  type GapEvidence,
} from '../../src/contexts/learning/domain/remediation.js';

function evidence(overrides: Partial<GapEvidence> = {}): GapEvidence {
  return {
    conceptKey: 'C-SET',
    effectiveMastery: 0.4,
    mastery: 0.4,
    observations: 5,
    masteryThreshold: 0.85,
    openMisconceptionKeys: [],
    ...overrides,
  };
}

function existing(overrides: Partial<ExistingEpisode> = {}): ExistingEpisode {
  return {
    episodeKey: 'REM-M-abc12345',
    conceptKey: 'C-SET',
    trigger: 'MASTERY_GAP',
    status: 'OPEN',
    misconceptionKey: null,
    ...overrides,
  };
}

describe('opening a mastery-gap episode', () => {
  it('opens when mastery is below threshold with enough evidence', () => {
    const result = detectEpisodes([evidence()], []);

    expect(result.toOpen).toHaveLength(1);
    expect(result.toOpen[0]).toMatchObject({
      conceptKey: 'C-SET',
      trigger: 'MASTERY_GAP',
      reason: 'remediation.mastery_below_threshold',
    });
  });

  it('carries the deficit so a teacher can see how big the gap is', () => {
    const result = detectEpisodes([evidence({ mastery: 0.4, masteryThreshold: 0.85 })], []);
    expect(result.toOpen[0]?.evidence.deficit).toBeCloseTo(0.45, 4);
  });

  it('does not open below the observation minimum', () => {
    // Mostly the BKT prior at this point — an unstarted concept is not a gap.
    const result = detectEpisodes([evidence({ observations: 2, mastery: 0.1 })], []);
    expect(result.toOpen).toEqual([]);
  });

  it('opens at exactly the minimum', () => {
    const result = detectEpisodes(
      [evidence({ observations: MIN_OBSERVATIONS_FOR_GAP, mastery: 0.2 })],
      [],
    );
    expect(result.toOpen).toHaveLength(1);
  });

  it('does not open when mastery meets the threshold', () => {
    expect(detectEpisodes([evidence({ mastery: 0.9 })], []).toOpen).toEqual([]);
  });

  it('respects a concept-specific threshold', () => {
    const lenient = detectEpisodes([evidence({ mastery: 0.7, masteryThreshold: 0.6 })], []);
    expect(lenient.toOpen).toEqual([]);

    const strict = detectEpisodes([evidence({ mastery: 0.7, masteryThreshold: 0.95 })], []);
    expect(strict.toOpen).toHaveLength(1);
  });

  it('does NOT open for decay alone', () => {
    // Known last month, merely forgotten: that is REVIEW, a different
    // pedagogical response. Judged on raw mastery, not the decayed value.
    const result = detectEpisodes(
      [evidence({ mastery: 0.95, effectiveMastery: 0.3, observations: 8 })],
      [],
    );
    expect(result.toOpen).toEqual([]);
  });
});

describe('opening a misconception episode', () => {
  it('opens one per diagnosed misconception', () => {
    const result = detectEpisodes(
      [evidence({ mastery: 0.9, openMisconceptionKeys: ['MIS-A', 'MIS-B'] })],
      [],
    );

    expect(result.toOpen).toHaveLength(2);
    expect(result.toOpen.map((e) => e.misconceptionKey).sort()).toEqual(['MIS-A', 'MIS-B']);
  });

  it('opens even when mastery is high', () => {
    // A learner can score well and still hold a wrong model underneath.
    const result = detectEpisodes(
      [evidence({ mastery: 0.95, openMisconceptionKeys: ['MIS-A'] })],
      [],
    );
    expect(result.toOpen[0]?.trigger).toBe('MISCONCEPTION');
  });

  it('opens both a misconception and a gap episode when both apply', () => {
    const result = detectEpisodes(
      [evidence({ mastery: 0.3, openMisconceptionKeys: ['MIS-A'] })],
      [],
    );
    expect(result.toOpen.map((e) => e.trigger).sort()).toEqual(['MASTERY_GAP', 'MISCONCEPTION']);
  });
});

describe('idempotence', () => {
  it('does not re-open an episode that is already open', () => {
    const result = detectEpisodes([evidence()], [existing()]);
    expect(result.toOpen).toEqual([]);
  });

  it('does not re-open a misconception episode already open', () => {
    const result = detectEpisodes(
      [evidence({ openMisconceptionKeys: ['MIS-A'] })],
      [existing({ trigger: 'MISCONCEPTION', misconceptionKey: 'MIS-A' })],
    );
    expect(result.toOpen.filter((e) => e.trigger === 'MISCONCEPTION')).toEqual([]);
  });

  it('running detection twice on the same state changes nothing', () => {
    const state = [evidence({ openMisconceptionKeys: ['MIS-A'] })];
    const first = detectEpisodes(state, []);

    // Feed the first run's output back in as existing episodes.
    const now: ExistingEpisode[] = first.toOpen.map((e, i) => ({
      episodeKey: `REM-${i}`,
      conceptKey: e.conceptKey,
      trigger: e.trigger,
      status: 'OPEN',
      misconceptionKey: e.misconceptionKey,
    }));

    expect(detectEpisodes(state, now).toOpen).toEqual([]);
  });

  it('a RESOLVED episode does not block a new one for the same gap', () => {
    // A gap that reappears is a NEW episode: reusing the old row would destroy
    // how long the first one took to close.
    const result = detectEpisodes([evidence()], [existing({ status: 'RESOLVED' })]);
    expect(result.toOpen).toHaveLength(1);
  });

  it('distinguishes two different misconceptions on one concept', () => {
    const result = detectEpisodes(
      [evidence({ openMisconceptionKeys: ['MIS-A', 'MIS-B'] })],
      [existing({ trigger: 'MISCONCEPTION', misconceptionKey: 'MIS-A' })],
    );
    // Filtered by trigger: this fixture's mastery is also below threshold, so
    // a MASTERY_GAP episode opens alongside — correctly, and separately.
    const misconceptions = result.toOpen.filter((e) => e.trigger === 'MISCONCEPTION');
    expect(misconceptions.map((e) => e.misconceptionKey)).toEqual(['MIS-B']);
  });
});

describe('closing an episode', () => {
  it('resolves a gap episode when mastery recovers', () => {
    const result = detectEpisodes([evidence({ mastery: 0.9 })], [existing()]);

    expect(result.toResolve).toHaveLength(1);
    expect(result.toResolve[0]).toMatchObject({
      episodeKey: 'REM-M-abc12345',
      reason: 'remediation.mastery_recovered',
    });
  });

  it('resolves a misconception episode when the misconception clears', () => {
    const result = detectEpisodes(
      [evidence({ mastery: 0.9, openMisconceptionKeys: [] })],
      [existing({ trigger: 'MISCONCEPTION', misconceptionKey: 'MIS-A' })],
    );

    expect(result.toResolve[0]?.reason).toBe('remediation.misconception_resolved');
  });

  it('does not resolve a gap on thin evidence', () => {
    // Recovery has to be as well-evidenced as the gap was.
    const result = detectEpisodes([evidence({ mastery: 0.9, observations: 1 })], [existing()]);
    expect(result.toResolve).toEqual([]);
  });

  it('leaves an episode alone when its concept has no evidence at all', () => {
    // Out of scope is not corrected. SUPERSEDED is the content lifecycle's
    // call, not detection's.
    const result = detectEpisodes([], [existing({ trigger: 'MISCONCEPTION', misconceptionKey: 'MIS-A' })]);
    expect(result.toResolve).toEqual([]);
    expect(result.toOpen).toEqual([]);
  });

  it('ignores episodes that are not open', () => {
    const result = detectEpisodes(
      [evidence({ mastery: 0.95 })],
      [existing({ status: 'RESOLVED' }), existing({ episodeKey: 'x', status: 'SUPERSEDED' })],
    );
    expect(result.toResolve).toEqual([]);
  });
});

describe('recommendations', () => {
  function resource(overrides: Partial<CandidateResource> = {}): CandidateResource {
    return { resourceKey: 'RES-1', kind: 'READING', title: 'Reading', estimatedMins: 10, ...overrides };
  }

  it('puts corrective content first for a misconception', () => {
    // Re-reading the original explanation usually re-derives the same wrong
    // model, so REMEDIAL leads.
    const ranked = recommendForEpisode('MISCONCEPTION', [
      resource({ resourceKey: 'A', kind: 'READING' }),
      resource({ resourceKey: 'B', kind: 'REMEDIAL' }),
    ]);

    expect(ranked[0]?.resourceKey).toBe('B');
    expect(ranked[0]?.reason).toBe('remediation.corrective_content');
  });

  it('prefers a different modality for a mastery gap', () => {
    const ranked = recommendForEpisode('MASTERY_GAP', [
      resource({ resourceKey: 'A', kind: 'READING' }),
      resource({ resourceKey: 'B', kind: 'WORKED_EXAMPLE' }),
    ]);

    expect(ranked[0]?.resourceKey).toBe('B');
    expect(ranked[0]?.reason).toBe('remediation.alternative_modality');
  });

  it('breaks ties by shorter duration', () => {
    const ranked = recommendForEpisode('MASTERY_GAP', [
      resource({ resourceKey: 'LONG', kind: 'VIDEO', estimatedMins: 40 }),
      resource({ resourceKey: 'SHORT', kind: 'VIDEO', estimatedMins: 5 }),
    ]);
    expect(ranked[0]?.resourceKey).toBe('SHORT');
  });

  it('sorts unestimated resources last, not first', () => {
    const ranked = recommendForEpisode('MASTERY_GAP', [
      resource({ resourceKey: 'UNKNOWN', kind: 'VIDEO', estimatedMins: null }),
      resource({ resourceKey: 'KNOWN', kind: 'VIDEO', estimatedMins: 30 }),
    ]);
    expect(ranked[0]?.resourceKey).toBe('KNOWN');
  });

  it('is deterministic for identical candidates', () => {
    const candidates = [
      resource({ resourceKey: 'B', kind: 'VIDEO' }),
      resource({ resourceKey: 'A', kind: 'VIDEO' }),
    ];
    expect(recommendForEpisode('MASTERY_GAP', candidates).map((r) => r.resourceKey)).toEqual(
      recommendForEpisode('MASTERY_GAP', candidates).map((r) => r.resourceKey),
    );
  });

  it('respects the limit and ranks from zero', () => {
    const ranked = recommendForEpisode(
      'MASTERY_GAP',
      ['A', 'B', 'C', 'D'].map((k) => resource({ resourceKey: k })),
      2,
    );
    expect(ranked).toHaveLength(2);
    expect(ranked.map((r) => r.rank)).toEqual([0, 1]);
  });

  it('returns nothing when there is nothing to suggest', () => {
    expect(recommendForEpisode('MASTERY_GAP', [])).toEqual([]);
  });
});

describe('summarising episodes', () => {
  const day = 86_400_000;
  const now = new Date('2026-09-12T00:00:00Z');
  const ago = (days: number) => new Date(now.getTime() - days * day);

  it('counts open and resolved separately', () => {
    const summary = summariseEpisodes(
      [
        { episodeKey: 'a', conceptKey: 'C', trigger: 'MASTERY_GAP', openedAt: ago(3), resolvedAt: null },
        { episodeKey: 'b', conceptKey: 'C', trigger: 'MISCONCEPTION', openedAt: ago(9), resolvedAt: ago(4) },
      ],
      now,
    );

    expect(summary.open).toBe(1);
    expect(summary.resolved).toBe(1);
    expect(summary.byTrigger).toEqual({ MASTERY_GAP: 1, MISCONCEPTION: 0 });
  });

  it('measures time-to-resolve over closed episodes only', () => {
    // Mixing in "days open so far" would make the number improve whenever an
    // old gap finally closes badly.
    const summary = summariseEpisodes(
      [
        { episodeKey: 'a', conceptKey: 'C', trigger: 'MASTERY_GAP', openedAt: ago(100), resolvedAt: null },
        { episodeKey: 'b', conceptKey: 'C', trigger: 'MASTERY_GAP', openedAt: ago(6), resolvedAt: ago(4) },
      ],
      now,
    );
    expect(summary.medianDaysToResolve).toBe(2);
  });

  it('reports null when nothing has closed yet', () => {
    const summary = summariseEpisodes(
      [{ episodeKey: 'a', conceptKey: 'C', trigger: 'MASTERY_GAP', openedAt: ago(3), resolvedAt: null }],
      now,
    );
    expect(summary.medianDaysToResolve).toBeNull();
  });

  it('names episodes that have gone stale', () => {
    const summary = summariseEpisodes(
      [
        { episodeKey: 'old', conceptKey: 'C', trigger: 'MASTERY_GAP', openedAt: ago(30), resolvedAt: null },
        { episodeKey: 'new', conceptKey: 'C', trigger: 'MASTERY_GAP', openedAt: ago(2), resolvedAt: null },
      ],
      now,
    );
    expect(summary.stale).toEqual(['old']);
  });

  it('never counts a resolved episode as stale', () => {
    const summary = summariseEpisodes(
      [{ episodeKey: 'a', conceptKey: 'C', trigger: 'MASTERY_GAP', openedAt: ago(90), resolvedAt: ago(1) }],
      now,
    );
    expect(summary.stale).toEqual([]);
  });

  it('handles an empty set', () => {
    expect(summariseEpisodes([], now)).toMatchObject({ open: 0, resolved: 0, stale: [] });
  });
});
