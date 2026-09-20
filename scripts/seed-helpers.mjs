/**
 * Test-scenario helpers that need direct SQL.
 *
 * Creating a Textbook row needs a subject/grade/term catalogue, which is
 * administrative setup rather than content authoring — it has no HTTP surface
 * in this gate, so the end-to-end script seeds it directly.
 *
 * PGlite accepts one connection at a time and the API holds one, so every
 * helper retries its connection rather than failing as ECONNRESET.
 */
import pg from 'pg';

const CONNECTION =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/postgres';

export async function withClient(fn, attempts = 20) {
  for (let attempt = 1; ; attempt += 1) {
    const client = new pg.Client({ connectionString: CONNECTION });
    try {
      await client.connect();
      const result = await fn(client);
      await client.end();
      return result;
    } catch (error) {
      await client.end().catch(() => {});
      const retryable = /ECONNRESET|Connection terminated|ECONNREFUSED/.test(String(error));
      if (!retryable || attempt >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

/**
 * Create an empty DRAFT textbook reusing the seeded subject/grade/term.
 *
 * `edition` is what makes it distinct: the schema's uniqueness is
 * (subject, grade, term, edition), which is precisely the "a correction is a
 * new edition" model this gate settled on.
 */
export async function createTextbook(key, edition) {
  return withClient(async (client) => {
    const { rows } = await client.query(
      `select
         (select id from subjects limit 1) as subject_id,
         (select id from grades   limit 1) as grade_id,
         (select id from terms    limit 1) as term_id`,
    );
    const { subject_id, grade_id, term_id } = rows[0];

    await client.query(
      `insert into textbooks (id, key, "termId", "gradeId", "subjectId", title, edition, status, "createdAt", "updatedAt")
       values (gen_random_uuid(), $1, $2, $3, $4, $5, $6, 'DRAFT', now(), now())
       on conflict (key) do nothing`,
      [key, term_id, grade_id, subject_id, `Scenario ${edition}`, edition],
    );
    return key;
  });
}

/** Remove a scenario textbook and everything under it. */
export async function dropTextbook(key) {
  return withClient(async (client) => {
    await client.query('delete from textbooks where key = $1', [key]);
    // A question has no foreign key to a textbook -- it reaches one only
    // through its concept links -- so deleting the book cascades the concepts
    // and the links but strands the question rows themselves. Left behind they
    // accumulate across runs and make any "count the rows afterwards" check
    // meaningless. Deleted by the condition that actually defines the garbage:
    // a question that no longer measures anything.
    //
    // Except where the schema says otherwise. Two tables reference a question
    // with RESTRICT rather than CASCADE, and both are deliberate: attempt_items
    // is a record of what a learner was actually asked, and exam_items is a
    // paper's composition. Deleting the question would turn either into a
    // reference to nothing. The cleanup honours those constraints instead of
    // working around them -- this is the schema telling the test helper where
    // its authority ends.
    await client.query(
      `delete from questions q
        where not exists (select 1 from question_concepts qc where qc."questionId" = q.id)
          and not exists (select 1 from attempt_items ai where ai."questionId" = q.id)
          and not exists (select 1 from exam_items ei where ei."questionId" = q.id)`,
    );
  });
}

/**
 * Remove a provisioned person and everything that hangs off them.
 *
 * Roles, profiles, enrollments, guardian links and sessions all cascade from
 * `users`, so one delete is enough -- but only for someone who has produced no
 * evidence. A learner who has answered a question is referenced by attempt
 * rows with RESTRICT, and that refusal is correct: their history is a record of
 * what actually happened. Scenario users in these scripts never answer
 * anything, so they delete cleanly.
 */
export async function dropUser(key) {
  return withClient(async (client) => {
    await client.query('delete from users where key = $1', [key]);
  });
}
