// Serve static frontend and add approve endpoint in server
import express from 'express';
import bodyParser from 'body-parser';
import { previewImportFromSample } from './import/json-import';
import path from 'path';
import { db } from './backend/mock-db';

const app = express();
app.use(bodyParser.json());

app.use('/static', express.static(path.join(process.cwd(), 'modules/question-bank/frontend')));

app.get('/api/v1/health', (_req, res) => res.json({ status: 'ok', product: 'Question Bank (prototype)' }));
app.post('/api/v1/auth/login', (req, res) => {
  const { username } = req.body;
  res.json({ token: 'mock-token', user: { id: 'u-student', username } });
});

app.post('/api/v1/imports/preview-from-sample', async (req, res) => {
  try {
    const { sampleFile } = req.body;
    if (!sampleFile) return res.status(400).json({ error: 'sampleFile required' });
    const items = await previewImportFromSample(`modules/question-bank/sample/${sampleFile}`);
    const jobId = `preview-${Date.now()}`;
    // store preview job in mock db
    db.importJobs.set(jobId, { id: jobId, items });
    res.json({ jobId, items });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/v1/imports/:jobId/approve', async (req, res) => {
  const { jobId } = req.params;
  const job = db.importJobs.get(jobId);
  if (!job) return res.status(404).json({ error: 'job not found' });
  const inserted: any[] = [];
  for (const it of job.items) {
    if (it.errors && it.errors.length) continue; // skip invalid
    const q = it.canonical;
    const qid = q.id || `q-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
    db.questions.set(qid, q);
    inserted.push({ id: qid, key: q.key ?? null });
  }
  job.status = 'IMPORTED';
  db.importJobs.set(jobId, job);
  res.json({ imported: inserted.length, items: inserted });
});

app.post('/api/v1/exams', (req, res) => {
  const id = `exam-${Date.now()}`;
  res.status(201).json({ id, ...req.body });
});

app.post('/api/v1/exams/self-generate', (req, res) => {
  const id = `exam-${Date.now()}`;
  res.status(201).json({ id });
});

app.post('/api/v1/exams/:id/start', (req, res) => {
  const attemptId = `att-${Date.now()}`;
  res.json({ attemptId, firstItem: null });
});

app.post('/api/v1/attempts/:id/answer', (req, res) => {
  const { attemptId } = req.params;
  const payload = req.body;
  const aid = `aa-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
  db.attemptAnswers.set(aid, { id: aid, attemptId, payload, createdAt: new Date().toISOString() });
  res.status(201).json({ id: aid });
});

app.post('/api/v1/attempts/:id/submit', (req, res) => {
  res.json({ totalScore: 0, evaluated: false });
});

app.get('/', (_req, res) => res.redirect('/static/index.html'));

const port = process.env.PORT ? Number(process.env.PORT) : 4001;
app.listen(port, () => console.log(`Question Bank prototype API listening on http://localhost:${port}`));
