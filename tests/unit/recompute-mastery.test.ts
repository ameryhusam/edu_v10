/**
 * Use-case test with in-memory ports — no database, no network.
 *
 * That this is possible at all is the architecture working: the use case only
 * ever sees interfaces, so a Map is a perfectly valid repository.
 */

import { describe, expect, it } from 'vitest';
import { RecomputeMasteryUseCase } from '../../src/contexts/mastery/application/recompute-mastery.use-case.js';
import type {
  ConceptMasteryPolicy,
  EvidenceReader,
  MasteryRecord,
  MasteryRepository,
  MisconceptionRecord,
} from '../../src/contexts/mastery/application/ports.js';
import type { Evidence } from '../../src/contexts/assessment/domain/evidence.js';
import { fixedClock } from '../../src/shared/kernel/clock.js';
import { unwrap } from '../../src/shared/kernel/result.js';

class InMemoryMasteryRepository implements MasteryRepository {
  readonly store = new Map<string, MasteryRecord>();

  async findOne(learnerKey: string, conceptKey: string) {
    return this.store.get(`${learnerKey}|${conceptKey}`) ?? null;
  }
  async findMany(learnerKey: string, conceptKeys: readonly string[]) {
    return conceptKeys
      .map((k) => this.store.get(`${learnerKey}|${k}`))
      .filter((r): r is MasteryRecord => r != null);
  }
  async findAllForLearner(learnerKey: string) {
    return [...this.store.values()].filter((r) => r.learnerKey === learnerKey);
  }
  /** Mirrors the adapter's scoped replace so tests see real semantics. */
  readonly misconceptions = new Map<string, MisconceptionRecord>();

  async replaceMisconceptions(
    learnerKey: string,
    conceptKeys: readonly string[],
    records: readonly MisconceptionRecord[],
  ) {
    const scope = new Set(conceptKeys);
    for (const [k, r] of this.misconceptions) {
      if (r.learnerKey === learnerKey && scope.has(r.conceptKey)) this.misconceptions.delete(k);
    }
    for (const r of records) {
      this.misconceptions.set(`${r.learnerKey}|${r.conceptKey}|${r.misconceptionKey}`, r);
    }
  }

  async upsertMany(records: readonly MasteryRecord[]) {
    for (const r of records) this.store.set(`${r.learnerKey}|${r.conceptKey}`, r);
  }
}

const evidence = (
  conceptKey: string,
  isCorrect: boolean,
  observedAt: string,
  weight = 1,
  misconceptionKey?: string,
): Evidence => ({
  conceptKey,
  questionKey: `Q-${observedAt}`,
  isCorrect,
  weight,
  observedAt: new Date(observedAt),
  verdict: isCorrect ? 'CORRECT' : 'INCORRECT',
  ...(misconceptionKey ? { misconceptionKey } : {}),
});

function makeUseCase(stream: Evidence[], repo = new InMemoryMasteryRepository()) {
  const reader: EvidenceReader = {
    async forLearner(_learner, conceptKeys) {
      const filtered = conceptKeys
        ? stream.filter((e) => conceptKeys.includes(e.conceptKey))
        : stream;
      return [...filtered].sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime());
    },
  };
  const policy: ConceptMasteryPolicy = {
    async thresholds(keys) {
      return new Map(keys.map((k) => [k, 0.85]));
    },
  };
  const clock = fixedClock('2026-03-01T00:00:00Z');
  return { useCase: new RecomputeMasteryUseCase(reader, repo, policy, clock), repo };
}

