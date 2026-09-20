/**
 * A guardian's children list (gap G2).
 *
 * The rule that carries weight: **verified links only**. An unverified link is
 * an unproven claim of guardianship, and anyone can assert they are a child's
 * parent. Listing an unverified child would also be internally inconsistent —
 * `isVerifiedGuardianOf` refuses that learner on every subsequent route, so
 * the parent would see a name they cannot open.
 *
 * These assert the query, because that is where the rule lives. The live probe
 * covers the real database.
 */

import { describe, expect, it } from 'vitest';
import { PrismaGuardianLinkReader } from '../../src/infrastructure/database/identity.repository.js';
import type { Db } from '../../src/infrastructure/database/prisma.client.js';

interface Recorded {
  where?: unknown;
}

function dbDouble(rows: readonly unknown[]): { db: Db; recorded: Recorded } {
  const recorded: Recorded = {};
  const db = {
    guardianLink: {
      findMany: async (args: { where: unknown }) => {
        recorded.where = args.where;
        return rows;
      },
    },
  } as unknown as Db;
  return { db, recorded };
}

function link(options: {
  key: string;
  fullName: string;
  relation?: string | null;
  gradeName?: string | null;
}) {
  return {
    relation: options.relation ?? null,
    learner: {
      key: options.key,
      user: { fullName: options.fullName },
      enrollments:
        options.gradeName == null ? [] : [{ grade: { name: options.gradeName } }],
    },
  };
}

describe('childrenFor', () => {
  it('selects only verified links, scoped to the calling guardian', async () => {
    const { db, recorded } = dbDouble([]);
    await new PrismaGuardianLinkReader(db).childrenFor('user-123');

    const where = recorded.where as {
      isVerified?: boolean;
      guardian?: { userId?: string };
    };
    // Both halves matter: verified, AND belonging to this user.
    expect(where.isVerified).toBe(true);
    expect(where.guardian?.userId).toBe('user-123');
  });

  it('returns the name a parent can actually read, not just the key', async () => {
    const { db } = dbDouble([
      link({ key: 'lrn_a', fullName: 'طالب تجريبي', relation: 'father', gradeName: 'الصف السابع' }),
    ]);

    const [child] = await new PrismaGuardianLinkReader(db).childrenFor('user-123');

    expect(child).toEqual({
      learnerKey: 'lrn_a',
      fullName: 'طالب تجريبي',
      relation: 'father',
      gradeName: 'الصف السابع',
    });
  });

  it('reports a child with no current enrollment as having no grade', async () => {
    // A registered child who has not been placed in a class yet is a real
    // state. Inventing a grade would be a lie the parent cannot check.
    const { db } = dbDouble([link({ key: 'lrn_b', fullName: 'طفل جديد' })]);

    const [child] = await new PrismaGuardianLinkReader(db).childrenFor('user-123');

    expect(child?.gradeName).toBeNull();
    expect(child?.learnerKey).toBe('lrn_b');
  });

  it('returns an empty list for a user who is not a guardian', async () => {
    // Not an error: a student calling this has no children, and refusing would
    // make the caller distinguish "not a parent" from "no children".
    const { db } = dbDouble([]);
    await expect(new PrismaGuardianLinkReader(db).childrenFor('user-999')).resolves.toEqual([]);
  });
});
