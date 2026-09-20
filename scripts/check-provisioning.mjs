/**
 * End-to-end proof of provisioning, against the live API.
 *
 * The question this script answers is not "do the endpoints return 200" but
 * "can an administrator bring a real person into the system and have every
 * other context recognise them?" So it provisions a learner and then *uses*
 * them: logs in as them, asks for a next step, enrols them, and checks that a
 * parent can only see their work once the guardianship is verified.
 *
 * That distinction matters here more than anywhere else. Until this capability
 * existed the seed was the only way to create a user, which meant every live
 * check depended on fixtures and no admin UI could be built at all. A green run
 * means the seed is no longer load-bearing.
 *
 * Usage: node scripts/check-provisioning.mjs   (API must be running)
 */

const API = process.env.API_URL ?? 'http://127.0.0.1:3000';

let failures = 0;
let checks = 0;

function report(pass, label, detail) {
  checks += 1;
  if (!pass) failures += 1;
  console.log(`${pass ? '✓' : '✗'} ${label}${detail ? `  (${detail})` : ''}`);
}

async function login(identifier, password = 'demo1234') {
  const res = await fetch(`${API}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier, password }),
  });
  const body = await res.json();
  return { http: res.status, token: body.data?.tokens?.accessToken ?? null, body };
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

/** Assert a refusal with a SPECIFIC code: any-failure-passes is a false green. */
function refused(label, res, expectedCode) {
  const actual = res.body.ok ? 'succeeded' : res.body.error.code;
  report(!res.body.ok && actual === expectedCode, label, `${res.http} ${actual}`);
}

// Every person this run creates is torn down afterwards, including on the
// failure path. Scenario users left behind would change what the next run sees.
const created = [];
const cleanup = async () => {
  const { dropUser } = await import('./seed-helpers.mjs');
  for (const key of created) await dropUser(key).catch(() => {});
};

const run = async () => {
  const adminToken = (await login('admin')).token;
  if (!adminToken) throw new Error('admin login failed');
  const admin = client(adminToken);
  const student = client((await login('student')).token);

  const stamp = Date.now().toString(36).toUpperCase().slice(-5);
  const studentName = `sc_stu_${stamp}`.toLowerCase();
  const parentName = `sc_par_${stamp}`.toLowerCase();

  // ── Creating a person ────────────────────────────────────────────────────
  console.log('\n── provisioning a learner ────────────────────────────────');

  const learner = ok(
    'an admin provisions a student',
    await admin('POST', 'provisioning/users', {
      username: studentName,
      fullName: 'Scenario Learner',
      password: 'demo1234',
      roles: ['STUDENT'],
    }),
  );
  if (learner?.key) created.push(learner.key);

  report(learner?.key === `usr_${studentName}`, 'the user key is derived from the username', learner?.key);
  report(
    learner?.learnerKey === `lrn_${studentName}`,
    'a STUDENT gets a learner profile automatically',
    learner?.learnerKey,
  );
  report(learner?.status === 'ACTIVE', 'a provisioned user starts active', learner?.status);
  report(
    learner?.roles?.some((r) => r.role === 'STUDENT'),
    'the requested role is granted',
    JSON.stringify(learner?.roles),
  );

  refused(
    'the same username cannot be provisioned twice',
    await admin('POST', 'provisioning/users', {
      username: studentName,
      fullName: 'Duplicate',
      password: 'demo1234',
      roles: ['STUDENT'],
    }),
    'identity.username_taken',
  );

  refused(
    'a user cannot be created with no role at all',
    await admin('POST', 'provisioning/users', {
      username: `${studentName}_norole`,
      fullName: 'No Role',
      password: 'demo1234',
      roles: [],
    }),
    'request.invalid_input',
  );

  refused(
    'a learner cannot provision users',
    await student('POST', 'provisioning/users', {
      username: `${studentName}_x`,
      fullName: 'Not Allowed',
      password: 'demo1234',
      roles: ['STUDENT'],
    }),
    'identity.provisioning_forbidden',
  );

  // The whole point of provisioning: the person can actually use the system.
  console.log('\n── the new person can use the system ─────────────────────');

  const asLearner = await login(studentName);
  report(asLearner.token !== null, 'the new learner can sign in', `${asLearner.http}`);

  if (asLearner.token) {
    const nextStep = await client(asLearner.token)(
      'GET',
      'learning/next-step?textbookKey=EDU-MATH-G07-T1-ED2026',
    );
    // A learner with no evidence is still a learner: the system must answer,
    // not fail. This is what proves learnerKey resolved for a user the seed
    // never created.
    report(nextStep.body.ok, 'the learner-scoped API recognises them', `${nextStep.http}`);
  }

  // ── Enrolment ────────────────────────────────────────────────────────────
  console.log('\n── enrolling the learner ─────────────────────────────────');

  const enrollment = ok(
    'the learner is enrolled for a term',
    await admin('POST', 'provisioning/enrollments', {
      learnerKey: learner?.learnerKey,
      schoolKey: 'sch_demo',
      academicYearKey: '2026-2027',
      termKey: '2026-2027-T01',
      gradeKey: 'G07',
    }),
  );
  report(
    enrollment?.key === `enr_${learner?.learnerKey}_2026-2027_T01`,
    'the enrolment key names the coordinate, not a counter',
    enrollment?.key,
  );
  report(enrollment?.isCurrent === true, 'a new enrolment is the current one');

  refused(
    'the same learner cannot be enrolled twice in one term',
    await admin('POST', 'provisioning/enrollments', {
      learnerKey: learner?.learnerKey,
      schoolKey: 'sch_demo',
      academicYearKey: '2026-2027',
      termKey: '2026-2027-T01',
      gradeKey: 'G07',
    }),
    'identity.enrollment_exists',
  );

  const badCoords = await admin('POST', 'provisioning/enrollments', {
    learnerKey: learner?.learnerKey,
    schoolKey: 'no-such-school',
    academicYearKey: '2026-2027',
    termKey: '2026-2027-T01',
    gradeKey: 'no-such-grade',
  });
  refused('unknown coordinates are refused', badCoords, 'identity.coordinate_not_found');
  report(
    badCoords.body.error?.details?.missing?.length === 2,
    'every missing coordinate is named, so an admin can fix the form',
    JSON.stringify(badCoords.body.error?.details?.missing),
  );

  const listed = ok(
    'an admin can list a learner\u2019s enrolments',
    await admin('GET', `provisioning/learners/${learner?.learnerKey}/enrollments`),
  );
  report(listed?.length === 1, 'the enrolment appears in the list', `${listed?.length} row(s)`);

  ok(
    'an enrolment can be ended',
    await admin('POST', 'provisioning/enrollments/end', { enrollmentKey: enrollment?.key }),
  );
  refused(
    'ending it twice is refused rather than silently repeated',
    await admin('POST', 'provisioning/enrollments/end', { enrollmentKey: enrollment?.key }),
    'identity.enrollment_not_current',
  );
  const restored = ok(
    'a past enrolment can be made current again',
    await admin('POST', 'provisioning/enrollments/make-current', {
      enrollmentKey: enrollment?.key,
    }),
  );
  report(restored?.isCurrent === true, 'the restored enrolment is current', `${restored?.isCurrent}`);

  // ── Guardianship ─────────────────────────────────────────────────────────
  console.log('\n── linking a parent ──────────────────────────────────────');

  const parent = ok(
    'an admin provisions a parent',
    await admin('POST', 'provisioning/users', {
      username: parentName,
      fullName: 'Scenario Parent',
      password: 'demo1234',
      roles: ['PARENT'],
    }),
  );
  if (parent?.key) created.push(parent.key);
  report(
    parent?.guardianKey === `gdn_${parentName}`,
    'a PARENT gets a guardian profile automatically',
    parent?.guardianKey,
  );

  const link = ok(
    'the parent is linked to the learner',
    await admin('POST', 'provisioning/guardian-links', {
      guardianKey: parent?.guardianKey,
      learnerKey: learner?.learnerKey,
      relation: 'father',
    }),
  );
  report(
    link?.isVerified === false,
    'a new link is UNVERIFIED: a claim is not access',
    `isVerified=${link?.isVerified}`,
  );

  // This is the boundary that matters. learner-access.ts grants a parent sight
  // of a child's record through a VERIFIED link only, so the same request must
  // be refused before verification and allowed after it.
  const parentToken = (await login(parentName)).token;
  const asParent = client(parentToken);

  refused(
    'an unverified parent cannot read the child\u2019s record',
    await asParent('GET', `engagement/xp?learnerKey=${learner?.learnerKey}`),
    'learning.learner_not_accessible',
  );

  ok(
    'an admin verifies the guardianship',
    await admin('POST', 'provisioning/guardian-links/verification', {
      guardianKey: parent?.guardianKey,
      learnerKey: learner?.learnerKey,
      isVerified: true,
    }),
  );

  const afterVerify = await asParent('GET', `engagement/xp?learnerKey=${learner?.learnerKey}`);
  report(
    afterVerify.body.ok,
    'a verified parent can read the child\u2019s record',
    `${afterVerify.http}`,
  );

  ok(
    'verification can be withdrawn',
    await admin('POST', 'provisioning/guardian-links/verification', {
      guardianKey: parent?.guardianKey,
      learnerKey: learner?.learnerKey,
      isVerified: false,
    }),
  );
  refused(
    'withdrawing verification closes the access again',
    await asParent('GET', `engagement/xp?learnerKey=${learner?.learnerKey}`),
    'learning.learner_not_accessible',
  );

  const guardians = ok(
    'an admin can list a learner\u2019s guardians',
    await admin('GET', `provisioning/learners/${learner?.learnerKey}/guardians`),
  );
  report(guardians?.length === 1, 'the link appears in the list', `${guardians?.length} link(s)`);

  ok(
    'a guardian link can be removed',
    await admin('POST', 'provisioning/guardian-links/remove', {
      guardianKey: parent?.guardianKey,
      learnerKey: learner?.learnerKey,
    }),
  );
  refused(
    'removing it twice is a clean not-found',
    await admin('POST', 'provisioning/guardian-links/remove', {
      guardianKey: parent?.guardianKey,
      learnerKey: learner?.learnerKey,
    }),
    'identity.guardian_link_not_found',
  );

  // ── Roles and lifecycle ──────────────────────────────────────────────────
  console.log('\n── roles and account lifecycle ───────────────────────────');

  ok(
    'a second role can be granted',
    await admin('POST', 'provisioning/roles', {
      userKey: parent?.key,
      role: 'TEACHER',
    }),
  );
  refused(
    'granting the same role twice is refused',
    await admin('POST', 'provisioning/roles', { userKey: parent?.key, role: 'TEACHER' }),
    'identity.role_already_granted',
  );
  refused(
    'an unknown role is refused by name',
    await admin('POST', 'provisioning/roles', { userKey: parent?.key, role: 'PRINCIPAL' }),
    'identity.unknown_role',
  );

  ok(
    'a role can be revoked',
    await admin('POST', 'provisioning/roles/revoke', { userKey: parent?.key, role: 'TEACHER' }),
  );
  refused(
    'the last role cannot be revoked, leaving an account that can do nothing',
    await admin('POST', 'provisioning/roles/revoke', { userKey: parent?.key, role: 'PARENT' }),
    'identity.last_role',
  );

  ok(
    'a user can be suspended',
    await admin('POST', 'provisioning/users/status', { userKey: parent?.key, status: 'SUSPENDED' }),
  );

  const suspendedLogin = await login(parentName);
  report(
    suspendedLogin.token === null,
    'a suspended user cannot sign in',
    suspendedLogin.body?.error?.code ?? `${suspendedLogin.http}`,
  );

  ok(
    'a user can be reinstated',
    await admin('POST', 'provisioning/users/status', { userKey: parent?.key, status: 'ACTIVE' }),
  );
  report((await login(parentName)).token !== null, 'a reinstated user can sign in again');

  ok(
    'a user can be archived',
    await admin('POST', 'provisioning/users/status', { userKey: parent?.key, status: 'ARCHIVED' }),
  );
  refused(
    'an archived user cannot be revived by flipping the status back',
    await admin('POST', 'provisioning/users/status', { userKey: parent?.key, status: 'ACTIVE' }),
    'identity.user_archived',
  );

  ok(
    'a profile detail can be corrected',
    await admin('PATCH', 'provisioning/users', {
      userKey: learner?.key,
      fullName: 'Scenario Learner (corrected)',
    }),
  );
  refused(
    'an unknown user is a clean not-found',
    await admin('GET', 'provisioning/users/usr_no_such_person'),
    'identity.user_not_found',
  );

  console.log(
    failures === 0
      ? `\n✅ ${checks} checks passed — people can be provisioned and used`
      : `\n❌ ${failures} of ${checks} checks failed`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
};

run()
  .catch((error) => {
    console.error('\n💥', error.message);
    process.exitCode = 1;
  })
  .finally(cleanup);
