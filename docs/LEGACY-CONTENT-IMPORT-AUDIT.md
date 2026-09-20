# Legacy content conversion + student dashboard — Phase 1 audit

Evidence gathered by reading the legacy data files, the new Prisma schema, the
canonical import contract and the live API. No API, field or rule below is
invented; everything is quoted from the repository or from a live response.

---

## 1. What the legacy configuration actually contains

`data/demo/` holds seven subjects, each as three files
(`-canonical-hierarchy.json`, `-canonical-prerequisites.json`,
`-canonical-questions.json`), declaring `"$schema":
"eduinsight/curriculum-template@2.0"`.

Measured, not estimated:

| subject | units | lessons | concepts | questions | prereqs |
|---|---|---|---|---|---|
| math | 7 | 27 | 55 | 110 | 54 |
| science | 9 | 31 | 57 | 114 | 56 |
| arabic | 1 | 2 | 3 | 6 | 2 |
| english | 1 | 1 | 1 | 2 | 0 |
| islamic | 1 | 1 | 2 | 4 | 1 |
| geography | 1 | 1 | 2 | 4 | 1 |
| civics | 1 | 1 | 2 | 4 | 1 |
| **total** | **21** | **64** | **122** | **244** | **115** |

**Only math and science are real.** The other five are one-unit stubs. Any
claim that Edu7 has "seven subjects of content" after this conversion would be
false; it has two, plus five placeholders.

Also present and **not** in the question/hierarchy counts above: **66
misconceptions** and **122 remedial resources** attached to concepts. These
matter — they are what makes remediation targeted rather than generic.

`config/textbook/` holds `.xlsx` sources and Drive manifests. Out of scope
here: the conversion target is JSON, and a zero-dependency XLSX codec is an
already-paused decision (see session notes), not a prerequisite for this work.

---

## 2. The canonical target contract

`src/contexts/content/domain/export-profile.ts` defines `ContentPackage`:

```
meta, textbook, units[], lessons[], concepts[], prerequisites[], questions[]
```

`src/contexts/content/application/content-import.service.ts` (528 lines)
imports exactly that shape and states its own rule in its header comment:

> This service owns NO persistence. Every write goes through
> `ContentAuthoringService` — the same methods the HTTP API calls … an importer
> is a bulk adapter, never a second write path. Legacy made 19 direct Prisma
> calls from its importer and ended up with two different definitions of valid
> content.

**So the conversion must emit `ContentPackage` JSON and feed
`POST /content/textbooks/import`.** Writing a separate seeding script that
touches Prisma directly would rebuild precisely the defect the new
architecture was created to remove.

### 2.1 Shape differences that require real mapping

These are not cosmetic renames; each is a semantic decision.

| legacy | canonical | why it differs |
|---|---|---|
| `conceptKey: EDU-2026-MATH-G07-T1-U01-L01-C01` | `slug` + derived `key` | New keys are `EDU-<SUBJ>-G<nn>-T<n>-ED<edition>-U-<slug>-L-<slug>-C-<slug>`. Ordinal keys (`U01`, `C01`) are **forbidden** by the key-identity audit: a key that moves with `orderIndex` silently returns another concept's mastery. |
| `choices[].isCorrect` | `answerKey.correctChoiceIds[]` | `question_choices` has **no `isCorrect` column**. Correctness is one fact per question, in `AnswerKey`. Storing it per choice allows a question with zero or four correct answers. |
| `questionType: "mcq"` | `type: MCQ_SINGLE` | Enum. All 244 legacy questions are `mcq`; single-answer is the correct mapping, and it must be *derived from the answer key*, not assumed. |
| `answerKey.answerData: "<text>"` | `correctChoiceIds: ["c1"]` | Legacy repeated the correct choice's **text**. Matching on text is fragile; the canonical form references the author's local choice id. |
| `misconceptions[]`, `remedials[]` on a concept | **absent from `ContentPackage`** | See gap G7 below. |
| `bloomLevel`, `nameEn`, `estimatedTime`, `branch`, `importance` | partly absent | `importance` and `pageNumber` exist on `ConceptExport`; `bloomLevel`, `nameEn` and `branch` have no home. |

### 2.2 Choice identity

`QuestionChoiceExport.id` is documented as "the author's local handle ("a",
"b", or a positional "c1"), not the stored identifier", and
`answerKey.correctChoiceIds` references it. Legacy choices have no id at all —
only `orderIndex`. The converter must therefore **mint** local ids
deterministically (`c1..cN` from `orderIndex`) so re-running the conversion
produces byte-identical output.

---

## 3. Gap G7 — misconceptions and remedials have no canonical import path

**Evidence.** `ContentPackage` has seven arrays; none carries misconceptions or
remedial resources. `ConceptExport` has fifteen fields; none is
`misconceptions` or `resources`. Yet the schema has `Misconception`,
`LearningResource` and `QuestionChoice.misconceptionId`, and that last column
carries this comment:

> A distractor that maps to a named misconception turns a wrong answer into a
> diagnosis. This link is what powers targeted remediation.

