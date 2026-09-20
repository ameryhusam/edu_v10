/**
 * AI logging and quota adapters.
 *
 * Both exist because "AI in schools" is a governance problem before it is a
 * technical one. Every call is attributable and every learner has a ceiling.
 */

import type {
  AiInteractionLog,
  AiUsageQuota,
  TutoringTask,
} from '../../contexts/tutoring/application/ports.js';
import type { Db } from '../database/prisma.client.js';

export class PrismaAiInteractionLog implements AiInteractionLog {
  constructor(private readonly db: Db) {}

  async record(entry: {
    task: TutoringTask;
    learnerKey: string | null;
    providerId: string;
    modelId: string;
    grounded: boolean;
    chunkIds: readonly string[];
    refused: boolean;
    refusalReason?: string;
    tokensIn: number | null;
    tokensOut: number | null;
    latencyMs: number;
    at: Date;
  }): Promise<void> {
    const user = entry.learnerKey
      ? await this.db.learnerProfile.findUnique({
          where: { key: entry.learnerKey },
          select: { userId: true },
        })
      : null;

    await this.db.aiInteraction.create({
      data: {
        userId: user?.userId ?? null,
        task: entry.task,
        providerId: entry.providerId,
        modelId: entry.modelId,
        grounded: entry.grounded,
        chunkKeys: [...entry.chunkIds],
        refused: entry.refused,
        refusalReason: entry.refusalReason ?? null,
        tokensIn: entry.tokensIn,
        tokensOut: entry.tokensOut,
        latencyMs: entry.latencyMs,
        createdAt: entry.at,
      },
    });
  }
}

/**
 * Daily per-learner quota, counted from the interaction log itself.
 *
 * No separate counter table: the log is already the truth, so a counter could
 * only ever disagree with it. Refused calls are excluded — a learner should not
 * be punished for asking something the corpus could not answer.
 */
export class LogBackedAiQuota implements AiUsageQuota {
  constructor(
    private readonly db: Db,
    private readonly dailyLimit = 50,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async check(learnerKey: string): Promise<{ allowed: boolean; remaining: number; resetAt: Date }> {
    const { start, resetAt } = this.window();
    const learner = await this.db.learnerProfile.findUnique({
      where: { key: learnerKey },
      select: { userId: true },
    });
    if (!learner) return { allowed: false, remaining: 0, resetAt };

    const used = await this.db.aiInteraction.count({
      where: { userId: learner.userId, refused: false, createdAt: { gte: start } },
    });
    const remaining = Math.max(0, this.dailyLimit - used);
    return { allowed: remaining > 0, remaining, resetAt };
  }

  /** No-op: the log write in AskTutor is itself the consumption record. */
  async consume(): Promise<void> {}

  private window(): { start: Date; resetAt: Date } {
    const now = this.now();
    const start = new Date(now);
    start.setUTCHours(0, 0, 0, 0);
    const resetAt = new Date(start);
    resetAt.setUTCDate(resetAt.getUTCDate() + 1);
    return { start, resetAt };
  }
}
