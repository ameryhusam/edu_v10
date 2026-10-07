import express from 'express';
import bodyParser from 'body-parser';
import { persistImportJob } from './services/import.service';
import { runSampleImportPreview } from './demo';
import path from 'path';
import { prisma } from './backend/prisma-client';

const app = express();
app.use(bodyParser.json());

app.get('/api/v1/health', (_req, res) => res.json({ status: 'ok', product: 'Question Bank (Prisma)' }));

app.post('/api/v1/imports/preview-from-sample', async (req, res) => {
  try {
    const { sampleFile } = req.body;
    if (!sampleFile) return res.status(400).json({ error: 'sampleFile required' });
    const items = await runSampleImportPreview();
    const jobId = `import-${Date.now()}`;
    // persist job and items via import.service
    const result = await persistImportJob(jobId, items, null);
    res.json({ jobId, result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/v1/seed', async (req, res) => {
  try {
    // run seed
    const seed = await import('./prisma/seed.js');
    await seed.seed();
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/', (_req, res) => res.send('Question Bank (Prisma) running'));

const port = process.env.PORT ? Number(process.env.PORT) : 4001;
app.listen(port, () => console.log(`Question Bank Prisma API listening on http://localhost:${port}`));