**Impact.** Converting today drops 66 misconceptions and 122 remedials. The
content would import "successfully" while the remediation engine — a headline
capability of this platform — has nothing subject-specific to work with.

**Additional finding.** Legacy choices carry `feedback` text but **no**
misconception reference (verified: 440 choices, 0 with any misconception key).
So even with G7 closed, `QuestionChoice.misconceptionId` cannot be populated
from this data. Linking distractors to misconceptions is an **authoring** task,
not a conversion task, and claiming otherwise would be inventing pedagogy.

**Classification: CRITICAL for the data, SPECULATIVE for the links.** Extending
the package profile is a contract change and needs the owner's decision, not a
unilateral edit — so this audit stops here and asks.

---

## 4. The old student dashboard

`src/components/dashboards/StudentDashboardView.tsx` — 423 lines, plus
`student/` (7 files, 1 252 lines). Its own header comment states the design
intent:

> «الفصل الذهبي» بين (١) مهام اليوم القابلة للتنفيذ و(٢) رحلة التعلم التراكمية …
> صفر بيانات وهمية — كل رقم من الخادم

It splits **today's actionable work** from **the cumulative journey**, and it
has a junior/senior mode switch (`JuniorStudentDashboard` /
`SeniorStudentDashboard`, `resolveDefaultMode`).

### 4.1 Its five data calls, mapped to canonical capabilities

All five verified live against the running API just now:

| legacy call | canonical replacement | live check |
|---|---|---|
| `/learning/students/:id/dashboard` | `GET /learning/path` + `GET /learning/next-step` | 200 — `activity: REVIEW`, `rule: spaced_review_due` |
| `/learning/students/:id/assigned-exams` | `GET /instruction/due-work` | 200 — `{academic:[], advisory:[], summary:{outstanding:0}}` |
| `/learning/students/:id/mastery` | `GET /learning/mastery` (+ `path.progress`) | 200 — 3 concepts, 1 `IN_PROGRESS`, 2 `LOCKED` |
| `/learning/students/:id/recommendations` | `GET /learning/next-step` | 200 — one authoritative next step |
| `/learning/students/:id/exam-attempts` | `GET /assessment/attempts` | 200 — `{attempts:[]}` |
| *(gamification in the old UI)* | `GET /engagement/xp` | 200 — `level 1, totalXp 0, toNextLevel 400` |

**Every capability the old dashboard needs already exists.** No backend gap
blocks the dashboard itself — which is why G7 above is about *content*, not
about the page.

### 4.2 What must change in the copy

- **`:studentId` in the path is gone.** The new API derives the learner from
  the token, and delegated reads use `?learnerKey=`. A student cannot request
  another student's dashboard by editing a URL.
- **Five parallel requests → scoped hooks.** Note the schema gotcha: *PGlite is
  single-connection*; the client already serialises through react-query, but a
  hand-rolled `Promise.all` against the dev database is a known hazard.
- **`recommendations[]` → one `next-step`.** The old UI ranked a list client-
  side with `priorityScore`. The new system returns **one** decided step with a
  `rule` id and `rationale`. Re-ranking it in the UI would move an educational
  decision back into React — banned by FE rules and by §5 of the delivery
  protocol.
- **`POST /learning/recommendations/:id/complete` has no equivalent** and must
  not be invented: completion is derived from evidence, not self-declared.

---

## 5. Risks and contradictions

1. **Two subjects, not seven.** Stated plainly above so the demo cannot be
   mistaken for a full curriculum.
2. **The seed owns `EDU-MATH-G07-T1-ED2026`.** The live textbook has 3
   concepts; legacy math has 55. Importing must either target a *new* textbook
   key or be reconciled with the seed — silently doubling concepts under one
   key would corrupt the existing mastery demo.
3. **Import is `dryRun: true` by default** (recorded decision). Conversion
   output must be validated dry before any write.
4. **`status` is not importable** — "a question is published by SUBMIT then
   APPROVE, by two different actors, and an import must not shortcut a review."
   So converted questions arrive as DRAFT and will **not** be served to
   learners until reviewed. This is correct, and it means conversion alone does
   not make content visible.

---

## 6. Decisions needed before implementation

- **G7 scope:** extend `ContentPackage` with misconceptions + remedials
  (contract change), or convert without them and accept losing 188 records?
- **Textbook identity:** import math/science under new keys alongside the
  seeded demo textbook, or replace the seed?
- **Dashboard scope:** port the junior/senior split, or land the senior layout
  first against the fixed section order already agreed?

---

# Phase 1–4 delivered: contract, converter, dry run, import

All three decisions were taken as recommended. What follows is what was built
and what proves it.

## 7. G7 closed — the contract now carries the 188 records

`ContentPackage` gained two first-class collections, not fields on a concept:

```
misconceptions[]     slug, unitSlug, lessonSlug, conceptSlug, name,
                     description, correction
learningResources[]  slug, …, kind, title, body, url, orderIndex,
                     pageStart, pageEnd, estimatedMins
```

