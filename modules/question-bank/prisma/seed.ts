// Prisma-backed services and seed integration for Question Bank
import { PrismaClient } from '../../node_modules/.prisma/client-question-bank';
import bcrypt from 'bcryptjs';
import fs from 'fs/promises';

const prisma = new PrismaClient();

export async function seed() {
  console.log('Seeding Question Bank...');
  // create subjects and grades from sample if not exist
  const subjMath = await prisma.subject.upsert({ where: { key: 'MATH' }, update: {}, create: { key: 'MATH', name: 'Mathematics' } });
  const subjSci = await prisma.subject.upsert({ where: { key: 'SCI' }, update: {}, create: { key: 'SCI', name: 'Science' } });
  const g05 = await prisma.grade.upsert({ where: { key: 'G05' }, update: {}, create: { key: 'G05', name: 'Grade 5' } });

  // create admin and students
  const adminPass = await bcrypt.hash('AdminPass123!', 10);
  await prisma.user.upsert({ where: { email: 'admin@qb.local' }, update: {}, create: { email: 'admin@qb.local', username: 'admin', passwordHash: adminPass, role: 'SYSTEM_ADMIN' } });
  const studentPass = await bcrypt.hash('StudentPass1!', 10);
  await prisma.user.upsert({ where: { email: 'student.g05@qb.local' }, update: {}, create: { email: 'student.g05@qb.local', username: 'student.g05', passwordHash: studentPass, role: 'STUDENT', gradeId: g05.id } });

  // load sample questions
  const raw = await fs.readFile('modules/question-bank/sample/questions.json','utf8');
  const arr = JSON.parse(raw);
  for (const q of arr) {
    // map lesson/unit minimal creation
    const unit = await prisma.unit.upsert({ where: { key: q.unit.key }, update: {}, create: { key: q.unit.key, title: q.unit.title, subjectId: subjSci.id, gradeId: g05.id } });
    const lesson = await prisma.lesson.upsert({ where: { key: q.lesson.key }, update: {}, create: { key: q.lesson.key, title: q.lesson.title, unitId: unit.id } });
    const created = await prisma.question.create({ data: {
      key: q.key,
      lessonId: lesson.id,
      type: q.type,
      text: q.text,
      points: q.points ?? 1,
      difficulty: q.difficulty ?? null,
      hint: q.hint ?? null,
      explanation: q.explanation ?? null,
      answerData: q.answerData ?? null,
      metadata: q.metadata ?? null,
      status: q.status ?? 'PUBLISHED'
    } });
    // create choices if MCQ
    if (q.answerData && (q.type === 'MCQ_SINGLE' || q.type === 'MCQ_MULTI')) {
      const opts = q.answerData.options ?? [];
      for (let i=0;i<opts.length;i++) {
        await prisma.questionChoice.create({ data: { questionId: created.id, key: opts[i].id, text: opts[i].text, orderIndex: i } });
      }
    }
  }

  console.log('Seeding complete');
}

if (require.main === module) {
  seed().then(()=>process.exit(0)).catch((e)=>{ console.error(e); process.exit(1); });
}
