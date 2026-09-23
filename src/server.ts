import express from "express";
import cors from "cors";
import { z } from "zod";
import { db } from "./db.js";
import { auth, login } from "./auth.js";
import { guessScore, nextQuestion } from "./adaptive.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_, res) => res.json({ ok: true, profile: "question-bank-mobile" }));

app.post("/v1/auth/login", async (req, res) => {
  const body = z.object({ username: z.string().min(1), pin: z.string().min(1) }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "INVALID_INPUT" });
  const result = await login(body.data.username, body.data.pin);
  if (!result) return res.status(401).json({ error: "INVALID_CREDENTIALS" });
  res.json(result);
});

app.use("/v1", auth);

async function allowed(user: any, learnerId: string) {
  if (user.role === "SYSTEM_ADMIN") return true;
  if (user.role === "CHILD") return user.id === learnerId;
  return !!(await db.parentChildLink.findFirst({ where: { parentId: user.id, childId: learnerId } }));
}

app.get("/v1/catalog", async (_, res) => {
  const [grades, subjects, books] = await Promise.all([
    db.grade.findMany({ orderBy: { id: "asc" } }),
    db.subject.findMany({ orderBy: { nameAr: "asc" } }),
    db.book.findMany({
      include: {
        units: {
          orderBy: { orderIndex: "asc" },
          include: {
            lessons: {
              orderBy: { orderIndex: "asc" },
              include: { _count: { select: { questions: true, concepts: true } } }
            }
          }
        }
      },
      orderBy: { title: "asc" }
    })
  ]);
  res.json({ grades, subjects, books });
});

app.get("/v1/children", async (req, res) => {
  if (res.locals.user.role !== "PARENT") return res.status(403).json({ error: "FORBIDDEN" });
  const links = await db.parentChildLink.findMany({
    where: { parentId: res.locals.user.id },
    include: { child: { select: { id: true, username: true, displayName: true, role: true } } }
  });
  res.json(links.map((x) => x.child));
});

app.get("/v1/lessons/:lessonId/next", async (req, res) => {
  const learnerId = z.string().parse(req.query.learnerId);
  if (!await allowed(res.locals.user, learnerId)) return res.status(403).json({ error: "FORBIDDEN" });
  const excluded = typeof req.query.excluded === "string" ? req.query.excluded.split(",").filter(Boolean) : [];
  const question = await nextQuestion(learnerId, req.params.lessonId, excluded);
  if (!question) return res.status(404).json({ error: "NO_QUESTION" });
  res.json({
    id: question.id,
    key: question.key,
    lessonId: question.lessonId,
    text: question.text,
    type: question.type,
    options: question.options,
    explanation: question.explanation,
    difficulty: question.difficulty,
    sourcePage: question.sourcePage,
    origin: question.origin
  });
});

app.post("/v1/attempts", async (req, res) => {
  const body = z.object({
    learnerId: z.string(),
    questionId: z.string(),
    lessonId: z.string(),
    selectedAnswer: z.unknown(),
    timeMs: z.number().int().nonnegative().optional(),
    orderInSession: z.number().int().optional(),
    sessionId: z.string().optional()
  }).parse(req.body);

  if (!await allowed(res.locals.user, body.learnerId)) return res.status(403).json({ error: "FORBIDDEN" });

  const question = await db.question.findUnique({ where: { id: body.questionId } });
  if (!question || question.lessonId !== body.lessonId) return res.status(404).json({ error: "QUESTION_NOT_FOUND" });

  const isCorrect = JSON.stringify(body.selectedAnswer) === JSON.stringify(question.correctAnswer);
  const links = await db.questionConcept.findMany({ where: { questionId: question.id } });
  const score = guessScore(isCorrect, body.timeMs);

  const attempt = await db.$transaction(async (tx) => {
    const created = await tx.attempt.create({
      data: {
        learnerId: body.learnerId,
        questionId: body.questionId,
        lessonId: body.lessonId,
        selectedAnswer: body.selectedAnswer as any,
        isCorrect,
        timeMs: body.timeMs,
        orderInSession: body.orderInSession,
        sessionId: body.sessionId,
        guessScore: score
      }
    });

    for (const link of links) {
      await tx.conceptState.upsert({
        where: { learnerId_conceptId: { learnerId: body.learnerId, conceptId: link.conceptId } },
        create: {
          learnerId: body.learnerId,
          conceptId: link.conceptId,
          attempts: 1,
          correct: isCorrect ? 1 : 0,
          theta: isCorrect ? 0.1 : -0.1,
          understoodCount: isCorrect && score < 0.5 ? 1 : 0,
          guessedCount: score >= 0.5 ? 1 : 0
        },
        update: {
          attempts: { increment: 1 },
          correct: { increment: isCorrect ? 1 : 0 },
          theta: { increment: isCorrect ? 0.1 : -0.1 },
          understoodCount: { increment: isCorrect && score < 0.5 ? 1 : 0 },
          guessedCount: { increment: score >= 0.5 ? 1 : 0 }
        }
      });
    }
    return created;
  });

  res.json({ id: attempt.id, isCorrect, guessScore: score, explanation: question.explanation ?? null });
});

app.get("/v1/learners/:learnerId/report", async (req, res) => {
  const id = req.params.learnerId;
  if (!await allowed(res.locals.user, id)) return res.status(403).json({ error: "FORBIDDEN" });
  const states = await db.conceptState.findMany({
    where: { learnerId: id },
    include: { concept: true },
    orderBy: { theta: "asc" }
  });
  res.json(states.map((x) => ({
    conceptId: x.conceptId,
    concept: x.concept.nameAr,
    mastery: x.attempts ? x.correct / x.attempts : 0,
    theta: x.theta,
    attempts: x.attempts,
    correct: x.correct,
    guessedCount: x.guessedCount,
    lastUpdated: x.lastUpdated
  })));
});

app.listen(Number(process.env.PORT ?? 3000), () => console.log("question-bank-mobile API listening"));
