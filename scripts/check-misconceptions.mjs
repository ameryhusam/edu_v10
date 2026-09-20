/**
 * End-to-end proof that misconception state is produced by the PRODUCTION path.
 *
 * This script exists because of a specific defect. `learner_misconceptions` was
 * read in two places — the REMEDIATE branch of next-step, and the MISCONCEPTION
 * remediation trigger — and written in none. The only thing that had ever
 * inserted a row was raw SQL inside `check-remediation.mjs`, which meant the
 * remediation suite was asserting against data it had planted itself. The
 * capability looked green and could not work in production.
 *
 * So the one rule governing this file: **it never inserts into
 * `learner_misconceptions`.** Everything is authored and answered over HTTP,
 * and SQL is used only to read state back and to clean up. If the promotion
 * path regresses, these checks go red — which is exactly what the previous
 * arrangement could not do.
 *
 * The flow under test:
 *   author a concept + a question whose distractor carries a misconception
 *     → learner answers with that distractor (HTTP)
 *     → recompute promotes it to learner_misconceptions (production code)
 *     → the remediation trigger can now see it and opens an episode
 *     → learner recovers → state clears, derived, with nobody asserting it
 *
 * Usage: node scripts/check-misconceptions.mjs   (API must be running)
 */

import { withClient } from './seed-helpers.mjs';

const API = process.env.API_URL ?? 'http://127.0.0.1:3000';
const TAG = 'MISCHK';

let failures = 0;
let checks = 0;

/** The textbook this run created, and how to remove it. */
let fixture = null;

function registerFixture(textbookKey, drop) {
  fixture = { textbookKey, drop };
}

async function dropFixture() {
  if (!fixture) return;
  const { textbookKey, drop } = fixture;
  fixture = null;
  await drop(textbookKey).catch(() => {});
}

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

/** Read the learner's misconception state. READ ONLY — never inserts. */
async function readState(learnerKey) {
  return withClient(async (c) => {
    const { rows } = await c.query(
      `select m.key         as misconception_key,
              con.key       as concept_key,
              lm.occurrences,
              lm.confidence,
              lm."isResolved" as is_resolved,
              lm."resolvedAt" as resolved_at,
              lm."firstSeenAt" as first_seen_at
         from learner_misconceptions lm
         join learner_profiles lp on lp.id = lm."learnerId"
         join concepts con        on con.id = lm."conceptId"
         left join misconceptions m on m.id = lm."misconceptionId"
        where lp.key = $1
        order by m.key`,
      [learnerKey],
    );
    return rows;
  });
}

