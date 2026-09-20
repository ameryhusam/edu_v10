# Next-Wave Review — Exams, Misconceptions, Recommendations, Dashboards

**Status:** review only. No implementation has started, and none will until the
owner approves a sequence.
**Date:** 2026-09-12
**Requested by the owner**, who suspended ledger-order delivery:

> Before continuing to the next capability, perform a product and architecture
> review of the remaining scope […] Do not start implementing the next wave
> until the review is complete.

Standing rules applied throughout:

- Dashboards **consume** canonical backend outputs; they do not own educational
  meaning.
- **Do not add persistence** merely because a capability appears in the ledger.
- **Do not create new domain abstractions** until ownership and lifecycle are
  justified.

---

## 0. The finding that should reorder the wave

While auditing item 6, I checked who writes `learner_misconceptions`:

```
$ grep -rn "learnerMisconception\.(create|update|upsert|delete)" src scripts prisma
(no matches)
```

**The table is read in two places and written in none.**

- `learning.repository.ts:146` `openForLearner` — feeds next-step's REMEDIATE branch.
- `remediation.repository.ts:256` — feeds the `MISCONCEPTION` remediation trigger.

The only thing that has ever inserted a row is raw SQL inside
`scripts/check-remediation.mjs:158`, which seeds the table so the check has
something to find. **The 58 live remediation assertions passed against data the
test script inserted itself.** The production path cannot produce that data.

This is not a missing feature. It is a **silent dead branch in a capability
already marked ✅**:

| Layer | State |
|---|---|
| Diagnosis from distractors | ✅ works — `submit-answer.use-case.ts:113` |
| Written to `mastery_evidence.misconceptionKey` | ✅ works |
| Promoted to `learner_misconceptions` | ❌ **nothing does this** |
| Read by next-step REMEDIATE | ✅ reads — always empty |
| Read by the remediation trigger | ✅ reads — always empty |

Every wrong answer carries a correct diagnosis into `mastery_evidence`, and then
nothing ever promotes it. `openMisconceptionKeys` is therefore always `[]` in
production, the REMEDIATE branch of `decideNextActivity` is unreachable, and
the `MISCONCEPTION` remediation trigger never fires. Item 2 is marked ✅ on the
strength of a trigger that cannot currently fire.

**Consequence for sequencing:** item 6 is not a new capability to schedule
behind the others. It is a **defect in two shipped ones**, and it is the
cheapest, highest-value work in this wave. It should go first. See §2 and §6.

A second, smaller finding is in §1: exam assignment is closer to done than the
ledger claims, and its real gap is not assignment at all.

---

## 1. Exam Assignment (item 4)

### 1. Canonical domain owner

**Instruction**, with no change to the boundary. An exam assignment is a
statement that an exam *was asked for*; the exam itself, its blueprint and its
attempt lifecycle stay in Assessment. This is the ownership already recorded in
ASSIGNMENT-GATE §1 and acceptance criterion 6: *"Exam and lesson assignment use
**one** mechanism."*

### 2. Dependencies on completed capabilities

All present:

- Instruction plan/obligation lifecycle (item 3 ✅).
- `EXAM` is already a member of `INSTRUCTIONAL_ACTIVITY_TYPES`.
- `PrismaActivityReader.describe` already resolves `EXAM` and refuses an
  unpublished exam (`instruction.repository.ts:364`).
- `PrismaCompletionReader` already branches on `EXAM` to count attempts against
  `exam.key` rather than `lessonKey` (`:403`).

**So "assign an exam to a class with a due date" already works today.** A
teacher can `POST /instruction/plans {activityType:'EXAM', activityKey, scope,
dueAt}` and it will validate, materialise and derive status. The ledger's
"لا إسناد امتحان لصف بمواعيد" is out of date.

### 3. Is persistence actually required?

**No new persistence.** `InstructionalPlan` + `LearnerObligation` already carry
everything. Specifically rejected: an `ExamAssignment` table, an
`ExamSchedule` table, and a per-learner exam window. A second assignment model
for exams is exactly the god-object-by-duplication the gate ruled out.

**One possible exception, and I do not recommend taking it yet:** timed exam
windows (`opensAt`/`closesAt` distinct from `availableAt`/`dueAt`, plus
proctoring state). That is a real product capability, but nobody has asked for
it, and `availableAt`/`dueAt` already express "you may start now" and "this is
late". Defer until a named requirement exists.

### 4. API requirements

None new for assignment. What *is* missing is the teacher-facing **result view**
— and it belongs to Analytics, not Instruction:

- `GET /analytics/exam-results?examKey=…` — cohort results for one exam.

`AnalyticsService` already has `cohortReport` and `itemHealth`; this is a third
read over the same evidence, not a new context.

### 5. UI requirements

- Assign-exam form: reuse the plan form with `activityType: EXAM`.
- Exam results table for a teacher, consuming the Analytics endpoint above.
- **No exam-specific progress widget.** Obligation status already derives from
  the same completion policy for every activity type.

### 6. Acceptance criteria

1. A teacher assigns a published exam to a scope with a due date, via the
   existing `/instruction/plans` route — **no exam-specific route**.
2. Assigning an unpublished or archived exam is refused by name before any
   write (LD-2 preserved).
3. An exam obligation's status derives from attempt + mastery evidence exactly
   as a lesson's does; there is no exam-only status path.
4. The same exam taken unassigned produces byte-identical evidence (gate
   criterion 4).
5. Cohort exam results are read from Analytics and write nothing.

### 7. Duplication with existing capabilities

**High risk, and the reason to be careful here.** An "exam results" screen is
one refactor away from recomputing mastery while rendering — the exact legacy
defect rule **AW1** exists to prevent. Exam results must be an Analytics
projection over `mastery_evidence` and `attempts`, never a second scorer.

### 8. Architectural risks

- **A second grading path.** If exam results are computed anywhere other than
  the existing evaluator, two numbers will disagree. Mitigated by AW1 and by
  routing results through Analytics.
- **Exam-specific completion semantics.** Tempting to say "an exam is complete
  when submitted, regardless of mastery". That contradicts the completion
  policy. If the product genuinely wants it, it needs a gate decision, not an
  `if (activityType === 'EXAM')` in the completion reader.

### 9. Recommended implementation order

**Position: third.** Small, mostly verification. One live proof that an exam
assignment flows end to end, then the Analytics results endpoint.

---

## 2. Misconception Surfacing (item 6)

### 1. Canonical domain owner

Split, and the split is already correct:

| Concern | Owner |
|---|---|
| Which distractor implies which misconception | **Content** (authoring) |
| Diagnosing one from an answer | **Assessment** (already works) |
| *Does this learner currently hold it?* | **Mastery** ← **the missing piece** |
| What to do about it | **Learning** (remediation, already built) |

`LearnerMisconception` is learner state derived from evidence. Mastery already
owns exactly that kind of state and already owns the single write path for
derived learner state (rule M1). **No new context, no new abstraction.**

### 2. Dependencies on completed capabilities

Everything needed exists and is proven:

- Distractor→misconception authoring ✅ (`item-bank.repository.ts:249`).
- Diagnosis at submit ✅ (`submit-answer.use-case.ts:113`).
- `mastery_evidence.misconceptionKey` persisted ✅.
- Two consumers already written and waiting ✅.

The capability is a **missing link between two working halves**, not a build.

### 3. Is persistence actually required?

**This is the one place in the wave where I argue persistence is genuinely
required, and I want to justify it rather than assume it.**

The naive alternative is to derive open misconceptions at read time from
`mastery_evidence` — no table, no writer. That fails on two counts:

- **Resolution is not derivable.** "Learner no longer holds this wrong model"
  is a judgement about a *sequence* (diagnosed, then N subsequent correct
  answers on the concept), and it has a lifecycle — `firstSeenAt`,
  `lastSeenAt`, `occurrences`, `resolvedAt`. Recomputing it on every read makes
  "how long did this learner hold this misconception?" unanswerable, which is
  the question a teacher actually asks.
- **Remediation episodes already point at it.** `RemediationEpisode` records a
  `misconceptionKey` and expects a stable open/closed claim on the other side.
  Deriving one side and persisting the other guarantees they disagree.

The table also **already exists**, with the right shape and the right unique
constraint (`[learnerId, conceptId, misconceptionId]`). Nothing new is added —
a **writer** is added.

### 4. API requirements

- `GET /remediation/misconceptions?learnerKey=…` — open misconceptions for a
  learner, via the canonical learner-access boundary.
- `GET /analytics/misconceptions?textbookKey=…&gradeId=…` — cohort view: which
  wrong models are widespread. This is the teacher-facing payoff, and it is a
  projection.

**No `POST /resolve`.** Resolution follows evidence, exactly as remediation
episodes do (rules RW1/RW2). A teacher declaring a misconception fixed is the
`PATCH {masteryAchieved}` mistake wearing a new hat.

### 5. UI requirements

