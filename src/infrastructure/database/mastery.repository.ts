/**
 * Prisma adapter for the Mastery ports.
 *
 * Adapters translate; they do not decide. There is no threshold, no formula and
 * no pedagogy in this file — only mapping between rows and domain records. If
 * you ever feel the urge to add an `if (mastery > 0.85)` here, it belongs in
 * the domain layer instead.
 */

import type { Evidence } from '../../contexts/assessment/domain/evidence.js';
import type {
  ConceptMasteryPolicy,
  MisconceptionRecord,
  EvidenceReader,
  MasteryRecord,
  MasteryRepository,
} from '../../contexts/mastery/application/ports.js';
import type { Db } from './prisma.client.js';

export class PrismaMasteryRepository implements MasteryRepository {
  constructor(private readonly db: Db) {}

  async findOne(learnerKey: string, conceptKey: string): Promise<MasteryRecord | null> {
    const row = await this.db.conceptMastery.findFirst({
      where: { learner: { key: learnerKey }, concept: { key: conceptKey } },
      include: { concept: { select: { key: true } } },
    });
    return row ? toRecord(learnerKey, row.concept.key, row) : null;
  }

  async findMany(learnerKey: string, conceptKeys: readonly string[]): Promise<MasteryRecord[]> {
    if (conceptKeys.length === 0) return [];
    const rows = await this.db.conceptMastery.findMany({
      where: { learner: { key: learnerKey }, concept: { key: { in: [...conceptKeys] } } },
      include: { concept: { select: { key: true } } },
    });
    return rows.map((r) => toRecord(learnerKey, r.concept.key, r));
  }

  async findAllForLearner(learnerKey: string): Promise<MasteryRecord[]> {
    const rows = await this.db.conceptMastery.findMany({
      where: { learner: { key: learnerKey } },
      include: { concept: { select: { key: true } } },
    });
    return rows.map((r) => toRecord(learnerKey, r.concept.key, r));
  }

  /**
   * The single mastery write path. Runs in one transaction so a partial
   * recompute can never leave a learner's profile half-updated.
   */
  async upsertMany(records: readonly MasteryRecord[]): Promise<void> {
    if (records.length === 0) return;

    const learnerKey = records[0]!.learnerKey;
    const learner = await this.db.learnerProfile.findUnique({
      where: { key: learnerKey },
      select: { id: true },
    });
    if (!learner) throw new Error(`Unknown learner key: ${learnerKey}`);

    const concepts = await this.db.concept.findMany({
      where: { key: { in: records.map((r) => r.conceptKey) } },
      select: { id: true, key: true },
    });
    const idByKey = new Map(concepts.map((c) => [c.key, c.id]));

    await this.db.$transaction(
      records
        .filter((r) => idByKey.has(r.conceptKey))
        .map((r) => {
          const data = {
            mastery: r.mastery,
            confidence: r.confidence,
            stabilityDays: r.stabilityDays,
            attemptsCount: r.attemptsCount,
            correctCount: r.correctCount,
            lastObservedAt: r.lastObservedAt,
            recomputedAt: new Date(),
          };
          return this.db.conceptMastery.upsert({
            where: {
              learnerId_conceptId: { learnerId: learner.id, conceptId: idByKey.get(r.conceptKey)! },
            },
            create: { learnerId: learner.id, conceptId: idByKey.get(r.conceptKey)!, ...data },
            update: data,
          });
        }),
    );
  }

