/**
 * End-to-end proof of remediation, against the live API.
 *
 * The claim under test is narrow and it is the whole capability: an episode is
 * opened by evidence and can be closed only by evidence. Everything else here
 * exists to make that claim falsifiable.
 *
 * Specifically it proves, over HTTP:
 *   · a real gap opens exactly one episode, and asking again opens no more
 *   · recovery closes it, and a relapse opens a NEW episode rather than
 *     reviving the old one (so "how long did it take" survives)
 *   · there is no route that closes an episode by assertion — the legacy
 *     `PATCH { masteryAchieved: true }` has no successor
 *   · a misconception produces corrective content first, a plain gap a worked
 *     example first
 *   · the teacher tracker sees the cohort; a learner cannot
 *   · a guardian can read their child's gaps but cannot refresh as them
 *
 * Mastery is seeded by SQL because arriving at "0.30 mastery over 6
 * observations" through the answer API would take dozens of requests. Every
 * assertion is a READ or a WRITE over HTTP.
 *
 * Usage: node scripts/check-remediation.mjs   (API must be running)
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

const TAG = `REM${Date.now().toString(36).toUpperCase().slice(-5)}`;

/** Overwrite one concept's mastery for the demo learner. */
async function setMastery(c, conceptId, { mastery, attempts, stability = 400 }) {
  await c.query(
    `update concept_mastery
        set mastery = $2, "attemptsCount" = $3, "stabilityDays" = $4,
            "lastObservedAt" = now(), "recomputedAt" = now()
      where "conceptId" = $1
        and "learnerId" = (select id from learner_profiles where key = 'lrn_demo_student')`,
    [conceptId, mastery, attempts, stability],
  );
}

