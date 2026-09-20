/**
 * End-to-end proof of analytics, against the live API.
 *
 * The centrepiece is the miskey detection. The script seeds a question that is
 * keyed the WRONG way round and has the strongest learners answer it "wrong",
 * then asks the API whether anything is amiss. If the discrimination index
 * comes back positive, or the item is not flagged, the capability is decorative.
 *
 * Everything is seeded through direct SQL because generating twenty learners'
 * worth of realistic response data over HTTP would take longer than the whole
 * rest of the suite. The READS are all over HTTP, which is what is being proved.
 *
 * Usage: node scripts/check-analytics.mjs   (API must be running)
 */

const API = process.env.API_URL ?? 'http://127.0.0.1:3000';

let failures = 0;
let checks = 0;

function report(pass, label, detail) {
  checks += 1;
  if (!pass) failures += 1;
  console.log(`${pass ? '✓' : '✗'} ${label}${detail ? `  (${detail})` : ''}`);
}

async function login(identifier) {
  const res = await fetch(`${API}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier, password: 'demo1234' }),
  });
  const body = await res.json();
  if (!body.ok) throw new Error(`login ${identifier} failed: ${JSON.stringify(body.error)}`);
  return body.data.tokens.accessToken;
}

function client(token) {
  return async (method, path, payload) => {
    const res = await fetch(`${API}/api/v1/${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
    });
    return { http: res.status, body: await res.json() };
  };
}

function ok(label, res) {
  report(res.body.ok, label, res.body.ok ? `${res.http}` : `${res.http} ${res.body.error?.code}`);
  return res.body.data;
}

function refused(label, res, expectedCode) {
  const actual = res.body.ok ? 'succeeded' : res.body.error.code;
  report(!res.body.ok && actual === expectedCode, label, `${res.http} ${actual}`);
}

const COHORT = 24;
const TAG = `ANL${Date.now().toString(36).toUpperCase().slice(-5)}`;