- Learner: nothing new. Misconceptions surface *as remediation*, which is the
  existing loop — showing a learner a list of their wrong models is
  demotivating and pedagogically useless.
- Teacher: "common misconceptions in this class", ranked by learner count.

### 6. Acceptance criteria

1. Answering with a diagnostic distractor creates or increments a
   `learner_misconceptions` row **through the Mastery write path**, in the same
   recompute that consumes the evidence.
2. Idempotent: re-running the recompute over the same evidence does not
   double-count `occurrences`. *(This is the trap from the mastery work —
   reading a computed result as input to its own recomputation destroys
   idempotence. Rebuild `occurrences` from evidence; never increment in place.)*
3. N consecutive correct answers on the concept without the distractor sets
   `isResolved`, derived — never asserted.
4. A resolved misconception that recurs **re-opens**, and the first episode's
   duration stays readable (same rule as remediation).
5. **The live proof must remove the raw-SQL seed from
   `check-remediation.mjs:158` and let the API produce the row.** Until that
   passes, the trigger is still unproven.
6. Rule **MW1**: `learner_misconceptions` is written only by
   `mastery.repository.ts`. Mutation-tested.

### 7. Duplication with existing capabilities

Low, if the writer is chained onto the existing mastery recompute rather than
given its own trigger. A separate trigger would mean two things reacting to one
answer, in an order nobody controls.

### 8. Architectural risks

- **A second write path for learner state** if the writer lands anywhere but
  `mastery.repository.ts`. Mitigated by MW1.
- **Ordering.** The remediation trigger already chains after mastery recompute.
  The misconception writer must run *inside* that recompute, before remediation
  reads — otherwise the trigger sees the previous answer's state.
- **Over-diagnosis.** One wrong answer is not a wrong mental model. Legacy had
  a confidence field for this; `occurrences` and `confidence` already exist on
  the table. A threshold belongs in the domain, not the UI.

### 9. Recommended implementation order

**Position: FIRST.** It repairs two capabilities already marked ✅, unblocks a
dead branch in next-step, and needs no new table.

---

## 3. Persistent Recommendations (item 10)

### 1. Canonical domain owner

**Learning** — if it is built at all.

### 2. Dependencies on completed capabilities

`decideNextActivity` ✅, remediation episodes ✅, `learning_decision_log` (model
exists, written at `learning.repository.ts:228`).

### 3. Is persistence actually required?

**No — and I recommend against it.** This is the capability the owner's rule
("do not add persistence merely because a capability is listed") most directly
applies to.

The ledger describes item 10 as recommendations that are "stored, accepted,
completed, expired". Examined against what now exists, each of those either
already has an owner or is unwanted:

| Wanted property | Already provided by |
|---|---|
| A durable claim about a learner's gap | **`RemediationEpisode`** — opened by evidence, closed by evidence |
| A durable thing the learner owes | **`LearnerObligation`** — with origins `REMEDIAL` and `ADAPTIVE` |
| A record of what was recommended and why | **`learning_decision_log`** — already written on every decision |
| "What next?" | `decideNextActivity`, derived fresh |

A `Recommendation` entity would overlap all four. Worse, it introduces a
**mutable pedagogical claim**: a stored recommendation goes stale the moment
the learner answers a question, and then the system holds two opinions about
what to do next — the stored one and the derived one. That is the four-competing-
mastery-formulas failure in a new location.

"Accepted" is the only genuinely new idea, and it is thin: a learner choosing to
act on a suggestion. If the product wants it, the cheap and correct form is an
`ADAPTIVE`-origin obligation created from a recommendation the learner accepted
— which the Instruction model **already supports today** with no schema change.

### 4. API requirements

If the accept flow is wanted: `POST /learning/recommendations/accept` creating
an `ADAPTIVE`-origin obligation. Nothing else.

### 5. UI requirements

A "start this" button on the existing next-step card. No new screen.

### 6. Acceptance criteria

1. No new table.
2. Accepting a recommendation creates an `ADAPTIVE`-origin obligation, which
   derives its status from the same completion policy as any other.
3. Not accepting one has no effect — an ignored suggestion leaves no state.
4. Next-step still derives fresh on every call; nothing reads a stored
   recommendation to decide.

### 7. Duplication with existing capabilities

**The highest in the wave.** Four existing mechanisms already cover it. This is
the item most likely to be a ledger entry that has outlived its own problem
statement.

### 8. Architectural risks

- **A stored pedagogical opinion competing with the derived one** — the main
  reason to refuse the table.
- Storing recommendations invites expiry jobs, and a background writer of
  learner state is a new failure mode for no product gain.

### 9. Recommended implementation order

**Position: last, and scoped to the accept flow only — or dropped.** I
recommend the ledger row be rewritten to "recommendation acceptance
(obligation-backed)" and closed, rather than built as persistence.

---

## 4. Dashboards (item 20)

### 1. Canonical domain owner

**No domain owner — by design.** A dashboard is an interface-layer composition
over canonical outputs. Per the owner's rule, it owns no educational meaning.
The moment a dashboard computes something, that computation has an owner
elsewhere and is in the wrong place.

### 2. Dependencies on completed capabilities

This is what makes dashboards viable now — every panel maps to an endpoint that
already exists:

| Panel | Canonical source | Status |
|---|---|---|
| Where am I? | `GET /learning/path` | ✅ |
| What next? | `GET /learning/next-step` | ✅ |
| What do I owe? | `GET /instruction/due-work` | ✅ |
| Open gaps | `GET /remediation/episodes` | ✅ |
| XP / level | `GET /engagement/xp` | ✅ |
| Cohort performance | `GET /analytics/cohort` | ✅ |
| Item health | `GET /analytics/textbooks/:key/item-health` | ✅ |
| Overdue pile-up | `POST /instruction/due-work/alerts` | ✅ |
| Common misconceptions | `GET /analytics/misconceptions` | ❌ needs §2 |

Only one panel has no source, and it is the one item 6 creates.

### 3. Is persistence actually required?

**No.** No dashboard table, no materialised view, no snapshot table. If a read
is slow, the fix is an index or a cache with an explicit TTL — not a second
copy of learner state with its own update path. Legacy's dashboard service
recomputed mastery while rendering; **AW1** exists because of it.

### 4. API requirements

**Ideally none.** Three dashboards, each composing existing endpoints
client-side.

The one thing worth considering is a **BFF aggregate** (`GET /dashboard/learner`
returning the four learner panels in one round trip) — but only as a pure
fan-out that adds no field the underlying endpoints do not already return. If
it ever computes a value, it has become a domain service in the wrong layer.
Start without it; add it only if round-trip count is measurably a problem.

### 5. UI requirements

Three dashboards, in this order:

1. **Learner** — path, next step, due work (academic and advisory *visually
   separated*), XP.
2. **Teacher** — cohort mastery, overdue alerts, common misconceptions, item
   health.
3. **Parent** — the child's academic picture read-only, plus the parent's own
   advisory tasks, **clearly labelled as not counting**. The API already
   returns `countsTowardCompletion` per row precisely so the UI does not have
   to decide this.

### 6. Acceptance criteria

1. No dashboard component computes mastery, completion, overdue status or XP.
   Every displayed number comes from a canonical endpoint.
2. Advisory and academic work are visually distinct and never summed together.
3. A dashboard with no data renders "not yet assessed", never `0%` — the
   distinction Analytics already makes and that a UI can easily destroy.
4. No new table, no new domain type.
5. Rule **UI1** (candidate): nothing under `web/` imports from
   `src/contexts/*/domain/`. Frontend gets DTOs, not domain logic.

### 7. Duplication with existing capabilities

The risk is not duplicated code but **duplicated meaning** — a "progress" bar
computed from a different denominator than `JourneyService` uses. Note the
journey work already settled a subtle one: locked concepts stay in the
denominator. A dashboard recomputing that will silently disagree.

### 8. Architectural risks

- **Meaning leaking into the frontend** — the primary risk, and the owner's
  standing rule.
- **A BFF that grows logic.** Guard by keeping it a pure fan-out or omitting it.
- **Advisory/academic conflation in a chart.** The backend separates them; a
  single stacked bar would undo the domain work in one component.

### 9. Recommended implementation order

**Position: fourth (last), after item 6 supplies the final missing panel.**
Building dashboards before then means shipping a teacher view with a permanently
empty misconceptions panel.

---

## 5. Recommended next-wave sequence, with gates

### Stage 1 — Misconception state (item 6) · **GATE: none, start here**

Repairs a dead branch in two shipped capabilities. No new table.

**Exit criteria:** MW1 added and mutation-tested · the raw-SQL seed deleted from
`check-remediation.mjs` and the suite still green · `occurrences` proven
idempotent under repeated recompute · live proof that a diagnostic wrong answer
produces a remediation episode **through the API alone**.

### Stage 2 — Teacher intervention actions (completes item 11) · **GATE: product**

