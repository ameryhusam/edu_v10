// Enhanced server_with_frontend.ts
// Adds routes for import preview/approve, questions listing, exam creation, attempt lifecycle, and evaluation.

import express from 'express';
import bodyParser from 'body-parser';
import { previewImportFromSample } from './import/json-import';
import path from 'path';
import { db } from './backend/mock-db';
import { evaluateMCQ } from './evaluators/mcq';
import { evaluateTrueFalse } from './evaluators/truefalse';
import { evaluateNumeric } from './evaluators/numeric';
import { evaluateShortText } from './evaluators/shorttext';
import { evaluateMatching } from './evaluators/matching';
import { evaluateOrdering } from './evaluators/ordering';
import { evaluateFillBlank } from './evaluators/fillblank';
import { evaluateEssay } from './evaluators/essay';

const app = express();
app.use(bodyParser.json());

app.use('/static', express.static(path.join(process.cwd(), 'modules/question-bank/frontend')));

function sanitizeForClient(q: any) {
  if (!q) return q;
  // Deep clone minimal fields and remove answer keys that leak solutions
  const copy: any = { ...q };
  if (copy.answerData) {
    const ad = { ...copy.answerData };
    // Remove known solution fields
    delete ad.correctOptions;
    delete ad.expectedOrder;
    delete ad.pairs;
    delete ad.accepted;
    delete ad.min;
    delete ad.max;
    delete ad.rubric;
    delete ad.correct;
    copy.answerData = ad;
  }
  // Do not include explanation while in-progress
  delete copy.explanation;
  return copy;
}

app.get('/api/v1/health', (_req, res) => res.json({ status: 'ok', product: 'Question Bank (prototype)' }));
app.post('/api/v1/auth/login', (req, res) => {
  const { username } = req.body;
  res.json({ token: 'mock-token', user: { id: 'u-student', username, role: 'STUDENT' } });
});

// Import preview
app.post('/api/v1/imports/preview-from-sample', async (req, res) => {
  try {
    const { sampleFile } = req.body;
    if (!sampleFile) return res.status(400).json({ error: 'sampleFile required' });
    const items = await previewImportFromSample(`modules/question-bank/sample/${sampleFile}`);
    const jobId = `preview-${Date.now()}`;
    db.importJobs.set(jobId, { id: jobId, items, status: 'PENDING' });
    res.json({ jobId, items });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/v1/imports', (_req, res) => {
  res.json(Array.from(db.importJobs.values()));
});

app.get('/api/v1/imports/:jobId', (req, res) => {
  const job = db.importJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'job not found' });
  res.json(job);
});