describe('RecomputeMastery', () => {
  it('derives mastery purely from the evidence stream', async () => {
    const { useCase } = makeUseCase([
      evidence('C1', true, '2026-02-25T10:00:00Z'),
      evidence('C1', true, '2026-02-26T10:00:00Z'),
      evidence('C1', true, '2026-02-27T10:00:00Z'),
    ]);
    const views = unwrap(await useCase.execute({ learnerKey: 'lrn_1' }));
    expect(views).toHaveLength(1);
    expect(views[0]!.snapshot.value).toBeGreaterThan(0.5);
  });

  it('is idempotent even when a previous result is already stored', async () => {
    // Regression: stability used to be seeded from the stored record, so each
    // run compounded on the last and the same evidence drifted upward.
    const stream = [
      evidence('C1', true, '2026-02-20T10:00:00Z'),
      evidence('C1', true, '2026-02-22T10:00:00Z'),
      evidence('C1', true, '2026-02-24T10:00:00Z'),
      evidence('C1', true, '2026-02-26T10:00:00Z'),
    ];
    const { useCase } = makeUseCase(stream);

    const run1 = unwrap(await useCase.execute({ learnerKey: 'lrn_1' }))[0]!;
    const run2 = unwrap(await useCase.execute({ learnerKey: 'lrn_1' }))[0]!;
    const run3 = unwrap(await useCase.execute({ learnerKey: 'lrn_1' }))[0]!;

    expect(run2.stabilityDays).toBe(run1.stabilityDays);
    expect(run3.stabilityDays).toBe(run1.stabilityDays);
    expect(run2.snapshot.effective).toBe(run1.snapshot.effective);
    expect(run3.snapshot.effective).toBe(run1.snapshot.effective);
  });

  it('is idempotent — running twice does not inflate mastery', async () => {
    const stream = [
      evidence('C1', true, '2026-02-25T10:00:00Z'),
      evidence('C1', false, '2026-02-26T10:00:00Z'),
      evidence('C1', true, '2026-02-27T10:00:00Z'),
    ];
    const { useCase, repo } = makeUseCase(stream);

    const first = unwrap(await useCase.execute({ learnerKey: 'lrn_1' }));
    const second = unwrap(await useCase.execute({ learnerKey: 'lrn_1' }));

    expect(second[0]!.snapshot.value).toBe(first[0]!.snapshot.value);
    expect(repo.store.size).toBe(1);
  });

  it('ignores zero-weight evidence in the attempt count', async () => {
    const { useCase } = makeUseCase([
      evidence('C1', true, '2026-02-25T10:00:00Z'),
      evidence('C1', false, '2026-02-26T10:00:00Z', 0),
    ]);
    const views = unwrap(await useCase.execute({ learnerKey: 'lrn_1' }));
    expect(views[0]!.attemptsCount).toBe(1);
  });

  it('applies forgetting: stale mastery reads lower than fresh mastery', async () => {
    const stale = makeUseCase(
      Array.from({ length: 6 }, (_, i) =>
        evidence('C1', true, `2026-01-0${i + 1}T10:00:00Z`),
      ),
    );
    const fresh = makeUseCase(
      Array.from({ length: 6 }, (_, i) =>
        evidence('C1', true, `2026-02-2${i + 1}T10:00:00Z`),
      ),
    );

    const staleView = unwrap(await stale.useCase.execute({ learnerKey: 'lrn_1' }))[0]!;
    const freshView = unwrap(await fresh.useCase.execute({ learnerKey: 'lrn_1' }))[0]!;

    expect(staleView.snapshot.effective).toBeLessThan(freshView.snapshot.effective);
    // The belief at the time of observation is unchanged — only recall decays.
    expect(staleView.snapshot.value).toBeCloseTo(freshView.snapshot.value, 4);
  });

  it('separates concepts rather than pooling their evidence', async () => {
    const { useCase } = makeUseCase([
      evidence('C1', true, '2026-02-25T10:00:00Z'),
      evidence('C2', false, '2026-02-25T11:00:00Z'),
    ]);
    const views = unwrap(await useCase.execute({ learnerKey: 'lrn_1' }));
    const byKey = new Map(views.map((v) => [v.conceptKey, v]));
    expect(byKey.get('C1')!.snapshot.value).toBeGreaterThan(byKey.get('C2')!.snapshot.value);
  });
});

/**
 * Misconception promotion — the defect this closes.
 *
 * Before this, `mastery_evidence.misconceptionKey` was written on every
 * diagnostic wrong answer and nothing ever promoted it, so
 * `learner_misconceptions` stayed permanently empty and both of its consumers
 * were dead branches. These tests pin the promotion to the mastery recompute.
 */
