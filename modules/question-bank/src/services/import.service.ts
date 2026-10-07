import { prisma } from '../backend/prisma-client';
import { computeFingerprint } from '../utils/fingerprint';

export async function persistImportJob(jobId: string, items: any[], createdBy?: string) {
  // Create ImportJob and ImportItems and persist canonical questions into Question table
  const job = await prisma.importJob.create({ data: { id: jobId, jobType: 'JSON', inputMeta: null, status: 'IMPORTED', createdBy: createdBy ?? null } });
  const inserted: any[] = [];
  for (const it of items) {
    const fingerprint = it.fingerprint || computeFingerprint(it.canonical);
    await prisma.importItem.create({ data: { jobId: job.id, canonicalQuestion: it.canonical, validationErrors: it.errors && it.errors.length ? it.errors : null, fingerprint, action: 'INSERT' } });
    if (it.errors && it.errors.length) continue;
    const q = it.canonical;
    // Find or create unit/lesson minimal
    let unit = null;
    if (q.unit && q.unit.key) {
      unit = await prisma.unit.findUnique({ where: { key: q.unit.key } });
      if (!unit) unit = await prisma.unit.create({ data: { key: q.unit.key, title: q.unit.title ?? q.unit.key, subjectId: q.subject?.id ?? '', gradeId: q.grade?.id ?? '' } }).catch(()=>null);
    }
    let lesson = null;
    if (q.lesson && q.lesson.key && unit) {
      lesson = await prisma.lesson.findUnique({ where: { key: q.lesson.key } });
      if (!lesson) lesson = await prisma.lesson.create({ data: { key: q.lesson.key, title: q.lesson.title ?? q.lesson.key, unitId: unit.id } }).catch(()=>null);
    }
    const lessonId = lesson?.id ?? q.lesson?.id ?? null;
    const created = await prisma.question.create({ data: { key: q.key ?? undefined, lessonId: lessonId ?? undefined, type: q.type, text: q.text, points: q.points ?? 1, difficulty: q.difficulty ?? null, hint: q.hint ?? null, explanation: q.explanation ?? null, answerData: q.answerData ?? null, metadata: q.metadata ?? null, status: q.status ?? 'PUBLISHED' } });
    // Insert choices if any
    if (q.answerData && (q.type === 'MCQ_SINGLE' || q.type === 'MCQ_MULTI') && Array.isArray(q.answerData.options)) {
      for (let i = 0; i < q.answerData.options.length; i++) {
        const opt = q.answerData.options[i];
        await prisma.questionChoice.create({ data: { questionId: created.id, key: opt.id, text: opt.text, orderIndex: i } });
      }
    }
    inserted.push(created);
  }
  return { jobId: job.id, imported: inserted.length };
}
