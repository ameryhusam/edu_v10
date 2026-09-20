/**
 * Development seed — a small but COMPLETE vertical slice.
 *
 * The point is not volume, it is coverage: after seeding, every layer has real
 * data to exercise. One textbook, a prerequisite chain, questions with
 * misconception-tagged distractors, a learner with an evidence history, and
 * grounding chunks for the AI tutor.
 *
 * Idempotent: every write is an upsert keyed by a canonical key, so running it
 * twice changes nothing. Seeds that can only run once are seeds nobody runs.
 */

// Reads .env before anything below looks at process.env. The seed was the
// only database client that did NOT load it, so with DATABASE_URL unset the
// PrismaPg pool fell back to pg's defaults — the OS user at "localhost". On a
// machine with a real PostgreSQL installed, "localhost" can resolve to where
// THAT server listens, and it refuses the unknown user with SQLSTATE 28000,
// which Prisma reports as "User was denied access on the database" (P1010).
// db:apply always loaded .env, which is why apply succeeded while the seed
// failed on the very same machine. Loading .env here makes the seed target
// the same explicitly-addressed server as every other client.
import 'dotenv/config';

import { createPrismaClient } from '../../src/infrastructure/database/prisma.client.js';
import { RecomputeMasteryUseCase } from '../../src/contexts/mastery/application/recompute-mastery.use-case.js';
import {
  PrismaConceptMasteryPolicy,
  PrismaEvidenceReader,
  PrismaMasteryRepository,
} from '../../src/infrastructure/database/mastery.repository.js';
import { systemClock } from '../../src/shared/kernel/clock.js';
import { BcryptPasswordHasher } from '../../src/infrastructure/security/tokens.js';
import {
  conceptKey,
  lessonKey,
  textbookKey,
  unitKey,
  questionKey,
} from '../../src/shared/kernel/identifiers.js';
import { unwrap } from '../../src/shared/kernel/result.js';
import { seedFoundation, seedDemoAccounts } from './foundation.js';
import { readTextbookSpec, seedTextbookFromSpec } from './load-textbook.js';
import { readYemenSourceCatalog, seedYemenSourceCatalog } from './source-catalog.js';
import { reportConnectionError } from '../../src/infrastructure/database/connection-diagnosis.js';

if (!process.env.DATABASE_URL) {
  // Same contract as scripts/apply-migrations.mjs: refuse loudly rather than
  // letting pg fall back to its defaults and connect to who-knows-what.
  console.error('DATABASE_URL is not set. Copy .env.example to .env first.');
  process.exit(1);
}

const prisma = createPrismaClient({
  databaseUrl: process.env.DATABASE_URL,
  verbose: false,
  // The seed is one sequential writer — it never needs a second connection.
  // Against the dev PGlite server (10 slots) an uncapped pool defaults to 10,
  // so the seed alone could hold every slot and starve a running API.
  poolMax: 1,
});

const YEAR = '2026-2027';
const TERM = 1;
const GRADE = 7;
const SUBJECT = 'MATH';
/** Printed edition of the physical book — part of textbook identity. */
const EDITION = '2026';

/** Development-only credential for the demo learner, printed by the seed. */
const DEMO_PASSWORD = 'demo1234';

