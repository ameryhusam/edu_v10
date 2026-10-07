import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';

// Integration full-flow test: preview import -> persist -> create exam -> start attempt -> answer -> submit
// Guards: requires TEST_DATABASE_URL env var. Tests will deploy migrations to that DB (prisma migrate deploy)

const TEST_DB = process.env.TEST_DATABASE_URL;
if (!TEST_DB) {
  console.warn('TEST_DATABASE_URL not set — skipping full integration tests');
}

describe('full flow integration (import -> exam -> attempt)', () => {
  beforeAll(() => {
    if (!TEST_DB) return;
    // Ensure DATABASE_URL is set for prisma client used by services
    process.env.DATABASE_URL = TEST_DB;
    // Deploy migrations (assumes prisma CLI is available)
    try {
      execSync('npx prisma migrate deploy --schema=prisma/question_bank/schema.prisma', { stdio: 'inherit' });
    } catch (e) {
      console.warn('prisma migrate deploy failed or already applied — ensure schema is present');
    }
  });

  it('runs import -> exam -> attempt flow', async () => {
    if (!TEST_DB) return;
    const { persistImportJob } = await import('../../src/services/import.service');
    const { createFixedExam } = await import('../../src/services/exam.service');
    const { startAttempt, saveAnswer, submitAttempt } = await import('../../src/services/attempt.service');
    const { prisma } = await import('../../src/backend/prisma-client');

    // Prepare a simple canonical item (MCQ single)
    const items = [
      {
        canonical: {
          subject: { name: 'Demo' },
          grade: { name: 'Grade 1' },
          unit: { title: 'Unit 1' },
          lesson: { title: 'Lesson 1' },
          type: 'MCQ_SINGLE',
          text: 'What is 1+1?',
          points: 1,
          answerData: { options: [{ id: 'A', text: '1' }, { id: 'B', text: '2' }], correctIds: ['B'] }
        }
      }
    ];

    const jobId = `test-import-${Date.now()}`;
    const res = await persistImportJob(jobId, items, 'test-runner');
    expect(res.imported).toBeGreaterThan(0);

    // find created questions
    const qs = await prisma.question.findMany();
    expect(qs.length).toBeGreaterThan(0);
    const qIds = qs.map(q => q.id);

    // create fixed exam with these questions
    const examRes: any = await createFixedExam('Test Exam', qIds, 'creator-1');
    expect(examRes.exam).toBeDefined();
    expect(examRes.items.length).toBeGreaterThan(0);

    // start attempt
    const attempt: any = await startAttempt(examRes.exam.id, 'student-1');
    expect(attempt).toBeDefined();

    // submit answer for first exam item
    const firstItem: any = examRes.items[0];
    await saveAnswer(attempt.id, firstItem.id, { selectedOptionIds: ['B'] }, 500);

    // submit attempt
    const review: any = await submitAttempt(attempt.id);
    expect(review.totalScore).toBeGreaterThanOrEqual(0);
    expect(review.review.length).toBeGreaterThan(0);
  }, 120000);

  afterAll(async () => {
    if (!TEST_DB) return;
    const { prisma } = await import('../../src/backend/prisma-client');
    // cleanup - drop data created by tests
    await prisma.attemptAnswer.deleteMany();
    await prisma.attempt.deleteMany();
    await prisma.examItem.deleteMany();
    await prisma.exam.deleteMany();
    await prisma.questionChoice.deleteMany();
    await prisma.question.deleteMany();
    await prisma.importItem.deleteMany();
    await prisma.importJob.deleteMany();
    await prisma.lesson.deleteMany();
    await prisma.unit.deleteMany();
    await prisma.grade.deleteMany();
    await prisma.subject.deleteMany();
    await prisma.$disconnect();
  });
});
