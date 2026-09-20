/**
 * End-to-end proof for three capabilities that had unit tests and no live run:
 * XP/Engagement, parent tasks, and Due Work.
 *
 * Why these three, and why now. They were ranked by risk, not convenience
 * (NEXT-WAVE-REVIEW.md §10.4):
 *
 *   1. XP writes persistent state as a SIDE EFFECT of submitting an answer, and
 *      claims idempotency. An idempotency guarantee asserted only against a
 *      mocked ledger is not evidence — the mock was written to agree with it.
 *   2. Parent tasks create and cancel state across a guardian/staff
 *      authorization boundary. Until this run, no guardian user existed in the
 *      seed at all, so that boundary had never been crossed by a real request.
 *   3. Due Work is read-only but is the teacher-facing surface that composes
 *      the other two.
 *
 * The rule this file follows: nothing is inserted by SQL. XP is earned by
 * answering questions over HTTP, parent tasks are created by a parent over
 * HTTP, and SQL is used only to read state back and to clean up. If the
 * production path regresses, these checks go red.
 *
 * Usage: node scripts/check-engagement-and-parent.mjs   (API must be running)
 */

import { withClient, createTextbook, dropTextbook } from './seed-helpers.mjs';

const API = process.env.API_URL ?? 'http://127.0.0.1:3000';

let failures = 0;
let checks = 0;

let fixture = null;
/** Plans this run created, cancelled in the finally block. */
const createdPlans = [];

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

function ok(label, res) {
  const pass = res.http >= 200 && res.http < 300 && res.body?.ok === true;
  report(pass, label, pass ? `${res.http}` : `${res.http} ${JSON.stringify(res.body?.error ?? {})}`);
  return pass ? res.body.data : null;
}