async function main(): Promise<void> {
  console.log('[seed] starting');

  // ── Reference foundation (data-driven) ─────────────────────────────────
  // Calendar, subject catalogue, schools and demo accounts all come from
  // prisma/seed/data/*.json. Hardcoding them here is what made the converted
  // national curriculum unimportable: a textbook cannot be created for a
  // subject the catalogue does not contain.
  const foundation = await seedFoundation(prisma);
  console.log(
    `  reference  ${foundation.report.grades} grades, ${foundation.report.terms} terms, ` +
      `${foundation.report.subjects} subjects, ${foundation.report.schools} school(s)`,
  );

  // ── The curriculum matrix: expand the national policy once ────────────────
  // The legacy system's fill algorithm (provisioningPolicy → distribution
  // rows), run here at seed time so a fresh installation opens with the
  // national offer already materialised. Two deliberate differences from a
  // naive expansion, both protecting the administrator:
  //   · only POSITIVE cells are created — a subject the policy excludes is
  //     simply absent, not stored as a disabled row;
  //   · create-only, never update: a re-seed must not flip a cell the
  //     administrator has since decided differently about.
  const [policySubjects, policyGrades] = await Promise.all([
    prisma.subject.findMany({ where: { isActive: true }, select: { id: true, key: true, standardGradeLevels: true } }),
    prisma.grade.findMany({ where: { isActive: true }, select: { id: true, key: true, ordinal: true } }),
  ]);
  let matrixCells = 0;
  for (const subject of policySubjects) {
    for (const grade of policyGrades) {
      if (!subject.standardGradeLevels.includes(grade.ordinal)) continue;
      const existing = await prisma.gradeSubject.findFirst({
        where: { gradeId: grade.id, subjectId: subject.id },
        select: { id: true },
      });
      if (existing) continue;
      await prisma.gradeSubject.create({
        data: {
          key: `${grade.key}-${subject.key}`,
          gradeId: grade.id,
          subjectId: subject.id,
          isActive: true,
        },
      });
      matrixCells += 1;
    }
  }
  console.log(`  matrix     ${matrixCells} subject-grade cells from the national policy`);

  const year = await prisma.academicYear.findUniqueOrThrow({
    where: { key: foundation.currentYearKey },
  });
  const term = await prisma.term.findUniqueOrThrow({ where: { key: foundation.firstTermKey } });
  const grade = await prisma.grade.findUniqueOrThrow({ where: { key: `G0${GRADE}` } });
  const subject = await prisma.subject.findUniqueOrThrow({ where: { key: SUBJECT } });
  const school = await prisma.school.findUniqueOrThrow({ where: { key: 'sch_demo' } });

  // ── Content: one textbook, one unit, one lesson, three chained concepts ──
  const tbKey = unwrap(textbookKey({ subject: SUBJECT, grade: GRADE, term: TERM, edition: EDITION }));

  const textbook = await prisma.textbook.upsert({
    where: { key: tbKey },
    create: {
      key: tbKey,
      termId: term.id,
      gradeId: grade.id,
      subjectId: subject.id,
      edition: EDITION,
      title: 'كتاب الرياضيات',
      issuer: 'وزارة التربية والتعليم — اليمن',
      status: 'PUBLISHED',
      publishedAt: new Date(),
      totalPages: 180,
    },
    update: { status: 'PUBLISHED' },
  });

  // The academic year of USE lives on the adoption, not on the book.
  await prisma.textbookAdoption.upsert({
    where: {
      textbookId_schoolId_academicYearId: {
        textbookId: textbook.id,
        schoolId: school.id,
        academicYearId: year.id,
      },
    },
    create: { textbookId: textbook.id, schoolId: school.id, academicYearId: year.id },
    update: {},
  });

  const uSlug = 'SETS-RELATIONS';
  const uKey = unwrap(unitKey(tbKey, uSlug));
  const unit = await prisma.unit.upsert({
    where: { key: uKey },
    create: {
      key: uKey,
      slug: uSlug,
      textbookId: textbook.id,
      name: 'المجموعات والعلاقات',
      type: 'UNIT',
      orderIndex: 1,
      startPage: 9,
      endPage: 46,
    },
    update: {},
  });

  const lSlug = 'SET-AND-ELEMENT';
  const lKey = unwrap(lessonKey(uKey, lSlug));
  const lesson = await prisma.lesson.upsert({
    where: { key: lKey },
    create: {
      key: lKey,
      slug: lSlug,
      unitId: unit.id,
      name: 'المجموعة والعنصر',
      orderIndex: 1,
      estimatedMins: 45,
      startPage: 9,
      endPage: 12,
    },
    update: {},
  });

  // The lesson's own reading — the screen shows the text before the questions.
  await prisma.learningResource.upsert({
    where: { key: `${lKey}-RES1` },
    create: {
      key: `${lKey}-RES1`,
      slug: 'READING',
      kind: 'READING',
      title: 'المجموعة والعنصر',
      body:
        'المجموعة تجمّعٌ محدَّدٌ تحديدًا تامًّا من الأشياء أو الأعداد، وكلّ ما فيها يُسمّى عنصرًا. ' +
        'نكتب المجموعة بين قوسين، ونرمز لعنصرها برمز الانتماء ∈، فنقول: 2 ∈ {1, 2, 3}. ' +
        'والمجموعة الجزئية ب ⊆ أ عندما يكون كلّ عنصر في ب عنصرًا في أ أيضًا.',
      lessonId: lesson.id,
      textbookId: textbook.id,
      orderIndex: 1,
      pageStart: 9,
      pageEnd: 12,
      estimatedMins: 45,
    },
    update: {},
  });
  await prisma.learningResource.upsert({
    where: { key: `${lKey}-RES2` },
    create: {
      key: `${lKey}-RES2`,
      slug: 'WORKED_EXAMPLE',
      kind: 'WORKED_EXAMPLE',
      title: 'مثال محلول: هل ب ⊆ أ؟',
      body: 'أ = {1, 2, 3}، ب = {2, 3}. كلّ عنصر في ب (وهما 2 و3) موجود في أ، إذن ب ⊆ أ.',
      url: 'https://example.org/edu7/set-diagram.png',
      lessonId: lesson.id,
      textbookId: textbook.id,
      orderIndex: 2,
    },
    update: {},
  });

  await prisma.learningResource.upsert({
    where: { key: `${lKey}-RESPDF` },
    create: {
      key: `${lKey}-RESPDF`,
      slug: 'TEXTBOOK-PDF',
      kind: 'TEXTBOOK_PAGE',
      title: 'صفحات الكتاب المدرسي',
      url: 'https://example.org/edu7/math-g07-pages-9-12.pdf',
      lessonId: lesson.id,
      textbookId: textbook.id,
      orderIndex: 3,
      pageStart: 9,
      pageEnd: 12,
    },
    update: {},
  });

  // A deliberate prerequisite chain: C01 → C02 → C03. This is what makes the
  // UNBLOCK path in the decision engine demonstrable with real data.
  // Slugs are frozen identity; orderIndex is presentation only. Reordering
  // these three concepts must not change a single key.
  const conceptSpecs = [
    { slug: 'SET', order: 1, name: 'المجموعة', threshold: 0.75, difficulty: 0.25, page: 9 },
    { slug: 'ELEMENT-MEMBERSHIP', order: 2, name: 'العنصر والانتماء', threshold: 0.8, difficulty: 0.4, page: 10 },
    { slug: 'SUBSET', order: 3, name: 'المجموعة الجزئية', threshold: 0.85, difficulty: 0.6, page: 11 },
  ];

  const concepts = [];
  for (const spec of conceptSpecs) {
    const cKey = unwrap(conceptKey(lKey, spec.slug));
    const concept = await prisma.concept.upsert({
      where: { key: cKey },
      create: {
        key: cKey,
        slug: spec.slug,
        lessonId: lesson.id,
        name: spec.name,
        orderIndex: spec.order,
        difficulty: spec.difficulty,
        importance: 0.9,
        masteryThreshold: spec.threshold,
        isCore: true,
        pageNumber: spec.page,
      },
      update: {},
    });
    concepts.push(concept);
  }

  for (let i = 1; i < concepts.length; i++) {
    await prisma.conceptPrerequisite.upsert({
      where: {
        conceptId_prerequisiteId: {
          conceptId: concepts[i]!.id,
          prerequisiteId: concepts[i - 1]!.id,
        },
      },
      create: {
        conceptId: concepts[i]!.id,
        prerequisiteId: concepts[i - 1]!.id,
        strength: 1.0, // hard gate
        requiredMastery: 0.7,
      },
      update: {},
    });
  }

  // ── A named misconception, wired to a distractor ────────────────────────
  const misconception = await prisma.misconception.upsert({
    where: { key: `${concepts[0]!.key}-MIS01` },
    create: {
      key: `${concepts[0]!.key}-MIS01`,
      slug: 'خلط-مفهوم-المجموعة',
      conceptId: concepts[0]!.id,
      name: 'خلط مفهوم المجموعة',
      description: 'يعتقد الطالب أن أي تجمع من الأشياء يمثل مجموعة رياضية.',
      remediation: 'المجموعة يجب أن تكون محددة تحديداً تاماً؛ التفضيلات الشخصية لا تصلح معياراً.',
    },
    update: {},
  });

  // ── Questions, including misconception-tagged distractors ───────────────
  const questionSpecs = [
    {
      order: 1,
      concept: concepts[0]!,
      text: 'أي مما يلي يمثل مجموعة رياضية محددة تحديداً تاماً؟',
      choices: [
        { text: 'أيام الأسبوع', correct: true },
        { text: 'الطلاب الطوال في الفصل', correct: false, misconception: true },
        { text: 'الألوان الجميلة', correct: false, misconception: true },
        { text: 'الأطعمة اللذيذة', correct: false, misconception: true },
      ],
      difficulty: -0.5,
    },
    {
      order: 2,
      concept: concepts[1]!,
      text: 'إذا كانت أ = {1, 2, 3} فأي العبارات صحيحة؟',
      choices: [
        { text: '2 ∈ أ', correct: true },
        { text: '5 ∈ أ', correct: false },
        { text: '2 ∉ أ', correct: false },
        { text: 'أ = ∅', correct: false },
      ],
      difficulty: 0.0,
    },
    {
      order: 3,
      concept: concepts[2]!,
      text: 'إذا كانت ب = {1, 2} و أ = {1, 2, 3} فما العلاقة بينهما؟',
      choices: [
        { text: 'ب ⊆ أ', correct: true },
        { text: 'أ ⊆ ب', correct: false },
        { text: 'ب = أ', correct: false },
        { text: 'لا علاقة', correct: false },
      ],
      difficulty: 0.8,
    },
  ];

  for (const spec of questionSpecs) {
    // Parented on the lesson: relinking a question to another concept must
    // not rename it. Identity is the question's stable source reference.
    const qKey = unwrap(questionKey(lKey, `${spec.concept.key}#${spec.order}`));

    const question = await prisma.question.upsert({
      where: { key: qKey },
      create: {
        key: qKey,
        lessonId: lesson.id,
        type: 'MCQ_SINGLE',
        text: spec.text,
          points: 1,
          // Origin is left at its UNKNOWN default on purpose. These fixtures
          // are aligned to a textbook lesson, but alignment is not origin, and
          // nothing here establishes that they were printed in the book.
          irtDifficulty: spec.difficulty,
        irtDiscrimination: 1.2,
        irtGuessing: 0.25,
        difficulty01: Number((spec.difficulty / 6 + 0.5).toFixed(2)),
        status: 'PUBLISHED',
      },
      update: { status: 'PUBLISHED' },
    });

    await prisma.questionConcept.upsert({
      where: { questionId_conceptId: { questionId: question.id, conceptId: spec.concept.id } },
      create: {
        questionId: question.id,
        conceptId: spec.concept.id,
        weight: 1.0,
        isPrimary: true,
      },
      update: {},
    });

    // Choices are replaced wholesale so re-seeding cannot duplicate them.
    await prisma.questionChoice.deleteMany({ where: { questionId: question.id } });
    const created = [];
    for (const [i, choice] of spec.choices.entries()) {
      created.push(
        await prisma.questionChoice.create({
          data: {
            questionId: question.id,
            text: choice.text,
            orderIndex: i + 1,
            misconceptionId:
              'misconception' in choice && choice.misconception ? misconception.id : null,
          },
        }),
      );
    }

    const correctIds = created
      .filter((_, i) => spec.choices[i]!.correct)
      .map((c) => c.id);

    await prisma.answerKey.upsert({
      where: { questionId: question.id },
      create: { questionId: question.id, correctChoiceIds: correctIds },
      update: { correctChoiceIds: correctIds },
    });
  }

  // ── Flashcards: the junior board's card treasure ───────────────────────
  // A handful of authored cards so the treasure has something to flip on a
  // fresh install. Ordered by the service, not by this list.
  const cardSpecs = [
    {
      concept: concepts[0]!,
      front: 'ما الذي يجعل تجمّع الأشياء «مجموعة» رياضيّة؟',
      back: 'أن يكون محدَّدًا تحديدًا تامًّا: نعرف لكل عنصر إن كان داخل المجموعة أم خارجها.',
    },
    {
      concept: concepts[0]!,
      front: '«الألوان الجميلة» — هل هي مجموعة رياضيّة؟',
      back: 'لا: الجمال تفضيل شخصي، فالتحديد ليس تامًّا.',
    },
    {
      concept: concepts[1]!,
      front: 'إذا كانت أ = {1, 2, 3} فهل 2 ∈ أ؟',
      back: 'نعم — 2 عنصر من عناصر أ.',
    },
    {
      concept: concepts[2]!,
      front: 'متى تكون ب ⊆ أ؟',
      back: 'عندما يكون كل عنصر في ب عنصرًا في أ أيضًا.',
    },
  ];

  for (const [i, spec] of cardSpecs.entries()) {
    await prisma.flashcard.upsert({
      where: { key: `${spec.concept.key}-FC${i + 1}` },
      create: {
        key: `${spec.concept.key}-FC${i + 1}`,
        conceptId: spec.concept.id,
        front: spec.front,
        back: spec.back,
      },
      update: { front: spec.front, back: spec.back, isActive: true },
    });
  }

  // ── A published exam the learner can take ───────────────────────────────
  // Adaptive and small: the stopping rule ends it after a handful of items
  // once the estimate is precise, which is the flow the runner exercises.
  const exam = await prisma.exam.upsert({
    where: { key: 'EXAM-MATH-G07-SETS-01' },
    create: {
      key: 'EXAM-MATH-G07-SETS-01',
      title: 'اختبار قصير: المجموعات والعلاقات',
      description: 'خمسة أسئلة تكيّفيّة على مفاهيم الوحدة الأولى.',
      isAdaptive: true,
      timeLimitMins: 10,
      passingScore: 0.5,
      textbookId: textbook.id,
      status: 'PUBLISHED',
    },
    update: { status: 'PUBLISHED', textbookId: textbook.id },
  });

  // The blueprint: every published question of the lesson, in book order.
  const examQuestions = await prisma.question.findMany({
    where: { lessonId: lesson.id, status: 'PUBLISHED' },
    orderBy: { key: 'asc' },
  });
  await prisma.examItem.deleteMany({ where: { examId: exam.id } });
  for (const [i, q] of examQuestions.entries()) {
    await prisma.examItem.create({
      data: { examId: exam.id, questionId: q.id, orderIndex: i + 1, points: 1 },
    });
  }

  // ── The junior (براعم) book: grades 1-4 get their own path ─────────────
  // Same shape as the senior book, junior content: a short chain, plain
  // questions, a card treasure, and a little challenge. Without a book for
  // G03, the junior board's demo account (sara) would face an honest but
  // empty shelf — and the point of the براعم board is that it is real.
  const juniorGrade = await prisma.grade.findUniqueOrThrow({ where: { key: 'G03' } });
  const juniorTbKey = unwrap(
    textbookKey({ subject: SUBJECT, grade: 3, term: TERM, edition: EDITION }),
  );

  const juniorBook = await prisma.textbook.upsert({
    where: { key: juniorTbKey },
    create: {
      key: juniorTbKey,
      termId: term.id,
      gradeId: juniorGrade.id,
      subjectId: subject.id,
      edition: EDITION,
      title: 'كتاب الرياضيات',
      issuer: 'وزارة التربية والتعليم — اليمن',
      status: 'PUBLISHED',
      publishedAt: new Date(),
      totalPages: 96,
    },
    update: { status: 'PUBLISHED' },
  });

  await prisma.textbookAdoption.upsert({
    where: {
      textbookId_schoolId_academicYearId: {
        textbookId: juniorBook.id,
        schoolId: school.id,
        academicYearId: year.id,
      },
    },
    create: { textbookId: juniorBook.id, schoolId: school.id, academicYearId: year.id },
    update: {},
  });

  const jUnitSlug = 'NUMBERS-ADDITION';
  const jUnitKey = unwrap(unitKey(juniorTbKey, jUnitSlug));
  const jUnit = await prisma.unit.upsert({
    where: { key: jUnitKey },
    create: {
      key: jUnitKey,
      slug: jUnitSlug,
      textbookId: juniorBook.id,
      name: 'الأعداد والجمع',
      type: 'UNIT',
      orderIndex: 1,
      startPage: 5,
      endPage: 30,
    },
    update: {},
  });

  const jLessonSlug = 'COUNT-AND-ADD';
  const jLessonKey = unwrap(lessonKey(jUnitKey, jLessonSlug));
  const jLesson = await prisma.lesson.upsert({
    where: { key: jLessonKey },
    create: {
      key: jLessonKey,
      slug: jLessonSlug,
      unitId: jUnit.id,
      name: 'العدّ والجمع',
      orderIndex: 1,
      estimatedMins: 30,
      startPage: 5,
      endPage: 9,
    },
    update: {},
  });

  // The junior reading: short sentences, the way a seven-year-old reads.
  await prisma.learningResource.upsert({
    where: { key: `${jLessonKey}-RES1` },
    create: {
      key: `${jLessonKey}-RES1`,
      slug: 'READING',
      kind: 'READING',
      title: 'العدّ والجمع',
      body:
        'نَعُدُّ الأشياء واحدًا واحدًا: ١، ٢، ٣… حتى نعرف كم عددها. ' +
        'والجمع أن نضع مجموعتين معًا ونعرف المجموع: ٣ تفاحات و٤ تفاحات تصيران ٧ تفاحات.',
      lessonId: jLesson.id,
      textbookId: juniorBook.id,
      orderIndex: 1,
      pageStart: 5,
      pageEnd: 9,
      estimatedMins: 30,
    },
    update: {},
  });

  // A two-step chain: counting before adding. Short on purpose — a junior
  // path a seven-year-old can see the end of.
  const juniorConcepts = [
    { slug: 'COUNT-TO-100', order: 1, name: 'العدّ حتى ١٠٠', threshold: 0.7, difficulty: 0.15, page: 5 },
    { slug: 'SIMPLE-ADDITION', order: 2, name: 'الجمع البسيط', threshold: 0.75, difficulty: 0.3, page: 7 },
  ];

  const jConcepts = [];
  for (const spec of juniorConcepts) {
    const cKey = unwrap(conceptKey(jLessonKey, spec.slug));
    const concept = await prisma.concept.upsert({
      where: { key: cKey },
      create: {
        key: cKey,
        slug: spec.slug,
        lessonId: jLesson.id,
        name: spec.name,
        orderIndex: spec.order,
        difficulty: spec.difficulty,
        importance: 0.9,
        masteryThreshold: spec.threshold,
        isCore: true,
        pageNumber: spec.page,
      },
      update: {},
    });
    jConcepts.push(concept);
  }

  await prisma.conceptPrerequisite.upsert({
    where: {
      conceptId_prerequisiteId: {
        conceptId: jConcepts[1]!.id,
        prerequisiteId: jConcepts[0]!.id,
      },
    },
    create: {
      conceptId: jConcepts[1]!.id,
      prerequisiteId: jConcepts[0]!.id,
      strength: 1.0,
      requiredMastery: 0.7,
    },
    update: {},
  });

  // Plain questions, plain answers — junior vocabulary only.
  const juniorQuestions = [
    {
      concept: jConcepts[0]!,
      text: 'ما العدد الذي يأتي بعد ٧؟',
      choices: [
        { text: '٨', correct: true },
        { text: '٦', correct: false },
        { text: '٩', correct: false },
        { text: '١٠', correct: false },
      ],
    },
    {
      concept: jConcepts[1]!,
      text: '٣ + ٤ = ؟',
      choices: [
        { text: '٧', correct: true },
        { text: '٥', correct: false },
        { text: '٨', correct: false },
        { text: '١', correct: false },
      ],
    },
  ];

  for (const [i, spec] of juniorQuestions.entries()) {
    const qKey = unwrap(questionKey(jLessonKey, `${spec.concept.key}#${i + 1}`));
    const question = await prisma.question.upsert({
      where: { key: qKey },
      create: {
        key: qKey,
        lessonId: jLesson.id,
        type: 'MCQ_SINGLE',
        text: spec.text,
        points: 1,
        irtDifficulty: -1.2,
        irtDiscrimination: 1.2,
        irtGuessing: 0.25,
        difficulty01: 0.3,
        status: 'PUBLISHED',
      },
      update: { status: 'PUBLISHED' },
    });

    await prisma.questionConcept.upsert({
      where: { questionId_conceptId: { questionId: question.id, conceptId: spec.concept.id } },
      create: { questionId: question.id, conceptId: spec.concept.id, weight: 1.0, isPrimary: true },
      update: {},
    });

    await prisma.questionChoice.deleteMany({ where: { questionId: question.id } });
    const created = [];
    for (const [ci, choice] of spec.choices.entries()) {
      created.push(
        await prisma.questionChoice.create({
          data: { questionId: question.id, text: choice.text, orderIndex: ci + 1, misconceptionId: null },
        }),
      );
    }
    const correctIds = created.filter((_, ci) => spec.choices[ci]!.correct).map((c) => c.id);
    await prisma.answerKey.upsert({
      where: { questionId: question.id },
      create: { questionId: question.id, correctChoiceIds: correctIds },
      update: { correctChoiceIds: correctIds },
    });
  }

  // The junior treasure: cards a seven-year-old can hold in their head.
  const juniorCards = [
    { concept: jConcepts[0]!, front: 'ما العدد الذي يأتي بعد ٩؟', back: '١٠' },
    { concept: jConcepts[0]!, front: 'عُدّ: ٥، ٦، …؟', back: '٧' },
    { concept: jConcepts[1]!, front: '٢ + ٣ = ؟', back: '٥' },
  ];
  for (const [i, card] of juniorCards.entries()) {
    await prisma.flashcard.upsert({
      where: { key: `${card.concept.key}-FC${i + 1}` },
      create: {
        key: `${card.concept.key}-FC${i + 1}`,
        conceptId: card.concept.id,
        front: card.front,
        back: card.back,
      },
      update: { front: card.front, back: card.back, isActive: true },
    });
  }

  // The little hero challenge: an adaptive exam on the junior unit.
  const juniorExam = await prisma.exam.upsert({
    where: { key: 'EXAM-MATH-G03-NUMBERS-01' },
    create: {
      key: 'EXAM-MATH-G03-NUMBERS-01',
      title: 'تحدّي الأبطال: العدّ والجمع',
      description: 'أسئلة قصيرة وممتعة على وحدة الأعداد.',
      isAdaptive: true,
      timeLimitMins: 8,
      passingScore: 0.5,
      textbookId: juniorBook.id,
      status: 'PUBLISHED',
    },
    update: { status: 'PUBLISHED', textbookId: juniorBook.id },
  });

  const juniorExamQuestions = await prisma.question.findMany({
    where: { lessonId: jLesson.id, status: 'PUBLISHED' },
    orderBy: { key: 'asc' },
  });
  await prisma.examItem.deleteMany({ where: { examId: juniorExam.id } });
  for (const [i, q] of juniorExamQuestions.entries()) {
    await prisma.examItem.create({
      data: { examId: juniorExam.id, questionId: q.id, orderIndex: i + 1, points: 1 },
    });
  }

  // ── The science book: real curriculum content, from data ────────────────
  // Nine units of the Yemeni G07 science book (Part 1) — authored as JSON in
  // prisma/seed/data/textbooks/, because a real book is data. This is also
  // the load-bearing demo of the data-driven path: units, lessons, concepts,
  // two questions per concept, misconceptions with remediation, prerequisite
  // chains, lesson readings and a unit assessment all arrive in one walk.
  const science = await seedTextbookFromSpec(
    prisma,
    {
      termId: term.id,
      termKey: term.key,
      academicYearId: year.id,
      schoolId: school.id,
    },
    readTextbookSpec('science-g07.json'),
  );
  console.log(
    `  science    ${science.units} units, ${science.lessons} lessons, ` +
      `${science.concepts} concepts, ${science.questions} questions, ` +
      `${science.misconceptions} misconceptions, ${science.resources} resources`,
  );

  // ── G04 Arabic textbook (curriculum template JSON spec) ───────────────
  try {
    const templateBook = await seedTextbookFromSpec(
      prisma,
      {
        termId: term.id,
        termKey: term.key,
        academicYearId: year.id,
        schoolId: school.id,
      },
      readTextbookSpec('curriculum-template.json'),
    );
    console.log(
      `  template   ${templateBook.units} units, ${templateBook.lessons} lessons, ` +
        `${templateBook.concepts} concepts, ${templateBook.questions} questions, ` +
        `${templateBook.misconceptions} misconceptions, ${templateBook.resources} resources`,
    );
  } catch (templateErr) {
    console.warn('  template seed warning:', templateErr);
  }

  // ── Yemeni Ministry/Telegram textbook source catalogue ────────────────
  // These are PDF source attachments grouped by subject, grade and term.
  // They feed the content database without pretending that a raw PDF is a
  // vetted adaptive lesson map; reviewers can then extract units/questions
  // through the normal content-package and item-bank workflows.
  const yemenSources = await seedYemenSourceCatalog(
    prisma,
    readYemenSourceCatalog(),
    { academicYearKey: foundation.currentYearKey },
  );
  console.log(
    `  sources    ${yemenSources.resourcesTouched}/${yemenSources.sources} PDFs attached, ` +
      `${yemenSources.textbooksTouched} textbook coordinate(s), ${yemenSources.skipped} skipped`,
  );

  // ── Grounding content for the AI tutor ──────────────────────────────────
  const page = await prisma.textbookPage.upsert({
    where: { textbookId_pageNumber: { textbookId: textbook.id, pageNumber: 9 } },
    create: {
      textbookId: textbook.id,
      pageNumber: 9,
      text: 'المجموعة هي تجمع من الأشياء المحددة تحديداً تاماً، وتسمى الأشياء التي تتكون منها المجموعة عناصر المجموعة.',
    },
    update: {},
  });

  await prisma.contentChunk.upsert({
    where: { key: `${lKey}-CH01` },
    create: {
      key: `${lKey}-CH01`,
      pageId: page.id,
      lessonKey: lKey,
      conceptKey: concepts[0]!.key,
      text: 'المجموعة هي تجمع من الأشياء المحددة تحديداً تاماً. وتسمى الأشياء التي تتكون منها المجموعة عناصر المجموعة. ويشترط في المجموعة أن يكون تحديد عناصرها واضحاً لا لبس فيه.',
      ordinal: 1,
    },
    update: {},
  });

  await prisma.learningResource.upsert({
    where: { key: `${concepts[0]!.key}-RES01` },
    create: {
      key: `${concepts[0]!.key}-RES01`,
      slug: 'قراءة-تعريف-المجموعة',
      orderIndex: 1,
      kind: 'READING',
      title: 'قراءة: تعريف المجموعة',
      textbookId: textbook.id,
      conceptId: concepts[0]!.id,
      pageStart: 9,
      pageEnd: 10,
      estimatedMins: 10,
    },
    update: {},
  });

  await prisma.learningResource.upsert({
    where: { key: `${concepts[0]!.key}-RES02` },
    create: {
      key: `${concepts[0]!.key}-RES02`,
      slug: 'علاج-متى-يكون-التجمع-مجموعة',
      orderIndex: 2,
      kind: 'REMEDIAL',
      title: 'علاج: متى يكون التجمع مجموعة؟',
      body: 'راجع الفرق بين التجمع المحدد تحديداً تاماً والتجمع القائم على التفضيل.',
      conceptId: concepts[0]!.id,
      estimatedMins: 5,
    },
    update: {},
  });

  // ── Demo accounts (data-driven) ─────────────────────────────────────────
  // Accounts, role grants, learner profiles, guardian links and enrollments
  // all come from prisma/seed/data/demo-users.json.
  //
  // SYSTEM_ADMIN and SCHOOL_ADMIN are separate accounts there, and that is the
  // point: the platform-wide grant carries schoolId null, the school grant
  // does not. The previous hand-written block gave every account a school,
  // including CONTENT_AUTHOR, which silently stripped its platform reach.
  const accounts = await seedDemoAccounts(
    prisma,
    (plain) => new BcryptPasswordHasher().hash(plain),
    { currentYearKey: foundation.currentYearKey, firstTermKey: foundation.firstTermKey },
  );
  console.log(
    `  accounts   ${accounts.report.users} users, ${accounts.report.roleGrants} role grants, ` +
      `${accounts.report.learners} learners, ${accounts.report.educators} educator(s), ` +
      `${accounts.report.guardianLinks} guardian link(s)`,
  );

  // The demo learner, re-read so the evidence history below can attach to it.
  const learner = await prisma.learnerProfile.findUniqueOrThrow({
    where: { key: 'lrn_demo_student' },
  });

  // Evidence: C01 mastered, C02 shaky, C03 untouched. That state deliberately
  // produces a PRACTISE decision on C02 rather than letting the learner run
  // ahead to the locked C03.
  await prisma.masteryEvidence.deleteMany({ where: { learnerId: learner.id } });
  const base = new Date();
  base.setDate(base.getDate() - 10);

  const history: { concept: (typeof concepts)[number]; correct: boolean; dayOffset: number }[] = [
    { concept: concepts[0]!, correct: true, dayOffset: 0 },
    { concept: concepts[0]!, correct: true, dayOffset: 1 },
    { concept: concepts[0]!, correct: false, dayOffset: 2 },
    { concept: concepts[0]!, correct: true, dayOffset: 3 },
    { concept: concepts[0]!, correct: true, dayOffset: 4 },
    { concept: concepts[0]!, correct: true, dayOffset: 5 },
    { concept: concepts[1]!, correct: false, dayOffset: 6 },
    { concept: concepts[1]!, correct: true, dayOffset: 7 },
    { concept: concepts[1]!, correct: false, dayOffset: 8 },
  ];

  for (const [i, h] of history.entries()) {
    const at = new Date(base);
    at.setDate(at.getDate() + h.dayOffset);
    await prisma.masteryEvidence.create({
      data: {
        learnerId: learner.id,
        conceptId: h.concept.id,
        questionKey: `${h.concept.key}-Q${String(i + 1).padStart(3, '0')}`,
        isCorrect: h.correct,
        weight: 1,
        verdict: h.correct ? 'CORRECT' : 'INCORRECT',
        observedAt: at,
      },
    });
  }

  // Materialise mastery from that evidence.
  //
  // Through the canonical use case, never with a direct write: mastery has
  // exactly one write path and a seed that bypassed it would be the fifth
  // writer this architecture exists to prevent. It is also how the seeded
  // state stays honest — the numbers are whatever the real BKT replay says
  // they are, not whatever looked plausible when the seed was written.
  const recompute = new RecomputeMasteryUseCase(
    new PrismaEvidenceReader(prisma),
    new PrismaMasteryRepository(prisma),
    new PrismaConceptMasteryPolicy(prisma),
    systemClock,
  );
  const recomputed = await recompute.execute({ learnerKey: learner.key });

  console.log('[seed] done:');
  console.log(`  textbook   ${tbKey}`);
  console.log(`  concepts   ${concepts.map((c) => c.key.split('-').pop()).join(', ')}`);
  console.log(`  logins     all with password "${accounts.password}":`);
  console.log('             superadmin (SYSTEM_ADMIN, platform-wide, no school)');
  console.log('             admin      (SCHOOL_ADMIN, sch_demo only)');
  console.log('             author, reviewer, teacher, student, ahmed, sara, parent');
  console.log(`  evidence   ${history.length} observations`);
  console.log(
    `  mastery    ${recomputed.ok ? recomputed.value.length : 0} concepts materialised`,
  );
  console.log('  next: run the API, then GET /api/v1/learning/next-step');
}

main()
  .catch((err) => {
    // A connection fault gets a plain explanation instead of a Prisma stack
    // whose error code names the wrong cause. Anything else is printed in
    // full: an unrecognised failure must not be softened into a friendly
    // message that hides it.
    if (reportConnectionError(err, (line) => console.error(`[seed] ${line}`))) {
      process.exit(1);
    }
    console.error('[seed] failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
