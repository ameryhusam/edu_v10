// add multer and excel endpoints to server_prisma
import express from 'express';
import bodyParser from 'body-parser';
import { persistImportJob } from './services/import.service';
import { runSampleImportPreview } from './demo';
import path from 'path';
import { prisma } from './backend/prisma-client';
import multer from 'multer';
import { createExcelImportPreview, approveImportJobFromExcel } from './services/excel-import.service';
import XLSX from 'xlsx';

const upload = multer({ storage: multer.memoryStorage() });
const app = express();
app.use(bodyParser.json());

app.get('/api/v1/health', (_req, res) => res.json({ status: 'ok', product: 'Question Bank (Prisma)' }));

app.post('/api/v1/imports/preview-from-sample', async (req, res) => {
  try {
    const { sampleFile } = req.body;
    if (!sampleFile) return res.status(400).json({ error: 'sampleFile required' });
    const items = await runSampleImportPreview();
    const jobId = `import-${Date.now()}`;
    // persist job and items via import.service (legacy flow may insert immediately)
    const result = await persistImportJob(jobId, items, null);
    res.json({ jobId, result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// New: preview from uploaded Excel (multipart)
app.post('/api/v1/imports/preview-from-excel', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'file required' });
    const buf: Buffer = req.file.buffer;
    const preview = await createExcelImportPreview(buf, null);
    res.json(preview);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Approve import job by id (will persist questions for items)
app.post('/api/v1/imports/:jobId/approve', async (req, res) => {
  try {
    const { jobId } = req.params;
    const result = await approveImportJobFromExcel(jobId);
    res.json(result);
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

// New: export canonical JSON and XLSX
app.get('/api/v1/export', async (req, res) => {
  try {
    const { subjectKey, gradeKey, unitKey, lessonKey } = req.query as any;
    const lessons = await resolveLessons(subjectKey, gradeKey, unitKey, lessonKey);
    const out = await buildExportPayload(lessons);
    res.json({ count: out.length, data: out });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/v1/export.xlsx', async (req, res) => {
  try {
    const { subjectKey, gradeKey, unitKey, lessonKey } = req.query as any;
    const lessons = await resolveLessons(subjectKey, gradeKey, unitKey, lessonKey);
    const out = await buildExportPayload(lessons);
    // flatten to rows
    const rows: any[] = [];
    out.forEach(block => {
      block.questions.forEach((q: any) => {
        rows.push({
          subjectKey: block.subject.key,
          subjectName: block.subject.name,
          gradeKey: block.grade.key,
          gradeName: block.grade.name,
          unitKey: block.unit.key,
          unitTitle: block.unit.title,
          lessonKey: block.lesson.key,
          lessonTitle: block.lesson.title,
          questionKey: q.key,
          type: q.type,
          text: q.text,
          points: q.points,
          difficulty: q.difficulty,
          hint: q.hint,
          explanation: q.explanation,
          answerData: JSON.stringify(q.answerData || {})
        });
      });
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'questions');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', 'attachment; filename=export.xlsx');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

async function resolveLessons(subjectKey?: string, gradeKey?: string, unitKey?: string, lessonKey?: string) {
  if (lessonKey) {
    const l = await prisma.lesson.findUnique({ where: { key: lessonKey }, include: { unit: true } });
    return l ? [l] : [];
  }
  if (unitKey) {
    return await prisma.lesson.findMany({ where: { unitId: (await prisma.unit.findUnique({ where: { key: unitKey } }))?.id }, include: { unit: true } });
  }
  if (gradeKey || subjectKey) {
    const units = await prisma.unit.findMany({ where: { ...(gradeKey ? { gradeId: (await prisma.grade.findUnique({ where: { key: gradeKey } }))?.id : undefined), ...(subjectKey ? { subjectId: (await prisma.subject.findUnique({ where: { key: subjectKey } }))?.id : undefined) : undefined } } });
    const unitIds = units.map(u => u.id);
    return await prisma.lesson.findMany({ where: { unitId: { in: unitIds } }, include: { unit: true } });
  }
  return await prisma.lesson.findMany({ include: { unit: true } });
}

async function buildExportPayload(lessons: any[]) {
  const out: any[] = [];
  for (const l of lessons) {
    const unit = l.unit;
    const subject = unit ? await prisma.subject.findUnique({ where: { id: unit.subjectId } }) : null;
    const grade = unit ? await prisma.grade.findUnique({ where: { id: unit.gradeId } }) : null;
    const qs = await prisma.question.findMany({ where: { lessonId: l.id } });
    const questions = qs.map(q => ({ id: q.id, key: q.key, type: q.type, text: q.text, points: q.points, difficulty: q.difficulty, hint: q.hint, explanation: q.explanation, answerData: q.answerData, status: q.status }));
    out.push({ subject: { id: subject?.id, key: subject?.key, name: subject?.name }, grade: { id: grade?.id, key: grade?.key, name: grade?.name }, unit: { id: unit?.id, key: unit?.key, title: unit?.title }, lesson: { id: l.id, key: l.key, title: l.title }, questions });
  }
  return out;
}

app.get('/', (_req, res) => res.send('Question Bank (Prisma) running'));

const port = process.env.PORT ? Number(process.env.PORT) : 4001;
app.listen(port, () => console.log(`Question Bank Prisma API listening on http://localhost:${port}`));
