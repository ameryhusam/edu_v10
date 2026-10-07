import express from 'express';
import bodyParser from 'body-parser';
import { previewImportFromSample } from './import/json-import';

const app = express();
app.use(bodyParser.json());

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
    res.json({ jobId: `preview-${Date.now()}`, items });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
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
  res.status(204).send();
});

app.post('/api/v1/attempts/:id/submit', (req, res) => {
  res.json({ totalScore: 0, evaluated: false });
});

const port = process.env.PORT ? Number(process.env.PORT) : 4001;
app.listen(port, () => console.log(`Question Bank prototype API listening on http://localhost:${port}`));
