import XLSX from 'xlsx';
import { prisma } from '../backend/prisma-client';
import { computeFingerprint } from '../utils/fingerprint';

// Expected Excel columns (header row):
// subjectKey, subjectName, gradeKey, gradeName, unitKey, unitTitle, lessonKey, lessonTitle, questionKey, type, text, points, difficulty, hint, explanation, answerData

export function parseExcelBuffer(buffer: Buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  const items: any[] = [];
  for (const r of rows) {
    const canonical: any = {
      subject: { key: r['subjectKey'] || undefined, name: r['subjectName'] || undefined },
      grade: { key: r['gradeKey'] || undefined, name: r['gradeName'] || undefined },
      unit: { key: r['unitKey'] || undefined, title: r['unitTitle'] || undefined },
      lesson: { key: r['lessonKey'] || undefined, title: r['lessonTitle'] || undefined },
      key: r['questionKey'] || undefined,
      type: r['type'] || undefined,
      text: r['text'] || undefined,
      points: r['points'] ? Number(r['points']) : undefined,
      difficulty: r['difficulty'] || undefined,
      hint: r['hint'] || undefined,
      explanation: r['explanation'] || undefined,
      answerData: undefined,
      metadata: undefined
    };
    if (r['answerData']) {
      try {
        canonical.answerData = typeof r['answerData'] === 'string' ? JSON.parse(r['answerData']) : r['answerData'];
      } catch (e) {
        canonical.answerData = null;
      }
    }
    const fingerprint = computeFingerprint(canonical);
    items.push({ canonical, fingerprint, errors: [] });
  }
  return items;
}

export async function createExcelImportPreview(buffer: Buffer, createdBy?: string) {
  const items = parseExcelBuffer(buffer);
  const job = await prisma.importJob.create({ data: { jobType: 'EXCEL', inputMeta: null, status: 'PENDING', createdBy: createdBy ?? null } });
  for (const it of items) {
    await prisma.importItem.create({ data: { jobId: job.id, canonicalQuestion: it.canonical, validationErrors: it.errors && it.errors.length ? it.errors : null, fingerprint: it.fingerprint, action: 'PREVIEW' } });
  }
  return { jobId: job.id, items };
}

export async function approveImportJobFromExcel(jobId: string) {
  const job = await prisma.importJob.findUnique({ where: { id: jobId } });
  if (!job) throw new Error('job not found');
  const items = await prisma.importItem.findMany({ where: { jobId } });
  const inserted: any[] = [];
  for (const it of items) {
    if (it.validationErrors && (it.validationErrors as any).length) continue;
    const q = it.canonicalQuestion as any;
    // create or find subject/grade/unit/lesson similar to import.service logic
    let subjectKey = q.subject?.key ?? (q.subject?.name ? q.subject.name : 'SUBJECT');
    let subject = await prisma.subject.findUnique({ where: { key: subjectKey } });
    if (!subject) subject = await prisma.subject.create({ data: { key: subjectKey, name: q.subject?.name ?? subjectKey } });

    let gradeKey = q.grade?.key ?? (q.grade?.name ? q.grade.name : 'G00');
    let grade = await prisma.grade.findUnique({ where: { key: gradeKey } });
    if (!grade) grade = await prisma.grade.create({ data: { key: gradeKey, name: q.grade?.name ?? gradeKey } });

    let unit = null;
    if (q.unit?.key) unit = await prisma.unit.findUnique({ where: { key: q.unit.key } });
    if (!unit) unit = await prisma.unit.create({ data: { key: q.unit?.key ?? `${subjectKey}-${gradeKey}-U01`, title: q.unit?.title ?? 'Unit', subjectId: subject.id, gradeId: grade.id } });

    let lesson = null;
    if (q.lesson?.key) lesson = await prisma.lesson.findUnique({ where: { key: q.lesson.key } });
    if (!lesson) lesson = await prisma.lesson.create({ data: { key: q.lesson?.key ?? `${unit.key}-L01`, title: q.lesson?.title ?? 'Lesson', unitId: unit.id } });

    const created = await prisma.question.create({ data: { key: q.key ?? undefined, lessonId: lesson.id, type: q.type, text: q.text, points: q.points ?? 1, difficulty: q.difficulty ?? null, hint: q.hint ?? null, explanation: q.explanation ?? null, answerData: q.answerData ?? null, metadata: q.metadata ?? null, status: 'PUBLISHED' } });
    if (q.answerData && (q.type === 'MCQ_SINGLE' || q.type === 'MCQ_MULTI') && Array.isArray(q.answerData.options)) {
      for (let i = 0; i < q.answerData.options.length; i++) {
        const opt = q.answerData.options[i];
        await prisma.questionChoice.create({ data: { questionId: created.id, key: opt.id, text: opt.text, orderIndex: i } });
      }
    }
    inserted.push(created);
  }
  await prisma.importJob.update({ where: { id: jobId }, data: { status: 'IMPORTED', completedAt: new Date() } });
  return { imported: inserted.length };
}