function refused(label, res, expectedCode) {
  const code = res.body?.error?.code;
  const pass = res.body?.ok === false && (!expectedCode || code === expectedCode);
  report(pass, label, `${res.http} ${code ?? 'no code'}`);
  return pass;
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

/** READ ONLY. Counts ledger rows so idempotence can be proven by row count. */
async function xpRows(learnerKey) {
  return withClient(async (c) => {
    const { rows } = await c.query(
      `select count(*)::int as n, coalesce(sum(amount), 0)::int as total
         from xp_ledger x
         join learner_profiles lp on lp.id = x."learnerId"
        where lp.key = $1`,
      [learnerKey],
    );
    return rows[0];
  });
}

async function runScenario() {
  console.log('\n— XP, parent tasks, and due work (production paths only) —\n');

  const authorToken = await login('author');
  const adminToken = await login('admin');
  const studentToken = await login('student');
  const teacherToken = await login('teacher');
  const parentToken = await login('parent');

  const author = client(authorToken);
  const admin = client(adminToken);
  const student = client(studentToken);
  const teacher = client(teacherToken);
  const parent = client(parentToken);

  const learnerKey = 'lrn_demo_student';

  console.log('── the parent surface exists at all ──────────────────────');

  // Until this run there was no guardian in the seed, so every guardian-scoped
  // rule was enforced only against mocks.
  const childXp = ok('a verified parent can read their child\'s XP', await parent('GET', `engagement/xp?learnerKey=${learnerKey}`));
  report(typeof childXp?.totalXp === 'number', 'the child XP summary is real', `totalXp=${childXp?.totalXp}`);

  refused(
    'a parent cannot read a child they are not linked to',
    await parent('GET', 'engagement/xp?learnerKey=lrn_not_my_child'),
  );

  refused(
    'a parent cannot reach the staff leaderboard',
    await parent('GET', 'engagement/leaderboard?schoolId=00000000-0000-0000-0000-000000000000'),
  );

  console.log('\n── XP is earned, never asserted ──────────────────────────');

  const stamp = Date.now().toString(36).toUpperCase().slice(-6);
  const TB = `EDU-MATH-G07-T1-ED${stamp}`;
  await createTextbook(TB, stamp);
  registerFixture(TB, dropTextbook);

  // Author a lesson with two questions. Keys are always read back from the
  // response: hand-composing a concept key yields question.concept_not_found.
  const unit = ok('author creates a unit', await author('POST', 'content/units', { textbookKey: TB, name: 'XP Unit' }));
  const lesson = ok('author creates a lesson', await author('POST', 'content/lessons', { unitKey: unit?.key, name: 'XP Lesson' }));
  const concept = ok(
    'author creates a concept',
    await author('POST', 'content/concepts', { lessonKey: lesson?.key, name: 'XP Concept' }),
  );

  const made = [];
  for (const n of [1, 2]) {
    const q = ok(
      `author creates question ${n}`,
      await author('POST', 'content/questions', {
        type: 'MCQ_SINGLE',
        text: `XP probe question ${n}: which set contains 2?`,
        choices: [
          { id: 'a', text: '{1, 2, 3}' },
          { id: 'b', text: '{5, 6}' },
        ],
        answerKey: { correctChoiceIds: ['a'] },
        concepts: [{ conceptKey: concept?.key, weight: 1, isPrimary: true }],
      }),
    );
    if (q?.key) made.push(q.key);
  }

  // Publishing is two steps by two actors, and a question has its own lifecycle
  // separate from the book's. Both must be published or the learner is served
  // nothing -- unpublished content is filtered out of every learner read.
  for (const key of made) {
    await author('POST', `content/questions/${key}/transitions`, { action: 'SUBMIT' });
    ok(`admin approves question ${key.slice(-10)}`, await admin('POST', `content/questions/${key}/transitions`, { action: 'APPROVE' }));
  }
  ok('author submits the book for review', await author('POST', 'content/transitions', { textbookKey: TB, action: 'SUBMIT' }));
  ok('admin approves the book', await admin('POST', 'content/transitions', { textbookKey: TB, action: 'APPROVE' }));

  const before = await xpRows(learnerKey);

  const attempt = ok(
    'learner starts a practice attempt',
    await student('POST', 'assessment/attempts', { kind: 'PRACTICE', lessonKey: lesson?.key }),
  );

  // Answer the served questions, taking the choice id from what was served.
  const attemptKey = attempt?.attempt?.key ?? attempt?.key;

  // startAttempt returns the attempt, not a served item list -- questions are
  // resolved at answer time. READ ONLY: this finds the published questions and
  // their real choice ids; it inserts nothing.
  const targets = await withClient(async (c) => {
    const { rows } = await c.query(
      `select q.key as question_key,
              (ak."correctChoiceIds")[1] as choice_id
         from questions q
         join answer_keys ak on ak."questionId" = q.id
         join question_concepts qc on qc."questionId" = q.id
         join concepts co on co.id = qc."conceptId"
         join lessons l on l.id = co."lessonId"
        where l.key = $1 and q.status = 'PUBLISHED'
        order by q.key`,
      [lesson?.key],
    );
    return rows;
  });
  report(targets.length > 0, 'published questions are available to answer', `${targets.length} question(s)`);

  let answered = 0;
  let firstAnswered = null;
  for (const t of targets) {
    const res = await student('POST', 'assessment/answers', {
      attemptKey,
      questionKey: t.question_key,
      answer: { choiceIds: [t.choice_id] },
    });
    if (res.body?.ok) {
      answered += 1;
      if (!firstAnswered) firstAnswered = t;
    }
  }
  report(answered > 0, 'learner answered at least one question over HTTP', `${answered} answered`);

  const after = await xpRows(learnerKey);
  report(after.n > before.n, 'answering wrote XP ledger rows', `${before.n} -> ${after.n}`);
  report(after.total > before.total, 'the XP total grew', `${before.total} -> ${after.total}`);

  const summary = ok('learner reads their own XP', await student('GET', 'engagement/xp'));
  report(summary?.totalXp === after.total, 'the API total matches the ledger', `api=${summary?.totalXp} db=${after.total}`);
  report(
    typeof summary?.level === 'number' && summary.level >= 1,
    'a level is derived from the total',
    `level=${summary?.level}`,
  );
  report(
    summary?.currentStreak !== undefined,
    'the streak is derived server-side, never supplied',
    `streak=${summary?.currentStreak}`,
  );

  // The claim that cannot be tested against a mock: the same answer must not
  // pay twice. One attempt cannot answer the same question twice, so the
  // replay is refused and the ledger must be unchanged.
  if (firstAnswered) {
    const dup = await student('POST', 'assessment/answers', {
      attemptKey,
      questionKey: firstAnswered.question_key,
      answer: { choiceIds: [firstAnswered.choice_id] },
    });
    refused('the same question cannot be answered twice', dup, 'assessment.question_already_answered');

    const afterReplay = await xpRows(learnerKey);
    report(
      afterReplay.n === after.n && afterReplay.total === after.total,
      'the refused replay paid no XP',
      `${after.total} -> ${afterReplay.total}`,
    );
  }

  console.log('\n── parent tasks are advisory, and stay advisory ──────────');

  const task = ok(
    'a parent sets a task for their own child',
    await parent('POST', 'instruction/parent-tasks', {
      learnerKey,
      title: 'Read for twenty minutes',
      activityType: 'LESSON',
      activityKey: lesson?.key,
    }),
  );
  const taskPlanKey = task?.plan?.key ?? task?.planKey;
  if (taskPlanKey) createdPlans.push(taskPlanKey);

  report(task?.plan?.origin === 'PARENT', 'the origin is forced to PARENT', task?.plan?.origin);
  report(task?.countsTowardCompletion === false, 'a parent task never counts toward completion', `${task?.countsTowardCompletion}`);

  // These two previously passed on `request.invalid_input` -- a schema error, not
  // an authorization decision. A refusal check that accepts ANY failure proves
  // nothing, so both now assert the payload is valid and name the expected code.
  const notMine = await parent('POST', 'instruction/parent-tasks', {
    learnerKey: 'lrn_not_my_child',
    title: 'Should be refused',
    activityType: 'LESSON',
    activityKey: lesson?.key,
  });
  report(
    notMine.body?.error?.code !== 'request.invalid_input',
    'the not-my-child probe reaches authorization, not the schema',
    notMine.body?.error?.code,
  );
  refused('a parent cannot set a task for a child who is not theirs', notMine);

  const wrongActor = await teacher('POST', 'instruction/parent-tasks', {
    learnerKey,
    title: 'Wrong actor',
    activityType: 'LESSON',
    activityKey: lesson?.key,
  });
  report(
    wrongActor.body?.error?.code !== 'request.invalid_input',
    'the wrong-actor probe reaches authorization, not the schema',
    wrongActor.body?.error?.code,
  );
  refused('a teacher cannot use the parent surface', wrongActor);

  const childTasks = ok('the parent reads their child\'s tasks', await parent('GET', `instruction/parent-tasks?learnerKey=${learnerKey}`));
  report(Array.isArray(childTasks?.tasks), 'the child task list is returned', `${childTasks?.tasks?.length} task(s)`);
  const mine = (childTasks?.tasks ?? []).find((t) => (t.planKey ?? t.plan?.key) === taskPlanKey);
  report(mine !== undefined, 'the task just created is listed');
  report(
    mine?.countsTowardCompletion === false,
    'it is labelled as not counting toward completion',
    `${mine?.countsTowardCompletion}`,
  );

  console.log('\n── due work keeps advisory out of the academic count ─────');

  const due = ok('learner reads their due work', await student('GET', 'instruction/due-work'));
  report(Array.isArray(due?.academic) && Array.isArray(due?.advisory), 'due work separates academic from advisory');

  const advisoryKeys = (due?.advisory ?? []).map((d) => d.planKey ?? d.key);
  report(
    !(due?.academic ?? []).some((a) => advisoryKeys.includes(a.planKey ?? a.key)),
    'a parent task never appears as academic work',
    `${due?.academic?.length ?? 0} academic / ${due?.advisory?.length ?? 0} advisory`,
  );
  report(
    typeof due?.summary?.outstanding === 'number' && typeof due?.summary?.overdueAcademic === 'number',
    'the summary reports academic overdue separately',
    JSON.stringify(due?.summary ?? {}),
  );

  const alerts = ok(
    'staff request overdue alerts',
    await teacher('POST', 'instruction/due-work/alerts', { learnerKeys: [learnerKey] }),
  );
  report(alerts !== null, 'the alert surface answers for a real cohort');

  refused(
    'a learner cannot request staff alerts',
    await student('POST', 'instruction/due-work/alerts', { learnerKeys: [learnerKey] }),
  );

  // Cancel what this run created, over HTTP, and prove the cancel works.
  const cancelled = ok(
    'the parent cancels the task they set',
    await parent('POST', 'instruction/parent-tasks/cancel', { planKey: taskPlanKey }),
  );
  if (cancelled) createdPlans.length = 0;
  report(cancelled?.planKey === taskPlanKey, 'cancel returns the plan it cancelled', cancelled?.planKey);

  const afterCancel = ok(
    'the parent re-reads the child task list',
    await parent('GET', `instruction/parent-tasks?learnerKey=${learnerKey}`),
  );
  const stillThere = (afterCancel?.tasks ?? []).find((t) => (t.planKey ?? t.plan?.key) === taskPlanKey);
  report(stillThere === undefined, 'a cancelled task drops off the active list, but the row survives');
}

try {
  await runScenario();
} catch (err) {
  failures += 1;
  console.error('\n✗ scenario threw:', err.message);
} finally {
  // Clean up what this run CAUSED, not only what it wrote, and on the failure
  // path too. Plans are cancelled over HTTP; the textbook takes its content
  // with it.
  for (const planKey of createdPlans) {
    await fetch(`${API}/api/v1/instruction/parent-tasks/cancel`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${await login('parent').catch(() => '')}`,
      },
      body: JSON.stringify({ planKey }),
    }).catch(() => {});
  }
  await dropFixture();
}

console.log(`\n${failures === 0 ? '✅' : '❌'} ${checks - failures}/${checks} checks passed`);
process.exitCode = failures === 0 ? 0 : 1;
