import 'dotenv/config';
import { createPrismaClient } from '../src/infrastructure/database/prisma.client.js';
import { loadEnv } from '../src/shared/config/env.js';
import { readTextbookSpec } from '../prisma/seed/load-textbook.js';
import { normalizeOrConvertPackage } from '../src/contexts/content/application/content-import.service.js';
import { buildContainer } from '../src/composition/container.js';

async function test() {
  const prisma = createPrismaClient({ databaseUrl: process.env.DATABASE_URL, verbose: false, poolMax: 1 });
  const container = buildContainer(loadEnv(), { db: prisma });
  const spec = readTextbookSpec('science-g07.json');
  const pkg = normalizeOrConvertPackage(spec, { dryRun: false });
  const res = await container.useCases.contentImport.importPackage({ actorKey: 'usr_admin' }, pkg, { dryRun: false, mode: 'APPEND_DEDUP' });
  if (!res.ok) {
    console.error('Error:', res.error);
  } else {
    console.log('Prerequisite problems (first 3):', res.value.problems.filter(p => p.sheet === 'prerequisites').slice(0, 3));
    console.log('Question problems (first 3):', res.value.problems.filter(p => p.sheet === 'questions').slice(0, 3));
  }
}

test();
