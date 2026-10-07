// export endpoint: return canonical JSON for given filters
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

// New: export canonical JSON
app.get('/api/v1/export', async (req, res) => {
  try {
    const { subjectKey, gradeKey, unitKey, lessonKey } = req.query as any;
    const where: any = {};
    if (lessonKey) where.key = lessonKey;
    if (unitKey) where.key = unitKey;
    // find lessons matching filter
    let lessons: any[] = [];
    if (lessonKey) {
      const l = await prisma.lesson.findUnique({ where: { key: lessonKey }, include: { unit: true } });
      if (l) lessons = [l];
    } else if (unitKey) {
      lessons = await prisma.lesson.findMany({ where: { unitId: (await prisma.unit.findUnique({ where: { key: unitKey } }))?.id }, include: { unit: true } });
    } else if (gradeKey || subjectKey) {
      // find units by grade/subject then lessons
      const units = await prisma.unit.findMany({ where: { ...(gradeKey ? { gradeId: (await prisma.grade.findUnique({ where: { key: gradeKey } }))?.id : undefined), ...(subjectKey ? { subjectId: (await prisma.subject.findUnique({ where: { key: subjectKey } }))?.id : undefined) : undefined } } });
      const unitIds = units.map(u => u.id);
      lessons = await prisma.lesson.findMany({ where: { unitId: { in: unitIds } }, include: { unit: true } });
    } else {
      lessons = await prisma.lesson.findMany({ include: { unit: true } });
    }
    const out: any[] = [];
    for (const l of lessons) {
      const unit = l.unit;
      const subject = unit ? await prisma.subject.findUnique({ where: { id: unit.subjectId } }) : null;
      const grade = unit ? await prisma.grade.findUnique({ where: { id: unit.gradeId } }) : null;
      const qs = await prisma.question.findMany({ where: { lessonId: l.id } });
      const questions = qs.map(q => ({ id: q.id, key: q.key, type: q.type, text: q.text, points: q.points, difficulty: q.difficulty, hint: q.hint, explanation: q.explanation, answerData: q.answerData, status: q.status }));
      out.push({ subject: { id: subject?.id, key: subject?.key, name: subject?.name }, grade: { id: grade?.id, key: grade?.key, name: grade?.name }, unit: { id: unit?.id, key: unit?.key, title: unit?.title }, lesson: { id: l.id, key: l.key, title: l.title }, questions });
    }
    res.json({ count: out.length, data: out });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/', (_req, res) => res.send('Question Bank (Prisma) running'));

const port = process.env.PORT ? Number(process.env.PORT) : 4001;
app.listen(port, () => console.log(`Question Bank Prisma API listening on http://localhost:${port}`));
