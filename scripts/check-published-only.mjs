/**
 * End-to-end proof that learners are served published content only.
 *
 * Walks the textbook through every publication state and asks the live API for
 * a next step each time. This exists as a committed script because the claim
 * "draft content is not teachable" is only credible when demonstrated against
 * the running stack, not against a mock.
 *
 * PGlite serves one connection at a time, so each SQL step opens and closes
 * its own client before any HTTP call is made.
 *
 * Usage: node scripts/check-published-only.mjs   (API must be running)
 */
import pg from 'pg';

const API = process.env.API_URL ?? 'http://127.0.0.1:3000';
const TEXTBOOK = 'EDU-MATH-G07-T1-ED2026';
const CONNECTION =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/postgres';

/**
 * PGlite's socket server accepts a single client at a time and the running API
 * holds one pooled connection, so this retries until node-postgres releases it
 * on idle timeout. Without the retry the script fails intermittently with
 * ECONNRESET, which would look like a product bug rather than a dev-database
 * limitation.
 */
async function setStatus(status, attempts = 20) {
  for (let attempt = 1; ; attempt += 1) {
    const client = new pg.Client({ connectionString: CONNECTION });
    try {
      await client.connect();
      await client.query('update textbooks set status=$1 where key=$2', [status, TEXTBOOK]);
      await client.end();
      return;
    } catch (error) {
      await client.end().catch(() => {});
      if (attempt >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

async function login() {
  const res = await fetch(`${API}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier: 'student', password: 'demo1234' }),
  });
  const body = await res.json();
  if (!body.ok) throw new Error(`login failed: ${JSON.stringify(body.error)}`);
  return body.data.tokens.accessToken;
}

async function nextStep(token) {
  const res = await fetch(
    `${API}/api/v1/learning/next-step?textbookKey=${encodeURIComponent(TEXTBOOK)}`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  return { http: res.status, body: await res.json() };
}

const EXPECTED = {
  PUBLISHED: 'served',
  DRAFT: 'refused',
  IN_REVIEW: 'refused',
  ARCHIVED: 'refused',
};

let failures = 0;

for (const [status, expected] of Object.entries(EXPECTED)) {
  await setStatus(status);
  const token = await login();
  const { http, body } = await nextStep(token);

  const actual = body.ok ? 'served' : 'refused';
  const detail = body.ok ? `${http} ${body.data.step.activity}` : `${http} ${body.error.code}`;
  const pass = actual === expected;
  if (!pass) failures += 1;

  console.log(`${pass ? '✓' : '✗'} ${status.padEnd(10)} expected ${expected.padEnd(8)} got ${actual.padEnd(8)} (${detail})`);
}

// Leave the database in the state the seed created.
await setStatus('PUBLISHED');
console.log(failures === 0 ? '\n✅ learners are served published content only' : `\n❌ ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
