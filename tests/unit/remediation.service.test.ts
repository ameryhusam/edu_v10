/**
 * RemediationService against in-memory adapters.
 *
 * Two claims are under test that the pure domain tests cannot make:
 *
 *  1. `refresh` is idempotent end to end, including key generation. The fake
 *     enforces the same partial-uniqueness rule as the real index, so a second
 *     open for the same gap would throw rather than being quietly absorbed —
 *     the lesson from the obligation work, where a permissive fake made an
 *     idempotence test vacuous.
 *  2. There is no way to close an episode except through evidence. Asserted on
 *     the service's own surface.
 */

import { describe, expect, it } from 'vitest';
import { RemediationService } from '../../src/contexts/learning/application/remediation.service.js';
import type {
  EpisodeRecord,
  GapEvidenceReader,
  RemediationRepository,
} from '../../src/contexts/learning/application/remediation.ports.js';
import type { LearningResource, ResourceReader } from '../../src/contexts/learning/application/ports.js';
import type {
  ExistingEpisode,
  GapEvidence,
} from '../../src/contexts/learning/domain/remediation.js';

const LEARNER = 'lrn-1';
const CONCEPT = 'EDU-X-U-A-L-B-C-SET';

let clockNow = new Date('2026-09-12T10:00:00.000Z');
const clock = { now: () => clockNow };

class FakeEpisodes implements RemediationRepository {
  rows: EpisodeRecord[] = [];
  /** Every applyDetection call, so tests can assert what was REQUESTED. */
  calls: Array<{ opened: number; resolved: number }> = [];

  async forLearner(learnerKey: string, openOnly = false) {
    return this.rows.filter(
      (r) => r.learnerKey === learnerKey && (!openOnly || r.status === 'OPEN'),
    );
  }

  async openEpisodesFor(learnerKey: string): Promise<ExistingEpisode[]> {
    return this.rows
      .filter((r) => r.learnerKey === learnerKey && r.status === 'OPEN')
      .map((r) => ({
        episodeKey: r.episodeKey,
        conceptKey: r.conceptKey,
        trigger: r.trigger,
        status: r.status,
        misconceptionKey: r.misconceptionKey,
      }));
  }

  async applyDetection(input: Parameters<RemediationRepository['applyDetection']>[0]) {
    for (const episode of input.toOpen) {
      // Mirror the real partial unique index. A fake that silently absorbed a
      // duplicate would make the idempotence test prove nothing.
      const clash = this.rows.some(
        (r) =>
          r.status === 'OPEN' &&
          r.learnerKey === input.learnerKey &&
          r.conceptKey === episode.conceptKey &&
          r.trigger === episode.trigger &&
          r.misconceptionKey === episode.misconceptionKey,
      );
      if (clash) throw new Error('duplicate key value violates remediation_one_open_per_gap');

      this.rows.push({
        episodeKey: episode.episodeKey,
        learnerKey: input.learnerKey,
        conceptKey: episode.conceptKey,
        trigger: episode.trigger,
        status: 'OPEN',
        misconceptionKey: episode.misconceptionKey,
        openedReason: episode.reason,
        resolvedReason: null,
        openedEvidence: episode.evidence,
        openedAt: input.at,
        resolvedAt: null,
      });
    }

    for (const resolution of input.toResolve) {
      const row = this.rows.find((r) => r.episodeKey === resolution.episodeKey);
      if (row) {
        Object.assign(row, {
          status: 'RESOLVED',
          resolvedReason: resolution.reason,
          resolvedAt: input.at,
        });
      }
    }

    const result = { opened: input.toOpen.length, resolved: input.toResolve.length };
    this.calls.push(result);
    return result;
  }

  async forLearners(input: { learnerKeys: readonly string[]; openOnly?: boolean }) {
    return this.rows.filter(
      (r) => input.learnerKeys.includes(r.learnerKey) && (!input.openOnly || r.status === 'OPEN'),
    );
  }

  async supersedeForConcepts(conceptKeys: readonly string[], at: Date) {
    let count = 0;
    for (const row of this.rows) {
      if (row.status === 'OPEN' && conceptKeys.includes(row.conceptKey)) {
        Object.assign(row, { status: 'SUPERSEDED', resolvedAt: at });
        count += 1;
      }
    }
    return count;
  }
}

class FakeEvidence implements GapEvidenceReader {
  points: GapEvidence[] = [];
  async forLearner() {
    return this.points;
  }
}

class FakeResources implements ResourceReader {
  rows: LearningResource[] = [];
  async forConcept(conceptKey: string) {
    return this.rows.filter((r) => r.conceptKey === conceptKey);
  }
}

function setup() {
  const episodes = new FakeEpisodes();
  const evidence = new FakeEvidence();
  const resources = new FakeResources();
  return {
    episodes,
    evidence,
    resources,
    service: new RemediationService(episodes, evidence, resources, clock),
  };
}

