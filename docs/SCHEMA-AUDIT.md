# Schema audit — id, key, ordinal, and what the seed files may claim

Written 2026-09-14, in answer to a direct question: *why do some models carry
`id`, `key` and `ordinal` at the same time, and do the seed JSON files drive
the schema or follow it?*

Everything below was measured against `prisma/schema.prisma` at this commit,
not recalled.

---

## 1. The three columns, and the job each one does

They are not three ways of saying the same thing. Each answers a different
question, and removing any of them moves its question onto a column that
answers it worse.

| Column | Answers | Who uses it | Shape |
|---|---|---|---|
| `id` | "which row is this, internally?" | Foreign keys, joins, Prisma relations | UUID, never shown to users, regenerable |
| `key` | "what is this thing, stably and readably?" | URLs, API paths, cross-file references in seed data, humans | Short string, globally unique, frozen at creation |
| `ordinal` | "where does this sit in an ordered list?" | Sorting terms (T01, T02), grades (G01..G12), retrieval chunks | Integer, 1-based |

**Why both `id` and `key`.** A foreign key needs an identifier that can never
change and never carries meaning; a business identifier needs to be readable in
a URL (`/admin/schools/sch_demo`) and stable across exports. Making the
human-readable string THE primary key means a rename is a data migration — the
legacy system learned this when renaming a school orphaned rows that pointed at
the name. Making the UUID the only identifier means every URL and seed file is
full of `c8eab716-baeb-4bd1-98f6-0155b2c113b5`. So: `id` for the database's
plumbing, `key` for everything a person reads, and relations always join on
`id` — never on `key`.

**Why `ordinal` is not "just sorting by key".** It would be, if keys were
uniformly zero-padded (`G07`), and for grades they are. But an ordinal column
says the *order is data*, decided by the operator, not a property of a string.
Terms prove the point: `2026-2027-T01` sorts correctly only while every year
has exactly the same number of zero-padded terms, and a summer term inserted
as `T02B` breaks it forever.

### Who carries what

Measured across all 44 models:

- **All 44** have a UUID `id` — except `SystemSetting`, which is keyed by its
  `key` alone: a settings row has no relations to orphan and no lifecycle, so
  the simpler shape wins.
- **25** carry a `key`: everything reference-like (School, Grade, Subject,
  Term, AcademicYear, Textbook, Unit, Lesson, Concept, Misconception,
  Flashcard, Question, Exam, Attempt, the three profiles, the plan and
  obligation models). Rows that only exist as part of another row's story —
  `Session`, `UserRole`, `TextbookAdoption`, `ConceptPrerequisite`,
  `QuestionChoice`, `AnswerKey`, `QuestionConcept`, `ExamItem`, `AttemptItem`,
  `MasteryEvidence`, `ConceptMastery`, `LearnerMisconception`,
  `LearningDecisionLog`, `XpLedgerEntry`, `AiInteraction`, `AuditEntry` — have
  no key, because nothing outside the database ever needs to name them.
- **3** carry an `ordinal`:
  - `Term.ordinal` — unique **within its year** (`@@unique([academicYearId, ordinal])`), so two years can both have a first term.
  - `Grade.ordinal` — unique across the table (the national ladder, G01..G12).
  - `ContentChunk.ordinal` — the stable position of a retrieval chunk inside
    its source, kept because vector search will be added later and re-ordering
    chunks then would silently invalidate stored embeddings.

### The one denormalisation, and why it is deliberate

`ContentChunk` carries `lessonKey` and `conceptKey` as plain strings beside the
`pageId` foreign key. This is not drift: a chunk may hang off a lesson, a
concept, or a page, and the retrieval query filters by those keys directly.
It is the only model where a `key` is stored as a *column* rather than joined,
and it is called out here so a future audit does not "fix" it into a join the
retrieval path cannot afford.

---

## 2. What may change after creation — and why

The restricted edit surfaces are not missing features; each frozen column has
a written reason, recorded here in one place:

| Model | Frozen on edit | Reason |
|---|---|---|
| everything with a `key` | `key` | Other rows and URLs point at it. Renaming is "create a new row and migrate", which a text input must not imply it can do. |
| `Grade` | `ordinal` | It is encoded in the key (`G07` ⇒ 7). Changing it would require renaming the grade, orphaning every textbook and enrolment pinned to the old key. |
| `Term` | `ordinal`, `academicYearKey` | Both are encoded in the key (`2026-2027-T01`). The key is the year plus the zero-padded ordinal; there is no independent ordinal to change. |
| `AcademicYear` | `key`, `isCurrent` | The key is the year pair itself. `isCurrent` is not a PATCH field because two rows current at once is possible through it; the dedicated "make current" endpoint clears the others in one transaction. |
| `Subject`, `School` | `key` only | Everything else — names, city, `isActive` — is patchable. |

The admin modal now follows this table exactly: a field appears in **create**
or in **edit** or in both, and a field that the save call would silently
ignore is never shown as an input. Full control means control over everything
the schema actually permits, with the frozen columns visible in the table and
absent from the edit form.

---

## 3. The seed JSON files follow the schema — not the other way round

The direction of authority, as a standing rule:

> A field exists in `prisma/schema.prisma` because the domain needs it — never
> because a seed file happens to carry it. When they disagree, **the seed file
> changes**.

Audited at this commit, file by file, every field in every row of
`prisma/seed/data/*.json` against the generated schema:

| File | Sections | Result |
|---|---|---|
| `academic-structure.json` | AcademicYear, Term, Grade, School | every field is a real column or a `*Key` reference the seed resolves to an `id` |
| `subjects.json` | Subject | matches (key, name, nameEn, isActive) |
| `demo-users.json` | User | matches; `roles` and `password` are seed-only directives consumed by the seeder, not columns |

Nothing in the JSONs is waiting for a schema field, and nothing was added to
the schema for the JSONs' sake. This is enforced, not assumed:
`tests/unit/seed-foundation-data.test.ts` reads the generated Prisma schema
and fails the build when a JSON field stops matching a column — the `$comment`
in each file states the contract.

---

## 4. Findings

1. **No unused triples.** No model carries an `id`/`key`/`ordinal` combination
   it does not use; no model has a `key` nothing references; no `ordinal`
   exists without an ordering that needs it.
2. **One inconsistency of shape, intentional:** `SystemSetting` has no `id`.
   Documented above.
3. **One denormalisation, intentional:** `ContentChunk.lessonKey/conceptKey`.
   Documented above.
4. **The edit surfaces match the freeze table** (and where the modal used to
   show a frozen field as a live input, that is fixed in the same change as
   this document — the input is now hidden on edit rather than silently
   ignored).
