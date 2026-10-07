import { prisma } from '../backend/prisma-client';
import { computeFingerprint } from '../utils/fingerprint';
import { generateSubjectKey, generateGradeKey, generateUnitKey, generateLessonKey, generateQuestionKey } from '../utils/keygen';

export async function persistImportJob(jobId: string, items: any[], createdBy?: string) {
  // Create ImportJob and ImportItems and persist canonical questions into Question table
  const job = await prisma.importJob.create({ data: { id: jobId, jobType: 'JSON', inputMeta: null, status: 'IMPORTED', createdBy: createdBy ?? null } });
  const inserted: any[] = [];
  for (const it of items) {
    const fingerprint = it.fingerprint || computeFingerprint(it.canonical);
    await prisma.importItem.create({ data: { jobId: job.id, canonicalQuestion: it.canonical, validationErrors: it.errors && it.errors.length ? it.errors : null, fingerprint, action: 'INSERT' } });
    if (it.errors && it.errors.length) continue;
    const q = it.canonical;

    // Resolve or create subject
    let subjectKey = q.subject?.key ?? (q.subject?.name ? generateSubjectKey(q.subject.name) : 'SUBJECT');
    let subject = await prisma.subject.findUnique({ where: { key: subjectKey } });
    if (!subject) subject = await prisma.subject.create({ data: { key: subjectKey, name: q.subject?.name ?? subjectKey } });

    // Resolve or create grade
    let gradeKey = q.grade?.key ?? (q.grade?.name ? generateGradeKey(q.grade.name) : 'G00');
    let grade = await prisma.grade.findUnique({ where: { key: gradeKey } });
    if (!grade) grade = await prisma.grade.create({ data: { key: gradeKey, name: q.grade?.name ?? gradeKey } });

    // Create or find unit
    let unitKey = q.unit?.key ?? generateUnitKey(subject.key, grade.key, q.unit?.title ?? q.unit?.key ?? '01');
    let unit = await prisma.unit.findUnique({ where: { key: unitKey } });
    if (!unit) unit = await prisma.unit.create({ data: { key: unitKey, title: q.unit?.title ?? unitKey, subjectId: subject.id, gradeId: grade.id } });

    // Create or find lesson
    let lessonKey = q.lesson?.key ?? generateLessonKey(unit.key, q.lesson?.title ?? q.lesson?.key ?? '01');
    let lesson = await prisma.lesson.findUnique({ where: { key: lessonKey } });
    if (!lesson) lesson = await prisma.lesson.create({ data: { key: lessonKey, title: q.lesson?.title ?? lessonKey, unitId: unit.id } });

    const lessonId = lesson?.id ?? q.lesson?.id ?? undefined;

    // Generate question key if missing
    const questionKey = q.key ?? generateQuestionKey(subject.key, grade.key, unit.key, lesson.key, q.key ?? Date.now());

    const created = await prisma.question.create({ data: { key: questionKey, lessonId: lessonId ?? undefined, type: q.type, text: q.text, points: q.points ?? 1, difficulty: q.difficulty ?? null, hint: q.hint ?? null, explanation: q.explanation ?? null, answerData: q.answerData ?? null, metadata: q.metadata ?? null, status: q.status ?? 'PUBLISHED' } });

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
