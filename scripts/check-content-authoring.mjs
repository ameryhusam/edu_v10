/**
 * End-to-end proof of the content authoring surface, against the live API.
 *
 * Authors a whole textbook through HTTP — unit, lesson, concepts,
 * prerequisites, reorder — then walks it through the publication lifecycle and
 * checks that the guards hold on the real stack rather than against a fake
 * repository.
 *
 * The scenario is written so that a passing run means something specific:
 * every refusal below has a named code, and the script asserts the code, not
 * merely that the request failed. A 500 would otherwise "pass" a test that
 * only looked for non-2xx.
 *
 * Usage: node scripts/check-content-authoring.mjs   (API must be running)
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

/** Assert a call succeeded. */
function ok(label, res) {
  report(res.body.ok, label, res.body.ok ? `${res.http}` : `${res.http} ${res.body.error?.code}`);
  return res.body.data;
}

/** Assert a call was refused with a SPECIFIC named code. */
function refused(label, res, expectedCode) {
  const actual = res.body.ok ? 'succeeded' : res.body.error.code;
  report(!res.body.ok && actual === expectedCode, label, `${res.http} ${actual}`);
}

// Anything a run creates is torn down afterwards, including when it throws:
// the import section creates a second textbook, and leftovers would show up in
// catalogue reads and change what the next run tests against.
const created = [];
const cleanup = async () => {
  const { dropTextbook } = await import('./seed-helpers.mjs');
  for (const key of created) await dropTextbook(key).catch(() => {});
};

