import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';
import { prisma } from '../../src/backend/prisma-client';

// Integration tests rely on TEST_DATABASE_URL env variable. If not set, skip.
const TEST_DB = process.env.TEST_DATABASE_URL;
if (!TEST_DB) {
  console.warn('TEST_DATABASE_URL not set — skipping integration tests');
}

describe('import integration (manual run)', () => {
  it('skips if no TEST_DATABASE_URL', () => {
    if (!TEST_DB) return;
  });
});
