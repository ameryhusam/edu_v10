import fs from "node:fs/promises";
import path from "node:path";
import { db } from "../src/db.js";

type QuestionBankPackage = {
  schemaVersion?: string;
  packageKey?: string;
  grades?: any[];
  subjects?: any[];
  gradeSubjects?: any[];
  books?: any[];
  prerequisites?: any[];
};

function assertString(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) throw new Error(\`Invalid \${name}\`);
}

export async function importQuestionBankFile(filePath: string) {
  const raw = JSON.parse(await fs.readFile(filePath, "utf8")) as QuestionBankPackage;
  const packageKey = raw.packageKey ?? path.basename(filePath, ".json");

  await db.$transaction(async (tx) => {
    for (const grade of raw.grades ?? []) {
      assertString(grade.id, "grade.id");
      assertString(grade.nameAr, "grade.nameAr");
      await tx.grade.upsert({ where: { id: grade.id }, update: { nameAr: grade.nameAr }, create: { id: grade.id, nameAr: grade.nameAr } });
    }
    for (const subject of raw.subjects ?? []) {
      assertString(subject.id, "subject.id");
      assertString(subject.nameAr, "subject.nameAr");
      await tx.subject.upsert({
        where: { id: subject.id },
        update: { nameAr: subject.nameAr, iconName: subject.iconName ?? null },
        create: { id: subject.id, nameAr: subject.nameAr, iconName: subject.iconName ?? null }
      });
    }
    for (const link of raw.gradeSubjects ?? []) {
      await tx.gradeSubject.upsert({
        where: { gradeId_subjectId: { gradeId: link.gradeId, subjectId: link.subjectId } },
        update: { isActive: link.isActive ?? true },
        create: { gradeId: link.gradeId, subjectId: link.subjectId, isActive: link.isActive ?? true }
      });
    }
    for (const b of raw.books ?? []) {
      const book = await tx.book.upsert({
        where: { key: b.key },
        update: {
          gradeId: b.gradeId, subjectId: b.subjectId, title: b.title, part: b.part ?? null,
          semester: b.semester ?? null, edition: b.edition ?? null, publisher: b.publisher ?? null,
          publicationYear: b.publicationYear ?? null
        },
        create: {
          key: b.key, gradeId: b.gradeId, subjectId: b.subjectId, title: b.title, part: b.part ?? null,
          semester: b.semester ?? null, edition: b.edition ?? null, publisher: b.publisher ?? null,
          publicationYear: b.publicationYear ?? null
        }
      });
      for (const u of b.units ?? []) {
        const unit = await tx.unit.upsert({
          where: { key: u.key },
          update: { bookId: book.id, orderIndex: u.orderIndex, title: u.title, printedStartPage: u.printedStartPage ?? null, printedEndPage: u.printedEndPage ?? null },
          create: { bookId: book.id, key: u.key, orderIndex: u.orderIndex, title: u.title, printedStartPage: u.printedStartPage ?? null, printedEndPage: u.printedEndPage ?? null }
        });
        for (const l of u.lessons ?? []) {
          const lesson = await tx.lesson.upsert({
            where: { key: l.key },
            update: { unitId: unit.id, orderIndex: l.orderIndex, title: l.title, branch: l.branch ?? null, printedStartPage: l.printedStartPage ?? null, printedEndPage: l.printedEndPage ?? null },
            create: { unitId: unit.id, key: l.key, orderIndex: l.orderIndex, title: l.title, branch: l.branch ?? null, printedStartPage: l.printedStartPage ?? null, printedEndPage: l.printedEndPage ?? null }
          });
          for (const c of l.concepts ?? []) {
            await tx.concept.upsert({
              where: { key: c.key },
              update: { gradeId: c.gradeId, lessonId: lesson.id, orderIndex: c.orderIndex, nameAr: c.nameAr, description: c.description ?? null, difficultyHint: c.difficultyHint ?? null },
              create: { gradeId: c.gradeId, lessonId: lesson.id, key: c.key, orderIndex: c.orderIndex, nameAr: c.nameAr, description: c.description ?? null, difficultyHint: c.difficultyHint ?? null }
            });
          }
          for (const q of l.questions ?? []) {
            const question = await tx.question.upsert({
              where: { key: q.key },
              update: { lessonId: lesson.id, text: q.text, type: q.type, options: q.options ?? undefined, correctAnswer: q.correctAnswer, explanation: q.explanation ?? null, difficulty: q.difficulty ?? 0.5, sourcePage: q.sourcePage ?? null, origin: q.origin },
              create: { lessonId: lesson.id, key: q.key, text: q.text, type: q.type, options: q.options ?? undefined, correctAnswer: q.correctAnswer, explanation: q.explanation ?? null, difficulty: q.difficulty ?? 0.5, sourcePage: q.sourcePage ?? null, origin: q.origin }
            });
            await tx.questionConcept.deleteMany({ where: { questionId: question.id } });
            for (const conceptKey of q.conceptKeys ?? []) {
              const concept = await tx.concept.findUniqueOrThrow({ where: { key: conceptKey } });
              await tx.questionConcept.create({ data: { questionId: question.id, conceptId: concept.id } });
            }
          }
        }
      }
    }
    for (const p of raw.prerequisites ?? []) {
      const concept = await tx.concept.findUniqueOrThrow({ where: { key: p.conceptKey } });
      const prerequisite = await tx.concept.findUniqueOrThrow({ where: { key: p.prerequisiteKey } });
      if (concept.id === prerequisite.id) throw new Error(\`Self prerequisite: \${p.conceptKey}\`);
      await tx.conceptPrerequisite.upsert({
        where: { conceptId_prerequisiteId: { conceptId: concept.id, prerequisiteId: prerequisite.id } },
        update: { strength: p.strength ?? 1, requiredMastery: p.requiredMastery ?? 0.7 },
        create: { conceptId: concept.id, prerequisiteId: prerequisite.id, strength: p.strength ?? 1, requiredMastery: p.requiredMastery ?? 0.7 }
      });
    }
  });
  return packageKey;
}

export async function importQuestionBankDirectory(directory = "seeding/question_bank/packages") {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = entries.filter((e) => e.isFile() && e.name.endsWith(".json")).map((e) => path.join(directory, e.name)).sort();
  if (!files.length) throw new Error(\`No JSON question-bank packages found in \${directory}\`);
  for (const file of files) console.log(\`Imported \${await importQuestionBankFile(file)} <- \${path.basename(file)}\`);
  return files.length;
}

if (process.argv[1]?.endsWith("question-bank-importer.ts")) {
  const input = process.argv[2] ?? "seeding/question_bank/packages";
  const stat = await fs.stat(input);
  if (stat.isDirectory()) await importQuestionBankDirectory(input);
  else await importQuestionBankFile(input);
  await db.$disconnect();
  console.log("Question-bank import complete.");
}
