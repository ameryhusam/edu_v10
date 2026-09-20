# Canonical Key Identity — Mandatory Pre-Implementation Audit

**Directive:** reuse the existing key-generation behaviour as *behavioural
evidence*; do not invent a new key scheme. Resolve explicitly whether deriving
Unit/Lesson/Concept identity from `orderIndex` is safe, because reordering must
not silently change a persisted concept identity or invalidate mastery history.
**No Content CRUD until this is resolved.**

**Verdict: the flag is correct. Order-derived identity is UNSAFE and must not
survive into authoring.** The fix is narrow and is stated in §5.

---

## 1. What exists in legacy — audited, not assumed

### 1.1 There are TWO generators, not one

| File | Size | Consumers |
|---|---|---|
| `src/utils/textbook-key.generator.ts` | 108 lines | `question.service`, `question-import.service` |
| `src/utils/curriculum-code.generator.ts` | 23,484 bytes | `lesson-scoped-import`, `learning-material.service`, `textbook-excel-import`, `textbook-io`, `learning.routes` |

Both export `generateUnitKey`, `generateLessonKey`, `generateConceptKey`. They
disagree:

| | `textbook-key.generator` | `curriculum-code.generator` |
|---|---|---|
| Textbook key | `EDU-{SUBJ}-G07-T1-ED2026` | `EDU-MTH-G07-T1-…` (own format) |
| Empty/invalid order | **throws** | silently `|| 1` |
| Unit prefix | always `U` | `U`/`B`/`F`/`S` by `unitType` |
| Non-numeric order | **throws** | accepts, slugifies into the key |

This is the *same class of defect* the rebuild exists to remove (cf. four
competing mastery formulas, three `CURRICULUM_STATUS` definitions). The
**cited** generator is the better one: it is stricter, it refuses invalid input
instead of guessing, and it documents its reasoning. It is the right
behavioural reference — but it must be adopted as **one** rule, not merged with
the second.

### 1.2 The cited generator is genuinely good, and states the right principle

`textbook-key.generator.ts` is deterministic, with no timestamp, no random, no
database id — exactly as described. Its `generateQuestionKey` comment is the
most important text in either file:

> *"The parent is the lesson because lesson is the mandatory question scope
> while concept linkage is optional and may change. Keeping the optional
> concept out of identity prevents a relink operation from silently changing an
> externally referenced question key."*

**Legacy had already discovered the exact principle at issue here** — identity
must not embed a mutable attribute — and applied it to questions, where the
mutable thing was concept linkage.

It then did not apply that principle to Unit/Lesson/Concept, where the mutable
thing is `orderIndex`:

```ts
function childKey(parentKey, marker, orderIndex) {
  return `${cleanSegment(parentKey)}-${marker}${String(positiveOrder(orderIndex)).padStart(2,'0')}`;
}
```

So the audit's conclusion is not that legacy was careless. It is that legacy
**stopped one step short of its own rule**, and we inherited the gap.

### 1.3 The new project inherited the same flaw

`src/shared/kernel/identifiers.ts` reimplements the same derivation:
`unitKey(parent, order)`, `lessonKey(parent, order)`, `conceptKey(parent, order)`
→ `<parent>-C02`. The format is different (year-first, no `EDU-` prefix) but
the **identity model is identical**, and it carries the identical defect.

Note the new `questionKey(parent, order)` is *worse* than legacy's: it parents
questions on the **concept** and numbers them by order, discarding both halves
of the insight quoted above.

---

## 2. Is order-derived identity safe? — No

The failure is concrete. Insert a new concept at position 2 in a lesson of
three:

```
BEFORE                          AFTER inserting a new C02
…-L04-C01  "Sets"               …-L04-C01  "Sets"
…-L04-C02  "Union"              …-L04-C02  "Intersection"   ← NEW
…-L04-C03  "Complement"         …-L04-C03  "Union"          ← was C02
                                …-L04-C04  "Complement"     ← was C03
```

Every key from the insertion point down now names a **different concept**. The
key is not an identifier; it is a positional address that silently rebinds.

### What actually breaks — measured, not assumed

The blast radius is smaller than feared, and this matters for the fix:

**Mastery storage is safe; mastery *lookup* is not.**
`MasteryEvidence.conceptId` and `ConceptMastery.conceptId` are opaque UUID
foreign keys (`schema.prisma:853, 878`), so reordering cannot orphan mastery
rows — the relational links hold.