Due Work exists; the authorised actions the owner listed do not: extension,
waiver, cancellation, reopening, resubmission, **with audit history for human
overrides**.

**Gate question for the owner (do not decide unilaterally):** *who* may do
each, and does an extension move the plan's `dueAt` for everyone or create a
per-learner override? A per-learner override is a schema change and a new
lifecycle — the ASSIGNMENT-GATE bar applies before any of it is written.

**Exit criteria:** every override audited with actor, reason and timestamp ·
none of them writes mastery, evidence or eligibility · PARENT origin cannot
gate, even via an override.

### Stage 3 — Exam assignment verification (item 4) · **GATE: none**

Mostly proof, not build: live end-to-end exam assignment, then
`GET /analytics/exam-results`.

**Exit criteria:** no exam-specific route or table · results read-only ·
identical evidence assigned vs unassigned.

### Stage 4 — Dashboards (item 20) · **GATE: design review**

Learner first, then teacher, then parent.

**Gate:** a panel-to-endpoint map approved before any component is written; any
panel without a canonical source is cut, not computed locally.
**Exit criteria:** rule UI1 · zero computed educational values in the frontend ·
advisory work visually separate.

### Not scheduled

- **Item 10 (persistent recommendations)** — recommend rewriting the ledger row
  to "acceptance creates an `ADAPTIVE` obligation" and closing it. Build only if
  the owner wants the accept flow; **do not build the persistence.**
- **Imports** — unchanged: last, and not started.

### Sequencing rationale

The order is driven by **dependency and by defect-versus-feature**, not by
ledger numbering. Item 6 is first because it is the only item that fixes
something currently broken and because it is the last missing dashboard source.
Dashboards are last because they are the only consumer with no downstream.
Item 10 is unscheduled because the review found four existing mechanisms
already covering it.

---

## 6. Summary of findings that change the plan

1. **`learner_misconceptions` has no writer.** Two shipped capabilities depend
   on it; a test script's raw SQL is the only thing that has ever populated it.
   *Item 6 moves from "new feature, middle of the wave" to "defect repair,
   first".*
2. **Exam assignment largely already works.** `EXAM` is handled in the activity
   reader, the completion reader and the activity-type union. The real gap is a
   teacher results view, which belongs to Analytics. *Item 4 shrinks.*
3. **Persistent recommendations duplicate four existing mechanisms.** *Item 10
   should be re-scoped to an accept flow or dropped — no new persistence.*
4. **Dashboards are unblocked except for one panel**, which item 6 supplies.
   *Item 20 stays last, and needs no backend capability of its own.*
5. **Only one gate decision is genuinely open** in this wave: the per-learner
   due-date override in stage 2. Everything else can proceed on rules already
   agreed.

---

## 7. Current-state verification — 2026-09-12

Ordered by the owner after the Content Readiness correction closed. This is a
**read of the code as it stands today**, reconciled against this review and the
Capability Ledger. No implementation. Method: exhaustive grep for every write,
read and route on each path, plus the schema, rather than trusting either
document.

### 7.1 LearnerMisconception — the production path IS connected