  /**
   * The single misconception-state write path (rule MW1).
   *
   * Scoped delete-then-insert rather than upsert-per-row: the derivation
   * returns the COMPLETE truth for the concepts it examined, so a row that is
   * no longer derivable must disappear rather than linger. Upserting would
   * leave orphaned state behind forever — the failure mode legacy had, where
   * nothing ever cleared a misconception.
   *
   * Both statements run in one transaction, so a reader can never observe the
   * window where the learner's state has been deleted but not yet rewritten.
   */
  async replaceMisconceptions(
    learnerKey: string,
    conceptKeys: readonly string[],
    records: readonly MisconceptionRecord[],
  ): Promise<void> {
    if (conceptKeys.length === 0) return;

    const learner = await this.db.learnerProfile.findUnique({
      where: { key: learnerKey },
      select: { id: true },
    });
    if (!learner) throw new Error(`Unknown learner key: ${learnerKey}`);

    // Sequential, not Promise.all: the dev database is PGlite, which serves a
    // single connection, and two concurrent queries on it terminate the
    // connection outright. Cheap here (two indexed lookups) and correct on
    // both PGlite and real Postgres.
    const concepts = await this.db.concept.findMany({
      where: { key: { in: [...conceptKeys] } },
      select: { id: true, key: true },
    });
    const misconceptions = await this.db.misconception.findMany({
      where: { key: { in: records.map((r) => r.misconceptionKey) } },
      select: { id: true, key: true },
    });

    const conceptIdByKey = new Map(concepts.map((c) => [c.key, c.id]));
    const misconceptionIdByKey = new Map(misconceptions.map((m) => [m.key, m.id]));
    const conceptIds = [...conceptIdByKey.values()];
    if (conceptIds.length === 0) return;

    const rows = records.flatMap((r) => {
      const conceptId = conceptIdByKey.get(r.conceptKey);
      const misconceptionId = misconceptionIdByKey.get(r.misconceptionKey);
      // A misconception key with no authored row cannot be stored: the column
      // is a foreign key. Skipping is correct — the evidence still records what
      // was diagnosed, so nothing is lost and a later authoring fixes it.
      if (!conceptId || !misconceptionId) return [];
      return [
        {
          learnerId: learner.id,
          conceptId,
          misconceptionId,
          occurrences: r.occurrences,
          confidence: r.confidence,
          firstSeenAt: r.firstSeenAt,
          lastSeenAt: r.lastSeenAt,
          isResolved: r.isResolved,
          resolvedAt: r.resolvedAt,
        },
      ];
    });

    await this.db.$transaction([
      this.db.learnerMisconception.deleteMany({
        where: { learnerId: learner.id, conceptId: { in: conceptIds } },
      }),
      ...(rows.length > 0
        ? [this.db.learnerMisconception.createMany({ data: rows })]
        : []),
    ]);
  }
}

export class PrismaEvidenceReader implements EvidenceReader {
  constructor(private readonly db: Db) {}

  async forLearner(learnerKey: string, conceptKeys?: readonly string[]): Promise<Evidence[]> {
    const rows = await this.db.masteryEvidence.findMany({
      where: {
        learner: { key: learnerKey },
        ...(conceptKeys?.length ? { concept: { key: { in: [...conceptKeys] } } } : {}),
      },
      include: { concept: { select: { key: true } } },
      // Chronological order is a correctness requirement for BKT replay,
      // not a nicety. `id` is a UUID and sorts meaninglessly.
      orderBy: [{ observedAt: 'asc' }, { createdAt: 'asc' }],
    });

    return rows.map((r) => ({
      conceptKey: r.concept.key,
      questionKey: r.questionKey,
      isCorrect: r.isCorrect,
      weight: r.weight,
      observedAt: r.observedAt,
      verdict: r.verdict,
      ...(r.misconceptionKey ? { misconceptionKey: r.misconceptionKey } : {}),
    }));
  }
}

export class PrismaConceptMasteryPolicy implements ConceptMasteryPolicy {
  constructor(private readonly db: Db) {}

  async thresholds(conceptKeys: readonly string[]): Promise<ReadonlyMap<string, number>> {
    if (conceptKeys.length === 0) return new Map();
    const rows = await this.db.concept.findMany({
      where: { key: { in: [...conceptKeys] } },
      select: { key: true, masteryThreshold: true },
    });
    return new Map(rows.map((r) => [r.key, r.masteryThreshold]));
  }
}

function toRecord(
  learnerKey: string,
  conceptKey: string,
  row: {
    mastery: number;
    confidence: number;
    stabilityDays: number;
    attemptsCount: number;
    correctCount: number;
    lastObservedAt: Date | null;
  },
): MasteryRecord {
  return {
    learnerKey,
    conceptKey,
    mastery: row.mastery,
    confidence: row.confidence,
    stabilityDays: row.stabilityDays,
    attemptsCount: row.attemptsCount,
    correctCount: row.correctCount,
    lastObservedAt: row.lastObservedAt,
  };
}
