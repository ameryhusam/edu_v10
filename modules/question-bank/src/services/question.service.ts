import { prisma } from '../backend/prisma-client';

export async function listQuestions(filter: any = {}) {
  const where: any = {};
  if (filter.subjectId) {
    // join through unit.lesson etc. simplified: filter by metadata.part or lesson
  }
  const qs = await prisma.question.findMany({});
  return qs.map(q => ({ id: q.id, key: q.key, type: q.type, text: q.text, points: q.points, lessonId: q.lessonId }));
}

export async function getQuestion(id: string) {
  return prisma.question.findUnique({ where: { id } });
}
