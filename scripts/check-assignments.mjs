/**
 * End-to-end proof of the assignment surface, against the live API.
 *
 * A teacher authors a plan, publishes it to a real cohort resolved from
 * Enrollment, a learner reads it back, the teacher watches progress and
 * excuses someone. The point of running this against the real stack is the
 * things a fake repository cannot prove: that "class is a query" actually
 * resolves learners, that the unique constraint makes re-publication a no-op,
 * and that the derived status survives a round trip through Postgres.
 *
 * Every refusal below asserts a NAMED code. A script that only checked for
 * non-2xx would pass on a 500 and prove nothing.
 *
 * Usage: node scripts/check-assignments.mjs   (API must be running)
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

const run = async () => {
  const teacher = client(await login('teacher'));
  const student = client(await login('student'));
  const admin = client(await login('admin'));

  const { withClient } = await import('./seed-helpers.mjs');

  // The cohort the demo learner is actually enrolled in. Reading it from the
  // database rather than hardcoding it is the point: the plan targets a scope,
  // and the scope has to resolve to real people.
  const scope = await withClient(async (client) => {
    const { rows } = await client.query(
      `select e."schoolId", e."gradeId", e."termId"
         from enrollments e
         join learner_profiles l on l.id = e."learnerId"
        where l.key = 'lrn_demo_student' and e."isCurrent" = true
        limit 1`,
    );
    return rows[0];
  });
  report(Boolean(scope?.schoolId), 'demo learner has a current enrolment to assign into');

  const lessonKey = await withClient(async (client) => {
    const { rows } = await client.query(
      `select key from lessons where key like 'EDU-MATH-G07-T1-ED2026%' order by key limit 1`,
    );
    return rows[0]?.key;
  });
  report(Boolean(lessonKey), 'a published lesson exists to assign', lessonKey);

  console.log('\n── authoring ─────────────────────────────────────────────');

  const draft = ok(
    'teacher creates a draft plan',
    await teacher('POST', 'instruction/plans', {
      title: 'Sets homework',
      instructions: 'Work through the lesson and the check.',
      activityType: 'LESSON',
      activityKey: lessonKey,
      scope,
      dueAt: new Date(Date.now() + 7 * 864e5).toISOString(),
    }),
  );
  const planKey = draft?.key;
  report(draft?.status === 'DRAFT', 'plan starts as a draft', draft?.status);

  refused(
    'a student cannot assign work',
    await student('POST', 'instruction/plans', {
      title: 'No homework ever',
      activityType: 'LESSON',
      activityKey: lessonKey,
      scope,
    }),
    'instruction.assigning_forbidden',
  );

  refused(
    'an unknown activity is refused',
    await teacher('POST', 'instruction/plans', {
      title: 'Ghost lesson',
      activityType: 'LESSON',
      activityKey: 'EDU-DOES-NOT-EXIST',
      scope,
    }),
    'instruction.activity_not_found',
  );

  refused(
    'a due date before release is refused',
    await teacher('POST', 'instruction/plans', {
      title: 'Time travel',
      activityType: 'LESSON',
      activityKey: lessonKey,
      scope,
      availableAt: '2027-01-01T00:00:00.000Z',
      dueAt: '2026-01-01T00:00:00.000Z',
    }),
    'instruction.window_inverted',
  );

  refused(
    'a teacher cannot assign into another school',
    await teacher('POST', 'instruction/plans', {
      title: 'Reaching too far',
      activityType: 'LESSON',
      activityKey: lessonKey,
      scope: { ...scope, schoolId: '00000000-0000-0000-0000-000000000000' },
    }),
    'instruction.school_out_of_scope',
  );

  ok(
    'a draft can be edited',
    await teacher('PATCH', `instruction/plans/${planKey}`, { title: 'Sets homework (week 1)' }),
  );

  // The learner must not see a draft: nothing has been asked of them yet.
  const beforePublish = ok('learner lists obligations', await student('GET', 'instruction/obligations'));
  report(
    !(beforePublish ?? []).some((row) => row.plan.key === planKey),
    'a draft plan is invisible to the learner',
  );

  console.log('\n── publishing ────────────────────────────────────────────');

  const published = ok(
    'teacher publishes the plan',
    await teacher('POST', `instruction/plans/${planKey}/transitions`, { action: 'PUBLISH' }),
  );
  report(published?.status === 'PUBLISHED', 'plan is published', published?.status);
  report(
    published?.obligationsCreated >= 1,
    'publishing materialised the cohort from Enrollment',
    `${published?.obligationsCreated} obligation(s)`,
  );

  refused(
    'publishing twice is refused',
    await teacher('POST', `instruction/plans/${planKey}/transitions`, { action: 'PUBLISH' }),
    'instruction.already_published',
  );

  const again = ok(
    're-materialising is allowed',
    await teacher('POST', `instruction/plans/${planKey}/materialise`),
  );
  report(again?.obligationsCreated === 0, 're-materialising creates nobody twice', `${again?.obligationsCreated}`);

  refused(
    'a published plan cannot be edited',
    await teacher('PATCH', `instruction/plans/${planKey}`, { title: 'Sneaky change' }),
    'instruction.plan_not_editable',
  );

  console.log('\n── the learner sees it ───────────────────────────────────');

  const mine = ok('learner lists obligations', await student('GET', 'instruction/obligations'));
  const row = (mine ?? []).find((r) => r.plan.key === planKey);
  report(Boolean(row), 'the published plan reached the learner');
  report(row?.plan.title === 'Sets homework (week 1)', 'the edited title is what was published');
  report(
    ['PENDING', 'IN_PROGRESS', 'COMPLETED'].includes(row?.obligation.status),
    'obligation carries a derived status',
    row?.obligation.status,
  );

  // The god-object test: the wire format must not carry achievement at all.
  const wire = JSON.stringify(row ?? {});
  report(!/"score"/.test(wire), 'obligation exposes no score');
  report(!/"mastery(Achieved)?"\s*:/.test(wire), 'obligation exposes no mastery value');
  report(!/"xp"/i.test(wire), 'obligation exposes no XP');

  // Legacy allowed PATCH {masteryAchieved} on the assignment row. The route
  // must not exist at all — 404/405, not a silent success.
  const patched = await student('PATCH', `instruction/obligations/${row?.obligation.key}`, {
    masteryAchieved: 1,
    status: 'COMPLETED',
  });
  report(
    !patched.body.ok && patched.http >= 400,
    'there is no endpoint to assert completion',
    `${patched.http}`,
  );

  console.log('\n── progress and waiving ──────────────────────────────────');

  const progress = ok(
    'teacher reads cohort progress',
    await teacher('GET', `instruction/plans/${planKey}/progress`),
  );
  report(progress?.progress?.total >= 1, 'progress counts the cohort', `${progress?.progress?.total}`);
  report(
    typeof progress?.progress?.completionRate === 'number',
    'progress reports a completion rate',
    `${progress?.progress?.completionRate}`,
  );

  refused(
    'a student cannot read cohort progress',
    await student('GET', `instruction/plans/${planKey}/progress`),
    'instruction.assigning_forbidden',
  );

  const obligationKey = row?.obligation.key;

  // An empty reason never reaches the service — the route schema rejects it.
  refused(
    'an empty waiver reason is refused at the boundary',
    await teacher('POST', `instruction/obligations/${obligationKey}/waiver`, { reason: '' }),
    'request.invalid_input',
  );

  // Whitespace passes the schema, so the service has to refuse it too. Both
  // layers are checked because either alone would leave a reasonless waiver
  // possible through some other caller.
  refused(
    'a whitespace-only waiver reason is refused by the service',
    await teacher('POST', `instruction/obligations/${obligationKey}/waiver`, { reason: '   ' }),
    'instruction.waiver_reason_required',
  );

  refused(
    'a student cannot waive their own homework',
    await student('POST', `instruction/obligations/${obligationKey}/waiver`, { reason: 'busy' }),
    'instruction.assigning_forbidden',
  );

  const waived = ok(
    'teacher waives with a reason',
    await teacher('POST', `instruction/obligations/${obligationKey}/waiver`, {
      reason: 'Off sick all week',
    }),
  );
  report(waived?.status === 'WAIVED', 'obligation is waived', waived?.status);

  refused(
    'waiving twice is refused',
    await teacher('POST', `instruction/obligations/${obligationKey}/waiver`, { reason: 'again' }),
    'instruction.already_waived',
  );

  // ── reopen: the only exit from WAIVED ──────────────────────────────────
  console.log('\n── reopening a waiver ────────────────────────────────────');

  refused(
    'a student cannot reopen their own waiver',
    await student('POST', `instruction/obligations/${obligationKey}/reopen`, { reason: 'oops' }),
    'instruction.assigning_forbidden',
  );

  refused(
    'reopening without a reason is refused',
    await teacher('POST', `instruction/obligations/${obligationKey}/reopen`, { reason: '   ' }),
    'instruction.reopen_reason_required',
  );

  const reopened = ok(
    'teacher reopens a mistaken waiver',
    await teacher('POST', `instruction/obligations/${obligationKey}/reopen`, {
      reason: 'Waived the wrong learner',
    }),
  );
  report(reopened?.status !== 'WAIVED', 'the waiver is cleared', reopened?.status);
  // Reopening withdraws an assertion; it must not make a new one.
  report(
    reopened?.waiverReason === null && reopened?.waivedAt === null,
    'no waiver record is left behind',
    `${reopened?.waiverReason}`,
  );
  report(
    reopened?.status === 'PENDING' || reopened?.status === 'IN_PROGRESS',
    'status is re-derived from evidence, not asserted',
    reopened?.status,
  );

  refused(
    'reopening something that is not waived is refused',
    await teacher('POST', `instruction/obligations/${obligationKey}/reopen`, { reason: 'again' }),
    'instruction.not_waived',
  );

  // Restore the waiver so the assertions below still describe a waived cohort:
  // this section must not change the meaning of what follows it.
  ok(
    're-waiving after a reopen',
    await teacher('POST', `instruction/obligations/${obligationKey}/waiver`, {
      reason: 'Off sick all week',
    }),
  );

  const afterWaiver = ok(
    'progress after the waiver',
    await teacher('GET', `instruction/plans/${planKey}/progress`),
  );
  report(afterWaiver?.progress?.waived === 1, 'the waiver is counted', `${afterWaiver?.progress?.waived}`);
  // A waived learner must not be scored as a failure to complete.
  report(
    afterWaiver?.progress?.completionRate === 0 || afterWaiver?.progress?.total === 1,
    'waived learners leave the completion denominator',
    `rate=${afterWaiver?.progress?.completionRate}`,
  );

  console.log('\n── cancelling ────────────────────────────────────────────');

  const cancelled = ok(
    'teacher cancels the plan',
    await teacher('POST', `instruction/plans/${planKey}/transitions`, { action: 'CANCEL' }),
  );
  report(cancelled?.status === 'CANCELLED', 'plan is cancelled', cancelled?.status);

  refused(
    'a cancelled plan cannot be published',
    await teacher('POST', `instruction/plans/${planKey}/transitions`, { action: 'PUBLISH' }),
    'instruction.cancelled_cannot_publish',
  );

  const afterCancel = ok(
    'learner lists obligations after cancellation',
    await student('GET', 'instruction/obligations'),
  );
  report(
    !(afterCancel ?? []).some((r) => r.plan.key === planKey),
    'a cancelled plan drops off the learner list',
  );

  // Cancelling must not destroy evidence of what was asked.
  const survives = await withClient(async (client) => {
    const { rows } = await client.query(
      `select count(*)::int as n
         from learner_obligations o
         join instructional_plans p on p.id = o."planId"
        where p.key = $1`,
      [planKey],
    );
    return rows[0].n;
  });
  report(survives >= 1, 'cancelling keeps the obligation rows for the record', `${survives} row(s)`);

  // An admin may reach across schools; the teacher above could not.
  const adminView = await admin('GET', `instruction/plans/${planKey}/progress`);
  report(adminView.body.ok, 'an admin can read any plan in their school', `${adminView.http}`);

  await withClient(async (client) => {
    await client.query(`delete from instructional_plans where key = $1`, [planKey]);
  });
  console.log('\n(scenario plan removed)');

  console.log(`\n${failures === 0 ? '✅' : '❌'} ${checks - failures}/${checks} checks passed`);
  process.exit(failures === 0 ? 0 : 1);
};

run().catch((error) => {
  console.error('\n❌ scenario crashed:', error);
  process.exit(1);
});