The defect this review recorded in §0 (*"read by two capabilities and written
by none"*) is **fixed and verified in production code**, not only in a test.

Traced end to end, every hop in `src/`:

| # | Hop | Evidence |
|---|---|---|
| 1 | Author tags a distractor | `item-bank.repository.ts:249` maps `misconceptionKey` → `misconceptionId` on `question_choices` |
| 2 | Learner picks it | `submit-answer.use-case.ts:113` `diagnoseMisconception()` reads the chosen choice's tag |
| 3 | Written to evidence | `submit-answer.use-case.ts:121` → `evidence.ts:80` → `assessment.repository.ts:259` persists `mastery_evidence.misconceptionKey` |
| 4 | Triggers recompute | `submit-answer.use-case.ts:126` → `container.ts:268` `recomputeMastery.execute()` |
| 5 | Derived | `recompute-mastery.use-case.ts:93` `deriveMisconceptionStates(ordered)` |
| 6 | Persisted | `recompute-mastery.use-case.ts:159` → `mastery.repository.ts:158-162` delete-then-`createMany` in one transaction |
| 7 | Consumed | `learning.repository.ts:146` (next-activity) and `remediation.repository.ts:256` (episodes) |

**Canonical writer: exactly one.** Repo-wide, the only `learnerMisconception`
mutations are `mastery.repository.ts:158` and `:162`. Guard rule **MW1**
(`check-architecture.ts:190`) fails the build on any other writer, and on a
literal `isResolved: true` outside that file. Two readers, both read-only.

**No test-only or raw-SQL dependency in the proof — for the derived state.**
`check-misconceptions.mjs` (14/14) never inserts into `learner_misconceptions`
(verified: zero matching inserts); it authors and answers over HTTP and asserts
the API alone promoted the row.

It does issue **one** insert, at `:151`, into the **`misconceptions` catalogue**
— a different table, and an input rather than the asserted output. That is
sound as a proof, but it is itself evidence for §7.2: the script has to plant
the catalogue row in SQL **because no authoring path for it exists**. When §7.2
piece 2 is decided, that insert should be replaced by the real path; until then
it is correctly annotated at `:145`. Separately,
`check-remediation.mjs:177` *does* insert directly — that is a **different**
script proving a different capability, and its insert is annotated as
legitimate because `POST remediation/refresh` is a pure read that never
recomputes. That annotation is correct but now under-sells the situation:
since `check-misconceptions.mjs` exists, the derivation is proven elsewhere.
Not a defect; worth a one-line cross-reference at that comment.

**Conclusion: item 6 needs no further work.** It is genuinely ✅ and the ledger
is accurate.

### 7.2 The real remaining gap on this path — the misconception catalogue

The audit found one break, and it is **upstream of hop 1**, in Content:

> **A `misconceptionKey` that has no catalogue row is silently discarded.**

`item-bank.repository.ts:249` resolves the key through a map and falls back to
`?? null`:

```ts
misconceptionId: c.misconceptionKey
  ? (misconceptionId.get(c.misconceptionKey) ?? null)
  : null,
```

There is **no validation anywhere above it** — not in
`item-bank.service.ts` (which passes `c.misconceptionKey ?? null` through at
:214 and :284), not in `question-authoring.ts` (which only types the field at
:52), and there is no `content.misconception_not_found` error code in the
codebase. The Zod schema at `item-bank.routes.ts:65` checks it is a non-empty
string, nothing more.

**Failure mode:** an author tags a distractor with a typo'd or not-yet-created
key. The API returns **201 Created**. The choice is stored with
`misconceptionId = null`. Every downstream hop then behaves correctly on empty
input — no misconception is ever diagnosed, no row is ever written, remediation
never fires. The capability is silently dead for that question, and nothing in
the system reports it. This is the *same class of defect* as the original one
(a link that looks wired and is not), one layer further upstream.

**Compounding it: the catalogue has no authoring path at all.** The only writer
to the `misconceptions` table in the entire repo is `prisma/seed/seed.ts:208`.
No route, service, or use case creates one. So today the only way to use the
feature is to hand-write a seed row — which also means the silent-drop above is
not an edge case, it is the *default* outcome for any author using the API.

**Canonical owner:** Content (item bank authoring). Not Mastery — Mastery
consumes keys, it must not define them. The write belongs behind rule **CW1**
in `content.repository.ts`, consistent with every other content write.

**Recommendation (two small pieces, in this order):**

1. **Reject the unknown key.** Validate in `item-bank.service.ts` before the
   repository call; new code `content.misconception_not_found`. Turns a silent
   data-loss into a 422 naming the bad key. Small, self-contained, no schema
   change, no new entity.
2. **Then** decide whether authors need catalogue CRUD. This is a **product
   question, not an architecture one** — the catalogue may legitimately be
   curriculum-team-curated via seed/import rather than author-editable. Do not
   build CRUD on assumption. Note that Imports is explicitly out of scope, and
   a misconception catalogue is plausibly an *import* concern, not an authoring
   one.

Piece 1 is worth doing regardless of how piece 2 is decided, which is why they
are split.

### 7.3 Teacher interventions (item 11) — the override semantics question, answered factually

**Built:** Due Work derivation, the alert threshold, and **waiver only**
(`assignment.service.ts:381` `waive()`, requiring a reason at :388, audited at
:418, and protected at :279 — a waived obligation is never recomputed, so a
human decision is never silently undone).

**Not built:** extension, cancellation, reopening, resubmission.

**The schema fact that decides the gate question:** `dueAt` exists on
**`InstructionalPlan` only** (`schema.prisma:1145`). `LearnerObligation` has
**no due-date column** — its only human-override fields are
`waivedById / waivedAt / waiverReason`.

Therefore, as the code stands:

- Extending a due date **necessarily moves it for the entire cohort**. There is
  no per-learner due date to change.
- A per-learner extension is **a schema change** (new nullable column or a new
  override row), a new lifecycle, and a new precedence rule
  (`obligation.dueAtOverride ?? plan.dueAt`) that `deriveStatus` and every
  overdue computation must respect.

**This remains a product decision and I am not taking it.** The audit's
contribution is to make the cost explicit: cohort-wide extension is ~free
(already expressible); per-learner extension is the ASSIGNMENT-GATE bar.

**Cheapest coherent step if the owner wants motion without deciding:** implement
**cancellation and reopening** first. Both are status transitions on the
existing model, both fit the waiver audit pattern already proven at :381, and
neither needs a schema change or a product ruling.

### 7.4 Exam results (item 4) — the ledger understates what exists

The review's §1 suspicion is confirmed and is stronger than stated. **Exam
assignment already works through the generic plan mechanism** — there is
nothing to build and no `ExamAssignment` entity is warranted:

- `'EXAM'` is a first-class `InstructionalActivityType` (`plan.ts:29`) and is
  accepted by the plan routes (`instruction.routes.ts:109`), which already carry
  `availableAt` and `dueAt` (:112-113).
- Completion handles it explicitly: `instruction.repository.ts:364`
  (`conceptsFor` case `'EXAM'`), `:403` (attempt counting via `exam.key`),
  `:440`.
- Attempts carry `examId` (`schema.prisma`, `assessment.repository.ts:115-125`)
  and are scored (`submit-attempt.use-case.ts:117-145`).

So "**لا إسناد امتحان لصف بمواعيد**" in the ledger's item-4 row is **wrong** and
should be corrected — assigning an exam to a cohort with dates is expressible
today. What is missing is only the second half: "**لا نتائج مجمّعة للمعلّم**".

**The actual gap: teacher-facing exam results.** Analytics today exposes
`cohortReport`, `learnerReport`, `itemHealth`, `bankHealth`
(`analytics.service.ts:109-217`) — all concept/mastery or item-quality shaped.
**None is exam-scoped.** There is no "how did 7-B do on this exam" read:
score distribution, per-question breakdown, who has not sat it.

**Canonical owner: Analytics** (it already owns cohort reads and staff scoping
via `STAFF_ROLES` at `analytics.routes.ts:33`). **Not** Assessment — Assessment
grades one attempt and must not grow cohort reporting. **Reuse, do not
duplicate:** `learnersInScope`, `attemptCounts` and the existing `requireRoles`
guard. Expect this to be **one read model plus one endpoint**, no new table —
every input is already persisted on `attempts` / `attempt_items`.

**Explicitly avoid:** a second grading path. The score is computed once at
submit; a results view must read it, never recompute it (the AW1 lesson).

### 7.5 Recommendations (item 10) — the ledger should be reconciled, not implemented

Confirmed by grep: **there is no `Recommendation` model in the schema**, and
recommendations are computed per call in `learning/domain/remediation.ts:264`,
with the reasoning already recorded in code at `remediation.service.ts:125`
(*"computed here rather than stored: a persisted recommendation goes stale"*).

This matches the review's §3 conclusion. The remaining question is not
architectural but definitional: item 10's stated gap is *"تُخزَّن، تُقبل،
تُنجَز، تنتهي"* — accept/complete/expire. **Accepting** a recommendation is the
only part that implies state a derivation cannot supply, and even that is
arguably already covered: a learner who acts on a recommendation produces
evidence, and the recommendation then stops being produced.

**Recommendation: reconcile the ledger.** Either mark item 10 ✅-by-derivation
with the rationale, or reduce it to the one genuinely missing behaviour if the
owner can name a user-visible need that derivation cannot meet. **Do not create
a persistent Recommendation entity.**

### 7.6 Dashboards (item 20) — remains deferred, correctly

Unchanged from §4 of this review. Two of its three canonical inputs are now
verified green (misconception state, mastery); the third (exam results, §7.4)
does not exist yet. Dashboards must compose those outputs and calculate no
educational meaning. **Defer until §7.4 lands.**

### 7.7 Reconciliation with the Capability Ledger

| Item | Ledger says | Audit finds | Action |
|---|---|---|---|
| 6 Misconceptions | ✅ | ✅ confirmed, one canonical writer, no SQL-dependent proof | none |
| 4 Exams | 🟡 "no exam assignment with dates, no teacher results" | assignment **works today**; only teacher results missing | **correct the row** |
| 11 Teacher interventions | 🟡 waiver + alerts built | confirmed; `dueAt` is plan-level, so per-learner extension = schema change | add the schema fact |
| 10 Recommendations | 🟡 "no persistent recommendations" | derived by design; no table, and none wanted | **reconcile, likely ✅** |
| 20 Dashboards | ⬜ | blocked on §7.4 only | none |

Ledger edits are deferred to the implementation turn so the ledger records
outcomes rather than intentions — except the item-4 correction, which is a
**factual error** about what the code does and should be fixed when the owner
approves this audit.

### 7.8 Recommended implementation sequence

Each stage is independently shippable and small. Focused tests per stage; full
regression only at the end.

| # | Work | Owner ctx | Schema? | Gate | Verification |
|---|---|---|---|---|---|
| 1 | Reject unknown `misconceptionKey` (§7.2 piece 1) | Content | no | none | unit tests on the service + one assertion added to `check-item-bank.mjs` |
| 2 | Teacher exam results read model + endpoint (§7.4) | Analytics | no | none | unit tests on the read model; extend `check-analytics.mjs` with an exam-scoped case |
| 3 | Obligation cancel + reopen (§7.3) | Instruction | no | none | unit tests on transitions + audit assertions, mirroring `waive()` |
| 4 | Ledger reconciliation: items 4, 10, 11 (§7.7) | — | no | none | doc only |
| 5 | Per-learner due-date override | Instruction | **yes** | **PRODUCT DECISION** | blocked — do not start |
| 6 | Misconception catalogue authoring | Content | maybe | **PRODUCT DECISION** | blocked — may be an Imports concern |
| 7 | Dashboards | Interface | no | design review | blocked on #2 |

**Start at #1.** It is the smallest change that closes a real silent-data-loss
defect on the path the owner prioritised, and it needs no product ruling.

### 7.9 Stage 1 — DONE (2026-09-12)

`question.misconception_not_found`. An unknown misconception key is now refused
at the application layer instead of being silently nulled by the adapter.

- **Port:** `resolveMisconceptions(keys)` on `QuestionRepository`, mirroring the
  existing `resolveConcepts`.
- **Service:** `assertMisconceptionsExist()` on **both** write paths — create
  and update. It reports *every* unknown key, not the first.
- **No schema change, no new entity, no new file.**

**Verified.** 6 unit tests, **mutation-checked**: deleting the create-path guard
fails exactly the 3 create tests and leaves the edit test green, confirming the
two paths are independently covered. Live over HTTP: an unknown tag now returns
**404 `question.misconception_not_found`** naming the key, where it previously
returned **201** with the tag discarded. `check-item-bank.mjs` **51/51** (was
50/50). Guard 27/27. Focused suites only — 112 tests across the four affected
files. Post-run row counts match the seed baseline; no fixture leaked.

**Ordering note:** the check sits before the textbook-lock check, so a locked
book still answers `content.textbook_locked` first — consistent with
`resolveConceptScope`.

### 7.10 Stage 2 — DONE (2026-09-12)

Teacher-facing exam results. **Owner: Analytics. No new table, no new entity,
no second grading path** — every number already existed on `attempts` and
`attempt_items`.

- **Domain:** `analytics/domain/exam-results.ts`, pure `summariseExam()`.
- **Port:** `ExamResultsReader` (`findExam` / `sittings` / `itemOutcomes`).
- **Adapter:** `PrismaExamResultsReader`, read-only; selects the stored score,
  never re-derives it. Item order comes from the exam's item list so a question
  nobody answered still appears in its printed position.
- **API:** `GET /analytics/exams/:examKey/results?schoolId=&gradeId=&termId=`,
  staff-only via the existing `requireRoles` + `STAFF_ROLES` gate.

**Three honesty rules encoded in the domain**, each mutation-tested:

1. **A score is read, never recomputed.** Proven by a test where the stored
   score deliberately disagrees with the verdict counts (partial credit): the
   stored value wins.
2. **A half-marked paper has no percentage.** While `pendingReviewCount > 0`
   the sitting is excluded from mean/median/bands — an average over the
   machine-markable half is not a fact.
3. **`null` is not `0`.** An unanswered item reports `correctRate: null`, not
   0% — "nobody answered it" and "everyone got it wrong" are different claims.
   Unmarked answers are excluded from the per-item denominator.

**Verified.** 15 unit tests. Mutation-checked twice: removing the pending guard
fails exactly 2 tests; adding `pending` to the item denominator fails exactly 1.
Live: 404 on unknown exam, **403 for a learner** (a student cannot read the
class distribution), 200 for the teacher with participation reconciling
(`25 = 0+0+25`) and non-sitters **named**. `check-analytics.mjs` **42/42** (was
34/34). Guard 27/27, typecheck clean, focused suites only. Row counts match the
seed baseline.

**Item 4 is now ✅.** Exam assignment already worked via the generic plan
mechanism (§7.4); this closes the only real gap. Dashboards (§7.6) are
unblocked.

---

## 8. Question provenance — audit item, NOT scheduled for implementation

Raised by the owner 2026-09-12. Recorded here per the owner's instruction:
*"do not change the database now; add this to the Question/Content architecture
audit and have the agent determine the minimum representation."* **No schema
change, no field names fixed, nothing built.** This section states the problem,
what the code already has, and the cheapest representation — so the decision is
made on evidence rather than on a guess.

### 8.1 The distinction being drawn

> **"A question is aligned with the lesson" ≠ "a question is taken from the
> book."**

```
              Adding Fractions  (one lesson)
                       │
     ┌─────────────────┼─────────────────┐
Book exercise      Teacher item        AI item
 original in        authored            generated
  the book           locally            for this lesson
```

All three are aligned to the same lesson and concept. **Only one is original
textbook content.** Today the system cannot tell them apart.

The owner's proposed model separates three orthogonal questions, and that
separation is correct:

| Axis | Question it answers | Example values |
|---|---|---|
| **Origin** | How did this item come to exist? | `TEXTBOOK` · `TEACHER` · `AI` · `IMPORT` |
| **Textbook role** | If from the book, what was it printed as? | `EXERCISE` · `SELF_TEST` · `REVIEW` · `OTHER` — **null for non-textbook items** |
| **Alignment** | Where is it used pedagogically? | textbook / unit / lesson / concept (+ page) |

The key property: **an AI item is `origin = AI`, `textbookRole = null`, and
still fully aligned to the lesson and concept.** Alignment is not provenance.

### 8.2 What the schema already has — and what it lacks

Verified by inspection of `model Question`:

| Field | State | Verdict |
|---|---|---|
| `authoredByAi: Boolean` | **In use** (service, routes, adapter, domain) | A **boolean, not a classification.** It expresses one bit of a four-value axis. `false` conflates textbook, teacher and import — which is exactly the gap. |
| `sourcePage: Int?` | **Dead — zero reads, zero writes anywhere in `src`, `scripts`, `prisma`, `tests`** | The "page" half of the alignment axis, added speculatively and never wired. |
| `bloomLevel: BloomLevel?` | **Dead — zero references** | Same pattern. |
| Origin / textbook role | **Absent entirely** | No enum, no column, no filter, no API surface. |

**Two dead columns on this one model is the finding that should govern the
decision.** They are evidence that adding provenance fields *before* a consumer
exists produces schema that never gets used. Whatever is added here must ship
with the read path that uses it, or it becomes the third dead column.

### 8.3 Where provenance would actually bite — the risk to check first

Assessment selects items with `findPoolByConcepts` (`assessment.repository.ts:55`),
filtering on `status: 'PUBLISHED'` plus full ancestor visibility. **It does not
filter by provenance, and that is currently correct**: every published,
visible, concept-linked item is a legitimate measurement of that concept.

The architectural risk is precise:

> If provenance becomes a **filter in the adaptive selection path**, it stops
> being metadata and becomes pedagogy — and it acquires an owner problem.

Concretely: "exclude textbook exercises from practice so learners meet unseen
items" is a *pedagogical policy*. It would belong to Assessment's selection
domain, not to a Content column read opportunistically by an adapter. Deciding
that silently inside a repository query is how the legacy codebase ended up
with four competing mastery formulas.

**Therefore the audit's recommendation is to scope provenance deliberately:**

- ✅ **Descriptive use — safe.** Authoring/bank filters, teacher browsing,
  exam-blueprint composition by a human, import bookkeeping, AI-generation
  attribution. All human-facing reads.
- ⚠️ **Selection use — requires a gate.** Any use inside `findPoolByConcepts`,
  CAT selection, or remediation item choice is a **pedagogical rule** and needs
  the same bar as any other domain policy: named owner, explicit decision,
  tests. Not a side effect of adding a column.

### 8.4 Minimum representation — the cheapest option that works

Presented as an **assessment of cost**, not a decision to implement. Options,
cheapest first:

**Option A — two enums on `Question` (recommended if this ships).**
`origin` (4 values, default `TEXTBOOK`) + `textbookRole` (nullable, 4 values).
Alignment already exists via `QuestionConcept` + the lesson chain, and
`sourcePage` is already there for the page. Cost: one migration, two columns,
no new table, no relation. `authoredByAi` becomes **derived**
(`origin === 'AI'`) and should be dropped in the same migration rather than
left to drift against the new field — **two sources of truth for "is this AI"
is the defect pattern this project keeps removing.**

**Option B — a separate `QuestionProvenance` table.** Justified only if
provenance needs its own lifecycle (who imported it, when, from which batch,
re-import reconciliation). That is **Imports' concern**, and Imports is
explicitly out of scope. Do not build it now.

**Option C — infer from existing data.** Rejected: nothing in the current schema
distinguishes a textbook exercise from a teacher item, so there is nothing to
infer from.

**Honest cost note.** Option A is a small migration, but it is **not free**:
`origin` has no correct default for existing rows in general — although at
present the only seeded questions genuinely are textbook content, so a
`TEXTBOOK` backfill is truthful today and will not be once Imports or AI
generation runs. The right moment to add it is **immediately before the first
consumer**, not now.

### 8.5 Recommended trigger — when to pay for this

Do it when **the first of these becomes real**, and not before:

1. **AI question generation ships** — attribution stops being cosmetic; a
   teacher must know which items a machine wrote.
2. **Imports ships** — import bookkeeping needs origin by definition, and this
   is where Option B would be re-examined.
3. **A teacher-facing question bank browser is built** — the filters the owner
   described (Book / Teacher / AI / Imported, then Exercises / Self-test /
   Review) are the first genuine read consumer.
4. **A product rule explicitly needs it** — e.g. "exams must draw only from
   textbook exercises". This one also trips §8.3's gate.

**None of these is currently scheduled.** Per §7.8 the next work is teacher exam
results, which does not need provenance.

### 8.6 What must NOT happen

- Do **not** add the columns now "so they are ready" — that is precisely how
  `sourcePage` and `bloomLevel` became dead schema.
- Do **not** keep `authoredByAi` *and* an `origin` enum. One truth.
- Do **not** let provenance leak into adaptive selection without the §8.3 gate.
- Do **not** model provenance as a free-text `source` string. The owner is right
  that one collapsed field is the wrong shape; it is also unqueryable and
  untranslatable.
- Do **not** treat `textbookRole` as required. It is `null` for every
  non-textbook item, and a non-null constraint would force a lie.

### 8.7 IMPLEMENTED (2026-09-12) — owner brought this forward

The owner decided not to defer: `sourcePage` was unused and `authoredByAi` was
an insufficient boolean, so postponing would have forced changes across
repositories, services, API contracts, UI and tests later.

**One owner correction to §8.1, and it is the important one:**

> **Import is NOT an origin.** Importing is an ingestion *method*. A textbook
> question that arrives in a file is still `TEXTBOOK`; a teacher's question that
> arrives the same way is still `TEACHER`. **The importer states the real
> origin.** Batch/file/source tracking belongs to the future Imports capability
> and stays out of the Question domain. No `ingestionMethod` or `arrivedVia`
> field was added.

**Shipped — the smallest representation that fits:**

| Change | Detail |
|---|---|
| `QuestionOrigin` | `TEXTBOOK · TEACHER · AI · UNKNOWN` (no IMPORT), default `UNKNOWN` |
| `TextbookQuestionRole` | `EXERCISE · SELF_TEST · REVIEW · OTHER`, nullable |
| Domain rule | `resolveProvenance()` — a printed role requires `origin = TEXTBOOK` |
| Index | `@@index([origin, textbookRole])` for bank filtering |
| **Removed** | `authoredByAi` (redundant: `origin === 'AI'`), `bloomLevel` + the `BloomLevel` enum (dead), `sourcePage` (dead), `initialStatusFor()` (dead export that voided its own argument) |
| Guard | **new rule QP1** |

No provenance table. No change to `QuestionConcept`. Origin is not part of the
question key (key is still `lesson + fingerprint(stem)`), so re-imports stay
idempotent.

**The invariant that makes this more than two columns:** `origin = AI,
textbookRole = EXERCISE` is **refused**, not silently nulled — it asserts that a
machine-written item was printed in the book. Refusing surfaces the author's
mistake instead of hiding it.

**Historical data: not fabricated.** The 7 seeded questions are `UNKNOWN`. They
are aligned to a textbook lesson, but nothing establishes that they were printed
in the book, and alignment is not origin. The seed no longer sets a Bloom level
it never read.

**Rule QP1 enforces the §8.3 boundary in CI.** No file under Assessment, Mastery
or Learning (or their adapters) may reference question origin or
`textbookRole`. A future rule such as "exclude textbook exercises from adaptive
practice" is legitimate but must be written as an explicit Learning/Assessment
policy — QP1 is what forces that conversation instead of letting a repository
query decide pedagogy silently.

**Verified.** 13 domain tests + 7 service tests, **mutation-checked twice**:
disabling the invariant fails exactly 4 tests, defaulting to `TEXTBOOK` instead
of `UNKNOWN` fails exactly 2. Live over HTTP: `TEXTBOOK+EXERCISE` → 201,
`AI` and `TEACHER` on the **same concept** → 201 with `textbookRole: null`,
`AI+EXERCISE` → **400**, unstated → `UNKNOWN`, `origin=IMPORT` → **400 rejected
at the schema**. `check-item-bank` 51/51, `check-content-authoring` 34/34,
135 focused unit tests, guard **28/28**, typecheck clean.

**QP1 itself was mutation-tested** — the first version used
`stripCommentsAndStrings`, which blanks string literals and made the rule pass
on a planted `origin: 'TEXTBOOK'`. Switched to `stripComments`; the plant now
fails it.

**Status: §8.1–§8.6 recorded; §8.7 implemented.**

**Two decisions are requested from the owner** before #5 and #6 can be
scheduled: (a) does an extension move the cohort's date or create a per-learner
override? (b) is the misconception catalogue author-editable, or
curriculum-curated via seed/import?

**Blocked on nothing else.** Stages 1-4 can proceed in order on approval.

### §8.8 Obligation lifecycle — reopen (Stage 3) — IMPLEMENTED

**The audit narrowed the scope before any code was written.** The stated scope was "cancel + reopen". Cancel turned out to already exist, in the right place:

| Need | Where it already lives |
|---|---|
| Stop the work for a whole cohort | `InstructionalPlan` status `CANCELLED` (`DRAFT→PUBLISHED→CANCELLED`) |
| Hide cancelled work from learners | `obligationsForLearner` filters `plan.status = 'PUBLISHED'` by default |
| Keep the record after cancelling | Obligation rows retained, not deleted |
| Excuse ONE learner | `WAIVED` — actor, reason, timestamp |
| **Un-excuse one learner** | **nothing — this was the gap** |

A per-obligation cancel would have duplicated plan cancel for the cohort case and waive for the individual case, adding a second lifecycle path to the same rows. The owner's scope explicitly forbids a parallel lifecycle, so none was built.

**The real gap.** `recompute()` returns waived rows untouched, so a background pass can never silently reverse a human decision. That is correct — and it is also what made a mistaken waiver permanent. A teacher who excused the wrong learner had no remedy at all. `reopen` is that remedy and the only exit from `WAIVED`.

**The boundary that keeps it honest.** Reopening *withdraws an assertion; it does not make one*. It clears the waiver and nothing else; the status that follows is recomputed from evidence like any other obligation. It cannot mark work done, cannot un-complete finished work, and writes no mastery. A reason is mandatory in both directions, because an audit trail has to explain an override coming and going.

**Shipped:** `checkReopenable()` (domain), `PlanRepository.reopenObligation()` (port + adapter, writes `PENDING` and lets the service re-derive), `AssignmentService.reopen()`, `POST /instruction/obligations/:obligationKey/reopen` (instructor-only), audit action `instruction.obligation_reopened`. Errors: `instruction.reopen_reason_required` (400), `instruction.not_waived` (409). No schema change — the waiver columns already nullable.

**Verification:** mutation test disabling the guard fails 2 tests across both layers; 101 focused unit tests over 4 instruction files; `check-assignments` 46 → 54 live over HTTP, run 3× consecutively to prove the new section leaves the meaning of the following assertions unchanged; architecture guard 28/28; typecheck clean. The live run returned `IN_PROGRESS` after reopening rather than `PENDING`, which is the proof that the status is genuinely re-derived from evidence rather than written by hand.

---

## §9. Import/Export Audit and Architecture Evaluation

Requested: a documentation audit, a capability audit, and a unified import/export
architecture with template generation. This section is the **evaluation only** —
no import/export code, schema change, route, or template has been written, per
the implementation gate.

### §9.1 The finding that changes the proposal

The proposal asks for imports covering schools, branches, academic years, terms,
grades, sections, memberships, enrollments and school-scoped roles. The audit
establishes that **none of these entities has any write path in the application
at all.**

Prisma write calls per model, counted across `src/`:

| Model | Writes in `src/` | Only writer |
|---|---|---|
| School, AcademicYear, Term, Grade, Subject | **0** | `prisma/seed/seed.ts` |
| Enrollment, UserRole, LearnerProfile | **0** | `prisma/seed/seed.ts` |
| TextbookAdoption, Misconception | **0** | `prisma/seed/seed.ts` |
| **Textbook** | **0** | `seed.ts` + raw SQL in `scripts/seed-helpers.mjs` |
| Unit, Lesson, Concept, ConceptPrerequisite | 2 each | `AuthoringService` |
| Question, QuestionChoice, AnswerKey, QuestionConcept | 2-4 | `ItemBankService` |
| Flashcard, LearningResource, Exam, ExamItem | 2-3 | `ItemBankService` |
| InstructionalPlan, LearnerObligation | 3-4 | `AssignmentService` |

`IdentityRepository` exposes `findByLoginIdentifier`, `findById`, `recordLogin`,
`updatePasswordHash` — **and no create**. There is no user provisioning, no
enrollment API, no school API. There is also **no `Section`, `Class` or `Branch`
model in the schema at all**; the roster is a query over `Enrollment`, which was
a deliberate decision (`CLASS-ROSTER-INVESTIGATION.md`).

**Consequence: institutional import cannot be built next.** An importer for
schools/terms/grades/enrollments would have no canonical service to call, so it
would have to write Prisma directly — which is exactly the "second hidden write
path" the brief forbids, and exactly what legacy did (19 direct `prisma.*` calls
in `textbook-import.service.ts`). Import would silently become the *primary*
provisioning API, defining creation semantics for eight entities by accident,
inside a file parser.