const run = async () => {
  const author = client(await login('author'));
  const admin = client(await login('admin'));
  const student = client(await login('student'));

  // A fresh textbook per run, so repeated runs do not collide on slugs.
  const stamp = Date.now().toString(36).toUpperCase().slice(-6);
  const TB = `EDU-MATH-G07-T1-ED${stamp}`;

  console.log(`\n── authoring ${TB} ────────────────────────────────────────`);

  // The textbook itself is created out of band: creating a book needs a
  // subject/grade/term catalogue, which is not part of this gate.
  const { dropTextbook } = await import('./seed-helpers.mjs');

  // ── textbook creation, over HTTP ────────────────────────────────────────
  //
  // This used to be raw SQL from seed-helpers, because the application had no
  // way to create a textbook at all -- the first step of authoring happened
  // outside the system that owns authoring. It is now the real endpoint, so
  // this script exercises the production path instead of working around it.
  console.log('\n── creating a textbook ───────────────────────────────────');

  const book = ok(
    'author creates a textbook from business codes',
    await author('POST', 'content/textbooks', {
      subjectKey: 'MATH',
      gradeKey: 'G07',
      termKey: '2026-2027-T01',
      title: `Scenario ${stamp}`,
      edition: stamp,
    }),
  );
  report(book?.key === TB, 'the key is derived, not supplied', book?.key);
  report(book?.status === 'DRAFT', 'a new textbook starts as a draft', book?.status);

  refused(
    'the same subject+grade+term+edition cannot be created twice',
    await author('POST', 'content/textbooks', {
      subjectKey: 'MATH',
      gradeKey: 'G07',
      termKey: '2026-2027-T01',
      title: 'Duplicate',
      edition: stamp,
    }),
    'content.textbook_exists',
  );

  refused(
    'an unknown subject code names the offending field',
    await author('POST', 'content/textbooks', {
      subjectKey: 'NO-SUCH-SUBJECT',
      gradeKey: 'G07',
      termKey: '2026-2027-T01',
      title: 'Bad coordinates',
      edition: `${stamp}X`,
    }),
    'content.coordinate_not_found',
  );

  refused(
    'a learner cannot create a textbook',
    await student('POST', 'content/textbooks', {
      subjectKey: 'MATH',
      gradeKey: 'G07',
      termKey: '2026-2027-T01',
      title: 'Not allowed',
      edition: `${stamp}Y`,
    }),
    'content.authoring_forbidden',
  );
  // Leave no residue: a scenario book left behind would show up in catalogue
  // reads and quietly change what the next run is testing against.
  created.push(TB);

  const unit = ok(
    'create unit',
    await author('POST', 'content/units', { textbookKey: TB, name: 'Sets and Relations' }),
  );
  const lesson = ok(
    'create lesson',
    await author('POST', 'content/lessons', { unitKey: unit.key, name: 'Set and Element' }),
  );

  const conceptA = ok(
    'create concept A',
    await author('POST', 'content/concepts', { lessonKey: lesson.key, name: 'Set' }),
  );
  const conceptB = ok(
    'create concept B',
    await author('POST', 'content/concepts', { lessonKey: lesson.key, name: 'Membership' }),
  );

  report(
    conceptA.key === `${lesson.key}-C-SET`,
    'key derives from slug, not position',
    conceptA.key,
  );
  report(conceptA.orderIndex === 1 && conceptB.orderIndex === 2, 'appended in order');

  // ── questions, so the exported package carries an item bank ─────────────
  console.log('\n── authoring a question ──────────────────────────────────');

  const question = ok(
    'author a textbook question',
    await author('POST', 'content/questions', {
      type: 'MCQ_SINGLE',
      text: 'Which of these is a set?',
      origin: 'TEXTBOOK',
      textbookRole: 'EXERCISE',
      choices: [
        { id: 'a', text: 'A collection of distinct objects' },
        { id: 'b', text: 'A single number' },
      ],
      answerKey: { correctChoiceIds: ['a'] },
      concepts: [{ conceptKey: conceptA.key, weight: 1, isPrimary: true }],
    }),
  );
  report(
    question?.key?.startsWith(`${lesson.key}-Q`),
    'a question key derives from its lesson and its text',
    question?.key,
  );

  // The same stem against the same lesson is the same question. This used to
  // surface as an unhandled 500 from the unique constraint, which told an
  // author nothing and gave a re-run no way to tell "already there" from
  // "broken".
  refused(
    'the same question text cannot be authored twice in one lesson',
    await author('POST', 'content/questions', {
      type: 'MCQ_SINGLE',
      text: 'Which of these is a set?',
      choices: [
        { id: 'a', text: 'A collection of distinct objects' },
        { id: 'b', text: 'A single number' },
      ],
      answerKey: { correctChoiceIds: ['a'] },
      concepts: [{ conceptKey: conceptA.key, weight: 1, isPrimary: true }],
    }),
    'question.exists',
  );

  refused(
    'an AI question cannot claim a printed textbook role',
    await author('POST', 'content/questions', {
      type: 'MCQ_SINGLE',
      text: 'Is the empty set a set?',
      origin: 'AI',
      textbookRole: 'EXERCISE',
      choices: [
        { id: 'a', text: 'Yes' },
        { id: 'b', text: 'No' },
      ],
      answerKey: { correctChoiceIds: ['a'] },
      concepts: [{ conceptKey: conceptA.key, weight: 1, isPrimary: true }],
    }),
    'question.textbook_role_requires_textbook_origin',
  );

  // ── The slug contract ────────────────────────────────────────────────────
  console.log('\n── slug contract ──────────────────────────────────────────');

  ok(
    'rename a concept',
    await author('PATCH', 'content/nodes', {
      kind: 'concept',
      key: conceptA.key,
      patch: { name: 'A Set (renamed)' },
    }),
  );

  const afterRename = await author('GET', `content/readiness?textbookKey=${TB}`);
  report(
    afterRename.body.ok,
    'textbook still loads after rename',
    afterRename.body.ok ? 'ok' : afterRename.body.error?.code,
  );

  refused(
    'changing a slug is refused',
    await author('PATCH', 'content/nodes', {
      kind: 'concept',
      key: conceptA.key,
      patch: { slug: 'SETS' },
    }),
    'content.slug_immutable',
  );

  ok(
    're-sending the same slug is accepted',
    await author('PATCH', 'content/nodes', {
      kind: 'concept',
      key: conceptA.key,
      patch: { slug: 'SET', name: 'Set' },
    }),
  );

  refused(
    'setting the key is refused',
    await author('PATCH', 'content/nodes', {
      kind: 'concept',
      key: conceptA.key,
      patch: { key: 'SOMETHING-ELSE' },
    }),
    'content.key_immutable',
  );

  refused(
    'an unknown field is refused, not silently dropped',
    await author('PATCH', 'content/nodes', {
      kind: 'concept',
      key: conceptA.key,
      patch: { madeUpField: 1 },
    }),
    'content.field_not_editable',
  );

  // ── Prerequisites ────────────────────────────────────────────────────────
  console.log('\n── prerequisites ──────────────────────────────────────────');

  ok(
    'link B after A',
    await author('POST', 'content/prerequisites', {
      conceptKey: conceptB.key,
      prerequisiteKey: conceptA.key,
    }),
  );

  refused(
    'a cycle is refused',
    await author('POST', 'content/prerequisites', {
      conceptKey: conceptA.key,
      prerequisiteKey: conceptB.key,
    }),
    'content.prerequisite_cycle',
  );

  refused(
    'a self-prerequisite is refused',
    await author('POST', 'content/prerequisites', {
      conceptKey: conceptA.key,
      prerequisiteKey: conceptA.key,
    }),
    'content.self_prerequisite',
  );

  // ── Reorder ──────────────────────────────────────────────────────────────
  console.log('\n── reorder ────────────────────────────────────────────────');

  ok(
    'reorder concepts',
    await author('POST', 'content/reorder', {
      kind: 'concept',
      parentKey: lesson.key,
      orderedKeys: [conceptB.key, conceptA.key],
    }),
  );

  refused(
    'a partial reorder is refused',
    await author('POST', 'content/reorder', {
      kind: 'concept',
      parentKey: lesson.key,
      orderedKeys: [conceptA.key],
    }),
    'content.reorder_incomplete',
  );

  // Reordering must not change identity — the whole point of slug-based keys.
  const readiness = await author('GET', `content/readiness?textbookKey=${TB}`);
  report(readiness.body.ok && readiness.body.data.ready, 'textbook is structurally ready');

  // ── Authorisation ────────────────────────────────────────────────────────
  console.log('\n── authorisation ──────────────────────────────────────────');

  refused(
    'a student cannot author',
    await student('POST', 'content/concepts', { lessonKey: lesson.key, name: 'Hacked' }),
    'content.authoring_forbidden',
  );

  // ── Lifecycle ────────────────────────────────────────────────────────────
  console.log('\n── lifecycle ──────────────────────────────────────────────');

  refused(
    'DRAFT cannot be approved directly',
    await admin('POST', 'content/transitions', { textbookKey: TB, action: 'APPROVE' }),
    'content.review_required',
  );

  // Learners must not see it yet.
  const draftStep = await student('GET', `learning/next-step?textbookKey=${TB}`);
  refused('a DRAFT book is not teachable', draftStep, 'learning.no_concepts_in_scope');

  ok(
    'submit for review',
    await author('POST', 'content/transitions', { textbookKey: TB, action: 'SUBMIT' }),
  );

  refused(
    'an author cannot approve their own submission',
    await author('POST', 'content/transitions', { textbookKey: TB, action: 'APPROVE' }),
    'content.approval_forbidden',
  );

  ok(
    'an admin approves',
    await admin('POST', 'content/transitions', { textbookKey: TB, action: 'APPROVE' }),
  );

  const publishedStep = await student('GET', `learning/next-step?textbookKey=${TB}`);
  report(publishedStep.body.ok, 'a PUBLISHED book IS teachable', `${publishedStep.http}`);

  // ── The lock ─────────────────────────────────────────────────────────────
  console.log('\n── published lock ─────────────────────────────────────────');

  refused(
    'cannot add a concept to a published book',
    await author('POST', 'content/concepts', { lessonKey: lesson.key, name: 'Late Addition' }),
    'content.textbook_locked',
  );

  refused(
    'cannot reorder a published book',
    await author('POST', 'content/reorder', {
      kind: 'concept',
      parentKey: lesson.key,
      orderedKeys: [conceptA.key, conceptB.key],
    }),
    'content.textbook_locked',
  );

  refused(
    'cannot change a mastery threshold once published',
    await author('PATCH', 'content/nodes', {
      kind: 'concept',
      key: conceptA.key,
      patch: { masteryThreshold: 0.5 },
    }),
    'content.textbook_locked',
  );

  refused(
    'cannot link a prerequisite once published',
    await author('POST', 'content/prerequisites', {
      conceptKey: conceptA.key,
      prerequisiteKey: conceptB.key,
    }),
    'content.textbook_locked',
  );

  ok(
    'CAN still fix a typo in a title',
    await author('PATCH', 'content/nodes', {
      kind: 'concept',
      key: conceptA.key,
      patch: { name: 'Set (typo fixed)' },
    }),
  );

  refused(
    'cannot return a published book to draft',
    await admin('POST', 'content/transitions', { textbookKey: TB, action: 'SUBMIT' }),
    'content.published_cannot_return_to_draft',
  );

  // ── Archive ──────────────────────────────────────────────────────────────
  console.log('\n── archive ────────────────────────────────────────────────');

  ok('archive', await admin('POST', 'content/transitions', { textbookKey: TB, action: 'ARCHIVE' }));

  const archivedStep = await student('GET', `learning/next-step?textbookKey=${TB}`);
  refused('an ARCHIVED book is not teachable', archivedStep, 'learning.no_concepts_in_scope');

  ok('restore', await admin('POST', 'content/transitions', { textbookKey: TB, action: 'RESTORE' }));

  // ── export: the public content contract ─────────────────────────────────
  console.log('\n── exporting a content package ───────────────────────────');

  const pkg = ok('author exports the textbook', await author('GET', `content/textbooks/${TB}/export`));
  report(pkg?.meta?.profile === 'edu7.textbook-content', 'the package declares its profile', pkg?.meta?.profile);
  report(typeof pkg?.meta?.profileVersion === 'string', 'and its version', pkg?.meta?.profileVersion);

  report(
    pkg?.textbook?.subjectKey === 'MATH' && pkg?.textbook?.gradeKey === 'G07',
    'the header carries business codes, not ids',
    `${pkg?.textbook?.subjectKey}/${pkg?.textbook?.gradeKey}`,
  );

  const flat = JSON.stringify(pkg ?? {});
  report(
    !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(flat),
    'no database uuid leaks into the package',
  );
  report(!flat.includes('textbookId') && !flat.includes('unitId'), 'no foreign key column names leak');

  report(
    (pkg?.units?.length ?? 0) > 0 && (pkg?.lessons?.length ?? 0) > 0 && (pkg?.concepts?.length ?? 0) > 0,
    'the hierarchy this run authored is present',
    `${pkg?.units?.length}u/${pkg?.lessons?.length}l/${pkg?.concepts?.length}c`,
  );
  report(
    (pkg?.lessons ?? []).every((l) => (pkg?.units ?? []).some((u) => u.slug === l.unitSlug)),
    'every lesson resolves to a unit in the same package',
  );
  report(
    (pkg?.concepts ?? []).every((c) => (pkg?.lessons ?? []).some((l) => l.slug === c.lessonSlug)),
    'every concept resolves to a lesson in the same package',
  );

  // Determinism: the same content must export byte-identically, or a diff is
  // useless for review and a round-trip test cannot assert equality.
  const second = await author('GET', `content/textbooks/${TB}/export`);
  const strip = (p) => JSON.stringify({ ...p, meta: { ...p.meta, exportedAt: null } });
  report(
    second.body?.ok && strip(second.body.data) === strip(pkg),
    'two exports of unchanged content are identical apart from the timestamp',
  );

  refused(
    'a learner cannot export a textbook',
    await student('GET', `content/textbooks/${TB}/export`),
    'content.authoring_forbidden',
  );
  refused(
    'exporting an unknown textbook is a clean not-found',
    await author('GET', 'content/textbooks/NO-SUCH-BOOK/export'),
    'content.textbook_not_found',
  );

  // ── import: round trip through the canonical write path ────────────────
  console.log('\n── importing a content package ───────────────────────────');

  const rtEdition = `RT${stamp}`;
  const target = ok(
    'create an empty target textbook',
    await author('POST', 'content/textbooks', {
      subjectKey: 'MATH',
      gradeKey: 'G07',
      termKey: '2026-2027-T01',
      title: `Round trip ${stamp}`,
      edition: rtEdition,
    }),
  );
  const RT = target?.key;
  if (RT) created.push(RT);

  // Retarget the exported package at the new book. Prerequisite edges and
  // concept keys reference the source book, so they are rewritten -- exactly
  // what a real migration between editions does.
  const retarget = (k) => String(k).replace(TB, RT);
  const retargeted = {
    ...pkg,
    textbook: { ...pkg.textbook, key: RT, edition: rtEdition },
    concepts: (pkg.concepts ?? []).map((c) => ({ ...c, key: retarget(c.key) })),
    prerequisites: (pkg.prerequisites ?? []).map((e) => ({
      ...e,
      conceptKey: retarget(e.conceptKey),
      prerequisiteKey: retarget(e.prerequisiteKey),
    })),
  };

  const dry = ok(
    'a dry run is accepted',
    await author('POST', 'content/textbooks/import', { dryRun: true, package: retargeted }),
  );
  report(dry?.dryRun === true && dry?.applied === false, 'the dry run writes nothing', `applied=${dry?.applied}`);
  report((dry?.problems?.length ?? 0) === 0, 'a valid package reports no problems');

  report(
    (pkg?.questions?.length ?? 0) > 0,
    'the package carries the item bank, not just the hierarchy',
    `${pkg?.questions?.length} question(s)`,
  );
  report(
    pkg?.questions?.[0]?.choices?.every((c) => /^c\d+$/.test(c.id)),
    'choices carry the author local id, not the stored uuid',
    JSON.stringify(pkg?.questions?.[0]?.choices?.map((c) => c.id)),
  );
  report(
    pkg?.questions?.[0]?.answerKey?.correctChoiceIds?.every((id) =>
      pkg.questions[0].choices.some((c) => c.id === id),
    ),
    'the answer key resolves against the choices in the same package',
    JSON.stringify(pkg?.questions?.[0]?.answerKey?.correctChoiceIds),
  );
  report(
    pkg?.questions?.[0]?.origin === 'TEXTBOOK' && pkg?.questions?.[0]?.textbookRole === 'EXERCISE',
    'provenance is exported as authored',
    `${pkg?.questions?.[0]?.origin}/${pkg?.questions?.[0]?.textbookRole}`,
  );

  // Prove the dry run really wrote nothing, rather than trusting the flag.
  const afterDry = ok('export the target after the dry run', await author('GET', `content/textbooks/${RT}/export`));
  report(
    (afterDry?.units?.length ?? -1) === 0,
    'the target book is still empty after the dry run',
    `${afterDry?.units?.length} unit(s)`,
  );

  const applied = ok(
    'the real import is applied',
    await author('POST', 'content/textbooks/import', { dryRun: false, package: retargeted }),
  );
  report(applied?.applied === true, 'the package is applied whole', `applied=${applied?.applied}`);
  report(
    applied?.created?.units > 0 && applied?.created?.lessons > 0 && applied?.created?.concepts > 0,
    'units, lessons and concepts were created',
    JSON.stringify(applied?.created),
  );
  report(
    applied?.created?.questions > 0,
    'questions were created through the item bank',
    `${applied?.created?.questions} question(s)`,
  );
  report(
    (applied?.generatedKeys?.length ?? 0) > 0 &&
      applied.generatedKeys.every((g) => g.key.startsWith(RT)),
    'derived keys are reported back, parented on the new book',
    applied?.generatedKeys?.[0]?.key,
  );

  // Re-running must be safe: an import you cannot repeat after fixing one row
  // is not usable.
  const rerun = ok(
    'the same package can be imported again',
    await author('POST', 'content/textbooks/import', { dryRun: false, package: retargeted }),
  );
  report(
    rerun?.created?.units === 0 && rerun?.unchanged?.units > 0,
    'a second run creates nothing and reports unchanged rows',
    JSON.stringify(rerun?.unchanged),
  );
  report(
    rerun?.created?.questions === 0 && rerun?.unchanged?.questions > 0,
    'a re-run does not fork the question bank',
    `unchanged ${rerun?.unchanged?.questions}`,
  );

  const roundTripped = ok('export the target book back', await author('GET', `content/textbooks/${RT}/export`));
  const shape = (p) =>
    JSON.stringify({
      units: (p?.units ?? []).map((u) => [u.slug, u.name]),
      lessons: (p?.lessons ?? []).map((l) => [l.unitSlug, l.slug, l.name]),
      concepts: (p?.concepts ?? []).map((c) => [c.lessonSlug, c.slug, c.name]),
      questions: (p?.questions ?? []).map((q) => [
        q.unitSlug,
        q.lessonSlug,
        q.type,
        q.text,
        q.origin,
        q.textbookRole,
        q.choices.map((c) => [c.id, c.text]),
        q.answerKey.correctChoiceIds,
        q.concepts.map((c) => [c.conceptSlug, c.isPrimary]),
      ]),
    });
  report(shape(roundTripped) === shape(pkg), 'export -> import -> export reproduces the content exactly');

  refused(
    'a package with an unknown profile is refused',
    await author('POST', 'content/textbooks/import', {
      dryRun: true,
      package: { ...retargeted, meta: { ...retargeted.meta, profile: 'not.edu7' } },
    }),
    'import.unknown_profile',
  );

  const dupes = ok(
    'a package with a duplicate slug is reported, not applied',
    await author('POST', 'content/textbooks/import', {
      dryRun: false,
      package: { ...retargeted, units: [...retargeted.units, ...retargeted.units] },
    }),
  );
  report(dupes?.applied === false, 'the duplicate package is refused whole', `applied=${dupes?.applied}`);
  report(
    dupes?.problems?.some((p) => p.code === 'import.duplicate_identifier' && p.row > 0),
    'the duplicate is reported with a row number',
    dupes?.problems?.[0]?.code,
  );

  refused(
    'a learner cannot import content',
    await student('POST', 'content/textbooks/import', { dryRun: true, package: retargeted }),
    'content.authoring_forbidden',
  );

  console.log(
    failures === 0
      ? `\n✅ ${checks} checks passed — content authoring works end to end`
      : `\n❌ ${failures} of ${checks} checks failed`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
};

run()
  .catch((error) => {
    console.error('\n💥', error.message);
    process.exitCode = 1;
  })
  // A run that throws half way through still created books. Cleaning up only
  // on the happy path leaves residue that quietly changes the next run.
  .finally(cleanup);