But every read is by **key**, not id (`mastery.repository.ts:24, 33`):

```ts
where: { learner: { key: learnerKey }, concept: { key: conceptKey } }
```

So any caller holding a key from before a reorder — a cached client, a saved
URL, a queued job, an export being re-imported — silently reads **a different
concept's mastery**. It returns a plausible number for the wrong concept rather
than failing. That is worse than an orphan: a missing row is an error you can
see, and this is not.

Only six columns store a key as free text:

| Location | Column | Exposure |
|---|---|---|
| `MasteryEvidence:855` | `questionKey` | **HIGH** — permanent evidence record |
| `MasteryEvidence:860` | `misconceptionKey` | **HIGH** — permanent evidence record |
| `LearningDecisionLog:938` | `conceptKey` | **HIGH** — the audit trail of why a learner saw something |
| `ContentChunk:593-594` | `lessonKey`, `conceptKey` | MEDIUM — AI grounding retrieval |
| `Attempt:784` | `lessonKey` | MEDIUM |

So the honest statement is: **reordering would not corrupt the mastery
computation, but it would corrupt the record of what that computation was
about.** A `LearningDecisionLog` saying "recommended `…-C02`" becomes a lie the
moment C02 means something else — and this project's central promise is that a
teacher asking *"why did my student see this?"* gets a true answer.

Beyond the database, keys are the stated external contract: URLs, exports,
spreadsheets, re-import idempotence (`identifiers.ts` header). A key that
changes under reordering breaks every one of those, and breaks them **silently**
— re-import would create duplicates rather than match existing rows.

### 2.1 Why "just don't reorder" is not an answer

Reordering is not an edge case in authoring; it is one of the primary
operations. The Content gate itself requires contiguous `orderIndex` and a
reorder operation. An identity scheme that forbids the feature it must support
is not a scheme.

---

## 3. Does immutability-after-publish rescue it? — Only partly

The Content gate locks published content structurally, so reordering is
impossible once published. That genuinely contains the damage, but does not
resolve it:

1. **DRAFT reordering still breaks things.** ContentChunks, decision logs from
   preview/testing, and any external reference made during authoring all rot.
2. **It couples two unrelated rules.** Identity stability would depend on
   publication state — so a bug in the lifecycle becomes a data-integrity bug.
3. **It forbids legitimate post-publication correction.** Inserting an omitted
   concept in a new revision would renumber its siblings, so the *revision*
   mechanism inherits the defect.

Immutability is a good rule for a different reason (mastery interpretability).
It is not a substitute for stable identity.

---

## 4. Resolution

**Identity must not encode position.** Two changes, both small:

### 4.1 Separate identity from ordering

`orderIndex` stays as a **presentation attribute** — freely editable, never
part of a key. Identity comes from a stable, author-assigned slug fixed at
creation:

```
2026-2027-T01-G07-MATH-U03-L04-C-SETS-UNION
                                  └── stable slug, never changes
```

Reordering then changes `orderIndex` only. The key is untouched, so evidence,
decision logs, chunks, URLs and re-imports all stay valid.

**Where the slug comes from:** the author supplies it, or it is derived from
the concept's name at creation and then **frozen**. Renaming the concept does
not change the key — same principle as questions in §1.2.

### 4.2 Adopt legacy's fingerprint where a slug is impractical

`stableKeyFingerprint` (FNV-1a, NFKC-normalised, deterministic across
runtimes, no timestamp/random/db-id) is proven behaviour and should be reused
verbatim for imported content that has no author-assigned slug:

```
…-L04-C-a3f91b27          ← fingerprint of the concept's stable identity
```

Legacy already uses exactly this for questions, misconceptions, remedial
content and flashcards. Extending it to concepts is *applying legacy's own
rule consistently*, not inventing a scheme.

### 4.3 Textbook keys — one open point for the owner

Legacy: `EDU-{SUBJECT}-G07-T1-ED{edition}` — subject + grade + term + **printed
edition**, consistent with the ruling that `edition` means the printed textbook
edition, not a curriculum publication year.

New: `2026-2027-T01-G07-MATH` — subject + grade + term + **academic year**.

These are not interchangeable. Academic year is a *deployment* fact (the same
printed book is used across years); edition is an *identity* fact. Legacy is
arguably more correct, and the new `@@unique([academicYearId, termId, gradeId,
subjectId])` constraint encodes the other choice.

**Flagged, not decided** — it changes the meaning of every textbook key and
touches the unique constraint, so it needs an explicit ruling. Both remaining
options are recorded in §6.