The ordering is therefore inverted from the proposal: **provisioning services
must exist before their importers.** An importer is a bulk adapter over an
existing use case. Where the use case does not exist, the importer is not an
importer — it is an undesigned write path wearing a spreadsheet.

### §9.2 Documentation audit

13 documents, 5,771 lines. No missing cross-references. Findings:

| Document | Type | Verdict |
|---|---|---|
| `README.md` | entry point | **Keep.** Reading order is accurate; all 8 links resolve. |
| `ARCHITECTURE.md` | permanent rules | **Keep — canonical.** Owns layers, contexts, the 8 defended decisions. Import rules belong here, not in a new file. |
| `ARCHITECTURAL-GATE.md` | decision record | **Keep.** Is the de-facto `DECISIONS.md` (R1–R4 + revisions). **Do not create `DECISIONS.md`** — this document already owns durable decisions. |
| `CAPABILITY-LEDGER.md` | status | **Keep — canonical.** One correction needed, see §9.3. |
| `NEXT-WAVE-REVIEW.md` | open findings | **Keep — canonical** for unresolved items. This section lives here. |
| `PUBLISHING-LIFECYCLE-GATE.md` / `CONTENT-LIFECYCLE-GATE.md` | gates | **Overlap, but legitimate**: the first owns the *approval* workflow, the second owns *readiness semantics*. Keep both; do not merge. |
| `ASSIGNMENT-GATE.md`, `REMEDIATION-GATE.md`, `CLASS-ROSTER-INVESTIGATION.md`, `KEY-IDENTITY-AUDIT.md` | gates/audits | **Keep.** Closed, evidence-bearing, still cited. |
| `RECONCILIATION.md`, `MIGRATION-FROM-LEGACY.md` | audits | **Keep.** |
| `FRONTEND-ARCHITECTURE.md` | spec | **Keep.** Unimplemented by design (§14 gates it). |