function gap(overrides: Partial<GapEvidence> = {}): GapEvidence {
  return {
    conceptKey: CONCEPT,
    effectiveMastery: 0.3,
    mastery: 0.3,
    observations: 5,
    masteryThreshold: 0.85,
    openMisconceptionKeys: [],
    ...overrides,
  };
}

describe('refresh', () => {
  it('opens an episode for a real gap', async () => {
    const s = setup();
    s.evidence.points = [gap()];

    const result = await s.service.refresh({ learnerKey: LEARNER });

    expect(result.ok && result.value).toEqual({ opened: 1, resolved: 0 });
    expect(s.episodes.rows[0]).toMatchObject({
      conceptKey: CONCEPT,
      trigger: 'MASTERY_GAP',
      status: 'OPEN',
    });
  });

  it('derives a key that identifies the trigger', async () => {
    const s = setup();
    s.evidence.points = [gap({ openMisconceptionKeys: ['MIS-A'], mastery: 0.9 })];

    await s.service.refresh({ learnerKey: LEARNER });
    expect(s.episodes.rows[0]?.episodeKey).toMatch(/^REM-C[0-9a-f]{8}$/);
  });

  it('is idempotent — a second run opens nothing', async () => {
    const s = setup();
    s.evidence.points = [gap()];

    await s.service.refresh({ learnerKey: LEARNER });
    const second = await s.service.refresh({ learnerKey: LEARNER });

    // Asserted on what was REQUESTED of the port, not only on the row count:
    // the fake would throw on a duplicate, but a service that requested one
    // and swallowed the error would still leave a single row.
    expect(second.ok && second.value.opened).toBe(0);
    expect(s.episodes.calls[1]).toEqual({ opened: 0, resolved: 0 });
    expect(s.episodes.rows).toHaveLength(1);
  });

  it('resolves an episode once mastery recovers', async () => {
    const s = setup();
    s.evidence.points = [gap()];
    await s.service.refresh({ learnerKey: LEARNER });

    s.evidence.points = [gap({ mastery: 0.95, effectiveMastery: 0.95 })];
    const result = await s.service.refresh({ learnerKey: LEARNER });

    expect(result.ok && result.value.resolved).toBe(1);
    expect(s.episodes.rows[0]).toMatchObject({
      status: 'RESOLVED',
      resolvedReason: 'remediation.mastery_recovered',
    });
  });

  it('opens a NEW episode when a resolved gap reappears', async () => {
    const s = setup();

    s.evidence.points = [gap()];
    await s.service.refresh({ learnerKey: LEARNER });
    const firstKey = s.episodes.rows[0]!.episodeKey;

    s.evidence.points = [gap({ mastery: 0.95 })];
    await s.service.refresh({ learnerKey: LEARNER });

    // Time moves on, then the gap returns.
    clockNow = new Date('2026-10-01T10:00:00.000Z');
    s.evidence.points = [gap({ mastery: 0.2 })];
    await s.service.refresh({ learnerKey: LEARNER });
    clockNow = new Date('2026-09-12T10:00:00.000Z');

    expect(s.episodes.rows).toHaveLength(2);
    // The first episode's history survives intact — how long it took to close
    // is the main thing a teacher wants to know.
    expect(s.episodes.rows[0]).toMatchObject({ episodeKey: firstKey, status: 'RESOLVED' });
    expect(s.episodes.rows[1]?.episodeKey).not.toBe(firstKey);
  });

  it('does not open anything for an unstarted concept', async () => {
    const s = setup();
    s.evidence.points = [gap({ observations: 1, mastery: 0.1 })];

    const result = await s.service.refresh({ learnerKey: LEARNER });
    expect(result.ok && result.value.opened).toBe(0);
  });

  it('stores the evidence behind the decision', async () => {
    // A teacher must be shown the basis, not asked to trust "the algorithm".
    const s = setup();
    s.evidence.points = [gap({ mastery: 0.4, masteryThreshold: 0.85 })];

    await s.service.refresh({ learnerKey: LEARNER });
    expect(s.episodes.rows[0]?.openedEvidence).toMatchObject({
      mastery: 0.4,
      threshold: 0.85,
      observations: 5,
    });
  });
});

describe('no manual close', () => {
  it('exposes no method to close or dismiss an episode', () => {
    const s = setup();
    const surface = [
      ...Object.getOwnPropertyNames(Object.getPrototypeOf(s.service)),
    ];

    // The correction of legacy's PATCHable masteryAchieved. If someone adds a
    // close/dismiss/override method, this fails and the gate is re-read.
    expect(surface.filter((m) => /close|dismiss|resolve|override|complete/i.test(m))).toEqual([]);
  });
});

