/**
 * The user directory (gap G6).
 *
 * Until this existed an administrator had to already know a user's key to see
 * anything, so there was no way to answer "who is in this system" and every
 * administration screen was unbuildable.
 *
 * Three rules carry weight here.
 *
 * **A role filter is a predicate on the grants, not on the included rows.**
 * Filtering the `include` would return every user and merely hide their roles
 * — the list would silently be wrong rather than empty, which is worse.
 *
 * **The order must be stable and unique.** Paging over an unordered query
 * skips and repeats rows, and Postgres guarantees no order without ORDER BY.
 *
 * **`limit` is clamped in the service, not only at the route.** The route
 * protects the wire; the service protects every other caller.
 */

import { describe, expect, it } from 'vitest';
import { PrismaProvisioningRepository } from '../../src/infrastructure/database/identity.repository.js';
import type { Db } from '../../src/infrastructure/database/prisma.client.js';

interface Recorded {
  where?: Record<string, unknown>;
  orderBy?: unknown;
  take?: number;
  skip?: number;
  countWhere?: Record<string, unknown>;
}

function dbDouble(rows: readonly unknown[], total = rows.length): { db: Db; recorded: Recorded } {
  const recorded: Recorded = {};
  const db = {
    user: {
      count: async (args: { where: Record<string, unknown> }) => {
        recorded.countWhere = args.where;
        return total;
      },
      findMany: async (args: {
        where: Record<string, unknown>;
        orderBy: unknown;
        take: number;
        skip: number;
      }) => {
        recorded.where = args.where;
        recorded.orderBy = args.orderBy;
        recorded.take = args.take;
        recorded.skip = args.skip;
        return rows;
      },
    },
  } as unknown as Db;
  return { db, recorded };
}

function userRow(over: Record<string, unknown> = {}) {
  return {
    key: 'usr_demo_student',
    username: 'student',
    fullName: 'طالب تجريبي',
    email: 'student@edu7.local',
    status: 'ACTIVE',
    roles: [{ role: 'STUDENT' }],
    ...over,
  };
}

const BASE = { limit: 25, offset: 0 };

describe('PrismaProvisioningRepository.listUsers', () => {
  it('searches username, full name and email together', async () => {
    const { db, recorded } = dbDouble([]);
    await new PrismaProvisioningRepository(db).listUsers({ ...BASE, search: 'tea' });

    const or = recorded.where?.['OR'] as readonly Record<string, unknown>[];
    expect(or.map((clause) => Object.keys(clause)[0])).toEqual([
      'username',
      'fullName',
      'email',
    ]);
  });

  it('searches case-insensitively', async () => {
    const { db, recorded } = dbDouble([]);
    await new PrismaProvisioningRepository(db).listUsers({ ...BASE, search: 'TEA' });

    const or = recorded.where?.['OR'] as readonly Record<string, Record<string, string>>[];
    expect(or[0]?.['username']?.['mode']).toBe('insensitive');
  });

  it('omits the search clause entirely when nothing was typed', async () => {
    // An empty `OR: []` matches nothing in Prisma, so a blank search box must
    // not become a filter at all.
    const { db, recorded } = dbDouble([]);
    await new PrismaProvisioningRepository(db).listUsers({ ...BASE });

    expect(recorded.where).not.toHaveProperty('OR');
  });

  it('filters by role through the grants relation, not the included rows', async () => {
    const { db, recorded } = dbDouble([]);
    await new PrismaProvisioningRepository(db).listUsers({ ...BASE, role: 'TEACHER' });

    expect(recorded.where?.['roles']).toEqual({ some: { role: 'TEACHER' } });
  });

  it('scopes a role filter to a school when both are given', async () => {
    const { db, recorded } = dbDouble([]);
    await new PrismaProvisioningRepository(db).listUsers({
      ...BASE,
      role: 'TEACHER',
      schoolKey: 'sch_demo',
    });

    expect(recorded.where?.['roles']).toEqual({
      some: { role: 'TEACHER', school: { key: 'sch_demo' } },
    });
  });

  it('orders by username, which is unique, so paging cannot skip or repeat', async () => {
    const { db, recorded } = dbDouble([]);
    await new PrismaProvisioningRepository(db).listUsers({ ...BASE });

    expect(recorded.orderBy).toEqual({ username: 'asc' });
  });

  it('applies limit and offset to the page', async () => {
    const { db, recorded } = dbDouble([]);
    await new PrismaProvisioningRepository(db).listUsers({ limit: 10, offset: 20 });

    expect(recorded.take).toBe(10);
    expect(recorded.skip).toBe(20);
  });

  it('counts matches with the same predicate as the page', async () => {
    // A total computed with a different filter than the rows is a total that
    // lies, and the pager built on it sends the user to empty pages.
    const { db, recorded } = dbDouble([], 42);
    await new PrismaProvisioningRepository(db).listUsers({ ...BASE, status: 'ACTIVE' });

    expect(recorded.countWhere).toEqual(recorded.where);
  });

  it('reports the total matches, not the number of rows returned', async () => {
    const { db } = dbDouble([userRow()], 137);
    const page = await new PrismaProvisioningRepository(db).listUsers({ ...BASE });

    expect(page.rows).toHaveLength(1);
    expect(page.total).toBe(137);
  });

  it('collapses a role held at two schools into one entry', async () => {
    const { db } = dbDouble([
      userRow({ roles: [{ role: 'TEACHER' }, { role: 'TEACHER' }, { role: 'SCHOOL_ADMIN' }] }),
    ]);
    const page = await new PrismaProvisioningRepository(db).listUsers({ ...BASE });

    expect(page.rows[0]?.roles).toEqual(['TEACHER', 'SCHOOL_ADMIN']);
  });
});
