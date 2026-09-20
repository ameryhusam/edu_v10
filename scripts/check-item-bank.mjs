/**
 * End-to-end proof of the item bank, against the live API.
 *
 * Authors questions, links them to concepts, publishes them, assembles them
 * into fixed and adaptive exams, and attaches learning resources — all over
 * HTTP, on the real stack.
 *
 * The check this script exists for is the last one: a question this API
 * accepted as PUBLISHED is then answered through the real assessment endpoint
 * and grades to a definite verdict. Everything else is a rule; that one is the
 * proof the rule was worth having.
 *
 * Usage: node scripts/check-item-bank.mjs   (API must be running)
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

/** Assert a refusal carries a specific issue code in its details. */
function refusedWithIssue(label, res, expectedCode, issueCode) {
  const actual = res.body.ok ? 'succeeded' : res.body.error.code;
  const issues = res.body.error?.details?.issues ?? [];
  const hasIssue = issues.some((i) => i.code === issueCode);
  report(
    !res.body.ok && actual === expectedCode && hasIssue,
    label,
    `${res.http} ${actual}${hasIssue ? ` / ${issueCode}` : ` / MISSING ${issueCode}`}`,
  );
}

const run = async () => {
  const author = client(await login('author'));
  const admin = client(await login('admin'));
  const student = client(await login('student'));

  const { withClient, createTextbook, dropTextbook } = await import('./seed-helpers.mjs');

  const stamp = Date.now().toString(36).toUpperCase().slice(-6);
  const TB = `EDU-MATH-G07-T1-ED${stamp}`;

  console.log(`\n── scaffolding ${TB} ──────────────────────────────────────`);

  await createTextbook(TB, stamp);
  let cleanedUp = false;
  const cleanup = async () => {
    if (cleanedUp) return;
    cleanedUp = true;
    await dropTextbook(TB).catch(() => {});
  };
  process.on('exit', () => void cleanup());

  try {
    const unit = ok('unit', await author('POST', 'content/units', { textbookKey: TB, name: 'Sets' }));
    const lesson = ok(
      'lesson',
      await author('POST', 'content/lessons', { unitKey: unit.key, name: 'Set and element' }),
    );
    const conceptA = ok(
      'concept A',
      await author('POST', 'content/concepts', { lessonKey: lesson.key, name: 'Set' }),
    );
    const conceptB = ok(
      'concept B',
      await author('POST', 'content/concepts', { lessonKey: lesson.key, name: 'Subset' }),
    );

    const links = [{ conceptKey: conceptA.key, weight: 1, isPrimary: true }];

    console.log('\n── authoring questions ───────────────────────────────────');

    const mcq = ok(
      'author an MCQ',
      await author('POST', 'content/questions', {
        type: 'MCQ_SINGLE',
        text: 'Which of these is a set?',
        choices: [
          { id: 'a', text: '{1, 2, 3}' },
          { id: 'b', text: '17' },
        ],
        answerKey: { correctChoiceIds: ['a'] },
        concepts: links,
      }),
    );
    report(mcq?.status === 'DRAFT', 'a new question is a draft', mcq?.status);
    report(mcq?.key?.startsWith(lesson.key), 'the key is derived from its lesson', mcq?.key);

    refusedWithIssue(
      'an MCQ with no correct option is refused',
      await author('POST', 'content/questions', {
        type: 'MCQ_SINGLE',
        text: 'Ungradable question',
        choices: [
          { id: 'a', text: 'one' },
          { id: 'b', text: 'two' },
        ],
        answerKey: {},
        concepts: links,
      }),
      'question.invalid',
      'question.answer_key_incomplete',
    );

    refusedWithIssue(
      'a numeric question with no range is refused',
      await author('POST', 'content/questions', {
        type: 'NUMERIC',
        text: 'How many elements in {1,2,3}?',
        answerKey: {},
        concepts: links,
      }),
      'question.invalid',
      'question.answer_key_incomplete',
    );

    // The silent-drop defect: an unknown misconception key used to resolve to
    // null in the adapter, so the write SUCCEEDED with the tag discarded and
    // the whole diagnosis chain went quiet for that question. Proven over
    // HTTP because the unit test cannot see the adapter's fallback.
    refused(
      'a distractor tagged with an unknown misconception is refused',
      await author('POST', 'content/questions', {
        type: 'MCQ_SINGLE',
        text: 'Tagged with a misconception that does not exist',
        choices: [
          { id: 'a', text: 'one' },
          { id: 'b', text: 'two', misconceptionKey: `MIS-NOT-IN-CATALOGUE-${stamp}` },
        ],
        answerKey: { correctChoiceIds: ['a'] },
        concepts: links,
      }),
      'question.misconception_not_found',
    );

    refusedWithIssue(
      'a key naming a non-existent option is refused',
      await author('POST', 'content/questions', {
        type: 'MCQ_SINGLE',
        text: 'Dangling key',
        choices: [
          { id: 'a', text: 'one' },
          { id: 'b', text: 'two' },
        ],
        answerKey: { correctChoiceIds: ['zzz'] },
        concepts: links,
      }),
      'question.invalid',
      'question.unknown_choice_reference',
    );

    refusedWithIssue(
      'a question with two primary concepts is refused',
      await author('POST', 'content/questions', {
        type: 'TRUE_FALSE',
        text: 'The empty set is a subset of every set.',
        choices: [
          { id: 't', text: 'True' },
          { id: 'f', text: 'False' },
        ],
        answerKey: { correctChoiceIds: ['t'] },
        concepts: [
          { conceptKey: conceptA.key, weight: 1, isPrimary: true },
          { conceptKey: conceptB.key, weight: 1, isPrimary: true },
        ],
      }),
      'question.invalid',
      'question.multiple_primary_concepts',
    );

    refused(
      'a question linked to a missing concept is refused',
      await author('POST', 'content/questions', {
        type: 'TRUE_FALSE',
        text: 'Ghost concept',
        choices: [
          { id: 't', text: 'True' },
          { id: 'f', text: 'False' },
        ],
        answerKey: { correctChoiceIds: ['t'] },
        concepts: [{ conceptKey: 'NO-SUCH-CONCEPT', weight: 1, isPrimary: true }],
      }),
      'question.concept_not_found',
    );

    refused(
      'a student cannot author questions',
      await student('POST', 'content/questions', {
        type: 'TRUE_FALSE',
        text: 'Easy marks',
        choices: [
          { id: 't', text: 'True' },
          { id: 'f', text: 'False' },
        ],
        answerKey: { correctChoiceIds: ['t'] },
        concepts: links,
      }),
      'content.authoring_forbidden',
    );

    console.log('\n── editing ───────────────────────────────────────────────');

    refusedWithIssue(
      'an edit that would orphan the answer key is refused',
      await author('PATCH', `content/questions/${mcq.key}`, {
        choices: [
          { id: 'x', text: 'one' },
          { id: 'y', text: 'two' },
        ],
      }),
      'question.invalid',
      'question.unknown_choice_reference',
    );

    ok(
      'a consistent rewrite is accepted',
      await author('PATCH', `content/questions/${mcq.key}`, {
        text: 'Which one of these is a set?',
        choices: [
          { id: 'x', text: '{1, 2, 3}' },
          { id: 'y', text: '17' },
        ],
        answerKey: { correctChoiceIds: ['x'] },
      }),
    );

    console.log('\n── publishing ────────────────────────────────────────────');

    refused(
      'a question cannot be published straight from draft',
      await admin('POST', `content/questions/${mcq.key}/transitions`, { action: 'APPROVE' }),
      'content.review_required',
    );

    ok(
      'submit for review',
      await author('POST', `content/questions/${mcq.key}/transitions`, { action: 'SUBMIT' }),
    );

    refused(
      'an author cannot approve their own submission',
      await author('POST', `content/questions/${mcq.key}/transitions`, { action: 'APPROVE' }),
      'content.approval_forbidden',
    );

    const approved = ok(
      'an admin approves it',
      await admin('POST', `content/questions/${mcq.key}/transitions`, { action: 'APPROVE' }),
    );
    report(approved?.status === 'PUBLISHED', 'the question is published', approved?.status);

    refused(
      'a published question cannot be rewritten',
      await author('PATCH', `content/questions/${mcq.key}`, { text: 'Sneaky edit' }),
      'question.locked',
    );

    console.log('\n── exams ─────────────────────────────────────────────────');

    const exam = ok(
      'create a fixed exam',
      await author('POST', 'content/exams', { title: `Sets check ${stamp}`, textbookKey: TB }),
    );

    refused(
      'an item that does not exist is refused',
      await author('PUT', `content/exams/${exam.key}/items`, {
        items: [{ questionKey: 'NO-SUCH-QUESTION' }],
      }),
      'exam.question_not_found',
    );

    // A second question, left in draft, to prove the unpublished-item rule.
    const draftQ = ok(
      'author a second question, left as a draft',
      await author('POST', 'content/questions', {
        type: 'TRUE_FALSE',
        text: 'Every set is a subset of itself.',
        choices: [
          { id: 't', text: 'True' },
          { id: 'f', text: 'False' },
        ],
        answerKey: { correctChoiceIds: ['t'] },
        concepts: [{ conceptKey: conceptB.key, weight: 1, isPrimary: true }],
      }),
    );

    refusedWithIssue(
      'an exam cannot contain a draft question',
      await author('PUT', `content/exams/${exam.key}/items`, {
        items: [{ questionKey: mcq.key }, { questionKey: draftQ.key }],
      }),
      'exam.invalid',
      'exam.unpublished_item',
    );

    ok(
      'set the exam items',
      await author('PUT', `content/exams/${exam.key}/items`, {
        items: [{ questionKey: mcq.key, points: 2 }],
      }),
    );

    const blueprint = ok('read the blueprint', await author('GET', `content/exams/${exam.key}/blueprint`));
    report(blueprint?.totalItems === 1, 'the blueprint counts items', `${blueprint?.totalItems}`);
    report(blueprint?.totalPoints === 2, 'the blueprint counts points', `${blueprint?.totalPoints}`);
    report(
      blueprint?.conceptCoverage?.[0]?.conceptKey === conceptA.key,
      'the blueprint reports concept coverage',
    );

    await author('POST', `content/exams/${exam.key}/transitions`, { action: 'SUBMIT' });
    const examLive = ok(
      'publish the exam',
      await admin('POST', `content/exams/${exam.key}/transitions`, { action: 'APPROVE' }),
    );
    report(examLive?.status === 'PUBLISHED', 'the exam is published', examLive?.status);

    refused(
      'a published exam cannot be recomposed',
      await author('PUT', `content/exams/${exam.key}/items`, { items: [{ questionKey: mcq.key }] }),
      'exam.locked',
    );

    console.log('\n── adaptive exams ────────────────────────────────────────');

    const cat = ok(
      'create an adaptive exam',
      await author('POST', 'content/exams', {
        title: `Adaptive sets ${stamp}`,
        textbookKey: TB,
        isAdaptive: true,
      }),
    );

    refusedWithIssue(
      'an adaptive pool of one item is refused',
      await author('PUT', `content/exams/${cat.key}/items`, { items: [{ questionKey: mcq.key }] }),
      'exam.invalid',
      'exam.pool_below_minimum',
    );

    console.log('\n── learning resources ────────────────────────────────────');

    const resource = ok(
      'attach a resource to a concept',
      await author('POST', 'content/resources', {
        kind: 'VIDEO',
        title: 'What is a set?',
        url: 'https://example.org/sets',
        conceptKey: conceptA.key,
      }),
    );
    report(resource?.isActive === true, 'a new resource is active');

    refused(
      'a resource attached to nothing is refused',
      await author('POST', 'content/resources', {
        kind: 'READING',
        title: 'Floating page',
        url: 'https://example.org/x',
      }),
      'resource.unattached',
    );

    refused(
      'a resource with no content is refused',
      await author('POST', 'content/resources', {
        kind: 'READING',
        title: 'Empty',
        conceptKey: conceptA.key,
      }),
      'resource.empty',
    );

    refused(
      'an inverted page range is refused',
      await author('POST', 'content/resources', {
        kind: 'TEXTBOOK_PAGE',
        title: 'Pages',
        body: 'see the book',
        conceptKey: conceptA.key,
        pageStart: 40,
        pageEnd: 12,
      }),
      'resource.page_range_inverted',
    );

    const listed = ok(
      'list a concept\'s resources',
      await author('GET', `content/concepts/${conceptA.key}/resources`),
    );
    report(listed?.length === 1, 'the resource is listed', `${listed?.length}`);

    ok('retire the resource', await author('DELETE', `content/resources/${resource.key}`));

    // Retired, not deleted: a decision log line points at this row.
    const survives = await withClient(async (c) => {
      const { rows } = await c.query(`select "isActive" from learning_resources where key = $1`, [
        resource.key,
      ]);
      return rows[0];
    });
    report(survives?.isActive === false, 'retiring keeps the row and clears the flag');

    console.log('\n── the textbook lock reaches the item bank ───────────────');

    // Publish the whole book, then confirm its bank is closed.
    await author('POST', 'content/transitions', { textbookKey: TB, action: 'SUBMIT' });
    const bookLive = await admin('POST', 'content/transitions', {
      textbookKey: TB,
      action: 'APPROVE',
    });
    report(bookLive.body.ok, 'the textbook is published', `${bookLive.http}`);

    refused(
      'no new questions in a published textbook',
      await author('POST', 'content/questions', {
        type: 'TRUE_FALSE',
        text: 'Late addition',
        choices: [
          { id: 't', text: 'True' },
          { id: 'f', text: 'False' },
        ],
        answerKey: { correctChoiceIds: ['t'] },
        concepts: links,
      }),
      'content.textbook_locked',
    );

    refused(
      'no new resources in a published textbook',
      await author('POST', 'content/resources', {
        kind: 'VIDEO',
        title: 'Late video',
        url: 'https://example.org/late',
        conceptKey: conceptA.key,
      }),
      'content.textbook_locked',
    );

    console.log('\n── the point of all of it ────────────────────────────────');

    // A question this API published, answered through the real assessment
    // endpoint. If authoring validation were cosmetic, this would come back
    // UNGRADABLE.
    const attempt = await student('POST', 'assessment/attempts', {
      kind: 'PRACTICE',
      lessonKey: lesson.key,
    });

    if (attempt.body.ok) {
      // The learner answers with the id they were SERVED, not the author's
      // local handle — the two differ by design, and this is where that
      // mapping is proved end to end.
      const servedChoice = await withClient(async (c) => {
        const { rows } = await c.query(
          `select ch.id, ch.text
             from question_choices ch
             join questions q on q.id = ch."questionId"
            where q.key = $1
            order by ch."orderIndex"
            limit 1`,
          [mcq.key],
        );
        return rows[0];
      });
      report(
        Boolean(servedChoice?.id) && servedChoice.text === '{1, 2, 3}',
        'the stored option keeps the author\'s text under a served id',
        servedChoice?.id,
      );

      const answer = await student('POST', 'assessment/answers', {
        attemptKey: attempt.body.data.attempt.key,
        questionKey: mcq.key,
        answer: { choiceIds: [servedChoice.id] },
      });
      const verdict = answer.body.ok ? answer.body.data.evaluation?.verdict : null;
      // Asserted POSITIVELY against the set of definite verdicts. Checking
      // `!== 'UNGRADABLE'` would pass on undefined, which is how a typo in the
      // response path turns this into a test of nothing.
      report(
        ['CORRECT', 'INCORRECT', 'PARTIALLY_CORRECT'].includes(verdict),
        'a published question grades to a definite verdict',
        answer.body.ok ? String(verdict) : `${answer.http} ${answer.body.error?.code}`,
      );
      report(verdict === 'CORRECT', 'and the right answer is marked correct', `${verdict}`);
    } else {
      report(false, 'could not open an attempt to grade against', `${attempt.body.error?.code}`);
    }
  } finally {
    await cleanup();
    console.log('\n(scenario textbook removed)');
  }

  console.log(`\n${failures === 0 ? '✅' : '❌'} ${checks - failures}/${checks} checks passed`);
  process.exit(failures === 0 ? 0 : 1);
};

run().catch(async (error) => {
  console.error('\n❌ scenario crashed:', error);
  process.exit(1);
});
