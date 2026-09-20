/**
 * Prisma adapters for remediation.
 *
 * The only writer of `remediation_episodes`, and its write surface is
 * deliberately tiny: `applyDetection` and `supersedeForConcepts`. There is no
 * generic update, so no call site can set a status directly — the same
 * single-writer discipline as content (CW1), mastery (M1) and instruction
 * (IW1), enforced by rule RW1.
 *
 * `applyDetection` runs in one transaction because opens and resolves are one
 * reading of one evidence state. Applied separately, there is a window in which
 * a learner both has an open gap and has recovered from it, and any report
 * rendered in that window contradicts itself.
 */

import type {
  EpisodeRecord,
  RemediationRepository,
} from '../../contexts/learning/application/remediation.ports.js';
import type {
  ExistingEpisode,
  RemediationStatus,
  RemediationTrigger,
} from '../../contexts/learning/domain/remediation.js';
import type { GapEvidence } from '../../contexts/learning/domain/remediation.js';
import type { GapEvidenceReader } from '../../contexts/learning/application/remediation.ports.js';
import { daysBetween } from '../../shared/kernel/clock.js';
import { retrievability } from '../../contexts/mastery/domain/retention.js';
import type { Db } from './prisma.client.js';
import { publishedConcept } from './published-content.js';

const episodeSelect = {
  key: true,
  trigger: true,
  status: true,
  openedReason: true,
  resolvedReason: true,
  openedEvidence: true,
  openedAt: true,
  resolvedAt: true,
  learner: { select: { key: true } },
  concept: { select: { key: true } },
  misconception: { select: { key: true } },
} as const;

type EpisodeRow = {
  key: string;
  trigger: string;
  status: string;
  openedReason: string;
  resolvedReason: string | null;
  openedEvidence: unknown;
  openedAt: Date;
  resolvedAt: Date | null;
  learner: { key: string };
  concept: { key: string };
  misconception: { key: string } | null;
};

function toEpisode(row: EpisodeRow): EpisodeRecord {
  return {
    episodeKey: row.key,
    learnerKey: row.learner.key,
    conceptKey: row.concept.key,
    trigger: row.trigger as RemediationTrigger,
    status: row.status as RemediationStatus,
    misconceptionKey: row.misconception?.key ?? null,
    openedReason: row.openedReason,
    resolvedReason: row.resolvedReason,
    openedEvidence: (row.openedEvidence as Record<string, unknown>) ?? {},
    openedAt: row.openedAt,
    resolvedAt: row.resolvedAt,
  };
}

export class PrismaRemediationRepository implements RemediationRepository {
  constructor(private readonly db: Db) {}

  async forLearner(learnerKey: string, openOnly = false): Promise<EpisodeRecord[]> {
    const rows = await this.db.remediationEpisode.findMany({
      where: { learner: { key: learnerKey }, ...(openOnly ? { status: 'OPEN' } : {}) },
      select: episodeSelect,
      // Oldest first: a gap open for a month matters more than one opened today.
      orderBy: { openedAt: 'asc' },
    });
    return rows.map((r) => toEpisode(r as EpisodeRow));
  }

  async openEpisodesFor(learnerKey: string): Promise<ExistingEpisode[]> {
    const rows = await this.db.remediationEpisode.findMany({
      where: { learner: { key: learnerKey }, status: 'OPEN' },
      select: {
        key: true,
        trigger: true,
        status: true,
        concept: { select: { key: true } },
        misconception: { select: { key: true } },
      },
    });

    return rows.map((row) => ({
      episodeKey: row.key,
      conceptKey: row.concept.key,
      trigger: row.trigger as RemediationTrigger,
      status: row.status as RemediationStatus,
      misconceptionKey: row.misconception?.key ?? null,
    }));
  }

  async applyDetection(
    input: Parameters<RemediationRepository['applyDetection']>[0],
  ): Promise<{ opened: number; resolved: number }> {
    if (input.toOpen.length === 0 && input.toResolve.length === 0) {
      return { opened: 0, resolved: 0 };
    }

    const learner = await this.db.learnerProfile.findUnique({
      where: { key: input.learnerKey },
      select: { id: true },
    });
    if (!learner) return { opened: 0, resolved: 0 };

    const [concepts, misconceptions] = await Promise.all([
      this.db.concept.findMany({
        where: { key: { in: input.toOpen.map((e) => e.conceptKey) } },
        select: { id: true, key: true },
      }),
      this.db.misconception.findMany({
        where: {
          key: { in: input.toOpen.flatMap((e) => (e.misconceptionKey ? [e.misconceptionKey] : [])) },
        },
        select: { id: true, key: true },
      }),
    ]);
    const conceptId = new Map(concepts.map((c) => [c.key, c.id]));
    const misconceptionId = new Map(misconceptions.map((m) => [m.key, m.id]));

    await this.db.$transaction(async (tx) => {
      if (input.toOpen.length > 0) {
        await tx.remediationEpisode.createMany({
          data: input.toOpen.flatMap((episode) => {
            const id = conceptId.get(episode.conceptKey);
            if (!id) return [];
            return [
              {
                key: episode.episodeKey,
                learnerId: learner.id,
                conceptId: id,
                trigger: episode.trigger,
                misconceptionId: episode.misconceptionKey
                  ? (misconceptionId.get(episode.misconceptionKey) ?? null)
                  : null,
                openedReason: episode.reason,
                openedEvidence: episode.evidence as never,
                openedAt: input.at,
              },
            ];
          }),
          // Backstop for a concurrent refresh of the same learner. The partial
          // unique index is the real guarantee; this keeps a race from turning
          // into a 500 on a request that was going to be a no-op anyway.
          skipDuplicates: true,
        });
      }

      for (const resolution of input.toResolve) {
        await tx.remediationEpisode.updateMany({
          // Scoped to OPEN so a re-run cannot rewrite an already-closed
          // episode's resolvedAt and destroy its duration.
          where: { key: resolution.episodeKey, status: 'OPEN' },
          data: {
            status: 'RESOLVED',
            resolvedReason: resolution.reason,
            resolvedAt: input.at,
          },
        });
      }
    });

    return { opened: input.toOpen.length, resolved: input.toResolve.length };
  }

