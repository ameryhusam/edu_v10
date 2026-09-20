/**
 * Prisma adapters for Engagement.
 *
 * The only writer of `xp_ledger`, guarded by rule XW1, and its write surface is
 * a single append. There is no update and no delete: XP already awarded is a
 * fact about the past, and a feature that can quietly take points away is worse
 * than one that cannot give them.
 */

import { Prisma } from '@prisma/client';
import type {
  AnswerHistoryReader,
  XpAward,
  XpEntryRecord,
  XpLedger,
} from '../../contexts/engagement/application/engagement.ports.js';
import type { Db } from './prisma.client.js';

export class PrismaXpLedger implements XpLedger {
  constructor(private readonly db: Db) {}

  async append(award: XpAward): Promise<boolean> {
    const learner = await this.db.learnerProfile.findUnique({
      where: { key: award.learnerKey },
      select: { id: true },
    });
    // Fail closed, as legacy eventually learned to: an unknown learner gets no
    // XP and no invented profile. Legacy originally created a placeholder user
    // with a literal 'default_hash' password and awarded it real points.
    if (!learner) return false;

    try {
      await this.db.xpLedgerEntry.create({
        data: {
          learnerId: learner.id,
          amount: award.amount,
          reason: award.reason,
          sourceKey: award.sourceKey,
          idempotencyKey: award.idempotencyKey,
        },
      });
      return true;
    } catch (error) {
      // P2002 is the unique constraint on idempotencyKey doing its job: this
      // award has already been paid. Caught rather than pre-checked because two
      // concurrent submissions would both pass a read-then-write.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return false;
      }
      throw error;
    }
  }

  async totalFor(learnerKey: string): Promise<number> {
    const result = await this.db.xpLedgerEntry.aggregate({
      where: { learner: { key: learnerKey } },
      _sum: { amount: true },
    });
    return result._sum.amount ?? 0;
  }

  async recentFor(learnerKey: string, limit: number): Promise<XpEntryRecord[]> {
    const rows = await this.db.xpLedgerEntry.findMany({
      where: { learner: { key: learnerKey } },
      select: { amount: true, reason: true, sourceKey: true, awardedAt: true },
      orderBy: { awardedAt: 'desc' },
      take: limit,
    });
    return rows;
  }

  async totalsFor(learnerKeys: readonly string[]): Promise<Map<string, number>> {
    if (learnerKeys.length === 0) return new Map();

    // Grouped in the database rather than summed in memory: a cohort of a
    // thousand learners with a year of history is a lot of rows to ship just to
    // add them up.
    const rows = await this.db.xpLedgerEntry.groupBy({
      by: ['learnerId'],
      where: { learner: { key: { in: [...learnerKeys] } } },
      _sum: { amount: true },
    });

    const learners = await this.db.learnerProfile.findMany({
      where: { key: { in: [...learnerKeys] } },
      select: { id: true, key: true },
    });
    const keyById = new Map(learners.map((l) => [l.id, l.key]));

    const out = new Map<string, number>();
    for (const row of rows) {
      const key = keyById.get(row.learnerId);
      if (key) out.set(key, row._sum.amount ?? 0);
    }
    return out;
  }
}

/**
 * The learner's recent answers, newest first.
 *
 * Reads the evidence stream that Assessment writes — the same rows mastery is
 * computed from — so a streak can never claim a correct answer that mastery
 * does not also see.
 */
export class PrismaAnswerHistoryReader implements AnswerHistoryReader {
  constructor(private readonly db: Db) {}

  async recentAnswers(learnerKey: string, limit: number): Promise<{ isCorrect: boolean }[]> {
    const rows = await this.db.masteryEvidence.findMany({
      where: { learner: { key: learnerKey } },
      select: { isCorrect: true },
      orderBy: { observedAt: 'desc' },
      take: limit,
    });
    return rows;
  }
}