const run = async () => {
  const student = client(await login('student'));
  const teacher = client(await login('teacher'));

  const { withClient } = await import('./seed-helpers.mjs');

  console.log(`\n── preparing evidence (${TAG}) ──────────────────────────────`);

  const seeded = await withClient(async (c) => {
    const { rows: learners } = await c.query(
      `select id from learner_profiles where key = 'lrn_demo_student'`,
    );
    const learnerId = learners[0].id;

    const { rows: concepts } = await c.query(
      `select id, key, "masteryThreshold" from concepts
        where key like 'EDU-MATH-G07-T1-ED2026%' order by key limit 3`,
    );

    // Clear anything a previous run left behind, so counts mean something.
    await c.query(`delete from remediation_episodes where "learnerId" = $1`, [learnerId]);
    await c.query(`delete from learner_misconceptions where "learnerId" = $1`, [learnerId]);

    // Snapshot the mastery this script is about to overwrite, so cleanup can
    // put back what was actually there. An earlier version restored a guessed
    // 0.9 and quietly broke check-assignments.mjs, which reads the same demo
    // learner and concluded the homework was already complete. Shared seed
    // state is a shared resource: a script that leaves it "close enough" makes
    // the next script's failure someone else's problem.
    const { rows: before } = await c.query(
      `select "conceptId", mastery, "attemptsCount", "correctCount", "stabilityDays", "lastObservedAt"
         from concept_mastery where "learnerId" = $1`,
      [learnerId],
    );

    // Evidence that existed before this script ran. The answer submitted later
    // writes a REAL evidence row that no TAG can identify, and leaving it
    // behind makes the learner look progressively better on every run until
    // the gap stops opening at all — an order-dependent failure that passes
    // in isolation and fails in the suite.
    const { rows: evidenceBefore } = await c.query(
      `select id from mastery_evidence where "learnerId" = $1`,
      [learnerId],
    );

    // Ensure a mastery row exists for each concept under test.
    for (const concept of concepts) {
      await c.query(
        `insert into concept_mastery
           (id, "learnerId", "conceptId", mastery, "attemptsCount", "correctCount",
            "stabilityDays", "lastObservedAt", "recomputedAt")
         values (gen_random_uuid(), $1, $2, 0.9, 6, 5, 400, now(), now())
         on conflict ("learnerId", "conceptId") do update
           set mastery = 0.9, "attemptsCount" = 6, "stabilityDays" = 400,
               "lastObservedAt" = now(), "recomputedAt" = now()`,
        [learnerId, concept.id],
      );
    }

    // GAP concept: well below threshold, plenty of observations.
    await setMastery(c, concepts[0].id, { mastery: 0.3, attempts: 6 });

    // MISCONCEPTION concept: mastery is FINE. This separates the two triggers —
    // if the misconception episode only appears alongside a low score, the
    // trigger is not doing any independent work.
    const { rows: mis } = await c.query(
      `insert into misconceptions (id, key, "conceptId", name, description, "createdAt")
       values (gen_random_uuid(), $1, $2, $3, 'seeded by check-remediation', now())
       returning id`,
      [`${concepts[1].key}-MIS-${TAG}`, concepts[1].id, `Confuses things (${TAG})`],
    );
    // `learner_misconceptions` is seeded directly here, and that is legitimate
    // ONLY because of what it used to hide.
    //
    // Until 2026-09-12 this insert was the sole reason the table ever had a
    // row: no production code wrote it, so these assertions passed against
    // data this script had planted itself and the capability could not work
    // for a real learner. The promotion path now exists (the mastery recompute
    // derives it from evidence) and is proven end-to-end over HTTP by
    // `check-misconceptions.mjs`, which authors a diagnostic question, answers
    // it as the learner, and asserts the row appears with no SQL insert.
    //
    // With that proof in place, seeding the state here is a precondition the
    // way the mastery numbers above are: this script is about what remediation
    // DOES with a misconception, not about how one comes to exist. Reaching
    // "mastery 0.30 over 6 observations plus an independent misconception"
    // through the answer API would take dozens of requests and would make a
    // failure in either capability look like a failure in the other.
    //
    // If the promotion path regresses, `check-misconceptions.mjs` goes red.
    await c.query(
      `insert into learner_misconceptions
         (id, "learnerId", "conceptId", "misconceptionId", occurrences,
          "firstSeenAt", "lastSeenAt", "isResolved", confidence)
       values (gen_random_uuid(), $1, $2, $3, 2, now(), now(), false, 0.8)`,
      [learnerId, concepts[1].id, mis[0].id],
    );

    // Resources to recommend. One of each kind so ranking has something to
    // choose between; a REMEDIAL for the misconception concept, a
    // WORKED_EXAMPLE for the gap concept.
    for (const [concept, kinds] of [
      [concepts[0], ['READING', 'WORKED_EXAMPLE']],
      [concepts[1], ['READING', 'REMEDIAL']],
    ]) {
      for (const kind of kinds) {
        await c.query(
          `insert into learning_resources
             (id, key, "conceptId", kind, title, "estimatedMins", "isActive", "createdAt", "updatedAt")
           values (gen_random_uuid(), $1, $2, $3, $4, 12, true, now(), now())
           on conflict (key) do nothing`,
          [`${concept.key}-RES-${kind}-${TAG}`, concept.id, kind, `${kind} for ${TAG}`],
        );
      }
    }

    return {
      learnerId,
      gap: concepts[0],
      misconcept: concepts[1],
      clean: concepts[2],
      masteryBefore: before,
      evidenceIdsBefore: evidenceBefore.map((r) => r.id),
    };
  });

  report(true, 'seeded a mastery gap and an independent misconception', seeded.gap.key.slice(-12));

  console.log('\n── detection ───────────────────────────────────────────────');

  const first = ok('learner refreshes their own episodes', await student('POST', 'remediation/refresh'));
  report(first?.opened === 2, 'opened one episode per distinct gap', `opened=${first?.opened}`);
  report(first?.resolved === 0, 'closed nothing on a first run', `resolved=${first?.resolved}`);

  const again = ok('refresh is idempotent', await student('POST', 'remediation/refresh'));
  report(again?.opened === 0 && again?.resolved === 0, 'a second refresh changes nothing',
    `opened=${again?.opened} resolved=${again?.resolved}`);

  const episodes = ok('learner reads their open episodes', await student('GET', 'remediation/episodes'));
  report(Array.isArray(episodes) && episodes.length === 2, 'both gaps are visible',
    `${episodes?.length} episode(s)`);

  const gapEpisode = episodes?.find((e) => e.trigger === 'MASTERY_GAP');
  const misEpisode = episodes?.find((e) => e.trigger === 'MISCONCEPTION');

  report(Boolean(gapEpisode), 'a MASTERY_GAP episode exists');
  report(Boolean(misEpisode), 'a MISCONCEPTION episode exists on a concept whose mastery is fine');
  report(
    misEpisode?.conceptKey === seeded.misconcept.key,
    'the misconception episode is on the misconception concept',
    misEpisode?.conceptKey?.slice(-14),
  );
  report(
    gapEpisode?.openedReason === 'remediation.mastery_below_threshold',
    'the gap episode records why it opened',
    gapEpisode?.openedReason,
  );
  report(
    typeof gapEpisode?.evidence?.mastery === 'number' &&
      typeof gapEpisode?.evidence?.threshold === 'number',
    'the evidence behind the decision is shown, not just the verdict',
    JSON.stringify(gapEpisode?.evidence),
  );
  report(
    typeof gapEpisode?.ageDays === 'number' && gapEpisode.ageDays >= 0,
    'each episode reports how long it has been open',
    `ageDays=${gapEpisode?.ageDays}`,
  );

  console.log('\n── recommendations ─────────────────────────────────────────');

  report(
    misEpisode?.recommendations?.[0]?.kind === 'REMEDIAL',
    'a misconception leads with corrective content',
    misEpisode?.recommendations?.[0]?.kind,
  );
  report(
    misEpisode?.recommendations?.[0]?.reason === 'remediation.corrective_content',
    'and says why that resource was chosen',
    misEpisode?.recommendations?.[0]?.reason,
  );
  report(
    gapEpisode?.recommendations?.[0]?.kind === 'WORKED_EXAMPLE',
    'a plain gap leads with a worked example',
    gapEpisode?.recommendations?.[0]?.kind,
  );
  report(
    (gapEpisode?.recommendations?.length ?? 0) <= 3,
    'recommendations are capped at three',
    `${gapEpisode?.recommendations?.length}`,
  );

  console.log('\n── no manual close ─────────────────────────────────────────');

  // The legacy escape hatches, one by one. Each of these existed in some form
  // in the old codebase; none may exist here.
  const attempts = [
    ['PATCH', `remediation/episodes/${gapEpisode?.episodeKey}`, { status: 'RESOLVED' }],
    ['POST', `remediation/episodes/${gapEpisode?.episodeKey}/complete`, {}],
    ['POST', `remediation/episodes/${gapEpisode?.episodeKey}/dismiss`, {}],
    ['DELETE', `remediation/episodes/${gapEpisode?.episodeKey}`, undefined],
  ];
  for (const [method, path, payload] of attempts) {
    const res = await student(method, path, payload);
    report(
      res.http === 404 || res.http === 405,
      `${method} ${path.split('/').slice(1).join('/')} does not exist`,
      `${res.http}`,
    );
  }

  console.log('\n── closure by evidence ─────────────────────────────────────');

  await withClient((c) => setMastery(c, seeded.gap.id, { mastery: 0.95, attempts: 9 }));

  const recovered = ok('refresh after recovery', await student('POST', 'remediation/refresh'));
  report(recovered?.resolved === 1, 'the gap episode closed on its own', `resolved=${recovered?.resolved}`);

  const stillOpen = ok('re-read open episodes', await student('GET', 'remediation/episodes'));
  report(
    stillOpen?.every((e) => e.trigger !== 'MASTERY_GAP'),
    'the recovered gap is no longer listed as open',
    `${stillOpen?.length} left`,
  );

  const history = ok('read the full history', await student('GET', 'remediation/episodes/history'));
  const closed = history?.find((e) => e.status === 'RESOLVED');
  report(Boolean(closed), 'the closed episode is still on the record');
  report(
    closed?.resolvedReason === 'remediation.mastery_recovered',
    'and records what closed it',
    closed?.resolvedReason,
  );
  report(
    typeof closed?.durationDays === 'number',
    'and how long it stayed open',
    `durationDays=${closed?.durationDays}`,
  );

  console.log('\n── relapse ─────────────────────────────────────────────────');

  await withClient((c) => setMastery(c, seeded.gap.id, { mastery: 0.25, attempts: 12 }));

  const relapse = ok('refresh after a relapse', await student('POST', 'remediation/refresh'));
  report(relapse?.opened === 1, 'a relapse opens a NEW episode', `opened=${relapse?.opened}`);

  const after = ok('history after the relapse', await student('GET', 'remediation/episodes/history'));
  const gapEpisodes = after?.filter((e) => e.conceptKey === seeded.gap.key) ?? [];
  report(gapEpisodes.length === 2, 'both attempts at the same concept are on the record',
    `${gapEpisodes.length} episode(s)`);
  report(
    new Set(gapEpisodes.map((e) => e.episodeKey)).size === 2,
    'the new episode has its own identity — the old one was not reopened',
  );
  report(
    gapEpisodes.filter((e) => e.status === 'RESOLVED').length === 1,
    'the earlier resolution was not overwritten',
  );

  console.log('\n── the teacher tracker ─────────────────────────────────────');

  const scope = await withClient(async (c) => {
    const { rows } = await c.query(
      `select e."schoolId", e."gradeId", e."termId"
         from enrollments e
         join learner_profiles l on l.id = e."learnerId"
        where l.key = 'lrn_demo_student' and e."isCurrent" = true limit 1`,
    );
    return rows[0];
  });

  const tracker = ok(
    'teacher reads the cohort tracker',
    await teacher('GET', `remediation/tracker?schoolId=${scope.schoolId}&gradeId=${scope.gradeId}`),
  );
  report((tracker?.summary?.open ?? 0) >= 2, 'the tracker counts open gaps',
    `open=${tracker?.summary?.open}`);
  report(
    (tracker?.summary?.byTrigger?.MISCONCEPTION ?? 0) >= 1,
    'and separates the two triggers',
    JSON.stringify(tracker?.summary?.byTrigger),
  );
  report(
    (tracker?.learners?.length ?? 0) >= 1,
    'and lists the learners behind the numbers',
    `${tracker?.learners?.length} learner(s)`,
  );
  report(
    tracker?.learners?.[0]?.episodes?.length >= 1,
    'each learner row carries their episodes, not just a count',
  );

  refused(
    'a learner cannot read the cohort tracker',
    await student('GET', `remediation/tracker?schoolId=${scope.schoolId}`),
    'remediation.forbidden',
  );

  console.log('\n── the learner-access boundary ─────────────────────────────');

  refused(
    'a learner cannot refresh someone else',
    await student('POST', 'remediation/refresh', { learnerKey: 'lrn_other' }),
    'learning.learner_not_accessible',
  );
  refused(
    'a learner cannot read someone else\u2019s episodes',
    await student('GET', 'remediation/episodes?learnerKey=lrn_other'),
    'learning.learner_not_accessible',
  );

  const teacherRead = await teacher('GET', 'remediation/episodes?learnerKey=lrn_demo_student');
  report(teacherRead.body.ok, 'a teacher may READ a learner\u2019s episodes', `${teacherRead.http}`);

  // Refresh is deliberately READ-gated, not ACT-gated. It writes no evidence:
  // it re-derives episodes from evidence the caller was already permitted to
  // see, and nothing in the request influences the outcome. A teacher asking
  // "look again at this student" is not acting as the student — running it
  // twice, or never, leaves the same state. The ACT rule exists to keep the
  // evidence stream honest about who did the work, and no work is recorded here.
  const teacherRefresh = await teacher('POST', 'remediation/refresh', {
    learnerKey: 'lrn_demo_student',
  });
  report(
    teacherRefresh.body.ok,
    'a teacher may ask the system to re-derive a learner\u2019s episodes',
    `${teacherRefresh.http}`,
  );

  // The ACT boundary is still real, and this is where it bites: endpoints that
  // produce evidence. They take no learnerKey at all, so a teacher is refused
  // for having no learner identity of their own rather than for naming the
  // wrong one — there is no request they could have written that would work.
  refused(
    'but a teacher still cannot act on a learner\u2019s behalf',
    await teacher('POST', 'tutoring/ask', {
      learnerKey: 'lrn_demo_student',
      question: 'What is a set?',
    }),
    'learning.not_a_learner',
  );

  console.log('\n── detection follows evidence automatically ────────────────');

  // The loop the gate calls for and the earlier round left open: an episode
  // must appear because a learner ANSWERED something, not because somebody
  // remembered to POST /refresh. Legacy's remedial flag was set by hand, which
  // is why it was almost always wrong.
  // Seed EVIDENCE, not a mastery number. The recompute rebuilds mastery from
  // the evidence stream, so a hand-written mastery row is overwritten the
  // moment anything triggers it — which is exactly what this section triggers.
  // Writing the number directly here would have tested nothing, and did.
  await withClient(async (c) => {
    await c.query(`delete from remediation_episodes where "learnerId" = $1`, [seeded.learnerId]);
    // A previous run's practice attempt still holds an answer to this
    // question, and the API rightly refuses to record a second one.
    await c.query(
      `delete from attempt_items ai
        using attempts a
        where ai."attemptId" = a.id and a."learnerId" = $1 and a.kind = 'PRACTICE'`,
      [seeded.learnerId],
    );
    await c.query(`delete from attempts where "learnerId" = $1 and kind = 'PRACTICE'`, [
      seeded.learnerId,
    ]);
    for (let i = 0; i < 4; i += 1) {
      await c.query(
        `insert into mastery_evidence
           (id, "learnerId", "conceptId", "questionKey", "isCorrect", weight, verdict, "observedAt", "createdAt")
         values (gen_random_uuid(), $1, $2, $3, false, 1, 'INCORRECT', now() - ($4 || ' minutes')::interval, now())`,
        [seeded.learnerId, seeded.clean.id, `${seeded.clean.key}-QSEED${TAG}${i}`, String(30 - i)],
      );
    }
  });

  const beforeAnswer = ok('no episodes before answering', await student('GET', 'remediation/episodes'));
  const countBefore = beforeAnswer?.length ?? 0;

  // Answer one question through the normal learner flow. Nothing in this
  // request mentions remediation.
  const target = await withClient(async (c) => {
    const { rows } = await c.query(
      `select q.key as question_key, ch.id as choice_id, l.key as lesson_key
         from questions q
         join question_concepts qc on qc."questionId" = q.id
         join question_choices ch on ch."questionId" = q.id
         join concepts co on co.id = qc."conceptId"
         join lessons l on l.id = co."lessonId"
        where qc."conceptId" = $1 and q.status = 'PUBLISHED'
        order by ch."orderIndex"
        limit 1`,
      [seeded.clean.id],
    );
    return rows[0] ?? null;
  });

  if (target) {
    const attempt = await student('POST', 'assessment/attempts', {
      kind: 'PRACTICE',
      lessonKey: target.lesson_key,
    });

    if (attempt.body.ok) {
      const answered = await student('POST', 'assessment/answers', {
        attemptKey: attempt.body.data.attempt.key,
        questionKey: target.question_key,
        answer: { choiceIds: [target.choice_id] },
      });
      report(answered.body.ok, 'a plain answer was submitted',
        answered.body.ok ? `${answered.http}` : `${answered.http} ${answered.body.error?.code}`);

      const afterAnswer = ok('episodes after answering',
        await student('GET', 'remediation/episodes'));
      report(
        (afterAnswer?.length ?? 0) > countBefore,
        'answering a question opened an episode with no /refresh call',
        `${countBefore} → ${afterAnswer?.length}`,
      );
    } else {
      report(false, 'started a practice attempt',
        `${attempt.http} ${attempt.body.error?.code}`);
    }
  } else {
    report(false, 'found a published question to answer', 'none available');
  }

  console.log('\n── archiving supersedes open gaps ──────────────────────────');

  // The other end of the lifecycle. A gap on a concept that no longer exists
  // cannot close on evidence — no evidence can be produced for it — so it must
  // be SUPERSEDED rather than left open forever or falsely marked RESOLVED.
  const admin = client(await login('admin'));

  const openBeforeArchive = ok(
    'open episodes before archiving',
    await student('GET', 'remediation/episodes'),
  );
  const archivedConceptKeys = new Set((openBeforeArchive ?? []).map((e) => e.conceptKey));

  const archive = await admin('POST', 'content/transitions', {
    textbookKey: 'EDU-MATH-G07-T1-ED2026',
    action: 'ARCHIVE',
  });
  report(archive.body.ok, 'the textbook is archived', `${archive.http}`);

  if (archive.body.ok) {
    const statuses = await withClient(async (c) => {
      const { rows } = await c.query(
        `select status, count(*)::int as n
           from remediation_episodes
          where "learnerId" = $1
          group by status`,
        [seeded.learnerId],
      );
      return Object.fromEntries(rows.map((r) => [r.status, r.n]));
    });

    report(
      (statuses.SUPERSEDED ?? 0) >= archivedConceptKeys.size && archivedConceptKeys.size > 0,
      'every open gap on the archived book was superseded',
      JSON.stringify(statuses),
    );
    report(
      (statuses.OPEN ?? 0) === 0,
      'no gap is left open on content that no longer exists',
      `OPEN=${statuses.OPEN ?? 0}`,
    );
    // The distinction that keeps the numbers honest: superseding is not a
    // success. Counting it as RESOLVED would inflate "we fixed it" every time
    // a book was reorganised.
    report(
      (statuses.RESOLVED ?? 0) <= 1,
      'superseding did not inflate the resolved count',
      `RESOLVED=${statuses.RESOLVED ?? 0}`,
    );

    // Put the book back so the rest of the suite still has content.
    const restore = await admin('POST', 'content/transitions', {
      textbookKey: 'EDU-MATH-G07-T1-ED2026',
      action: 'RESTORE',
    });
    report(restore.body.ok, 'the textbook is restored', `${restore.http}`);
  }

  console.log('\n── cleanup ─────────────────────────────────────────────────');

  await withClient(async (c) => {
    await c.query(`delete from remediation_episodes where "learnerId" = $1`, [seeded.learnerId]);
    await c.query(`delete from learner_misconceptions where "learnerId" = $1`, [seeded.learnerId]);
    await c.query(`delete from misconceptions where key like $1`, [`%-MIS-${TAG}`]);
    await c.query(`delete from learning_resources where key like $1`, [`%-${TAG}`]);
    // The evidence this script injected, and the mastery the recompute derived
    // from it. Both must go, or the next suite inherits a struggling learner.
    await c.query(
      `delete from mastery_evidence
        where "learnerId" = $1 and not (id = any($2::uuid[]))`,
      [seeded.learnerId, seeded.evidenceIdsBefore],
    );
    await c.query(
      `delete from attempt_items ai
        using attempts a
        where ai."attemptId" = a.id and a."learnerId" = $1 and a.kind = 'PRACTICE'`,
      [seeded.learnerId],
    );
    await c.query(`delete from attempts where "learnerId" = $1 and kind = 'PRACTICE'`, [
      seeded.learnerId,
    ]);

    // Restore mastery exactly: rows that existed go back to their recorded
    // values, rows this script created are removed entirely.
    const original = new Set(seeded.masteryBefore.map((r) => r.conceptId));
    await c.query(
      `delete from concept_mastery where "learnerId" = $1 and not ("conceptId" = any($2::uuid[]))`,
      [seeded.learnerId, [...original]],
    );
    for (const row of seeded.masteryBefore) {
      await c.query(
        `update concept_mastery
            set mastery = $3, "attemptsCount" = $4, "correctCount" = $5,
                "stabilityDays" = $6, "lastObservedAt" = $7, "recomputedAt" = now()
          where "learnerId" = $1 and "conceptId" = $2`,
        [
          seeded.learnerId,
          row.conceptId,
          row.mastery,
          row.attemptsCount,
          row.correctCount,
          row.stabilityDays,
          row.lastObservedAt,
        ],
      );
    }
  });

  const restored = await withClient(async (c) => {
    const { rows } = await c.query(
      `select "conceptId", mastery, "attemptsCount" from concept_mastery where "learnerId" = $1`,
      [seeded.learnerId],
    );
    return rows;
  });
  const matches =
    restored.length === seeded.masteryBefore.length &&
    seeded.masteryBefore.every((b) =>
      restored.some(
        (r) =>
          r.conceptId === b.conceptId &&
          Number(r.mastery) === Number(b.mastery) &&
          r.attemptsCount === b.attemptsCount,
      ),
    );
  // Asserted, not assumed. The whole reason this check exists is that the
  // previous cleanup looked correct and was not.
  report(matches, 'seed mastery restored to exactly its previous state',
    `${restored.length}/${seeded.masteryBefore.length} rows`);

  console.log(
    `\n${failures === 0 ? '✅' : '❌'} ${checks - failures}/${checks} checks passed\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
};

run().catch((error) => {
  console.error('\n💥', error);
  process.exit(1);
});
