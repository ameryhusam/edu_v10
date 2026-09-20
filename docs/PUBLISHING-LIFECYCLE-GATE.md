# Content Readiness Lifecycle — Design Gate

*(formerly "Publishing Lifecycle" — renamed by owner ruling, 2026-09-12)*

**Status: gate document, accepted and implemented. Corrected by Revision 2 —
read [§10](#10-revision-2--edu7-does-not-publish-textbooks-owner-ruling-2026-09-12)
FIRST.**

> **Edu7 does not publish or approve textbooks.** A textbook enters the system
> as an externally approved source. The lifecycle below governs one thing only:
> whether Edu7's own ingested copy is complete and consistent enough to serve
> to learners. Read every "publish" in §§1–9 as **"activate for use inside
> Edu7"**. §10 records the ruling, the audit behind it, and what was and was
> not renamed.

Preceded by [`KEY-IDENTITY-AUDIT.md`](KEY-IDENTITY-AUDIT.md) (closed: keys are
edition-based and slug-derived). This gate settles the one dimension the
readiness check found unsettled — publication — and answers the question the
owner put ahead of any new entity:

> What does **revision** mean in the current model, and can the existing
> `Textbook` represent it *without* a new entity?

**Answer: yes. No `ContentVersion`, no `TextbookRevision`, no new table.**
The reasoning is in §3, and it is the same discipline that killed the `Class`
entity: an entity earns a table only by passing the three tests.

---

## 1. Decisions

### 1.1 One axis

`PublicationStatus { DRAFT, IN_REVIEW, PUBLISHED, ARCHIVED }` is the **only**
representation of publication state. No `isPublished` boolean, ever.

Evidence for the prohibition, from legacy (`textbook-snapshot.service.ts:653`):

```ts
curriculumStatus: c.status === 'PUBLISHED' ? 'ACTIVE' : (c.status || 'ACTIVE'),
isPublished:      c.isPublished !== false || c.status === 'PUBLISHED',
```

Two fields for one fact, reconciled by guessing, using a status value
(`'PUBLISHED'`) that the canonical constant never defined. `publishedAt` stays
as a **timestamp**, never as the answer to "is this published".

### 1.2 The state machine

```
DRAFT ──submit──> IN_REVIEW ──approve──> PUBLISHED ──archive──> ARCHIVED
  ^                   │                                            │
  └──── reject ───────┘                    restore ────────────────┘
                                              (→ PUBLISHED)
```

| From | To | Allowed | Guard |
|---|---|---|---|
| DRAFT | IN_REVIEW | ✅ | structural validation passes (§2) |
| IN_REVIEW | DRAFT | ✅ | reviewer rejects **with a reason** |
| IN_REVIEW | PUBLISHED | ✅ | required layers approved; sets `publishedAt`; **locks structure** |
| PUBLISHED | ARCHIVED | ✅ | withdrawn from use |
| ARCHIVED | PUBLISHED | ✅ | restore |
| **PUBLISHED** | **DRAFT** | ❌ | **never** |
| **ARCHIVED** | **DRAFT** | ❌ | **never** |
| DRAFT | PUBLISHED | ❌ | review is not optional |
| any | itself | ❌ | a no-op transition hides a bug |

The two `❌ never` rules are the load-bearing ones. Un-publishing content that
learners have already been assessed against would retroactively change what
their evidence was *about*.

`IN_REVIEW` is retained and given the meaning legacy lacked: it is what makes
`CONTENT_AUTHOR` and reviewer genuinely different roles rather than one role
with two names.

### 1.3 Published content is structurally immutable

Ported in intent from legacy, where it is enforced at **15 call sites**
(`curriculum.repository.content.ts:723, 767, 797, 882, 925, 961, 1069, 1117…`)
via `assertTextbookWritable`: every content write — unit, lesson **or** concept
— walks up to its textbook and refuses if that textbook is locked.

The justification is specific to this product:

> Mastery is computed from evidence tied to `conceptKey`. If a published
> concept could be edited or removed underneath a learner, their mastery
> history would silently change meaning. Immutability of published content is
> a **precondition for mastery being interpretable**, not an editorial nicety.

**Structural vs. non-structural.** Legacy locked everything, which is stricter
than necessary and pushed authors toward workarounds. We distinguish:

| Change to published content | Allowed | Why |
|---|---|---|
| Add/remove/reorder a unit, lesson or concept | ❌ | changes what the learning path *is* |
| Change a `slug` (i.e. a key) | ❌ | breaks every stored reference |
| Change `masteryThreshold`, `difficulty`, prerequisites | ❌ | changes pedagogical meaning; mastery is computed from these |
| Fix a typo in `name`, `description`, `title` | ✅ | presentational; changes nothing computed |
| `orderIndex` | ❌ | it *is* the structure, even though it is not identity |
| Add a `LearningResource` link | ✅ | additive, not part of the learning path |

The rule in one line: **anything the learning or mastery engines read is
frozen; pure presentation is not.**

---

## 2. Structural validation

Runs on `DRAFT → IN_REVIEW`, as a **pure function** in `content/domain/`, so a
textbook cannot reach review in a state that would break the engines.

Legacy's per-layer review gate (`textbook-content-review.service.ts`) is good
and is adopted:

```ts
CONTENT_REVIEW_LAYERS = ['unit','lesson','concept','remedial','misconception','question']
REQUIRED_LAYERS       = ['unit','lesson','concept']
```

with its structural errors (`no units` / `no lessons` / `no concepts`) and its
`readyForPublish` computation.

Rules enforced:

1. **No prerequisite cycles.** `A → B → A` makes `decideNextActivity`
   non-terminating. Already implemented and tested in
   `prerequisite-graph.ts` — reused, not rewritten.
2. **Prerequisites stay in scope** — a concept may not require a concept from
   another textbook (legacy rule LD-2: a *named refusal before any write*).
3. **Contiguous `orderIndex`** within each parent — no gaps, no duplicates.
4. **Non-empty** — ≥1 unit, ≥1 lesson, ≥1 concept (legacy's required layers).
5. **Ranges** — `masteryThreshold ∈ (0,1]`, `strength`/`requiredMastery ∈ [0,1]`.
6. **Every concept reachable** — no orphan under an inactive parent.

Validation returns *all* failures at once, not the first. An author fixing a
textbook one error per submit is a UI that wastes their afternoon.

---

## 3. Revision — investigated, no new entity

Applying the three entity tests, as directed.

### 3.1 What the current model already has

`Textbook.revision Int @default(1)` exists — and is **never read or written**
anywhere in the new codebase. A column, not a behaviour.

### 3.2 What legacy did — and undid

The decisive evidence: **legacy had a `CurriculumVersion` entity and deliberately
removed it.** The schema still carries the scar:

```prisma
// سنة إصدار الطبعة المطبوعة (كانت editionYear على CurriculumVersion)
// العلاقات المعاد توجيهها (كانت عبر CurriculumVersion — تنظيف معماري 2026-09-03)
```

*("was editionYear on CurriculumVersion"; "relations redirected — architectural
cleanup 2026-09-03".)* A previous team built the versioning entity, found it
was the wrong shape, and folded identity back onto `Textbook`. Re-introducing
it now would be repeating an experiment whose result is recorded in the schema.

What legacy kept instead was `version String @default("1.0")` — a **label**,
not a structure. Nothing branches on it.

### 3.3 The three tests

| Test | Result |
|---|---|
| Independent lifecycle | ❌ A revision is created by publishing and ends by being superseded. Both are `Textbook` status events. |
| Ownership | ❌ Every attribute a revision would hold — title, edition, status, `publishedAt`, the whole content tree — already belongs to `Textbook`. |
| Business responsibility | ❌ No pedagogical decision is made *about a revision*. Learners are taught a textbook; mastery is tied to concepts. |

Three failures out of three, exactly as with `Class`.

### 3.4 The resolution

**A corrected textbook is a new `Textbook` row, distinguished by `edition`.**

This falls out of the key ruling already made. Since identity is
`subject + grade + term + printed edition`, a corrected book is *already* a
different key:

```
EDU-MATH-G07-T1-ED2026        PUBLISHED   ← taught in 2026/27
EDU-MATH-G07-T1-ED2026-REV2   PUBLISHED   ← corrections; taught from 2027/28
```

Both may be published simultaneously, because `TextbookAdoption` says which
school teaches which edition in which year. A learner's mastery stays attached
to the concepts of the edition they were actually taught — which is the
correct answer, not a compromise: their evidence was gathered against *that*
book.

`Textbook.revision Int` is therefore **removed**. It is an unused second axis
next to `edition`, and this gate exists partly to eliminate exactly that
pattern.

**What is deliberately NOT built:** automatic content copying between editions.
Legacy's adoption service states the principle plainly — *"لا نستخدم سنة موجودة
على Textbook ولا ننسخ شجرة المحتوى"* (don't use a year on Textbook, don't copy
the content tree). Cloning a tree is an authoring convenience that belongs to
the import/authoring capability, if it is ever wanted; it is not part of the
lifecycle.

**Trigger to revisit:** if a requirement appears for *diffing* two editions, or
for tracking who changed which field when, that is an audit/history concern —
`AuditEntry` already exists and already carries `requestId`. It still would not
be a version entity.

### 3.5 `isTemplate` is not needed

Legacy added `isTemplate Boolean` to distinguish reusable "standard" books from
year-bound operational copies. That flag exists **because** legacy keyed
textbooks on academic year and needed a way to say "this one is reusable".

Our textbooks are already year-free by construction. Every textbook is reusable
across years; adoption records the years. `isTemplate` solves a problem we no
longer have, and is not introduced.

---

## 4. Reads must respect publication

Today a `DRAFT` textbook is fully teachable — nothing filters content reads by
status. That is a live defect, not a missing feature, and it must be fixed
**with** the lifecycle:

| Reader | Sees |
|---|---|
| Learner-facing reads (next-step, mastery, tutoring, assessment) | `PUBLISHED` only |
| `CONTENT_AUTHOR` / reviewer authoring reads | every status, role-scoped |
| `ARCHIVED` | never in learner reads; visible in authoring and history |

Identity already supplies scoped roles for the authoring case (R2).

**Consequence to accept knowingly:** the seed publishes its textbook, so the
demo keeps working. Any unpublished content becomes invisible to learners the
moment this lands — which is the point.

---

## 5. Layering

```
content/domain/          pure: transitions, validation, cycle detection
      ↓
content/application/     use cases over ports
      ↓
interface/http/          /api/v1/content, one envelope, handle()
      ↓
Admin UI                 renders and calls — decides nothing
```

The UI never decides publication rules, prerequisite validity, or link
legality. Rules D1–D3 and I1 already enforce the layering mechanically.

---

## 6. Acceptance criteria

1. One status axis; no `isPublished` anywhere; `Textbook.revision` removed.
2. Every illegal transition refused **by name**, with a reason. `PUBLISHED →
   DRAFT` and `ARCHIVED → DRAFT` impossible. Self-transitions refused.
3. The state machine is a pure function, tested **exhaustively over all
   (state × action) pairs** — 4 states × 5 actions = **20 cases**, not a
   sample. (An earlier draft of this document said 16; that miscounted the
   actions.)
4. Published content structurally immutable, enforced for unit, lesson **and**
   concept writes through one guard that walks to the textbook. Presentational
   edits explicitly permitted per §1.3.
5. Structural validation returns **all** failures at once; reuses the existing
   tested `prerequisite-graph.ts` for cycles.
6. Learner-facing reads return only `PUBLISHED`; authoring reads are
   role-scoped.
7. No new entity for revision. A correction is a new `Textbook` with a new
   `edition`.
8. No import functionality.
9. Slug immutability proven by test: renaming a concept changes neither `slug`
   nor `key`; attempting to change a `slug` is refused.

---

## 7. Open question carried forward

Slug source at creation — auto-derive from name then freeze, versus
author-typed. Owner has approved the shape:

```
name → default slug → author may override → slug frozen → key derived
```

Explicitly **not** allowed: renaming regenerates the slug. That would
reintroduce the identity defect under a different name. Criterion 9 above tests
exactly this.

---

## 8. Implementation status

Updated 2026-09-11.

| # | Criterion | State | Evidence |
|---|-----------|-------|----------|
| 1 | One axis, no `isPublished`, `revision` removed | ✅ | Column absent from the regenerated baseline and from the live `textbooks` table |
| 2 | Illegal transitions refused by name | ✅ | `publication.ts`; named codes asserted in unit tests and over HTTP |
| 3 | Exhaustive 20-pair transition test | ✅ | `tests/unit/publication.test.ts` enumerates every state × action |
| 4 | Structural immutability enforced on writes | ✅ | One guard (`assertWritable`) covers unit, lesson and concept creates, updates, reorders and prerequisite links; proven live for all four |
| 5 | Validation returns all failures, reuses `detectCycles` | ✅ | `structural-validation.ts`; mutation-tested |
| 6 | Learner reads return `PUBLISHED` only | ✅ | `published-content.ts` + rule PUB1; live across all four states |
| 7 | No revision entity | ✅ | §3 |
| 8 | No imports | ✅ | Nothing added |
| 9 | Slug immutability proven by test | ✅ | Rename changes neither slug nor key; slug change refused `content.slug_immutable`; verified in unit tests and live over HTTP |

**Gate closed.** All nine criteria met.

**The live defect named in §4 is closed.** Before this change a DRAFT textbook
was fully teachable: `next-step` returned a complete LEARN step with resources.
The status was checked on questions alone (`assessment.repository.ts:56`),
exactly as in legacy. It now returns `learning.no_concepts_in_scope` for DRAFT,
IN_REVIEW and ARCHIVED, and is unchanged for PUBLISHED.

The fix is one shared filter derived from `isVisibleToLearners`, not a status
literal per query — the per-query form is what drifted in legacy. Architecture
rule **PUB1** fails the build if a new database read hardcodes a publication
status without composing the shared fragment. PUB1 was negative-tested in both
directions: planted in code it fires, planted in a comment it stays silent.
It needed a `stripComments` helper that preserves string literals, because the
existing `stripCommentsAndStrings` blanked the very literal the rule matches —
the first version of the rule was vacuous and passed unconditionally.

**Remaining for this gate:** the authoring write path (criteria 4 and 9) —
application services, HTTP routes, and the slug-immutability proof.

---

## 9. What was built on top of the gate

The gate's own scope was the lifecycle. Closing criteria 4 and 9 required the
authoring write path, so that was built with it:

| Layer | File |
|-------|------|
| Domain | `content/domain/authoring.ts` — slug contract, field allow-lists, reorder validity |
| Application | `content/application/authoring.service.ts` — create/update/reorder/link, one write guard |
| Application | `content/application/publishing.service.ts` — transitions + the structural gate |
| Infrastructure | `infrastructure/database/content.repository.ts` — the ONLY content writer |
| Interface | `interface/http/content.routes.ts` — nine endpoints, role-gated |

### Decisions taken while building

**Structure is validated on SUBMIT, not on APPROVE.** A reviewer should be
reading content, not discovering a prerequisite cycle. By the time a human
opens it, the book is already known to be traversable.

**An author cannot approve their own submission.** Separating SUBMIT from
APPROVE only means something if a second party can be required for the second
step, so APPROVE demands an admin role. This is privilege separation, not yet
identity separation — a full four-eyes rule needs to compare the approver
against the submitter recorded in the audit trail. Named as a follow-up rather
than silently approximated.

**Reordering is a complete list, never "move X to position 3".** A complete
list cannot produce duplicates or gaps and is idempotent on replay; positional
deltas applied concurrently are neither. The repository applies it in a
transaction with a two-phase renumber, because `@@unique([parentId, orderIndex])`
rejects the intermediate states of a naive in-place swap.

**A slug change is refused with `content.slug_immutable`, never
`content.textbook_locked`** — even on a published book, and the check runs
first for that reason. The lock message would imply the rename becomes possible
once the book returns to draft. It never does.

**Unknown fields are rejected, not stripped.** The route schema is
passthrough and the application layer holds a per-kind allow-list. Zod
silently dropping a field would let an author believe they had set something
they had not.

**Rule CW1** — the content tree has exactly one write path — added and
negative-tested in both directions. Legacy wrote content from a dozen services,
which is why its publish lock had to be re-implemented at each of them, and was
not.

### Not built, deliberately

- Question authoring (ledger item 14) — the question model has its own review
  state and answer-key separation; it is its own capability.
- Learning resources CRUD — same reasoning, smaller.
- Textbook *creation* over HTTP. It needs a subject/grade/term catalogue,
  which is administrative setup rather than authoring. The end-to-end script
  seeds it directly through `scripts/seed-helpers.mjs`.
- Imports. Still deferred by owner decision.

---

## 10. Revision 2 — Edu7 does not publish textbooks (owner ruling, 2026-09-12)

The owner corrected the framing of this entire gate:

> إذا كان المقصود بـ `Published` نشر الكتاب المدرسي نفسه رسميًا، فهذه الوظيفة
> ليست من مسؤولية Edu7. […] الكتاب يدخل النظام باعتباره مصدرًا معتمدًا خارجيًا.
> […] أي `edition` هنا يصف هوية النسخة المطبوعة التي تم اعتمادها خارجيًا، وليس
> إصدارًا تقوم Edu7 بإصداره.

The ruling distinguishes two things this document had allowed to blur:

| | Who owns it |
|---|---|
| Approving a textbook as official curriculum | **The ministry / publisher. Not Edu7.** |
| Deciding that ingested content is complete enough to teach from | **Edu7** |

The correct pipeline is intake, not publication:

```
curriculum authority / publisher
        ↓   (approves the book — outside Edu7 entirely)
an approved printed edition
        ↓
Edu7 ingests it
        ↓
Edu7 checks its own copy is complete and consistent
        ↓
available to Learning / Assessment / Mastery
```

### 10.1 What the audit found

Before changing anything, I checked which of the two things the existing state
machine was actually protecting. Every `Textbook` write in the codebase:

```
content.repository.ts:249   generic field update (slug/key rejected)
content.repository.ts:421   setTextbookStatus
prisma/seed/seed.ts:93      seed upsert
```

**There is no way to create a textbook in Edu7 at all** — no route, no service,
no use case. A `Textbook` row is administrative intake (§9, "Not built,
deliberately"), and the state machine only ever governed a row that was already
in the database.

So the audit answers the owner's own test — *what does the state protect?* — in
favour of the second category. It has never described the book's official
standing, because no code path could confer or revoke that. Every consumer of
`PUBLISHED` asks one question only: **may a learner be served this content
yet?** Concretely, `PUBLISHED` gates:

- `published-content.ts` — the single definition of learner-visible content.
- Structural validation on `DRAFT → IN_REVIEW`: no units / no lessons / no
  concepts / prerequisite cycles / out-of-range thresholds / orphan ordering.
- Structural immutability, whose justification (§1.3) is *mastery
  interpretability* — a concept that changes under a learner silently changes
  what their evidence meant.

None of those is a claim about ministry approval. All of them are claims about
whether Edu7's own copy is fit to teach from.

### 10.2 Decision

**The state machine stays; the vocabulary is corrected.** Deleting it would
remove the structural validation gate and the immutability lock, and those are
load-bearing for mastery — the owner's ruling was explicitly *not* to delete
`PUBLISHED` outright, but to establish what it protects first.

What changes is what the system claims. Edu7 must never say *"we published this
textbook."* It says *"this approved content is ready and available for use
inside Edu7."*

Adopted terminology, from the owner's phrasing:

| Concept | Term |
|---|---|
| The lifecycle | **Content Readiness / Activation** — not Publishing |
| `DRAFT` | ingested, not yet checked |
| `IN_REVIEW` | undergoing Edu7's structural checks |
| `PUBLISHED` | **ACTIVE** — available to learners |
| `ARCHIVED` | withdrawn from use inside Edu7 |

### 10.3 What was corrected, and where

**Corrected:** this gate document (the thing most able to mislead an agent into
building a ministry-style approval workflow), `CONTENT-LIFECYCLE-GATE.md` §2,
the ledger's vocabulary, and every user-facing string and misleading comment —
itemised in the audit at §10.6.

**Not corrected: the `PublicationStatus` enum itself.** That is registered as
accepted technical debt with named triggers in §10.5.

### 10.4 `edition` — confirmed correct, one sentence corrected

`edition` already means what the owner requires. The schema comment reads
*"Printed edition of the physical book, e.g. 2026 or REV2"*, and identity is
`subject + grade + term + printed edition`. Edu7 records it; it never mints it.

But §3.4 above said *"A corrected textbook is a new `Textbook` row"* with an
example of `-REV2`, which reads as though Edu7 issues corrections. It does not.
**`-REV2` is a new row only because the publisher issued a new printed edition;
Edu7 records that fact.** Edu7 must not become a system for editing and
issuing official versions of textbooks. §3.4 is to be read with that
correction — the mechanism (a new row, keyed by edition) is unchanged and
correct; the agency is the publisher's, not Edu7's.

### 10.5 Registered technical debt — `PublicationStatus` vocabulary

**Debt:** the Prisma enum `PublicationStatus { DRAFT, IN_REVIEW, PUBLISHED,
ARCHIVED }` uses publishing vocabulary for what is, semantically, content
readiness inside Edu7. `PUBLISHED` should read `ACTIVE`.

**Severity: low, and deliberately accepted.** The enum is an internal storage
spelling. Every surface where the system makes a *claim* — documentation, API
messages, comments, and any future UI — has been corrected (§10.6). No user,
teacher, author or integrator sees the string `PUBLISHED` described as
"published"; they are told content is *available* or *withdrawn*.

**Cost of paying it now:** 92 occurrences across 38 files, three models
(`Textbook`, `Question`, `Exam`), the baseline migration, both live-proof
suites and the architecture rules — regression risk on capabilities that are
currently green, buying no semantic correction the documentation has not
already made.

**Named trigger to pay it — any ONE of these:**

1. A second notion of approval enters the system — recording that a ministry or
   publisher approved an edition, as a field, table or status. Two meanings of
   "published" would then coexist in one schema and the ambiguity becomes
   load-bearing.
2. An external integrator consumes `status` directly (an export, a public API,
   a reporting feed) where the raw enum value becomes a published contract.
3. Any other schema migration touches `PublicationStatus` for an unrelated
   reason — rename it in that same migration rather than separately.

**When triggered:** one migration renaming the enum to
`ContentReadiness { DRAFT, IN_REVIEW, ACTIVE, ARCHIVED }`, with the domain type
`PublicationState` → `ContentReadinessState` and the fragment file
`published-content.ts` → `available-content.ts`. Not before.

**Explicitly NOT to be built** in the meantime, under any reading of this
document: an approval workflow, an approver role, a ministry sign-off model, a
publication record, or any external publishing capability. Edu7 does not hold
that responsibility.

### 10.6 Semantic audit — 2026-09-12

A closing sweep for any surface implying Edu7 publishes a textbook, approves
one, issues a printed edition, grants publisher authority, or owns the external
approval lifecycle.

**Contradictions found and corrected (6 strings, 4 files):**

| Surface | Was | Now |
|---|---|---|
| `structural-validation.ts` ×3 | "before it can be **published**" | "before it can be **made available**" |
| `content.routes.ts` | "**Publishing** requires an administrator" | "**Making content available** requires an administrator" |
| `item-bank.routes.ts` | same | same |
| `ports.ts` | "**Publishing is an editorial act**… who approved it" | "who **released it inside Edu7** — not who approved the textbook" |

The last was the only true semantic contradiction: it asserted Edu7 exercises
editorial authority over the book. The others were ambiguous phrasing on the
right mechanism.

**Comments reframed:** `publishing.service.ts` and `structural-validation.ts`
headers now state plainly that these checks concern Edu7's ingested copy, not
the textbook as a published work.

**Verified clean — no contradiction:**

- **`edition`** is consistently *"printed edition of the physical book"*
  (`identifiers.ts:31,64`, `schema.prisma:473`). Edu7 parses, normalises and
  records it; nothing mints one. The single refusal that mentions it now says
  *"ingest the publisher's corrected edition"* — agency is the publisher's.
- **No ministry / sign-off / accreditation / endorsement language** anywhere in
  `src`, `scripts` or `prisma`. The only match is this gate's own disclaimer.
- **No textbook-creation path exists**, re-confirmed: three `Textbook` writes
  total (field update, status change, seed).
- `ARCHITECTURAL-GATE.md:720` ("…but not publish a textbook") is an RBAC
  granularity example, not an authority claim. Left as-is.
- Remaining "published book" phrasing in `authoring.service.ts` and
  `item-bank.service.ts` is shorthand for *the locked state*, on the correct
  mechanism. Left as-is; the enum rename above will sweep it.
- `PLAN_STATUSES` (`DRAFT → PUBLISHED → CANCELLED`) is **Instruction's own**
  lifecycle for teacher-authored plans. Edu7 genuinely does publish those. Out
  of scope for this correction.

**Status: the Content Readiness Lifecycle is CLOSED.** No further redesign; the
state machine is unchanged. Reopen only on a trigger named in §10.5.

### 10.7 Consequences for the remaining plan

- **No new workflow is to be built** for textbook approval. Had this not been
  corrected, the natural next step — an approval queue, approver roles, a
  ministry sign-off record — would all have been wasted work on a
  responsibility Edu7 does not hold.
- The existing review step keeps its narrow, correct job: Edu7 validating its
  own copy before learners reach it.
- Any UI must say *"available in Edu7"* / *"withdrawn"*, never *"published"* or
  *"approved"*.