The proposal suggests `gates/` and `audits/` subdirectories. **Rejected as
premature**: 13 files in one flat directory is navigable, the README already
imposes a reading order, and moving files would break every cross-reference in
the corpus for no functional gain. Revisit past ~20 documents.

**No new document is needed for import/export.** `ARCHITECTURE.md` owns the
permanent rule, the ledger owns status, this section owns the open design.

### §9.3 Capability audit — documentation claims vs. code

Verified by reading write paths, routes and tests, not by trusting the ledger.

**Claims that hold:** items 1–9, 12–16, 19 (Learning paths, remediation,
assignments, exams, flashcards, misconceptions, XP, completion, progress, parent
support, content management, question bank, concept relationships,
prerequisites, analytics). Each has a domain module, a service, a route and
tests.

**Claim that does not hold — item 18 "Identity + roles + sessions ✅".**
Authentication, session rotation and reuse detection are real and tested. But
the capability as titled includes roles and users, and **no user can be created,
no role can be granted, no enrollment can be made** through the application. The
seed is the only writer. This should read 🟡 with provisioning named as the gap.
Item 17 (Textbook) is already honest — it states that textbook creation remains
administrative and outside HTTP.

**Implemented but not live-verified:** journey, flashcards, XP/engagement,
due-work, parent tasks have unit tests but **no live proof script** (7 scripts
exist: published-only, content-authoring, item-bank, assignments, analytics,
remediation, misconceptions). Unit tests here mock the repository, and the one
concurrency bug found in this project was invisible to unit tests. Not a
correctness claim — a confidence gap worth closing before these surfaces get a UI.