They are entities rather than concept attributes because both are referenced
from elsewhere: a distractor points at a misconception, a remediation episode
is opened against one, and `LearnerMisconception` carries one per learner.
Nesting them inside a concept would make those references unaddressable.

Both are **optional** on the package, so every file written before this change
is still valid; an importer treats absent and empty identically.

Identity follows the existing rules. Reference by slug path
(`unit/lesson/concept`), because a package retargeted at a new edition must
not need key rewriting. The stored key is derived —
`<conceptKey>-MIS<fingerprint>` and `<conceptKey>-RES<fingerprint>` — and is
never supplied by the file, because `key` is in `NON_IMPORTABLE_FIELDS`.

The write path goes through `ContentAuthoringService.createMisconception` and
`.createLearningResource`, which take the same write lock, the same slug
resolution and the same audit log as every other content write. The importer
gained no privileges.

**Distractor links are still not generated.** Legacy choices carry `feedback`
but no misconception reference (440 choices, 0 links). Inferring that a given
feedback string means a given named error would be inventing pedagogy, so
`misconceptionKey` is emitted as `null` on every choice and linking remains an
authoring task.

## 8. The converter

`scripts/convert-legacy-curriculum.mjs`. It never opens a database, never
imports Prisma and never writes content — it reads JSON and writes JSON.

Properties that are enforced, not hoped for:

- **Deterministic.** Verified byte-identical across runs (`md5sum` diff).
  `exportedAt` is fixed rather than `new Date()`, which would have destroyed
  this on its own.
- **Refuses rather than guesses.** An unmapped `remedials[].contentType` is a
  hard error; a question with anything other than exactly one correct choice
  is rejected; an unresolvable concept reference stops the run.
- **Local choice ids** `c1..cN` from `orderIndex`, which is what
  `answerKey.correctChoiceIds` references. Legacy repeated the correct
  choice's *text*, which is fragile.
- **Slug truncation.** Ten legacy names exceed the 32-character limit. The cut
  falls back to the last separator when that leaves ≥16 characters, so slugs
  stay readable; a sibling collision is fatal, because silently merging two
  concepts would merge two learners' mastery.

### 8.1 Three defects the conversion exposed

**Empty `key` fields broke integrity checking.** Keys are derived on import, so
the converter first emitted `key: ''`. But `checkPackageIntegrity` resolves
prerequisite edges against `concept.key`, and every one of the 115 edges looked
like a dangling reference. A real export reports derived keys; so does this.
Found by running the canonical validator instead of trusting the converter's
own checks.

**A dry run reported zeros.** It validated correctly and then answered
`created: {units: 0, …}`. A reviewer deciding whether to apply a package needs
the counts — "122 concepts, 66 misconceptions" is checkable against the source;
a row of zeros is not. The dry run now reports what the package contains.

**A dry run passed and the real import failed 363 times.** A package *targets*
a textbook; it does not create one. That was only discovered by the first unit
write, so the preview was clean and the apply was not — precisely the failure a
dry run exists to prevent. `import.textbook_not_found` is now checked up front,
before anything is written.

## 9. Textbook identity

The seed occupies `EDU-MATH-G07-T1-ED2026`. The converted curriculum therefore
uses edition **`NAT2026`** — the 2026 national curriculum — rather than
inventing a printing year the source never claims. The seeded demo book was
verified untouched after import: still 3 concepts, its mastery demo intact.

Importing also required two catalogue facts that did not exist: the term key is
`2026-2027-T01` (year-scoped), not the `T1` fragment inside a textbook key, and
only `MATH` was seeded as a subject. The seed now carries all seven subjects as
catalogue rows — which say the subject exists, not that anything is written for
it.

## 10. Evidence

| step | result |
|---|---|
| canonical integrity check, 7 packages | **ok=true, 0 problems** each |
| determinism | **byte-identical** across runs |
| dry run (math) | 0 problems; would create 7/27/55/54/**55**/**55**/110 |
| real import (math) | `applied=true`, created exactly the same counts, 0 problems |
| real import (science) | 9/31/57/56/**1**/**57**/114, 0 problems |
| **re-import** | `created: 0` everywhere, all rows `unchanged` — **idempotent** |
| database | misconceptions **57**, learning_resources **114** |
| seed book | `EDU-MATH-G07-T1-ED2026` still **3 concepts** — not merged |
| tests | backend **864 passing / 47 files**, 28 rules; frontend 13/13, 23 |

Science contributes only 1 misconception because the source has only 1; the
converter did not invent the other 56.

## 11. What is NOT done

- **The content is `DRAFT` and invisible to learners.** Import does not
  shortcut review: publication is SUBMIT then APPROVE by two different actors.
  A successful import is not a claim that students can see anything.
- **Export does not yet report the new collections.** `readExportable` reads
  misconceptions only through choices, so a round-trip export currently returns
  `misconceptions: []` even though 57 rows exist. Import is complete; export
  parity is outstanding.
- **The five stub subjects remain stubs.** Converting them did not create
  content that is not in the source.
