import { prisma } from '../backend/prisma-client';
import { evaluateMCQ } from '../evaluators/mcq';
import { evaluateTrueFalse } from '../evaluators/truefalse';
import { evaluateNumeric } from '../evaluators/numeric';
import { evaluateShortText } from '../evaluators/shorttext';
import { evaluateMatching } from '../evaluators/matching';
import { evaluateOrdering } from '../evaluators/ordering';
import { evaluateFillBlank } from '../evaluators/fillblank';
import { evaluateEssay } from '../evaluators/essay';

export async function startAttempt(examId: string, userId: string) {
  const attempt = await prisma.attempt.create({ data: { examId, userId } });
  return attempt;
}

export async function saveAnswer(attemptId: string, examItemId: string, answerPayload: any, responseTimeMs?: number) {
  const rec = await prisma.attemptAnswer.create({ data: { attemptId, examItemId, answerPayload, responseTimeMs: responseTimeMs ?? null } });
  return rec;
}

export async function submitAttempt(attemptId: string) {
  const attempt = await prisma.attempt.findUnique({ where: { id: attemptId } });
  if (!attempt) throw new Error('Attempt not found');
  const answers = await prisma.attemptAnswer.findMany({ where: { attemptId } });
  const exam = await prisma.exam.findUnique({ where: { id: attempt.examId }, include: { items: true } });
  let totalPoints = 0;
  const review: any[] = [];
  for (const a of answers) {
    const exItem = exam?.items.find((it: any) => it.id === a.examItemId);
    const q = exItem ? await prisma.question.findUnique({ where: { id: exItem.questionId } }) : null;
    let evalRes: any = { verdict: 'UNGRADABLE', pointsAwarded: 0 };
    if (q) {
      switch (q.type) {
        case 'MCQ_SINGLE':
        case 'MCQ_MULTI':
          evalRes = evaluateMCQ(q as any, a.answerPayload.selectedOptionIds ?? a.answerPayload);
          break;
        case 'TRUE_FALSE':
          evalRes = evaluateTrueFalse(q as any, a.answerPayload.value);
          break;
        case 'NUMERIC':
          evalRes = evaluateNumeric(q as any, a.answerPayload.value);
          break;
        case 'SHORT_TEXT':
          evalRes = evaluateShortText(q as any, a.answerPayload.text);
          break;
        case 'MATCHING':
          evalRes = evaluateMatching(q as any, a.answerPayload.pairs);
          break;
        case 'ORDERING':
          evalRes = evaluateOrdering(q as any, a.answerPayload.orderedItemIds);
          break;
        case 'FILL_BLANK':
          evalRes = evaluateFillBlank(q as any, a.answerPayload.blanks);
          break;
        case 'ESSAY':
          evalRes = evaluateEssay(q as any, a.answerPayload.text);
          break;
        default:
          evalRes = { verdict: 'UNGRADABLE', pointsAwarded: 0 };
      }
    }
    await prisma.attemptAnswer.update({ where: { id: a.id }, data: { isCorrect: evalRes.verdict === 'CORRECT', pointsAwarded: evalRes.pointsAwarded, evaluationMeta: evalRes } });
    totalPoints += evalRes.pointsAwarded || 0;
    review.push({ examItemId: a.examItemId, questionId: q?.id ?? null, studentAnswer: a.answerPayload, correctAnswer: q?.answerData ?? null, verdict: evalRes.verdict, pointsAwarded: evalRes.pointsAwarded, explanation: q?.explanation ?? null });
  }
  await prisma.attempt.update({ where: { id: attemptId }, data: { status: 'SUBMITTED', submittedAt: new Date(), totalScore: totalPoints } });
  return { totalScore: totalPoints, review };
}
