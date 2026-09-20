# Content Management — Readiness Check & Publishing Lifecycle Gate

**The instruction was conditional:** build Content Management Core first **if**
the content model and publishing lifecycle are already settled; otherwise build
Assignments first and keep Content limited to the canonical model already
defined.

This document runs that check rather than assuming the answer.

**Result: the hierarchy is settled. The publishing lifecycle is NOT.**

> ✅ **PRECONDITION CLEARED 2026-09-11.** The key-identity audit is complete and
> **implemented**: see [`KEY-IDENTITY-AUDIT.md`](KEY-IDENTITY-AUDIT.md).
> Textbook keys are now edition-based (`EDU-MATH-G07-T1-ED2026`), hierarchy
> keys derive from a frozen `slug` instead of `orderIndex`, questions are
> parented on the lesson, and rule **K1** forbids any key function from taking
> a position. Content CRUD is unblocked.

Therefore: **Content Management Core goes first, but the first thing it must do
is settle the lifecycle** — because everything else in Content authoring
depends on it, and there is a genuine unresolved conflict in the model today.

---

## 1. The check

### 1.1 Is the content model settled? — **Yes**

`Textbook → Unit → Lesson → Concept` is coherent and already exercised by
built, tested capabilities:

| Element | State |
|---|---|
| Hierarchy + canonical keys | ✅ `2026-2027-T01-G07-MATH-U03-L04-C02`, tested |
| `Textbook` uniqueness | ✅ `@@unique([academicYearId, termId, gradeId, subjectId])` |
| Ordering | ✅ `orderIndex` + `@@unique([unitId, orderIndex])` |
| Unit self-nesting | ✅ `UnitTree` + `ContentNodeType` |
| `ConceptPrerequisite` | ✅ `strength`, `requiredMastery`, `@@unique`, graph + root-gap tested |
| `Concept` pedagogy | ✅ `difficulty`, `importance`, `masteryThreshold`, `isCore` |
| Misconceptions, resources, pages | ✅ modelled |

No structural change is needed to start authoring. This half of the condition
passes cleanly.

### 1.2 Is the publishing lifecycle settled? — **No**

Four findings, each verifiable:

**Finding 1 — the enum exists but is nearly unenforced.**
`PublicationStatus { DRAFT, IN_REVIEW, PUBLISHED, ARCHIVED }` is declared on
exactly three models — `Textbook:413`, `Question:662`, `Exam:750` — and read in
exactly **one** place in the whole codebase:

```
assessment.repository.ts:56 →  where: { status: 'PUBLISHED', ... }   // questions only
```

**A DRAFT textbook is fully teachable today.** Nothing filters content reads by
textbook status. By this project's own rule — *a table is not a capability* —
the lifecycle is a column, not a behaviour.

**Finding 2 — Unit / Lesson / Concept have no status at all.** They carry
`isActive: Boolean`. So "published" is a textbook-level fact while "active" is
a node-level fact, and the relationship between them is currently undefined.

**Finding 3 — there is no Content write path whatsoever.**
There is no `content.repository.ts`, and there are **zero** `create`/`update`/
`upsert`/`delete` calls against `textbook`, `unit`, `lesson` or `concept`
anywhere outside `prisma/seed/seed.ts`. Content is read-only by construction.
This is the honest state item 13 records as 🔴.

**Finding 4 — legacy's lifecycle is genuinely contradictory, and we inherited
half of it.** This is the decisive finding.

Legacy's own header comment (`textbook-lifecycle.service.ts:6`):

> `status: DRAFT → ACTIVE → ARCHIVED; publication is independent (isPublished + publishedAt)`

So legacy had **two orthogonal axes**: a *status* (`DRAFT | ACTIVE | ARCHIVED`
— note: **no PUBLISHED**) and a separate *publication* boolean. They were
reconciled ad hoc at read time:

```ts
// textbook-snapshot.service.ts:653
curriculumStatus: c.status === 'PUBLISHED' ? 'ACTIVE' : (c.status || 'ACTIVE'),
isPublished:      c.isPublished !== false || c.status === 'PUBLISHED',
```

That is a system translating between two representations of the same fact and
guessing when they disagree — with `'PUBLISHED'` appearing as a status value
the canonical constant does not even define.

The new schema took a *third* position: one enum, with an `IN_REVIEW` state
legacy never had.

**Conclusion:** the lifecycle is not settled. It is one unenforced enum, one
inherited contradiction, and one invented state with no defined meaning.

---

## 2. Decision

> **Corrected by owner ruling, 2026-09-12.** Edu7 does not publish or approve
> textbooks; a textbook enters as an externally approved source. The lifecycle
> below governs whether Edu7's own ingested copy is complete enough to serve to
> learners — read "published" throughout as **"active / available for use
> inside Edu7"**. Full ruling, audit and rename scope:
> [`PUBLISHING-LIFECYCLE-GATE.md` §10](PUBLISHING-LIFECYCLE-GATE.md#10-revision-2--edu7-does-not-publish-textbooks-owner-ruling-2026-09-12).

**Content Management Core is next, as directed — and its first deliverable is
the lifecycle, not CRUD.**

The condition's spirit is *don't build authoring on unsettled ground*. The
ground is unsettled in exactly one dimension, and that dimension is small,
well-evidenced, and blocking. Deferring Content to build Assignments instead
would leave the same unresolved question waiting, while Assignments would
proceed against content that cannot be authored.

### 2.1 One axis, not two

**Decision: a single `PublicationStatus`. No `isPublished` boolean, ever.**

Legacy's two axes produced the reconciliation guesswork above. A boolean that
can disagree with a status is a second source of truth — the same defect the
Assignment gate rejected in `masteryAchieved`, and the Class investigation
rejected in a roster table. `publishedAt` is retained as a *timestamp*, never
as the answer to "is this published".

### 2.2 The state machine

```
DRAFT ──submit──> IN_REVIEW ──approve──> PUBLISHED ──archive──> ARCHIVED
  ^                   │                      │                     │
  └──── reject ───────┘                      └──── revise ─────────┘
                                                    (new revision)
```

| Transition | Rule |
|---|---|
| `DRAFT → IN_REVIEW` | author submits; structure must validate (§2.4) |
| `IN_REVIEW → DRAFT` | reviewer rejects, with a reason |
| `IN_REVIEW → PUBLISHED` | reviewer approves; sets `publishedAt`; **locks structure** |
| `PUBLISHED → ARCHIVED` | withdrawn from use |
| `ARCHIVED → PUBLISHED` | restore |
| anything → `DRAFT` | ❌ never — a published textbook is not editable in place |

`IN_REVIEW` is **kept** and given the meaning legacy lacked: it is what makes
`CONTENT_AUTHOR` and reviewer distinct roles rather than one role with two
names. Without it, review is a social convention.

### 2.3 Published content is immutable — port this verbatim

Legacy's single best content decision, and it is enforced at **15 call sites**
(`curriculum.repository.content.ts:723, 767, 797, 882, 925, 961, 1069, 1117…`):

```ts
// textbook-lifecycle.service.ts
if (isImmutableTextbookStatus(status, isPublished))
  throw new Error(`الكتاب ${key} منشور/مؤرشف ومقفل من التعديل البنيوي.`);
```

Every content write — at unit, lesson **or** concept level — walks up to its
textbook and refuses if that textbook is locked. This is exactly right, for a
reason specific to this product:

> Mastery is computed from evidence tied to `conceptKey`. If a published
> concept can be edited or reordered underneath a learner, their mastery
> history silently changes meaning. Immutability of published content is a
> **prerequisite for mastery being interpretable**, not an editorial nicety.

Changing published content therefore requires a **new revision**, not an edit.
`Textbook.revision` already exists for this.

### 2.4 Structural validation belongs to the domain

Validated as a **pure function** in `content/domain/`, never in the UI:

1. **No prerequisite cycles** — `A → B → A` makes `decideNextActivity`
   non-terminating and is unrepresentable in a learning path.
2. **Prerequisites stay in scope** — a concept may not require a concept from a
   textbook it cannot see. (Legacy rule LD-2 in spirit: *"رفض مُسمّى قبل أي
   كتابة"* — a named refusal before any write.)
3. **Contiguous `orderIndex`** within a parent — gaps and duplicates are how
   ordering silently diverges from display.
4. **A publishable textbook is non-empty** — ≥1 unit, ≥1 lesson, ≥1 concept.
5. **`masteryThreshold` ∈ (0, 1]**, `strength`/`requiredMastery` ∈ [0, 1].

Validation runs on the `DRAFT → IN_REVIEW` transition, so a textbook cannot
reach review in a state that would break the learning engine.

### 2.5 Reads must respect publication

Once the lifecycle is enforced, learner-facing reads filter to `PUBLISHED`, the
way questions already do. This is a **behaviour change** and must land with the
lifecycle, not after: today a DRAFT textbook is served to learners.

Authoring reads (`CONTENT_AUTHOR`, reviewer) see every status. That is a
role-scoped read, and Identity already supplies scoped roles for it.

---

## 3. Scope — Core only

**Precondition (not optional):** the key-identity resolution in
`KEY-IDENTITY-AUDIT.md` §5. Reordering is a core authoring operation, and today
it would silently change persisted identities.

**In:**
hierarchy CRUD (textbook/unit/lesson/concept) · ordering & reordering ·
prerequisite edges + cycle detection · the state machine + immutability ·
structural validation · resource↔lesson/concept linking · role-scoped
authoring reads.

**Out, deliberately:**

| Deferred | Why |
|---|---|
| **Imports (Excel/PDF/Drive)** | Explicitly excluded by the instruction. ~14k legacy LOC; must follow a stable authoring model, not precede it |
| Question authoring | Item 14 — its own capability; `Question.status` already works |
| Flashcard authoring | Item 5; storage decision already recorded in gate F |
| Rich media pipeline | Not required to make the hierarchy manageable |
| Admin UI | Layering rule below |

### Layering — as directed

```
Content Domain              pure rules: validation, cycles, transitions
      ↓
Content Application         use cases over ports
      ↓
Content API                 /api/v1/content, one envelope, handle()
      ↓
Admin UI                    renders and calls — decides nothing
```

The UI must not decide publication rules, prerequisite validity, or link
legality. Architecture rules D1–D3 already forbid the domain from importing
Prisma/express; rule I1 keeps Prisma out of the interface layer. `check-architecture.ts`
enforces both, so the layering is machine-checked rather than aspirational.

---

## 4. Sequence adopted

Per the revised ordering:

1. **Content Management Core** ← next
2. Assignments *(design already gated; unblocked)*
3. Remediation + Recommendations
4. Teacher / Parent
5. Question Bank + Flashcards + Concept authoring
6. XP
7. Dashboards
8. Imports

---

## 5. Acceptance criteria

1. One status axis. No `isPublished` boolean anywhere.
2. Illegal transitions refused by name, with a reason; `PUBLISHED → DRAFT`
   impossible.
3. Published/archived content structurally immutable, enforced for unit, lesson
   **and** concept writes by walking to the textbook — the legacy 15-site rule,
   applied through one guard.
4. Cycle detection is a tested pure function; a cycle cannot be persisted.
5. `orderIndex` contiguous per parent after any reorder.
6. Learner-facing reads return only `PUBLISHED` content; authoring reads are
   role-scoped.
7. Every rule has a unit test; the state machine is tested exhaustively over
   all transition pairs.
8. No Prisma in `content/domain/`; no business rule in the UI.
9. No import functionality of any kind.
10. **No key-derivation function accepts an `orderIndex`** — machine-enforced by
    a new architecture rule. Reordering content must leave every canonical key
    byte-identical, proven by a test.