**Duplicated/incorrect paths:** none found. Single-writer rules (M1, CW1, IW1,
RW1, AW1, MW1, QP1) are enforced by the 28-rule architecture guard.

### §9.4 The public import contract — decision

Options in the brief: (A) database column names, (B) stable business field
names, (C) versioned profiles.

**A is rejected.** It couples the public contract to Prisma, leaks internal
structure, and is unusable by administrators. It is also *impossible* here:
`Question.id`, `lessonId`, `conceptId` are UUIDs no human has.

**B alone is insufficient**, because field names are only half a contract —
without a declared version, sheet set and dependency order there is nothing to
validate a workbook *against*, and no way to evolve it.

**C is correct, and cheaper here than it looks** — with one important
correction. The audit found that **Edu7 keys are derived, never supplied**:

    textbookKey  EDU-MATH-G07-T1-ED2026        = subject+grade+term+edition
    unitKey      <textbookKey>-U-<slug>
    lessonKey    <unitKey>-L-<slug>
    conceptKey   <lessonKey>-C-<slug>
    questionKey  <lessonKey>-Q<fingerprint(text)>

`AuthoringService.createUnit` builds the key from the parent plus a slug derived
from the name. A template must therefore **never contain a key column for a node
it is creating** — that would invent an identity the domain owns, and it is the
one thing `KEY-IDENTITY-AUDIT.md` exists to prevent. Templates carry
`parent reference + slug + human fields`; the key is an *output*, returned in the
import report. This is a stronger constraint than "use business field names" and
it falls out of the existing design rather than being added to it.

Profiles are therefore versioned declarations of: sheets, columns, required/
optional, types, enum values (read from the domain constants, not retyped),
references, dependency order, allowed operations, and the mode. One definition
generates the template, drives validation, and documents the contract — which is
what makes template generation honest rather than a second source of truth.

### §9.5 OneRoster — decision

Evaluated against the 1.2 CSV binding: `manifest.csv` is the only required file,
data files are `absent|bulk|delta`, every record needs a `sourcedId` GUID, and
semantic consistency is mandatory (`enrollments.csv` requires academicSessions,
classes, courses, orgs and users to accompany it).

**Verdict: adopt the *principles*, reject the *format*, for now.**

Principles worth stealing, because they are correct and cheap: a manifest
declaring profile + version + per-file mode; validate the whole package before
any write; reject unresolvable references rather than nulling them; explicit
dependency order; bulk vs delta as a declared mode rather than a guess.

The format itself does not fit. OneRoster models `courses` and `classes`
(sections) — Edu7 has **neither model**, by decision. Its `sourcedId` is a GUID
supplied by the source system; Edu7 derives keys from business coordinates.
Mapping between them would mean inventing a section entity and a GUID
correspondence table to satisfy a spec no counterparty is currently asking for.
And conformance is not partial: claiming OneRoster while supporting a subset is
a false claim, which the brief explicitly forbids.

**Recommendation: Edu7-native profiles now; keep OneRoster as a named future
export profile** (`oneroster-1.2-roster`), to be built when a real counterparty
exists *and* after sections/enrollment provisioning exist. Recording it as a
named trigger rather than speculative infrastructure.

### §9.6 Recommended sequence (replaces the proposal's ordering)

The proposal's scope is ~4,000+ lines of legacy equivalent. Sequenced by what
the audit proves is safe to build:

**Stage A — Export first, import second.** Export is read-only: it cannot
fabricate mastery, cannot bypass validation, cannot elevate permissions, and it
fails safe. It also produces the round-trip fixture that import tests need, and
it forces the profile definitions into existence under zero risk. Start with
textbook content export (the one domain that *is* fully serviced).

**Stage B — Content import over existing services.** Units, lessons, concepts,
prerequisites, questions, choices, answer keys, concept alignment, flashcards,
resources. Every one of these has a canonical service method today, so the
importer is a genuine adapter with no new write path. Origin must be stated by
the importer per the standing rule (`TEXTBOOK` vs merely aligned), never inferred.

**Stage C — Provisioning services** (schools, terms, grades, users, enrollments,
roles) as ordinary authored APIs with their own authorization design. This is a
capability gap in its own right, not an import feature.

**Stage D — Institutional import**, once C exists to call.

**Never:** mastery, evidence, attempts, completion, XP, recommendations,
eligibility. Derived state is computed from evidence or it is fabricated.

### §9.7 Formats, safety, authorization — positions

- **`.xlsx` primary, `.csv` for single-entity, `.json` for machine exchange.**
  All three normalize to one internal row model; the parser is the *only*
  format-aware component and contains no educational rules.
- **Library:** the legacy `xlsx` (SheetJS) dependency should not be carried over
  without review — it is absent from the new project and has a history of
  advisories. Evaluate `exceljs` at implementation time.
- **Dry-run is mandatory, not optional**, and must be the same code path as the
  real run with persistence disabled — a preview that diverges from the write is
  worse than no preview.
- **Transaction unit: the package, all-or-nothing.** Partial content leaves a
  hierarchy referencing missing parents.
- **Authorization from the authenticated actor only.** A file must never carry
  school, role or actor scope; textbook write-locks (`content.textbook_locked`)
  and the two-actor publication workflow apply to imports exactly as to the API,
  because the importer calls the same services.
- **Error reporting:** sheet, row, column, stable code, message, severity,
  blocking — as a structured report, never "import failed".

### §9.8 Open questions for the owner

1. **Sequence:** accept export-first (Stage A), or require content import first?
2. **Provisioning (Stage C)** is a real capability gap the audit surfaced — schedule
   it, or keep institutional data seed-only for now?
3. **Ledger item 18:** confirm the correction to 🟡.
4. **Live-proof gap** for journey/flashcards/XP/due-work/parent-tasks — close it
   before or after import work?

---

## §10. Decision Report — Import/Export Delivery Order

Owner decisions accepted (Stage 1 of the directive). This section records them
with the evidence that refines them, and answers Decisions A–D. **No
implementation code has been written.**

Owner-set order: `live-proof gaps → read-only export → provisioning APIs →
content import → institutional import`.

### §10.1 Decision A — Export first, confirmed, with one correction

Accepted. Export is read-only, cannot fabricate derived state, cannot elevate
permissions, and produces the round-trip fixtures import tests need. Nothing in
the audit contradicts it.

**The correction: there is no canonical read path to export from.** `content.routes.ts`
exposes seven write endpoints and exactly one GET — `/readiness`. The content
hierarchy is **write-only over HTTP**. The one existing reader,
`ContentRepository.loadStructure()`, returns keys, order, `isActive`,
`masteryThreshold` and prerequisite edges — **no names, no slugs, no
descriptions**, because it was built to validate publication readiness, not to
reproduce a book.

So "export uses canonical read paths" cannot be satisfied by reusing
`loadStructure`, and widening it would corrupt a validation query into a
reporting query. The export foundation must introduce **one new read port owned
by Content**, purpose-built for export and used by nothing else. That is a real
piece of work, not a thin wrapper — and it is still the right first step,
because it is read-only and it forces the profile definitions into existence at
zero risk.

**JSON first**, per the directive: it is the only format that can represent the
hierarchy without flattening decisions, so the profile contract gets settled
before spreadsheet ergonomics are argued about. CSV/Excel follow once stable.

### §10.2 Decision B — Provisioning scope: much smaller than feared

The audit found every institutional entity **already carries a stable
human-authored business key**:

| Entity | Key | Example |
|---|---|---|
| Subject | `key` unique | `MATH` |
| Grade | `key` unique | `G07` |
| AcademicYear | `key` unique | `2026-2027` |
| Term | `key` unique | `2026-2027-T01` |
| School | `key` unique | (seeded) |

These are not generated — they are authored codes. So an importer can *resolve*
`MATH` + `G07` + `2026-2027-T01` to the FKs a Textbook needs **without any
provisioning service existing**, provided those rows are already present.

This splits Decision B cleanly:

**Required now (blocks content import): Textbook creation only.** `Textbook`
requires `termId`+`gradeId`+`subjectId` and has no create path anywhere in the
application — `seed.ts` and raw SQL in `scripts/seed-helpers.mjs` are the only
writers. Content import is impossible without it: there is no book to import
into. This is one service method on the existing `AuthoringService`, resolving
three business keys, and it closes ledger item 17's named gap ("textbook
creation is still administrative and outside HTTP") as a side effect.