// Approve import: move valid items into mock DB.questions
app.post('/api/v1/imports/:jobId/approve', async (req, res) => {
  const { jobId } = req.params;
  const job = db.importJobs.get(jobId);
  if (!job) return res.status(404).json({ error: 'job not found' });
  const inserted: any[] = [];
  for (const it of job.items) {
    if (it.errors && it.errors.length) continue;
    const q = it.canonical;
    const qid = q.id || `q-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
    db.questions.set(qid, q);
    inserted.push({ id: qid, key: q.key ?? null });
  }
  job.status = 'IMPORTED';
  db.importJobs.set(jobId, job);
  res.json({ imported: inserted.length, items: inserted });
});

// Questions listing
app.get('/api/v1/questions', (_req, res) => {
  const list = Array.from(db.questions.entries()).map(([id, q]) => ({ id, key: q.key ?? null, subject: q.subject, grade: q.grade, lesson: q.lesson, type: q.type, points: q.points }));
  res.json({ total: list.length, rows: list });
});

app.get('/api/v1/questions/:id', (req, res) => {
  const q = db.questions.get(req.params.id);
  if (!q) return res.status(404).json({ error: 'not found' });
  res.json(q);
});

// Exams
app.post('/api/v1/exams', (req, res) => {
  const { title, questionIds = [], subjectId, gradeId, strategy = 'FIXED' } = req.body;
  const id = `exam-${Date.now()}`;
  const items = questionIds.map((qid: string, idx: number) => ({ id: `${id}-i-${idx}`, questionId: qid, orderIndex: idx }));
  const exam = { id, title, items, subjectId, gradeId, strategy, createdAt: new Date().toISOString() };
  db.exams.set(id, exam);
  res.status(201).json(exam);
});

app.get('/api/v1/exams', (_req, res) => {
  res.json(Array.from(db.exams.values()));
});

app.get('/api/v1/exams/:id', (req, res) => {
  const exam = db.exams.get(req.params.id);
  if (!exam) return res.status(404).json({ error: 'not found' });
  res.json(exam);
});

// Start attempt: create attempt and return first item sanitized
app.post('/api/v1/exams/:id/start', (req, res) => {
  const { id } = req.params;
  const exam = db.exams.get(id);
  if (!exam) return res.status(404).json({ error: 'exam not found' });
  const attemptId = `att-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
  const attempt = { id: attemptId, examId: id, userId: 'u-student', status: 'IN_PROGRESS', currentIndex: 0, createdAt: new Date().toISOString() };
  db.attempts.set(attemptId, attempt);
  // prepare first item
  const firstItem = exam.items[0];
  const question = db.questions.get(firstItem.questionId);
  res.json({ attemptId, item: { examItemId: firstItem.id, question: sanitizeForClient(question) } });
});

// Answer submission (store in attemptAnswers)
app.post('/api/v1/attempts/:id/answer', (req, res) => {
  const attemptId = req.params.id;
  const { examItemId, answerPayload, responseTimeMs } = req.body;
  const aid = `aa-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
  const rec = { id: aid, attemptId, examItemId, answerPayload, responseTimeMs, createdAt: new Date().toISOString() };
  db.attemptAnswers.set(aid, rec);
  res.status(201).json({ id: aid });
});

// Submit attempt: evaluate stored answers and return summary + per-item review
app.post('/api/v1/attempts/:id/submit', (req, res) => {
  const attemptId = req.params.id;
  const attempt = db.attempts.get(attemptId);
  if (!attempt) return res.status(404).json({ error: 'attempt not found' });
  // collect answers
  const answers = Array.from(db.attemptAnswers.values()).filter((a: any) => a.attemptId === attemptId);
  const review: any[] = [];
  let totalPoints = 0;
  for (const a of answers) {
    const item = a.examItemId ? a.examItemId : null;
    // find questionId via exam items lookup
    let questionId: string | undefined = undefined;
    const exam = db.exams.get(attempt.examId);
    if (exam) {
      const exItem = exam.items.find((it: any) => it.id === a.examItemId);
      if (exItem) questionId = exItem.questionId;
    }
    const question = questionId ? db.questions.get(questionId) : null;
    let evalRes: any = { verdict: 'UNGRADABLE', pointsAwarded: 0 };
    if (question) {
      switch (question.type) {
        case 'MCQ_SINGLE':
        case 'MCQ_MULTI':
          evalRes = evaluateMCQ(question, a.answerPayload.selectedOptionIds ?? a.answerPayload.selectedOptionId ?? a.answerPayload);
          break;
        case 'TRUE_FALSE':
          evalRes = evaluateTrueFalse(question, a.answerPayload.value);
          break;
        case 'NUMERIC':
          evalRes = evaluateNumeric(question, a.answerPayload.value);
          break;
        case 'SHORT_TEXT':
          evalRes = evaluateShortText(question, a.answerPayload.text);
          break;
        case 'MATCHING':
          evalRes = evaluateMatching(question, a.answerPayload.pairs);
          break;
        case 'ORDERING':
          evalRes = evaluateOrdering(question, a.answerPayload.orderedItemIds);
          break;
        case 'FILL_BLANK':
          evalRes = evaluateFillBlank(question, a.answerPayload.blanks);
          break;
        case 'ESSAY':
          evalRes = evaluateEssay(question, a.answerPayload.text);
          break;
        default:
          evalRes = { verdict: 'UNGRADABLE', pointsAwarded: 0 };
      }
    }
    // persist evaluation into answer record
    a.isCorrect = evalRes.verdict === 'CORRECT';
    a.pointsAwarded = evalRes.pointsAwarded;
    a.evaluationMeta = evalRes;
    totalPoints += evalRes.pointsAwarded || 0;
    // build review
    review.push({
      examItemId: a.examItemId,
      question: question,
      studentAnswer: a.answerPayload,
      correctAnswer: question ? question.answerData : null,
      verdict: evalRes.verdict,
      pointsAwarded: evalRes.pointsAwarded,
      explanation: question ? question.explanation : null,
    });
    db.attemptAnswers.set(a.id, a);
  }
  attempt.status = 'SUBMITTED';
  attempt.submittedAt = new Date().toISOString();
  attempt.totalScore = totalPoints;
  db.attempts.set(attemptId, attempt);
  res.json({ totalScore: totalPoints, review });
});

// Review endpoint
app.get('/api/v1/attempts/:id/review', (req, res) => {
  const attemptId = req.params.id;
  const attempt = db.attempts.get(attemptId);
  if (!attempt) return res.status(404).json({ error: 'attempt not found' });
  if (attempt.status !== 'SUBMITTED') return res.status(400).json({ error: 'attempt not submitted' });
  const answers = Array.from(db.attemptAnswers.values()).filter((a: any) => a.attemptId === attemptId);
  const review = answers.map((a: any) => ({ examItemId: a.examItemId, studentAnswer: a.answerPayload, verdict: a.evaluationMeta?.verdict, pointsAwarded: a.pointsAwarded, evaluationMeta: a.evaluationMeta }));
  res.json({ attemptId, totalScore: attempt.totalScore, review });
});

// Questions/Exam simple UI root
app.get('/', (_req, res) => res.redirect('/static/index.html'));

const port = process.env.PORT ? Number(process.env.PORT) : 4001;
app.listen(port, () => console.log(`Question Bank prototype API listening on http://localhost:${port}`));