---

## 5. What must happen before any Content CRUD

1. ✅ **Audit complete** — this document.
2. ⛔ **Decide §4.3** (textbook key basis: academic year vs printed edition).
3. ⛔ **Re-specify `identifiers.ts`**: `unitKey`/`lessonKey`/`conceptKey` take a
   stable slug, not an order; `questionKey` re-parented to the lesson per
   legacy's documented reasoning.
4. ⛔ **Port `stableKeyFingerprint` verbatim**, with tests pinning known inputs
   to known outputs so the value never drifts.
5. ⛔ **Add an architecture rule**: no key-derivation function may accept an
   `orderIndex`. Machine-enforced, like M1/M2/G1/L1.
6. ⛔ **Migrate the seed** to slug-based keys and confirm `db:reset` is clean.

Only then: Content CRUD.

**Cost of doing this now vs later:** the current database holds 3 seeded
concepts and no production data. Changing the key scheme today is a seed edit.
After Content authoring ships, it is a migration of every content row, every
`ContentChunk`, every `LearningDecisionLog`, and every external export.

---

## 6. Open questions for the owner

1. **Textbook key basis** — academic year (current) or printed edition
   (legacy)? Affects every key and the `@@unique` constraint.
2. **Slug source** — author-typed (better keys, more authoring friction) or
   auto-derived-then-frozen from the name (frictionless, occasionally ugly)?
   Recommendation: auto-derive, allow override at creation, freeze thereafter.
3. **Existing seed keys** — `…-U01-L01-C01` are order-derived. Since nothing has
   shipped, recommendation is to regenerate rather than preserve.


---

# Resolution — IMPLEMENTED (2026-09-11)

Owner ruling: **printed edition** is the textbook key basis. Implemented in
full; §5 items 2–6 are complete and Content CRUD is unblocked.

## What changed

| Before | After |
|---|---|
| `2026-2027-T01-G07-MATH` | `EDU-MATH-G07-T1-ED2026` |
| `…-U03` (position) | `…-U-SETS-RELATIONS` (frozen slug) |
| `…-L04` (position) | `…-L-SET-AND-ELEMENT` |
| `…-C02` (position) | `…-C-SET` |
| `questionKey(concept, order)` | `questionKey(lesson, stableIdentity)` |
| `@@unique([academicYearId, termId, gradeId, subjectId])` | `@@unique([subjectId, gradeId, termId, edition])` |

`Unit`, `Lesson` and `Concept` gained a `slug` column, unique within parent.
`orderIndex` survives as presentation only — it is documented as such in the
schema and can no longer reach a key function.

**Academic year moved to `TextbookAdoption`** (`@@unique([textbookId, schoolId,
academicYearId])`). This is the structural half of the ruling: the same printed
book is taught for several years, so year-of-use is a deployment fact about a
school, not part of the book's identity. `Textbook.academicYearId` is gone.

`stableKeyFingerprint` (FNV-1a over NFKC) is ported verbatim from
`textbook-key.generator.ts` and used for questions, misconceptions and
flashcards. Its outputs are **pinned in tests** (`'set-union' → 2421eef9`)
because a drift there would break every key ever issued.

## Enforcement

New architecture rule **K1**: no exported `*Key` function may take an
`order`/`index`/`position`/`sequence` parameter. Verified by planting a
violation and observing the failure.

`normalizeSlug` is Unicode-aware (`\p{L}`), so Arabic names slug correctly —
`'العنصر والانتماء'` → `العنصر-والانتماء`. A rule that kept only `[A-Z]` would
have made Arabic content unauthorable, which for this product is a defect, not
a limitation.

## Verified live

```
GET /learning/next-step?textbookKey=EDU-MATH-G07-T1-ED2026
→ LEARN / unseen_concept
  EDU-MATH-G07-T1-ED2026-U-SETS-RELATIONS-L-SET-AND-ELEMENT-C-SET
```

Keys are now self-describing: a decision log entry names the concept a reader
can recognise, instead of an address that may since have rebound.

177 tests, 15 architecture rules, 0 violations. Baseline regenerated (40
tables), `db:apply` + `db:seed` clean.

## Remaining open question

§6.2 (slug source: author-typed vs auto-derived-then-frozen) is **not** blocking
— the seed supplies explicit slugs, and the Content authoring API will need a
decision when it exposes creation. Recommendation stands: auto-derive from the
name, allow override at creation, freeze thereafter.