**Seed-only for this phase:** School, AcademicYear, Term, Grade, Subject. They
change once a year, they are already keyed, and nothing in the export→content-import
path writes them. Building five CRUD surfaces now would be the "large expansion
before establishing the minimum" the owner warned against.

**Required later (Stage 5/6, before institutional import):** User, UserRole,
LearnerProfile, Enrollment, GuardianLink. These are the genuinely missing
capability — `IdentityRepository` has no `create` — and each needs its own
authorization design, not an import feature.

**Intentionally unsupported:** Section/Class/Branch. No model exists; the roster
is a query over `Enrollment` by decision (`CLASS-ROSTER-INVESTIGATION.md`). Not
adding models to match an external standard.

### §10.3 Decision C — Ledger item 18: confirmed 🟡

Already applied in Rev 21. Authentication, session rotation and reuse detection
are real and tested; user/school/role/enrollment provisioning does not exist.
The single label was hiding two different states.

### §10.4 Decision D — Live-proof gaps, prioritised by the directive's criteria

Five capabilities have unit tests but no live HTTP verification. Ranked by
whether they mutate persistent state, cross domains, carry an authorization
boundary, or involve concurrency — not by convenience:

| Rank | Capability | Mutates | Authz boundary | Concurrency | Verdict |
|---|---|---|---|---|---|
| **1** | **XP / Engagement** | **yes** — `xpLedgerEntry.create` | learner-scoped | **yes** — written as a side effect of `submit-answer`, with an idempotency claim | **Must have a live proof.** An idempotency guarantee asserted only against a mocked ledger is not evidence; the one concurrency bug this project hit was invisible to unit tests. |
| **2** | **Parent tasks** | **yes** — create + cancel | **guardian vs staff** | no | **Must have a live proof.** Advisory-origin refusal and the PARENT boundary are exactly the rules a mock can be written to agree with. |
| **3** | Due Work / alerts | no (pure read) | staff-only | no | Worth adding — cheap, and it is the teacher-facing surface. |
| 4 | Journey | no | learner-scoped | no | Defer. Read-only composition over proven parts. |
| 5 | Flashcards | no (read; writes already covered by `check-item-bank`) | author | no | Defer. Authoring side is already live-proven. |

**Recommendation: close ranks 1–3 before export begins** (one script, three
sections, reusing `scripts/seed-helpers.mjs`). Ranks 4–5 stay documented gaps.
This is narrower than "close all live-proof gaps first" — ranks 4 and 5 mutate
nothing, so a live script would mostly re-prove reads that other scripts already
exercise.

### §10.5 Resulting sequence

1. **Live proofs for XP, parent tasks, due-work** — closes the confidence gap on state-mutating, authorization-bearing surfaces.
2. **Textbook creation service** — the one provisioning capability that blocks everything downstream; also closes item 17.
3. **Content export (JSON)** — new Content read port + first versioned profile.
4. **Content import**, vertical slice: **unit → lesson → concept → prerequisites**. Chosen over question import because every method exists on `AuthoringService`, keys are derived at each level (exercising the no-key-column rule), and it needs no answer-key or choice semantics. Questions follow as slice 2.
5. **Provisioning APIs** (users, roles, enrollments) as ordinary authored capabilities.
6. **Institutional import** over them.

### §10.6 Open question

The directive says provisioning APIs come before content import; the audit says
only **one** provisioning capability (Textbook) actually blocks content import,
and the rest block *institutional* import. §10.5 reflects that reading — full
provisioning stays at step 5. Confirm, or require all provisioning before any
content import.


---

## §11. Import/Export Review — after slices 1 and 2

Written at the end of step 4 (content import), covering commits `3155716`
(export), `89e5327` (import slice 1), `fc73f44` (import slice 2) and `ff9f7a4`
(cleanup correction). This section reviews what was built against what §9 and
§10 said should be built, and records what the work discovered that the audit
did not anticipate.

### 11.1 Did the delivered work match the binding decisions?

| §9/§10 decision | Delivered | Evidence |
| --- | --- | --- |
| Export first, own read port | `ContentExportReader`, unused by anything else | `ports.ts`; `loadStructure` untouched |
| Keys derived, never supplied | `key` ignored on create; `generatedKeys` returned | import tests; live round trip |
| No second write path | Writes go through `ContentAuthoringService` + `ItemBankService` only | `content-import.service.ts` has no repository |
| Parser holds no business rules | Service takes a parsed package; no format code | service signature |
| Dry run = same path, persistence off | One code path, `dryRun` defaults to `true` | mutation: forcing the write fails a test |
| Transaction unit = the package | Any blocking problem refuses the whole file | mutation: ignoring blocking problems fails 3 tests |
| Structured row-level errors | `{sheet,row,field,reference,code,message,severity}` | duplicate check reports a row number |
| Never import derived state | No mastery/evidence/attempt/XP field exists in the profile | `NON_IMPORTABLE_FIELDS`; test asserts on field names |
| Importer states textbook vs lesson-aligned | `origin` + `textbookRole` carried; domain judges coherence | live: `TEXTBOOK/EXERCISE` round-trips |
| Migration honesty: leave UNKNOWN | Unstated origin imports as `UNKNOWN` | mutation: defaulting to `TEXTBOOK` fails a test |

No decision was reversed. One was sharpened: §9 said "one canonical service", and
the code found there are legitimately **two** — structure belongs to
`ContentAuthoringService`, items to `ItemBankService`. The importer writes
through both rather than collapsing them, which would have created a third
definition of a question.

### 11.2 What the work found that the audit did not

Four defects, none of which were visible from reading code:

1. **Authoring the same question twice returned an unhandled 500.** A question's
   key derives from its text within its lesson, so a repeat is an expected
   duplicate. The unique constraint leaked instead. Now `question.exists` (409),
   refused where the key is derived — which is also what makes a re-import
   idempotent rather than forking the bank.
2. **`Promise.all` in `linkPrerequisite`** — the known PGlite single-connection
   killer, on a path the importer walks in a loop.
3. **`dropTextbook` stranded 9 orphan questions.** A question has no foreign key
   to a textbook; it reaches one only through concept links, so deleting the
   book cascaded the links and left the rows. Found by counting rows after a
   run, not by reading the cleanup.
4. **The first fix for (3) was itself too broad** and hit `RESTRICT` on
   `attempt_items` and `exam_items`. Both are deliberate: a response records
   what a learner was actually asked, and an exam item is a paper's
   composition. The sweep now honours them.

(3) and (4) are the same lesson twice: **verify cleanup by counting rows, and let
the schema's constraints tell the cleanup where its authority ends.**

### 11.3 Contract additions

`CONTENT_IMPORT_ORDER` now ends in `questions`, and the export test was rewritten
to assert the invariant that actually matters — nothing is read before what it
points at — rather than which entity happens to be last.

Choice identity is the subtle part. The stored choice id is a one-way hash of the
question key and the author's local handle, so the handle cannot be recovered.
Export uses **position** as the recoverable identity (`c1`, `c2`) and remaps the
answer key onto the same names. A package is therefore portable between books
instead of carrying one book's uuids, and no uuid appears in the contract.

Questions reference concepts **by slug**, unlike prerequisite edges which use
keys. That asymmetry is a domain rule, not an inconsistency: a prerequisite may
point into another textbook, but a question's concepts are refused if they span
textbooks (`question.concepts_span_textbooks`).

### 11.4 Verification at this gate

- Unit: **777 passing, 37 files** (`npm run verify`, which runs typecheck →
  `arch:check` → tests).
- `check-content-authoring` **81 checks** (52 → 71 → 81), run twice
  consecutively, with row counts before and after proving zero residue.
- All eight live scripts green: published-only, content-authoring 81,
  item-bank 51, assignments 54, analytics 42, remediation 58, misconceptions 14,
  engagement-and-parent 46.
- `arch:check` 28/28.
- Six mutations across the two slices, every one caught.

One process note worth keeping: **`vitest` passed three casts that `tsc`
rejected** (`ImportProblem[]` is readonly). Running the focused test file after
appending tests is not sufficient; `npm run verify` is what catches this.

### 11.5 Remaining gaps in import/export

Genuine, and deliberately not closed in this step:

- **Formats.** JSON only. `.xlsx` primary and `.csv` single-entity remain the
  §9 decision; the parser boundary exists but has no format adapter behind it.
- **Template generation.** The profile can describe itself, but nothing emits a
  blank authoring template yet.
- **Misconceptions, resources and flashcards** are not in the package. Questions
  may reference a `misconceptionKey`, and an import will fail cleanly if it does
  not exist, but the package cannot create one.
- **Exams** are not exportable. `exam_items` composition is a separate contract.
- **Institutional import** (users, enrolments, guardians) is untouched, per
  §10.5 — only Textbook creation blocked content import, and it shipped.
- **`oneroster-1.2-roster`** remains a named future profile, not an
  implementation, and conformance is still not claimed.