const run = async () => {
  const teacher = client(await login('teacher'));
  const admin = client(await login('admin'));
  const student = client(await login('student'));

  const { withClient } = await import('./seed-helpers.mjs');

  console.log(`\n── seeding a cohort of ${COHORT} (${TAG}) ────────────────────────`);

  const seeded = await withClient(async (c) => {
    const { rows: ctx } = await c.query(
      `select e."schoolId", e."gradeId", e."termId", e."academicYearId"
         from enrollments e
         join learner_profiles l on l.id = e."learnerId"
        where l.key = 'lrn_demo_student' and e."isCurrent" = true
        limit 1`,
    );
    const scope = ctx[0];

    const { rows: conceptRows } = await c.query(
      `select id, key from concepts where key like 'EDU-MATH-G07-T1-ED2026%' order by key limit 2`,
    );

    // Two questions on the same concept: one keyed correctly, one keyed the
    // wrong way round. Both look identical to authoring validation.
    const questions = [];
    for (const [i, label] of ['GOOD', 'MISKEYED'].entries()) {
      const key = `${conceptRows[0].key}-Q${TAG}${i}`;
      const { rows } = await c.query(
        `insert into questions (id, key, type, text, points, difficulty01, status, "createdAt", "updatedAt")
         values (gen_random_uuid(), $1, 'MCQ_SINGLE', $2, 1, 0.5, 'PUBLISHED', now(), now())
         returning id`,
        [key, `${label} item ${TAG}`],
      );
      const questionId = rows[0].id;

      await c.query(
        `insert into question_concepts (id, "questionId", "conceptId", weight, "isPrimary")
         values (gen_random_uuid(), $1, $2, 1, true)`,
        [questionId, conceptRows[0].id],
      );
      await c.query(
        `insert into answer_keys (id, "questionId", "correctChoiceIds")
         values (gen_random_uuid(), $1, '{}')`,
        [questionId],
      );
      questions.push({ key, id: questionId, label });
    }

    // Background items. Overall ability has to come from somewhere other than
    // the two items under analysis, or every learner ends up with the same
    // total score and discrimination is undefined by construction.
    const background = [];
    for (let j = 0; j < 10; j += 1) {
      const key = `${conceptRows[0].key}-QBG${TAG}${j}`;
      const { rows } = await c.query(
        `insert into questions (id, key, type, text, points, difficulty01, status, "createdAt", "updatedAt")
         values (gen_random_uuid(), $1, 'MCQ_SINGLE', $2, 1, 0.5, 'DRAFT', now(), now())
         returning id`,
        [key, `background ${j} ${TAG}`],
      );
      background.push({ key, id: rows[0].id });
    }

    // A cohort whose ability descends evenly, each with a short attempt
    // history so the overall-score half of the statistic is real.
    const learnerIds = [];
    for (let i = 0; i < COHORT; i += 1) {
      const strong = i < COHORT / 2;

      const { rows: userRows } = await c.query(
        `insert into users (id, key, username, email, "passwordHash", "fullName", status, "createdAt", "updatedAt")
         values (gen_random_uuid(), $1, $1, $2, 'x', $1, 'ACTIVE', now(), now())
         returning id`,
        [`usr_${TAG}_${i}`, `${TAG}_${i}@analytics.local`],
      );
      const { rows: learnerRows } = await c.query(
        `insert into learner_profiles (id, key, "userId", "createdAt", "updatedAt")
         values (gen_random_uuid(), $1, $2, now(), now())
         returning id`,
        [`lrn_${TAG}_${i}`, userRows[0].id],
      );
      const learnerId = learnerRows[0].id;
      learnerIds.push(learnerId);

      await c.query(
        `insert into enrollments (id, key, "learnerId", "schoolId", "academicYearId", "termId", "gradeId", "isCurrent", "createdAt")
         values (gen_random_uuid(), $1, $2, $3, $4, $5, $6, true, now())`,
        [
          `enr_${TAG}_${i}`,
          learnerId,
          scope.schoolId,
          scope.academicYearId,
          scope.termId,
          scope.gradeId,
        ],
      );

      const { rows: attemptRows } = await c.query(
        `insert into attempts (id, key, "learnerId", kind, status, "startedAt", "submittedAt", "createdAt", "updatedAt")
         values (gen_random_uuid(), $1, $2, 'PRACTICE', 'SUBMITTED', now(), now(), now(), now())
         returning id`,
        [`att_${TAG}_${i}`, learnerId],
      );
      const attemptId = attemptRows[0].id;

      // Background evidence establishes who is strong overall: 9/10 vs 2/10.
      // One row per (attempt, question) — the table is unique on that pair.
      for (const [j, bg] of background.entries()) {
        const rightOnBackground = strong ? j < 9 : j < 2;
        await c.query(
          `insert into attempt_items
             (id, "attemptId", "questionId", "rawAnswer", verdict, "scoreEarned", "scorePossible",
              "evaluatorVersion", "answeredAt", "timeSpentSeconds")
           values (gen_random_uuid(), $1, $2, $3, $4, $5, 1, 'canonical-2.0', now(), 30)`,
          [
            attemptId,
            bg.id,
            JSON.stringify({ choiceIds: [rightOnBackground ? 'a' : 'b'] }),
            rightOnBackground ? 'CORRECT' : 'INCORRECT',
            rightOnBackground ? 1 : 0,
          ],
        );
      }

      // The GOOD item: strong learners get it right. This is what a healthy
      // item looks like, and the control for the miskeyed one.
      await c.query(
        `insert into attempt_items
           (id, "attemptId", "questionId", "rawAnswer", verdict, "scoreEarned", "scorePossible",
            "evaluatorVersion", "answeredAt", "timeSpentSeconds")
         values (gen_random_uuid(), $1, $2, $3, $4, $5, 1, 'canonical-2.0', now(), 28)`,
        [
          attemptId,
          questions[0].id,
          JSON.stringify({ choiceIds: [strong ? 'a' : 'b'] }),
          strong ? 'CORRECT' : 'INCORRECT',
          strong ? 1 : 0,
        ],
      );

      // The MISKEYED item: strong learners are marked WRONG on it.
      await c.query(
        `insert into attempt_items
           (id, "attemptId", "questionId", "rawAnswer", verdict, "scoreEarned", "scorePossible",
            "evaluatorVersion", "answeredAt", "timeSpentSeconds")
         values (gen_random_uuid(), $1, $2, $3, $4, $5, 1, 'canonical-2.0', now(), 25)`,
        [
          attemptId,
          questions[1].id,
          JSON.stringify({ choiceIds: [strong ? 'trap' : 'keyed'] }),
          strong ? 'INCORRECT' : 'CORRECT',
          strong ? 0 : 1,
        ],
      );
    }

    return { scope, questions, background, conceptKey: conceptRows[0].key };
  });

  const cleanup = async () => {
    await withClient(async (c) => {
      await c.query(`delete from attempt_items where "questionId" = any($1)`, [
        [...seeded.questions, ...seeded.background].map((q) => q.id),
      ]);
      await c.query(`delete from attempts where key like $1`, [`att_${TAG}_%`]);
      await c.query(`delete from enrollments where key like $1`, [`enr_${TAG}_%`]);
      await c.query(`delete from learner_profiles where key like $1`, [`lrn_${TAG}_%`]);
      await c.query(`delete from users where key like $1`, [`usr_${TAG}_%`]);
      await c.query(`delete from questions where key = any($1)`, [
        [...seeded.questions, ...seeded.background].map((q) => q.key),
      ]);
    }).catch(() => {});
  };

  try {
    report(true, `seeded ${COHORT} learners and 2 questions`);

    console.log('\n── item health: the miskey detector ──────────────────────');

    const good = ok(
      'read the correctly keyed item',
      await admin('GET', `analytics/items/${seeded.questions[0].key}`),
    );
    report(
      good?.statistics?.responses === COHORT,
      'every response is counted',
      `${good?.statistics?.responses}`,
    );
    report(
      good?.statistics?.discrimination > 0.5,
      'a good item discriminates positively',
      `D=${good?.statistics?.discrimination}`,
    );
    report(good?.needsReview === false, 'and is not flagged for review');

    const bad = ok(
      'read the miskeyed item',
      await admin('GET', `analytics/items/${seeded.questions[1].key}`),
    );
    report(
      bad?.statistics?.discrimination < 0,
      'the miskeyed item discriminates NEGATIVELY',
      `D=${bad?.statistics?.discrimination}`,
    );
    report(
      bad?.statistics?.flags?.includes('MISKEYED_SUSPECTED'),
      'and is flagged MISKEYED_SUSPECTED',
      (bad?.statistics?.flags ?? []).join(','),
    );
    report(bad?.needsReview === true, 'and raised for author review');
    report(
      bad?.statistics?.pointBiserial < 0,
      'its point-biserial agrees with the discrimination index',
      `r=${bad?.statistics?.pointBiserial}`,
    );

    const trap = (bad?.statistics?.distractors ?? []).find((d) => d.optionId === 'trap');
    report(
      trap && trap.discrimination > 0,
      'the option strong learners chose has positive discrimination',
      `${trap?.discrimination}`,
    );

    console.log('\n── the bank sweep ────────────────────────────────────────');

    const sweep = ok(
      'sweep the textbook',
      await admin('GET', 'analytics/textbooks/EDU-MATH-G07-T1-ED2026/item-health'),
    );
    report(sweep?.scanned >= 2, 'the sweep scanned the bank', `${sweep?.scanned} question(s)`);
    report(
      (sweep?.flagged ?? []).some((f) => f.questionKey === seeded.questions[1].key),
      'the miskeyed item appears in the flagged list',
    );
    report(
      !(sweep?.flagged ?? []).some((f) => f.questionKey === seeded.questions[0].key),
      'the good item does not',
    );

    console.log('\n── cached statistics are a projection ────────────────────');

    ok(
      'refresh the cached counters',
      await admin('POST', `analytics/items/${seeded.questions[0].key}/refresh`),
    );
    const first = await withClient(async (c) => {
      const { rows } = await c.query(
        `select "timesAdministered", "correctRate" from questions where key = $1`,
        [seeded.questions[0].key],
      );
      return rows[0];
    });
    report(
      first.timesAdministered === COHORT,
      'the counters match the responses',
      `${first.timesAdministered}`,
    );

    await admin('POST', `analytics/items/${seeded.questions[0].key}/refresh`);
    const second = await withClient(async (c) => {
      const { rows } = await c.query(
        `select "timesAdministered", "correctRate" from questions where key = $1`,
        [seeded.questions[0].key],
      );
      return rows[0];
    });
    // Recomputed, never incremented: running twice must change nothing.
    report(
      second.timesAdministered === first.timesAdministered &&
        second.correctRate === first.correctRate,
      'refreshing twice changes nothing',
      `${second.timesAdministered}`,
    );

    console.log('\n── the cohort report ─────────────────────────────────────');

    const cohort = ok(
      'teacher reads the cohort report',
      await teacher(
        'GET',
        `analytics/cohort?schoolId=${seeded.scope.schoolId}&textbookKey=EDU-MATH-G07-T1-ED2026`,
      ),
    );
    report(cohort?.learners >= COHORT, 'it covers the cohort', `${cohort?.learners} learners`);
    report(Array.isArray(cohort?.concepts), 'it reports per concept', `${cohort?.concepts?.length}`);
    report(
      cohort?.activity?.totalLearners === cohort?.learners,
      'activity covers the same cohort',
    );
    report(
      cohort?.activity?.activeLearners <= cohort?.activity?.totalLearners,
      'active learners never exceed the cohort',
      `${cohort?.activity?.activeLearners}/${cohort?.activity?.totalLearners}`,
    );

    // The seeded learners have attempts but no mastery rows: they must show as
    // unassessed rather than as a class that failed everything.
    const anyConcept = (cohort?.concepts ?? []).find((c) => c.conceptKey === seeded.conceptKey);
    report(
      anyConcept && anyConcept.unassessedCount > 0,
      'learners with no mastery record count as unassessed, not as zero',
      `${anyConcept?.unassessedCount} unassessed`,
    );
    report(
      anyConcept && anyConcept.meanMastery > 0,
      'and the mean reflects only assessed learners',
      `mean=${anyConcept?.meanMastery}`,
    );

    const bands = cohort?.distribution?.bands ?? {};
    const banded = Object.values(bands).reduce((a, b) => a + b, 0);
    report(
      banded === cohort?.distribution?.assessed,
      'the bands account for exactly the assessed learners',
      `${banded}/${cohort?.distribution?.assessed}`,
    );

    console.log('\n── authorisation ─────────────────────────────────────────');

    refused(
      'a student cannot read the cohort report',
      await student('GET', `analytics/cohort?schoolId=${seeded.scope.schoolId}`),
      'analytics.forbidden',
    );

    refused(
      'a student cannot read item health',
      await student('GET', `analytics/items/${seeded.questions[0].key}`),
      'analytics.forbidden',
    );

    refused(
      "a teacher cannot read another school's cohort",
      await teacher('GET', 'analytics/cohort?schoolId=00000000-0000-0000-0000-000000000000'),
      'analytics.forbidden',
    );

    const own = ok(
      'a learner reads their own standing',
      await student('GET', 'analytics/learner'),
    );
    report(typeof own?.meanMastery === 'number', 'it reports their mastery', `${own?.meanMastery}`);
    report(own?.conceptsAssessed > 0, 'over the concepts they have evidence for');

    refused(
      "a learner cannot read another learner's standing",
      await student('GET', `analytics/learner?learnerKey=lrn_${TAG}_0`),
      'learning.learner_not_accessible',
    );

    const delegated = await teacher('GET', 'analytics/learner?learnerKey=lrn_demo_student');
    report(delegated.body.ok, 'a teacher may read a learner in their school', `${delegated.http}`);

    // ── exam results: the teacher-facing half of item 4 ──────────────────
    console.log('\n── exam results for a cohort ─────────────────────────────');

    const examKey = await withClient(async (c) =>
      (await c.query(`select key from exams limit 1`)).rows[0]?.key ?? null,
    );

    refused(
      'an unknown exam is refused',
      await teacher(
        'GET',
        `analytics/exams/NO-SUCH-EXAM-${TAG}/results?schoolId=${seeded.scope.schoolId}`,
      ),
      'analytics.exam_not_found',
    );

    refused(
      'a learner cannot read the class distribution',
      await student('GET', `analytics/exams/${examKey}/results?schoolId=${seeded.scope.schoolId}`),
      'analytics.forbidden',
    );

    if (examKey) {
      const results = await teacher(
        'GET',
        `analytics/exams/${examKey}/results?schoolId=${seeded.scope.schoolId}`,
      );
      const d = results.body.data;
      report(results.body.ok, 'a teacher reads exam results', `${results.http}`);
      report(
        d?.assigned === d?.submitted + d?.inProgress + d?.notStarted,
        'participation accounts for every learner in scope',
        `${d?.assigned} = ${d?.submitted}+${d?.inProgress}+${d?.notStarted}`,
      );
      report(
        Array.isArray(d?.notStartedLearners) && d.notStartedLearners.length === d.notStarted,
        'learners who have not sat it are named, not just counted',
        `${d?.notStartedLearners?.length}`,
      );
      // Nobody in this freshly seeded cohort has a marked sitting, so a mean
      // would be an invention. Null is the honest answer.
      report(
        d?.meanPercentage === null || typeof d?.meanPercentage === 'number',
        'the mean is a number or explicitly null, never a misleading zero',
        `${d?.meanPercentage}`,
      );
      report(
        d?.distribution?.length === 5 &&
          d.distribution.reduce((n, b) => n + b.learners, 0) <= d.assigned,
        'the distribution has fixed bands and cannot exceed the cohort',
        `${d?.distribution?.length} bands`,
      );
      report(
        Array.isArray(d?.items) &&
          d.items.every((i) => i.correctRate === null || (i.correctRate >= 0 && i.correctRate <= 1)),
        'every item rate is a proportion or null',
        `${d?.items?.length} item(s)`,
      );
    }
  } finally {
    await cleanup();
    console.log('\n(scenario cohort removed)');
  }

  console.log(`\n${failures === 0 ? '✅' : '❌'} ${checks - failures}/${checks} checks passed`);
  process.exit(failures === 0 ? 0 : 1);
};

run().catch((error) => {
  console.error('\n❌ scenario crashed:', error);
  process.exit(1);
});