async function runScenario() {
  console.log('\n— misconception promotion (production path only) —\n');

  const [authorToken, adminToken, studentToken] = [
    await login('author'),
    await login('admin'),
    await login('student'),
  ];
  const author = client(authorToken);
  const admin = client(adminToken);
  const student = client(studentToken);

  const learnerKey = 'lrn_demo_student';

  const { createTextbook, dropTextbook } = await import('./seed-helpers.mjs');

  // A fresh textbook of our own. The seeded one is PUBLISHED, and its question
  // bank is therefore closed — correctly, by the publish lock this project
  // enforces at the write path. Authoring into it would be the test asking the
  // system to break its own rule.
  const stamp = Date.now().toString(36).toUpperCase().slice(-6);
  const TB = `EDU-MATH-G07-T1-ED${stamp}`;
  await createTextbook(TB, stamp);

  // Awaited explicitly in a finally block below. A `process.on('exit')` handler
  // cannot await, so the drop it schedules never runs — which is how four
  // orphan textbooks accumulated before this was noticed.
  registerFixture(TB, dropTextbook);

  const unit = (await author('POST', 'content/units', { textbookKey: TB, name: 'Sets' })).body.data;
  const lesson = (
    await author('POST', 'content/lessons', { unitKey: unit.key, name: 'Subsets' })
  ).body.data;
  const concept = (
    await author('POST', 'content/concepts', { lessonKey: lesson.key, name: 'Subset' })
  ).body.data;

  const conceptKey = concept.key;
  const lessonKey = lesson.key;

  // A misconception to diagnose. Catalogue data with no HTTP surface in this
  // gate, so it is seeded directly — the same exemption `createTextbook` takes.
  // Note what is NOT seeded: any row in `learner_misconceptions`. That table is
  // the thing under test and must be written by production code alone.
  const misconceptionKey = `${conceptKey}-MIS-${TAG}`;
  await withClient(async (c) => {
    const { rows } = await c.query(`select id from concepts where key = $1`, [conceptKey]);
    await c.query(
      `insert into misconceptions (id, key, "conceptId", name, description)
       values (gen_random_uuid(), $1, $2, $3, $4)
       on conflict (key) do nothing`,
      [misconceptionKey, rows[0].id, `Confuses subset with element (${TAG})`, 'Test fixture.'],
    );
  });

  // Snapshot prior rows so cleanup removes only what this run causes.
  const before = await withClient(async (c) => {
    const { rows } = await c.query(
      `select lm.id from learner_misconceptions lm
         join learner_profiles lp on lp.id = lm."learnerId" where lp.key = $1`,
      [learnerKey],
    );
    return new Set(rows.map((r) => r.id));
  });
  const evidenceBefore = await withClient(async (c) => {
    const { rows } = await c.query(
      `select me.id from mastery_evidence me
         join learner_profiles lp on lp.id = me."learnerId" where lp.key = $1`,
      [learnerKey],
    );
    return new Set(rows.map((r) => r.id));
  });

  // ── The question, authored over HTTP ─────────────────────────────────────

  const created = await author('POST', 'content/questions', {
    type: 'MCQ_SINGLE',
    text: `Which of these is a subset of {1,2,3}? (${TAG})`,
    choices: [
      { id: 'a', text: '{1, 2}' },
      // The diagnostic distractor: choosing it implies the wrong model.
      { id: 'b', text: '1', misconceptionKey },
      { id: 'c', text: '{4}' },
    ],
    answerKey: { correctChoiceIds: ['a'] },
    concepts: [{ conceptKey, weight: 1, isPrimary: true }],
  });

  report(
    created.body.ok,
    'a question with a diagnostic distractor is authored over HTTP',
    created.body.ok ? undefined : JSON.stringify(created.body.error),
  );
  if (!created.body.ok) return;

  const questionKey = created.body.data.key ?? created.body.data.question?.key;

  await author('POST', `content/questions/${questionKey}/transitions`, { action: 'SUBMIT' });
  const published = await admin('POST', `content/questions/${questionKey}/transitions`, {
    action: 'APPROVE',
  });
  report(
    published.body.ok && published.body.data?.status === 'PUBLISHED',
    'the question is published by a different actor than its author',
    published.body.data?.status ?? JSON.stringify(published.body.error),
  );

  // Recovery questions are authored NOW, before the textbook is published.
  // The publish lock closes the question bank on approval — correctly — so
  // everything this scenario needs must exist while the book is still a draft.
  const recoveryKeys = [];
  for (let i = 0; i < 2; i += 1) {
    const q = await author('POST', 'content/questions', {
      type: 'MCQ_SINGLE',
      text: `Recovery check ${i} (${TAG})`,
      choices: [
        { id: 'a', text: '{1, 2}' },
        { id: 'b', text: '5' },
      ],
      answerKey: { correctChoiceIds: ['a'] },
      concepts: [{ conceptKey, weight: 1, isPrimary: true }],
    });
    if (!q.body.ok) break;
    const key = q.body.data.key;
    await author('POST', `content/questions/${key}/transitions`, { action: 'SUBMIT' });
    await admin('POST', `content/questions/${key}/transitions`, { action: 'APPROVE' });
    recoveryKeys.push(key);
  }


  // The lesson must be reachable by a learner, which means the textbook has to
  // be published too.
  await author('POST', 'content/transitions', { textbookKey: TB, action: 'SUBMIT' });
  const tbPublished = await admin('POST', 'content/transitions', {
    textbookKey: TB,
    action: 'APPROVE',
  });
  report(tbPublished.body.ok, 'the textbook is published so the learner can reach the lesson');

  // ── The learner answers with the diagnostic distractor ───────────────────

  const attempt = await student('POST', 'assessment/attempts', {
    kind: 'PRACTICE',
    lessonKey,
  });
  report(attempt.body.ok, 'the learner starts a practice attempt');
  if (!attempt.body.ok) {
    console.log('   ', JSON.stringify(attempt.body.error));
    return;
  }
  const attemptKey = attempt.body.data.key ?? attempt.body.data.attempt?.key;

  // The served choice id, not the author's handle.
  const servedChoiceId = await withClient(async (c) => {
    const { rows } = await c.query(
      `select qc.id from question_choices qc
         join questions q on q.id = qc."questionId"
         join misconceptions m on m.id = qc."misconceptionId"
        where q.key = $1 and m.key = $2`,
      [questionKey, misconceptionKey],
    );
    return rows[0]?.id;
  });

  const answered = await student('POST', 'assessment/answers', {
    attemptKey,
    questionKey,
    answer: { choiceIds: [servedChoiceId] },
  });
  report(
    answered.body.ok,
    'the learner answers with the misconception distractor',
    answered.body.ok ? undefined : JSON.stringify(answered.body.error),
  );

  // ── The claim under test ─────────────────────────────────────────────────

  const evidenceRow = await withClient(async (c) => {
    const { rows } = await c.query(
      `select me."misconceptionKey" from mastery_evidence me
         join learner_profiles lp on lp.id = me."learnerId"
        where lp.key = $1 and me."questionKey" = $2`,
      [learnerKey, questionKey],
    );
    return rows[0];
  });
  report(
    evidenceRow?.misconceptionKey === misconceptionKey,
    'the diagnosis is recorded on the evidence row',
    evidenceRow?.misconceptionKey ?? 'none',
  );

  let state = await readState(learnerKey);
  let mine = state.find((r) => r.misconception_key === misconceptionKey);

  report(
    mine != null,
    'THE DEFECT: evidence is promoted to learner_misconceptions by the API alone',
    mine ? `occurrences=${mine.occurrences}` : 'NO ROW — promotion did not happen',
  );
  report(mine?.is_resolved === false, 'the new state is open, not resolved');
  report(Number(mine?.occurrences) === 1, 'a single sighting counts once');

  // Idempotence: re-running the recompute must not inflate the count. The
  // remediation refresh endpoint recomputes as a side effect.
  await student('POST', 'remediation/refresh', {});
  await student('POST', 'remediation/refresh', {});
  state = await readState(learnerKey);
  mine = state.find((r) => r.misconception_key === misconceptionKey);
  report(
    Number(mine?.occurrences) === 1,
    'replaying the recompute does not inflate occurrences',
    `occurrences=${mine?.occurrences}`,
  );

  const confidenceAfterReplay = Number(mine?.confidence);

  // ── The consumer that was dead: the remediation trigger ──────────────────

  const episodes = await student('GET', 'remediation/episodes');
  const opened =
    episodes.body.ok &&
    (episodes.body.data.episodes ?? episodes.body.data ?? []).some?.(
      (e) => e.misconceptionKey === misconceptionKey,
    );
  report(
    opened === true,
    'the MISCONCEPTION remediation trigger can now fire — it never could before',
    opened ? undefined : JSON.stringify(episodes.body.data)?.slice(0, 160),
  );

  // ── Recovery clears it, derived and unasserted ───────────────────────────

  const correctChoiceId = await withClient(async (c) => {
    const { rows } = await c.query(
      `select qc.id from question_choices qc
         join questions q on q.id = qc."questionId"
         join answer_keys ak on ak."questionId" = q.id
        where q.key = $1 and qc.id::text = any(ak."correctChoiceIds")`,
      [questionKey],
    );
    return rows[0]?.id;
  });

  // Two further correct answers on the concept clear the state. They must be
  // DIFFERENT questions: one attempt cannot answer the same question twice
  // (`assessment.question_already_answered`), and re-answering is not how a
  // learner demonstrates recovery anyway.
  for (const key of recoveryKeys) {
    const correctId = await withClient(async (c) => {
      const { rows } = await c.query(
        `select qc.id from question_choices qc
           join questions q on q.id = qc."questionId"
           join answer_keys ak on ak."questionId" = q.id
          where q.key = $1 and qc.id::text = any(ak."correctChoiceIds")`,
        [key],
      );
      return rows[0]?.id;
    });

    const a = await student('POST', 'assessment/attempts', { kind: 'PRACTICE', lessonKey });
    if (!a.body.ok) break;
    await student('POST', 'assessment/answers', {
      attemptKey: a.body.data.key ?? a.body.data.attempt?.key,
      questionKey: key,
      answer: { choiceIds: [correctId] },
    });
  }

  state = await readState(learnerKey);
  mine = state.find((r) => r.misconception_key === misconceptionKey);

  report(
    mine?.is_resolved === true,
    'recovery clears the state — derived from evidence, asserted by nobody',
    `isResolved=${mine?.is_resolved}`,
  );
  report(
    mine != null && mine.first_seen_at != null,
    'the resolved row is kept, so "how long did they hold it?" stays answerable',
  );
  report(
    Number(mine?.confidence) === confidenceAfterReplay,
    'confidence still reflects the sighting count, not the number of writes',
  );

  // ── Cleanup: remove everything this run CAUSED, not only what it wrote ───

  if (process.env.KEEP_FIXTURES) {
    console.log('\n[KEEP_FIXTURES] leaving rows in place for inspection\n');
    console.log(`${checks - failures}/${checks} checks passed\n`);
    return;
  }

  await withClient(async (c) => {
    const { rows: after } = await c.query(
      `select lm.id from learner_misconceptions lm
         join learner_profiles lp on lp.id = lm."learnerId" where lp.key = $1`,
      [learnerKey],
    );
    const added = after.map((r) => r.id).filter((id) => !before.has(id));
    if (added.length > 0) {
      await c.query(`delete from learner_misconceptions where id = ANY($1::uuid[])`, [added]);
    }

    const { rows: afterEvidence } = await c.query(
      `select me.id from mastery_evidence me
         join learner_profiles lp on lp.id = me."learnerId" where lp.key = $1`,
      [learnerKey],
    );
    const addedEvidence = afterEvidence.map((r) => r.id).filter((id) => !evidenceBefore.has(id));
    if (addedEvidence.length > 0) {
      await c.query(`delete from mastery_evidence where id = ANY($1::uuid[])`, [addedEvidence]);
    }

    await c.query(
      `delete from remediation_episodes where "learnerId" in
         (select id from learner_profiles where key = $1)
       and "misconceptionId" in (select id from misconceptions where key = $2)`,
      [learnerKey, misconceptionKey],
    );
    await c.query(
      `delete from attempt_items where "attemptId" in
         (select a.id from attempts a join learner_profiles lp on lp.id = a."learnerId"
           where lp.key = $1 and a."lessonKey" = $2)`,
      [learnerKey, lessonKey],
    );
    await c.query(
      `delete from attempts where "learnerId" in
         (select id from learner_profiles where key = $1) and "lessonKey" = $2`,
      [learnerKey, lessonKey],
    );
    const allQuestionKeys = [questionKey, ...recoveryKeys];
    await c.query(`delete from answer_keys where "questionId" in
       (select id from questions where key = ANY($1))`, [allQuestionKeys]);
    await c.query(`delete from question_concepts where "questionId" in
       (select id from questions where key = ANY($1))`, [allQuestionKeys]);
    await c.query(`delete from question_choices where "questionId" in
       (select id from questions where key = ANY($1))`, [allQuestionKeys]);
    await c.query(`delete from questions where key = ANY($1)`, [allQuestionKeys]);
    await c.query(`delete from misconceptions where key = $1`, [misconceptionKey]);
  });

  console.log(`\n${checks - failures}/${checks} checks passed\n`);
  if (failures > 0) process.exit(1);
}


runScenario()
  .catch((error) => {
    console.error('\nscript failed:', error);
    process.exitCode = 1;
  })
  // Always drop the fixture textbook, pass or fail. This must be awaited: an
  // earlier version scheduled it from `process.on('exit')`, which cannot await,
  // so it silently never ran and orphan textbooks piled up across runs.
  .finally(async () => {
    await dropFixture();
  });