describe('RecomputeMastery — misconception promotion', () => {
  it('promotes a diagnosed misconception into learner state', async () => {
    const { useCase, repo } = makeUseCase([
      evidence('C1', false, '2026-01-01T00:00:00Z', 1, 'MIS-A'),
    ]);

    await useCase.execute({ learnerKey: 'L1' });

    const stored = [...repo.misconceptions.values()];
    expect(stored).toHaveLength(1);
    expect(stored[0]!.misconceptionKey).toBe('MIS-A');
    expect(stored[0]!.conceptKey).toBe('C1');
    expect(stored[0]!.isResolved).toBe(false);
  });

  it('writes nothing when no misconception was ever diagnosed', async () => {
    const { useCase, repo } = makeUseCase([evidence('C1', false, '2026-01-01T00:00:00Z')]);

    await useCase.execute({ learnerKey: 'L1' });
    expect(repo.misconceptions.size).toBe(0);
  });

  it('is idempotent — a replayed recompute does not inflate occurrences', async () => {
    // The legacy writer did `confidence + 0.1` per call, so a retried
    // submission permanently changed the number. This is the regression guard.
    const { useCase, repo } = makeUseCase([
      evidence('C1', false, '2026-01-01T00:00:00Z', 1, 'MIS-A'),
      evidence('C1', false, '2026-01-02T00:00:00Z', 1, 'MIS-A'),
    ]);

    await useCase.execute({ learnerKey: 'L1' });
    const first = [...repo.misconceptions.values()][0]!;

    await useCase.execute({ learnerKey: 'L1' });
    await useCase.execute({ learnerKey: 'L1' });
    const third = [...repo.misconceptions.values()][0]!;

    expect(third.occurrences).toBe(2);
    expect(third).toEqual(first);
  });

  it('clears state once the learner recovers', async () => {
    const { useCase, repo } = makeUseCase([
      evidence('C1', false, '2026-01-01T00:00:00Z', 1, 'MIS-A'),
      evidence('C1', true, '2026-01-02T00:00:00Z'),
      evidence('C1', true, '2026-01-03T00:00:00Z'),
    ]);

    await useCase.execute({ learnerKey: 'L1' });

    const stored = [...repo.misconceptions.values()][0]!;
    expect(stored.isResolved).toBe(true);
    expect(stored.resolvedAt).toEqual(new Date('2026-01-03T00:00:00Z'));
  });

  it('keeps misconceptions on the concept where they were diagnosed', async () => {
    const { useCase, repo } = makeUseCase([
      evidence('C1', false, '2026-01-01T00:00:00Z', 1, 'MIS-A'),
      evidence('C2', false, '2026-01-02T00:00:00Z', 1, 'MIS-B'),
    ]);

    await useCase.execute({ learnerKey: 'L1' });

    const byConcept = new Map(
      [...repo.misconceptions.values()].map((r) => [r.conceptKey, r.misconceptionKey]),
    );
    expect(byConcept.get('C1')).toBe('MIS-A');
    expect(byConcept.get('C2')).toBe('MIS-B');
  });

  it('a scoped recompute does not disturb state on other concepts', async () => {
    // The reason `replaceMisconceptions` takes conceptKeys: a partial recompute
    // must not delete state for concepts it never examined.
    const { useCase, repo } = makeUseCase([
      evidence('C1', false, '2026-01-01T00:00:00Z', 1, 'MIS-A'),
      evidence('C2', false, '2026-01-02T00:00:00Z', 1, 'MIS-B'),
    ]);

    await useCase.execute({ learnerKey: 'L1' });
    expect(repo.misconceptions.size).toBe(2);

    await useCase.execute({ learnerKey: 'L1', conceptKeys: ['C1'] });

    expect(repo.misconceptions.size).toBe(2);
    expect([...repo.misconceptions.values()].some((r) => r.conceptKey === 'C2')).toBe(true);
  });
});