  async forLearners(input: {
    learnerKeys: readonly string[];
    openOnly?: boolean;
  }): Promise<EpisodeRecord[]> {
    if (input.learnerKeys.length === 0) return [];

    const rows = await this.db.remediationEpisode.findMany({
      where: {
        learner: { key: { in: [...input.learnerKeys] } },
        ...(input.openOnly ? { status: 'OPEN' } : {}),
      },
      select: episodeSelect,
      orderBy: { openedAt: 'asc' },
      take: 500,
    });
    return rows.map((r) => toEpisode(r as EpisodeRow));
  }

  async supersedeForConcepts(conceptKeys: readonly string[], at: Date): Promise<number> {
    if (conceptKeys.length === 0) return 0;

    const result = await this.db.remediationEpisode.updateMany({
      where: { concept: { key: { in: [...conceptKeys] } }, status: 'OPEN' },
      // SUPERSEDED, never RESOLVED: the gap did not close, the question stopped
      // being meaningful.
      data: { status: 'SUPERSEDED', resolvedReason: 'remediation.concept_retired', resolvedAt: at },
    });
    return result.count;
  }
}

/**
 * Assembles gap evidence from Mastery and Misconception.
 *
 * Read-only across both. Learning consumes these numbers and never writes
 * them; mastery in particular is read the same way every other surface reads
 * it — stored value times retrievability — so remediation cannot disagree with
 * the learner's own screen about how well they know something.
 */
export class PrismaGapEvidenceReader implements GapEvidenceReader {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async forLearner(input: {
    learnerKey: string;
    conceptKeys?: readonly string[];
    textbookKey?: string | null;
  }): Promise<GapEvidence[]> {
    const scope = input.conceptKeys?.length
      ? { key: { in: [...input.conceptKeys] } }
      : input.textbookKey
        ? { lesson: { unit: { textbook: { key: input.textbookKey } } } }
        : {};

    const [mastery, misconceptions] = await Promise.all([
      this.db.conceptMastery.findMany({
        where: {
          learner: { key: input.learnerKey },
          // Only published, active concepts: a gap on retired content is not
          // something a learner can act on, and opening an episode for it
          // would produce a task nobody can complete.
          concept: { ...publishedConcept, ...scope },
        },
        select: {
          mastery: true,
          stabilityDays: true,
          lastObservedAt: true,
          attemptsCount: true,
          concept: { select: { key: true, masteryThreshold: true } },
        },
      }),
      this.db.learnerMisconception.findMany({
        where: {
          learner: { key: input.learnerKey },
          isResolved: false,
          concept: { ...publishedConcept, ...scope },
        },
        select: {
          concept: { select: { key: true } },
          misconception: { select: { key: true } },
        },
      }),
    ]);

    const openByConcept = new Map<string, string[]>();
    for (const row of misconceptions) {
      if (!row.misconception) continue;
      const list = openByConcept.get(row.concept.key) ?? [];
      list.push(row.misconception.key);
      openByConcept.set(row.concept.key, list);
    }

    const now = this.now();
    const out: GapEvidence[] = mastery.map((row) => {
      const elapsed = row.lastObservedAt ? Math.max(0, daysBetween(row.lastObservedAt, now)) : 0;
      const recall = retrievability(elapsed, row.stabilityDays);
      return {
        conceptKey: row.concept.key,
        mastery: row.mastery,
        effectiveMastery: Number((row.mastery * recall).toFixed(6)),
        observations: row.attemptsCount,
        masteryThreshold: row.concept.masteryThreshold,
        openMisconceptionKeys: openByConcept.get(row.concept.key) ?? [],
      };
    });

    // A misconception can be diagnosed on a concept with no mastery record at
    // all. Dropping those would silently hide the most actionable gap there
    // is — a learner with a confirmed wrong model and no measured mastery.
    const covered = new Set(out.map((e) => e.conceptKey));
    for (const [conceptKey, keys] of openByConcept) {
      if (covered.has(conceptKey)) continue;
      out.push({
        conceptKey,
        mastery: 0,
        effectiveMastery: 0,
        // Zero observations, so this can never trip the MASTERY_GAP rule —
        // only the misconception trigger, which is what the evidence supports.
        observations: 0,
        openMisconceptionKeys: keys,
      });
    }

    return out;
  }
}