describe('recommendations', () => {
  function resource(overrides: Partial<LearningResource> = {}): LearningResource {
    return {
      resourceKey: 'RES-1',
      title: 'Reading',
      kind: 'READING',
      conceptKey: CONCEPT,
      estimatedMinutes: 10,
      ...overrides,
    };
  }

  it('attaches ranked recommendations to open episodes', async () => {
    const s = setup();
    s.evidence.points = [gap()];
    s.resources.rows = [
      resource({ resourceKey: 'A', kind: 'READING' }),
      resource({ resourceKey: 'B', kind: 'WORKED_EXAMPLE' }),
    ];
    await s.service.refresh({ learnerKey: LEARNER });

    const listed = await s.service.openEpisodes({ learnerKey: LEARNER });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;

    expect(listed.value[0]?.recommendations[0]?.resourceKey).toBe('B');
  });

  it('leads with corrective content for a misconception', async () => {
    const s = setup();
    s.evidence.points = [gap({ mastery: 0.9, openMisconceptionKeys: ['MIS-A'] })];
    s.resources.rows = [
      resource({ resourceKey: 'A', kind: 'READING' }),
      resource({ resourceKey: 'R', kind: 'REMEDIAL' }),
    ];
    await s.service.refresh({ learnerKey: LEARNER });

    const listed = await s.service.openEpisodes({ learnerKey: LEARNER });
    if (!listed.ok) return;
    expect(listed.value[0]?.recommendations[0]).toMatchObject({
      resourceKey: 'R',
      reason: 'remediation.corrective_content',
    });
  });

  it('returns an episode with no recommendations rather than hiding it', async () => {
    // A gap with no resource is still a gap the teacher must see.
    const s = setup();
    s.evidence.points = [gap()];
    await s.service.refresh({ learnerKey: LEARNER });

    const listed = await s.service.openEpisodes({ learnerKey: LEARNER });
    if (!listed.ok) return;
    expect(listed.value).toHaveLength(1);
    expect(listed.value[0]?.recommendations).toEqual([]);
  });

  it('skips the resource lookup when recommendations are not wanted', async () => {
    const s = setup();
    s.evidence.points = [gap()];
    await s.service.refresh({ learnerKey: LEARNER });

    const listed = await s.service.openEpisodes({
      learnerKey: LEARNER,
      withRecommendations: false,
    });
    if (!listed.ok) return;
    expect(listed.value[0]?.recommendations).toEqual([]);
  });
});

describe('the cohort tracker', () => {
  it('summarises episodes across learners', async () => {
    const s = setup();
    s.evidence.points = [gap()];
    await s.service.refresh({ learnerKey: LEARNER });
    await s.service.refresh({ learnerKey: 'lrn-2' });

    const tracker = await s.service.cohortTracker({ learnerKeys: [LEARNER, 'lrn-2'] });
    expect(tracker.ok).toBe(true);
    if (!tracker.ok) return;

    expect(tracker.value.summary.open).toBe(2);
    expect(tracker.value.summary.byTrigger.MASTERY_GAP).toBe(2);
  });

  it('refuses an empty cohort rather than reporting zeroes', async () => {
    const tracker = await setup().service.cohortTracker({ learnerKeys: [] });
    expect(tracker.ok).toBe(false);
    if (tracker.ok) return;
    expect(tracker.error.code).toBe('remediation.empty_cohort');
  });

  it('names stale episodes', async () => {
    const s = setup();
    s.evidence.points = [gap()];
    await s.service.refresh({ learnerKey: LEARNER });

    clockNow = new Date('2026-10-12T10:00:00.000Z');
    const tracker = await s.service.cohortTracker({ learnerKeys: [LEARNER] });
    clockNow = new Date('2026-09-12T10:00:00.000Z');

    if (!tracker.ok) return;
    expect(tracker.value.summary.stale).toHaveLength(1);
  });
});

describe('superseding', () => {
  it('marks episodes SUPERSEDED, not RESOLVED, when a concept leaves the book', async () => {
    // Recording this as a resolution would inflate the "we fixed it" number
    // every time a textbook was reorganised.
    const s = setup();
    s.evidence.points = [gap()];
    await s.service.refresh({ learnerKey: LEARNER });

    const count = await s.service.supersedeForConcepts([CONCEPT]);
    expect(count.ok && count.value).toBe(1);
    expect(s.episodes.rows[0]?.status).toBe('SUPERSEDED');
  });

  it('does nothing for an empty list', async () => {
    const result = await setup().service.supersedeForConcepts([]);
    expect(result.ok && result.value).toBe(0);
  });
});

describe('history', () => {
  it('returns resolved episodes too', async () => {
    const s = setup();
    s.evidence.points = [gap()];
    await s.service.refresh({ learnerKey: LEARNER });
    s.evidence.points = [gap({ mastery: 0.95 })];
    await s.service.refresh({ learnerKey: LEARNER });

    const history = await s.service.history(LEARNER);
    if (!history.ok) return;
    expect(history.value).toHaveLength(1);
    expect(history.value[0]?.status).toBe('RESOLVED');
  });
});
