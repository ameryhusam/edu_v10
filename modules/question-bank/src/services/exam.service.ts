import { prisma } from '../backend/prisma-client';
import { selectQuestions } from '../exam/builder';

export async function createFixedExam(title: string, questionIds: string[], creatorId?: string) {
  const exam = await prisma.exam.create({ data: { title, strategy: 'FIXED', createdBy: creatorId ?? undefined } });
  const items = [];
  for (let i = 0; i < questionIds.length; i++) {
    const qid = questionIds[i];
    const q = await prisma.question.findUnique({ where: { id: qid } });
    if (!q) continue;
    const item = await prisma.examItem.create({ data: { examId: exam.id, questionId: qid, orderIndex: i, points: q.points } });
    items.push(item);
  }
  return { exam, items };
}

export async function createRuleBasedExam(criteria: any, count: number, creatorId?: string, seed?: number) {
  // fetch candidate questions
  const pool = await prisma.question.findMany({ where: { status: 'PUBLISHED' } });
  const selected = selectQuestions(pool as any, { count, seed });
  const exam = await prisma.exam.create({ data: { title: criteria.title ?? 'Rule-based Exam', strategy: 'RULE_BASED', criteria: criteria ?? null, createdBy: creatorId ?? undefined } });
  for (let i = 0; i < selected.length; i++) {
    await prisma.examItem.create({ data: { examId: exam.id, questionId: selected[i].id, orderIndex: i, points: selected[i].points } });
  }
  return exam;
}
