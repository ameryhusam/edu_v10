import { db } from "./db.js";

export async function nextQuestion(learnerId: string, lessonId: string, excluded: string[] = []) {
  const concepts = await db.concept.findMany({
    where: { lessonId },
    include: { states: { where: { learnerId } }, questions: { include: { question: true } } }
  });
  const ranked = concepts
    .map((concept) => ({ concept, state: concept.states[0], mastery: concept.states[0]?.attempts ? concept.states[0].correct / concept.states[0].attempts : 0 }))
    .sort((a, b) => a.mastery - b.mastery);

  for (const item of ranked) {
    const target = item.state ? item.state.theta + 0.15 : 0.15;
    const candidate = item.concept.questions
      .map((x) => x.question)
      .filter((q) => !excluded.includes(q.id))
      .sort((a, b) => Math.abs(a.difficulty - target) - Math.abs(b.difficulty - target))[0];
    if (candidate) return candidate;
  }

  return (await db.question.findMany({ where: { lessonId, id: { notIn: excluded } }, orderBy: { difficulty: "asc" } }))[0] ?? null;
}

export function guessScore(correct: boolean, timeMs?: number) {
  if (!correct) return 0;
  if (!timeMs) return 0.5;
  if (timeMs <= 5000) return 0.7;
  if (timeMs <= 12000) return 0.45;
  return 0.2;
}
