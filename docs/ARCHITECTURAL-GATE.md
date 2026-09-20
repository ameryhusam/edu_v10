# Architectural Gate — before Assignments

Seven deliverables (A–G) that must be complete before any Assignment code is
written. Each decision below is derived from evidence in the legacy repository,
cited by file and line where it matters.

**Status vocabulary.** A capability is `BUILT` only when its meaningful business
behaviour exists *and is tested*. A Prisma model is not a capability.

| Status | Meaning |
|---|---|
| `BUILT` | Behaviour exists, tested, verified running |
| `PARTIAL` | Some behaviour exists; the rest is named and missing |
| `MISSING` | No behaviour. A table may exist — irrelevant |
| `CORRECTED` | Rebuilt with a defect from legacy deliberately fixed |
| `DEFERRED` | Valid, consciously scheduled later |
| `REJECTED` | Will not be rebuilt in its legacy form |
| `DUPLICATE` | Legacy had ≥2 competing implementations; one owner now |

---

# A. Final capability matrix

Legend for dashboards: **S** student · **T** teacher · **P** parent.
`Foundational` = other capabilities cannot be correct without it.

---

### 1. Content / Textbook — `PARTIAL`

| | |
|---|---|
| **Legacy evidence** | `services/textbook/` 12,535 LOC / 23 files; `services/curriculum/` 4,327 LOC / 18 files — two parallel areas for one responsibility |
| **New evidence** | Schema hierarchy Textbook→Unit→Lesson→Concept; `PrismaContentReader`; seeded and read over HTTP |
| **Domain owner** | **Content** (new) |
| **Use-case owner** | `content/application/` — authoring use cases, not yet written |
| **Persistence** | `Textbook`, `Unit`, `Lesson`, `Concept`, `TextbookPage`, `ContentChunk`, `LearningResource` — all exist |
| **API** | `POST/PATCH /content/*` authoring; delivery reads already exist |
| **Depends on** | — |
| **Dashboards** | S ✓ (names, pages) · T ✓ · P ✓ |
| **Foundational** | **Yes.** Nothing can reference a concept that cannot be authored |

### 2. Concept relationships / Prerequisites — `BUILT` (traversal) · `PARTIAL` (authoring)

| | |
|---|---|
| **Legacy evidence** | `concept-prerequisite-{network,relink,rules}.service.ts` in **both** `curriculum/` and `textbook/`, **diverged** (163v26, 194v88, 96v80 lines) → `DUPLICATE` |
| **New evidence** | `learning/domain/prerequisite-graph.ts`; hard/soft gates, deepest-root-gap; tested |
| **Domain owner** | **Content** owns the edges; **Learning** owns eligibility |
| **Use-case owner** | `learning/application/get-next-step` (consumer); Content authoring pending |
| **Persistence** | `ConceptPrerequisite (strength, requiredMastery)` |
| **API** | Edge editing + cycle detection — missing |
| **Depends on** | 1 |
| **Dashboards** | S ✓ (locked) · T ✓ (gap analysis) · P ✗ |
| **Foundational** | **Yes** |

### 3. Question bank — `PARTIAL`

| | |
|---|---|
| **Legacy evidence** | `question.service.ts`, `question-linking.service.ts`, `question-import.service.ts`; `QuestionAnswerKey.answerData` free-text JSON |
| **New evidence** | `QuestionRepository`, `AnswerKey` separate table + separate call, `QuestionConcept` weights |
| **Domain owner** | **Content** |
| **Use-case owner** | `content/application/` — authoring pending |
| **Persistence** | `Question`, `QuestionChoice`, `AnswerKey`, `QuestionConcept` |
| **API** | Authoring, search, review/publish — missing |
| **Depends on** | 1, 2 |
| **Dashboards** | S ✗ (consumed via attempts) · T ✓ · P ✗ |
| **Foundational** | **Yes** for Assessment |

### 4. Assessment / Attempts — `BUILT`

| | |
|---|---|
| **Legacy evidence** | `exam.service.ts`, `evaluation/canonical-evaluator.ts`, `attempt-context.ts` |
| **New evidence** | `evaluation.ts` (9 types, versioned, Arabic normalisation), Start/Submit attempt, verified over HTTP |
| **Domain owner** | **Assessment** |
| **Use-case owner** | `assessment/application/{start,submit}-attempt`, `submit-answer` |
| **Persistence** | `Attempt`, `AttemptItem` |
| **API** | ✅ live |
| **Depends on** | 3 |
| **Dashboards** | S ✓ · T ✓ · P ✓ (results) |
| **Foundational** | **Yes** |

### 5. Exams — `PARTIAL`

| | |
|---|---|
| **Legacy evidence** | `Exam`, `ExamQuestion`, `ExamAssignment (assignmentType: students\|grade\|concept)`, `AssignmentTracking` |
| **New evidence** | CAT engine tested; `Exam`/`ExamItem` tables exist, **nothing writes them** |
| **Domain owner** | **Assessment** (definition) + **Instruction** (assigning it) |
| **Use-case owner** | `assessment/application/` authoring; `instruction/application/` for assigning |
| **Persistence** | `Exam`, `ExamItem` exist; scheduling/window fields needed |
| **API** | Authoring, scheduling, results — missing |
| **Depends on** | 3, 4, 16 |
| **Dashboards** | S ✓ · T ✓ · P ✓ |
| **Foundational** | No |

### 6. Evidence → Mastery — `BUILT` / `CORRECTED`

| | |
|---|---|
| **Legacy evidence** | `answer-evidence.ts` (good); **four** competing formulas — `mastery-estimator.ts`, `mastery-observation-reducer.ts`, `mastery.service.ts`, `adaptive-learning.service.ts` → `DUPLICATE` |
| **New evidence** | `bkt.ts`, `retention.ts`, `recompute-mastery`; rule **M1** = one write path; two real bugs fixed (zero-weight; non-idempotent stability) |
| **Domain owner** | **Mastery** |
| **Use-case owner** | `mastery/application/{recompute-mastery,get-mastery-profile}` |
| **Persistence** | `MasteryEvidence` (append-only), `ConceptMastery` (derived) |
| **API** | `GET /learning/mastery` ✅ |
| **Depends on** | 4 |
| **Dashboards** | S ✓ · T ✓ · P ✓ |
| **Foundational** | **Yes** |

### 7. Misconceptions — `PARTIAL`

| | |
|---|---|
| **Legacy evidence** | `QuestionChoice.misconceptionId`, `StudentMisconception`, `RemedialContent` |
| **New evidence** | Distractor-driven diagnosis verified over HTTP (`…C01-MIS01`); `LearnerMisconception` table exists |
| **Domain owner** | **Mastery** owns open/resolved state; **Content** owns the catalogue |
| **Use-case owner** | `mastery/application/` — open/resolve lifecycle missing |
| **Persistence** | `Misconception`, `LearnerMisconception` |
| **API** | Resolve/list — missing |
| **Depends on** | 3, 4, 6 |
| **Dashboards** | S ✓ · T ✓ · P ✓ (plain language) |
| **Foundational** | No, but it is the highest-value teaching signal |

### 8. Learning decision — `BUILT`

| | |
|---|---|
| **Legacy evidence** | `adaptive-learning.service.ts:279 decideNextAction` — mastery thresholds inline |
| **New evidence** | `next-activity.ts`, 7 ordered rules, every decision returns rule + rationale + evidence; `LearningDecisionLog` written |
| **Domain owner** | **Learning** |
| **Use-case owner** | `learning/application/get-next-step` |
| **Persistence** | `LearningDecisionLog` |
| **API** | `GET /learning/next-step` ✅ |
| **Depends on** | 2, 6, 7 |
| **Dashboards** | S ✓ (the core) · T ✓ · P ✓ |
| **Foundational** | **Yes** |

### 9. Completion — `PARTIAL` / `CORRECTED`

| | |
|---|---|
| **Legacy evidence** | `completion-policy.service.ts` — best pedagogy in the old system |
| **New evidence** | `completion-policy.ts` pure, 9 tests. Arabic UI copy removed from domain; stable gate codes |
| **Domain owner** | **Learning** |
| **Use-case owner** | Pending — needs an obligation to evaluate (→ 11) |
| **Persistence** | None of its own. **Deliberate**: completion is derived, never a stored flag |
| **API** | Surfaces inside assignment/lesson responses |
| **Depends on** | 6, 11 |
| **Dashboards** | S ✓ · T ✓ · P ✓ |
| **Foundational** | **Yes** for Assignments |

### 10. Progress — `PARTIAL`

| | |
|---|---|
| **Legacy evidence** | Derived ad hoc in React (`SubjectMasteryGrid`) with local thresholds |
| **New evidence** | `progress.ts` hierarchical rollup, 9 tests; locked concepts kept in denominator |
| **Domain owner** | **Learning** |
| **Use-case owner** | `learning/application/get-progress` — pending |
| **Persistence** | None. Derived from mastery + hierarchy |
| **API** | `GET /learning/progress` — pending |
| **Depends on** | 1, 6 |
| **Dashboards** | S ✓ · T ✓ · P ✓ |
| **Foundational** | No |

### 11. Assignments — `MISSING` (see **D**)

| | |
|---|---|
| **Legacy evidence** | `learning-plans.service.ts` 1,911 LOC; `StudentAssignment`, `TeacherLearningPlan`, `HomeLearningTask`, `ExamAssignment`, `AssignmentTracking`; `materializeForStudents:1855` |
| **New evidence** | **None** |
| **Domain owner** | **Instruction** (obligation) — *not* Learning |
| **Use-case owner** | `instruction/application/` |
| **Persistence** | `InstructionalPlan`, `LearnerObligation` (new). **No `masteryAchieved` column** — see D.4 |
| **API** | Plan CRUD + publish; learner obligation list |
| **Depends on** | 1, 9, 16 |
| **Dashboards** | S ✓ · T ✓ · P ✓ |
| **Foundational** | **Yes** for Teacher/Parent dashboards |

### 12. Learning paths — `PARTIAL`

| | |
|---|---|
| **Legacy evidence** | `resolveStudentLearningPath:420`, `StudentLearningPathView.tsx` (777 lines) |
| **New evidence** | Single next step only; no traversable sequence |
| **Domain owner** | **Learning** |
| **Use-case owner** | `learning/application/get-learning-path` — pending |
| **Persistence** | None. Derived from hierarchy + prerequisites + mastery |
| **API** | `GET /learning/path` — pending |
| **Depends on** | 1, 2, 6, 10 |
| **Dashboards** | S ✓ · T ✓ · P ✗ |
| **Foundational** | No |

### 13. Remediation — `PARTIAL`

| | |
|---|---|
| **Legacy evidence** | `RemedialContent`, `RemedialTrackerPanel.tsx`, support loops |
| **New evidence** | `REMEDIATE` decision + `LearningResource.REMEDIAL`; no cycle tracking |
| **Domain owner** | **Learning** (decision) + **Instruction** (assigned remediation) |
| **Use-case owner** | `learning/application/` |
| **Persistence** | Reuses `LearningResource`; **no parallel `RemedialContent` table** |
| **API** | Open/close a remediation cycle — missing |
| **Depends on** | 7, 8, 11 |
| **Dashboards** | S ✓ · T ✓ · P ✓ |
| **Foundational** | No |

### 14. Recommendations — `PARTIAL`

| | |
|---|---|
| **Legacy evidence** | `Recommendation` model; `generateRecommendations:102`, `persistGeneratedRecommendations:228` |
| **New evidence** | Live decisions only; nothing persists as a standing recommendation |
| **Domain owner** | **Learning** (system-generated) + **Instruction** (human-authored) |
| **Use-case owner** | Split by author — see D.5 |
| **Persistence** | Human recommendations only. **System recommendations are not stored** — they are recomputed; storing them creates stale advice |
| **API** | `POST /instruction/recommendations` |
| **Depends on** | 8, 16 |
| **Dashboards** | S ✓ · T ✓ · P ✓ |
| **Foundational** | No |

### 15. Teacher interventions & parent support — `MISSING`

| | |
|---|---|
| **Legacy evidence** | `support-loop.service.ts` (LD-6) — recommendation → APPROVED resource → task → progress → mastery, with named refusal at each missing link. `QuickInterventionModal.tsx` |
| **New evidence** | `GuardianProfile`/`GuardianLink` tables only |
| **Domain owner** | **Instruction** |
| **Use-case owner** | `instruction/application/run-support-loop` |
| **Persistence** | `InstructionalPlan`, `LearnerObligation`, `GuardianLink` |
| **API** | `POST /instruction/support-loop` |
| **Depends on** | 11, 16 |
| **Dashboards** | S ✗ · T ✓ · P ✓ |
| **Foundational** | No |

### 16. Identity & RBAC — `PARTIAL`

| | |
|---|---|
| **Legacy evidence** | `auth.service.ts`, `rbac.service.ts`, `permission-check.ts`, `Role`/`Permission`/`RolePermission` |
| **New evidence** | `authenticate` middleware, `requireAuth/requireRole`, `User`/`UserRole`, bcrypt seed. **No endpoint issues a token** |
| **Domain owner** | **Identity** |
| **Use-case owner** | `identity/application/{login,refresh,verify-guardian}` |
| **Persistence** | `User`, `UserRole`, `GuardianLink`, `AuditEntry` |
| **API** | `POST /auth/login`, `/refresh`, `/logout` |
| **Depends on** | — |
| **Dashboards** | S ✓ · T ✓ · P ✓ (all gated) |
| **Foundational** | **Yes** — hard gate for 11, 15 |

### 17. Flashcards — `PARTIAL` (see **F**)

| | |
|---|---|
| **Legacy evidence** | `Flashcard` model — content only, **no per-learner state, no SM-2**; ordering inside `AdaptiveFlashcardDeck.tsx:79–100` |
| **New evidence** | `flashcard-ordering.ts` pure + 6 tests |
| **Domain owner** | **Content** stores · **Learning** orders |
| **Use-case owner** | `learning/application/get-flashcard-deck` — pending |
| **Persistence** | `Flashcard` table (new). **No scheduling columns** |
| **API** | `GET /learning/flashcards?scope=` |
| **Depends on** | 1, 6, 7 |
| **Dashboards** | S ✓ · T ✗ · P ✗ |
| **Foundational** | No |

### 18. XP / Engagement — `MISSING` (see **E**)

| | |
|---|---|
| **Legacy evidence** | `engine/gamification/xp.ts` (37 lines), `XPTransaction.idempotencyKey`, `DailyChallenge`, `TrophyBox.tsx` |
| **New evidence** | `XpLedgerEntry` table, **never written** |
| **Domain owner** | **Engagement** — retained, with a one-way boundary (E) |
| **Use-case owner** | `engagement/application/award-xp` |
| **Persistence** | `XpLedgerEntry` (append-only, idempotency key) |
| **API** | `GET /engagement/profile` |
| **Depends on** | 4 |
| **Dashboards** | S ✓ · T ✗ · P ✓ (motivation) |
| **Foundational** | **No — and must never become so** |

### Imports — `DEFERRED`

~14k LOC legacy (Excel/PDF/Drive). Depends on 1, 3. Rebuild against Content
authoring ports, one adapter at a time. Not required by any dashboard.

### Summary

| Status | Count |
|---|---|
| `BUILT` | 3 (Assessment, Mastery, Learning decision) |
| `PARTIAL` | 10 |
| `MISSING` | 4 (Assignments, Interventions, XP, + Exams authoring) |
| `DEFERRED` | 1 (Imports) |
| `DUPLICATE` resolved | 2 (prerequisites ×2 copies, mastery ×4 formulas) |

---

# B. Capability dependency graph

The proposed chain was close but wrong in two places, both provable from legacy
code.

```
                        ┌──────────────┐
                        │ 16 IDENTITY  │  (independent root)
                        └──────┬───────┘
                               │ gates 11, 15
        ┌──────────────┐       │
        │  1 CONTENT   │───────┼──────────┐
        └──────┬───────┘       │          │
               │               │          │
        ┌──────▼───────┐       │   ┌──────▼──────┐
        │ 2 PREREQS    │       │   │ 3 QUESTIONS │
        └──────┬───────┘       │   └──────┬──────┘
               │               │          │
               │               │   ┌──────▼──────┐
               │               │   │4 ASSESSMENT │
               │               │   │  (attempts) │
               │               │   └──────┬──────┘
               │               │          │ EVIDENCE (sole contract)
               │               │   ┌──────▼──────┐
               │               │   │  6 MASTERY  │◄── 7 MISCONCEPTIONS
               │               │   └──────┬──────┘
               └───────────────┼──────────┤
                               │   ┌──────▼──────────┐
                               │   │ 8 LEARNING      │
                               │   │   DECISION      │
                               │   └──┬────┬────┬────┘
                               │      │    │    │
                    ┌──────────┘  ┌───▼─┐ ┌▼────▼──┐ ┌──────────┐
                    │             │ 10  │ │ 12 13  │ │ 17 CARDS │
                    │             │PROG │ │PATH REM│ │ ordering │
                    │             └──┬──┘ └────────┘ └──────────┘
                    │                │
              ┌─────▼────────────────▼─────┐
              │      9 COMPLETION          │
              └─────────────┬──────────────┘
                            │
              ┌─────────────▼──────────────┐
              │   11 ASSIGNMENTS           │  ← needs 16 AND 9
              │   (Instruction)            │
              └──┬──────────────────────┬──┘
                 │                      │
        ┌────────▼────────┐    ┌────────▼────────┐
        │ 15 INTERVENTIONS│    │  5 EXAMS        │
        │    14 RECOMMEND │    │   (assigned)    │
        └────────┬────────┘    └────────┬────────┘
                 └───────────┬──────────┘
                             │
                 ┌───────────▼───────────┐
                 │    DASHBOARDS (S/T/P) │
                 └───────────────────────┘

  18 ENGAGEMENT ── reads 4 ──▶ (terminal sink; NO outgoing edge)
```

**Two corrections to the proposed order.**

1. **Identity is a root, not a mid-stage.** Assignments and interventions are
   *acts by one person upon another*. Without verified roles and guardian links
   they cannot be authorised, so Identity must precede 11 and 15 — not follow.

2. **Completion precedes Assignments.** Legacy proves it:
   `learning-plans.service.ts:1541 markProgress` calls
   `completionPolicyService.assertCompletionAllowed` *before* accepting
   `COMPLETED`. The gate is not a reporting nicety layered on top; it is the
   rule that decides whether an obligation may close. Building assignments
   first would mean building status transitions with no gate — exactly the
   legacy sequence that let clients claim completion.

**Critical-path answer:** Assignments sit at **depth 7**, requiring Identity (16)
and Completion (9). Completion is now built. **Identity is the only remaining
blocker** — the earlier instinct was right, but the *reason* matters: not
"auth is generally important", but "an obligation is an authorised act between
two identified people".

---

# C. Domain ownership map

Exactly one canonical owner per capability. Seven contexts.

| Context | Owns | Never |
|---|---|---|
| **Identity** | users, roles, permissions, guardian links, audit | pedagogy |
| **Content** | textbook hierarchy, concepts, prerequisite *edges*, questions, answer keys, misconception catalogue, resources, flashcard *content*, publication | learner state |
| **Assessment** | attempts, grading, **evidence production**, exam definition, CAT | write mastery |
| **Mastery** | belief (BKT), forgetting, misconception open/resolved | grade |
| **Learning** | next activity, eligibility, completion, progress, path, remediation decision, **flashcard ordering** | write content, mastery, or obligations |
| **Instruction** | plans, learner obligations, human recommendations, support loops, exam assignment | grade, compute mastery, decide pedagogy |
| **Engagement** | XP, streaks, badges, challenges | **influence anything above** |

**Shared-concept resolutions** (each split has exactly one owner per side):

| Concept | Content owns | Other owns |
|---|---|---|
| Prerequisites | the edge (authoring) | Learning: eligibility |
| Misconceptions | the catalogue | Mastery: learner state |
| Flashcards | the card | Learning: order |
| Exams | items/blueprint (Assessment) | Instruction: who sits it, when |
| Recommendations | — | Learning: system · Instruction: human |

---

# D. Assignment domain decision

## D.1 What an Assignment actually is

Asked of the legacy data, not of intuition. The old system had **five** models
in this space: `TeacherLearningPlan`, `StudentAssignment`, `HomeLearningTask`,
`ExamAssignment`, `AssignmentTracking`.

`materializeForStudents` (`learning-plans.service.ts:1855`) is the giveaway: a
teacher plan **materialises into one row per student**, idempotently. That is
not one concept with a foreign key. It is two, with a fan-out:

> **A plan is an intent. An obligation is one learner's copy of it.**

Against the options given:

| Option | Verdict |
|---|---|
| Instructional activity definition | **Partly** — that is the *plan* |
| Assessment container | **No.** Legacy conflated them via `ExamAssignment`; an exam is content that may be *referenced* by a plan |
| Teacher-to-student assignment | **Partly** — that is the *obligation* |
| Learning-plan commitment | **Partly** — the same obligation, self-directed |
| Combination | **Yes — and it must be split** |

## D.2 The split

**`InstructionalPlan`** — an intent authored by a person, targeting a cohort.
Owns: author, scope (lesson/unit/exam), window, `requiresAssessment`,
`minimumMastery`, mandatory flag, publication status.
Lifecycle: `DRAFT → PUBLISHED → ARCHIVED`.

**`LearnerObligation`** — one learner's copy. Owns: learner, plan (nullable —
self-directed obligations have no plan), `originType`, due date, status.
Lifecycle: `PENDING → IN_PROGRESS → COMPLETED | EXPIRED | WAIVED`.

This absorbs all five legacy models without loss:

| Legacy | Becomes |
|---|---|
| `TeacherLearningPlan` | `InstructionalPlan` (author = educator) |
| `HomeLearningTask` | `InstructionalPlan` (author = guardian) |
| `ExamAssignment` | `InstructionalPlan` (scope = exam) |
| `StudentAssignment` | `LearnerObligation` |
| `AssignmentTracking` | `LearnerObligation` status — the duplicate disappears |

`originType` (`TEACHER \| PARENT \| REMEDIAL \| ADAPTIVE \| SELF`) is preserved:
it is what makes a task's provenance auditable, and legacy signed it
deliberately (`assertTaskOrigin`).

## D.3 Where it belongs

**Instruction**, not Learning. Learning answers *"what is pedagogically best for
this learner?"* — derived, no human author. An obligation answers *"what has
someone required of this learner, by when?"* — authored, authorised, dated.

Putting obligations in Learning would let a due date influence a pedagogical
decision, which is precisely the confusion that made
`adaptive-learning.service.ts` unreadable.

## D.4 What Assignment must NOT own

The stated risk is real and legacy fell into it. `StudentAssignment` carries
`masteryAchieved Float @default(0)`, written by `markProgress:1541`.

**That is a fifth mastery write path** — beyond the four already documented. It
is why the old system could show one mastery on a dashboard and another on an
assignment card for the same concept.

| Responsibility | Owner | Assignment's role |
|---|---|---|
| Grading | Assessment | none |
| Mastery | Mastery | **reads only** |
| Learning decisions | Learning | none |
| Content | Content | references by key |
| Progress | Learning | reads |
| Completion | Learning | **calls the gate; does not implement it** |

Enforced by extending architecture rule **M1**: no mastery column on any
Instruction table. `LearnerObligation` stores *status*, never *achievement*.

## D.5 The flow

Derived, not assumed — and it differs from the proposed diagram in one respect:

```
Identity ──authorises──▶ Instruction
                            │ publishes
                            ▼
                     InstructionalPlan
                            │ materialises (idempotent, one per learner)
                            ▼
                     LearnerObligation ─────────────┐
                            │ references            │ asks
                            ▼                       ▼
                      Content (lesson/exam)   Learning.completion
                            │                       ▲
                            ▼                       │ reads
                        Attempt                 Mastery
                            ▼                       ▲
                       Evaluation ──▶ Evidence ─────┘
```

**The correction:** the proposed chain ran Assignment → … → Mastery → Learning
as one line. In reality the obligation **does not sit in the evidence path at
all**. A learner may attempt a lesson with no obligation, and evidence flows
identically. The obligation is an *observer*: it asks Learning whether its
completion gate is satisfied, and Learning answers from mastery.

This is why Assignment cannot own grading — it is not on that path.

---

# E. Engagement decision — **RETAINED, with a hard boundary**

Tested against all six required proofs.

| # | Proof | Verdict |
|---|---|---|
| 1 | Independent business responsibility | **Yes.** Motivation, not knowledge. Deleting it entirely must not change one mastery value |
| 2 | Decisions not natural elsewhere | **Yes.** "Is this streak still alive?", "was this XP already awarded?" belong to no pedagogical context |
| 3 | Coherent state model | **Yes.** Append-only ledger + derived totals. Same recompute-from-events discipline as Mastery |
| 4 | Clear inputs/outputs | **Yes.** In: graded attempt events. Out: totals for display only |
| 5 | Not duplicating another context | **Yes.** Nothing else awards points |
| 6 | Not a dumping ground | **Enforced** — see below |

**Evidence it is genuinely separable:** I grepped the legacy knowledge-tracing,
psychometrics and assessment code for `xp|points|badge|streak` as whole words.
Every hit is `points` meaning *item marks*, never XP. The canonical evaluator
states it explicitly: *"ولا يلمس Mastery/XP/XPTransaction"*. Even in a codebase
with four mastery formulas, **XP never contaminated pedagogy**. That is a strong
signal the boundary is natural, not imposed.

### The boundary, made explicit

**Engagement is a terminal sink. It has no outgoing edges.**

XP, streaks, badges and points must never be inputs to:
mastery · grading · assessment · prerequisite eligibility · adaptive decisions.

Mechanically enforced by a new architecture rule **G1**:

> No file under `contexts/{mastery,assessment,learning,content}/` may import
> from `contexts/engagement/`.

Anti-dumping-ground rule: Engagement may only contain capabilities whose removal
leaves every pedagogical output byte-identical. Anything failing that test
belongs elsewhere.

The one legitimate exception would be an *explicit educational rule* — e.g. "a
7-day streak unlocks a bonus lesson". That requires a documented decision and
an ADR; it is not permitted to arrive by import.

---

# F. Flashcard policy decision — **CALIBRATED, one canonical policy**

Full disclosure of the inherited rule, then a decision on each part.

### Inputs
| Input | Source | Owner |
|---|---|---|
| `conceptKey` | card content | Content |
| `effectiveMastery` | decay-adjusted, read time | Mastery |
| `hasActiveMisconception` | open misconception | Mastery |
| `reviewPriority` | author weight | Content |
| `difficulty` | author estimate | Content |
| `cardKey` | identity | Content |

### Thresholds and weights (legacy `AdaptiveFlashcardDeck.tsx:79–100`)
| Rule | Value | Justification | Decision |
|---|---|---|---|
| tier 0 | active misconception | A confidently *wrong* model is more damaging than a weak one — it actively produces errors | **Preserve** |
| tier 1 | mastery < 0.50 | Below even chance of recall | **Preserve** |
| tier 2 | mastery < 0.75 | Shaky but present | **Calibrate** — see below |
| tier 3 | otherwise | General review | **Preserve** |
| tie 1 | `reviewPriority` desc | Author intent | **Preserve** |
| tie 2 | `difficulty` desc | Harder first while attention is fresh | **Preserve** |
| tie 3 | `cardKey` asc | Determinism — a reload must not reshuffle | **Preserve** (new) |

### The calibration
Legacy used a raw `0.75` for tier 2 while mastery elsewhere is judged against a
**per-concept `masteryThreshold`** (default 0.85). A concept demanding 0.95
would be called "fine" at 0.80 by the deck and "not mastered" by every other
screen — a visible contradiction to a learner.

**Decision:** tier 2 becomes *"below this concept's own mastery threshold"*.
Tier 1 stays absolute (0.50 is a claim about recall probability, not curriculum
standard). Documented now; implemented when the deck endpoint is built.

### Relationship to retention/review scheduling — **the important part**

| Question | Owner |
|---|---|
| *When* is this concept due for review? | **`retention.ts`** — `R(t) < 0.70` |
| *Which* cards, in what order, once studying? | **`flashcard-ordering.ts`** |

**There is exactly one scheduling engine, and flashcards are not it.** Ordering
consumes mastery signals; it never computes a due date, an interval, or a
stability value. No SM-2 in the deck. The `Flashcard` table gets **no
`nextReview`, `interval`, `easeFactor` or `repetitions` columns** — their
existence would invite a second scheduler, which is how the four competing
mastery formulas began.

**Frozen architecture:**
```
Content(card) + Mastery(signals) ──▶ Learning.orderFlashcards ──▶ Frontend(display)
                        ▲
              Mastery.retention decides WHEN to review at all
```

---

# G. Student Dashboard capability contract

No UI. The contract only — so the dashboard can never invent meaning.

**Binding rule:** the dashboard computes **nothing**. Not mastery, completion,
XP, recommendations, prerequisites, remediation, or assessment results. It
renders canonical outputs and their rationales.

| # | Question | Domain owner | Canonical state | Use case | API field | Ready |
|---|---|---|---|---|---|---|
| 1 | What should I do now? | Learning | decision | `GetNextStep` | `nextStep.activity` | ✅ |
| 2 | Why? | Learning | rule + rationale | `GetNextStep` | `nextStep.rule/.rationale` | ✅ |
| 3 | What do I know? | Mastery | `ConceptMastery` (decay at read) | `GetMasteryProfile` | `mastery[]` | ✅ |
| 4 | Where am I stuck? | Mastery | weak + open misconceptions | `GetMasteryProfile` | `struggling[]` | 🟡 |
| 5 | What should I review? | Mastery → Learning | `R(t) < 0.7` | `GetReviewQueue` | `reviewDue[]` | 🟡 |
| 6 | What must I complete? | Instruction + Learning | obligations + gate | `ListObligations` | `obligations[]` | 🔴 |
| 7 | How far along am I? | Learning | rollup | `GetProgress` | `progress` | 🟡 |
| 8 | My cards | Learning | ordered deck | `GetFlashcardDeck` | `deck[]` | 🟡 |
| 9 | Points / streak | Engagement | XP ledger | `GetEngagementProfile` | `engagement` | 🔴 |

### Contract shape

```jsonc
GET /api/v1/learning/dashboard
{
  "nextStep":    { "activity", "conceptKey", "rule", "rationale", "resources" },
  "mastery":     [{ "conceptKey", "value", "effective", "band", "threshold" }],
  "struggling":  [{ "conceptKey", "reason", "misconceptionKey" }],
  "reviewDue":   [{ "conceptKey", "retrievability", "daysOverdue" }],
  "obligations": [{ "key", "title", "dueDate", "status", "gate", "originType" }],
  "progress":    { "overall", "units": [], "lessons": [] },
  "engagement":  { "xpTotal", "streakDays", "badges": [] }
}
```

**Why one endpoint, not nine.** Nine calls would force the client to merge and
prioritise — and prioritisation is a pedagogical decision. Composition happens
server-side; the client renders in the order given.

`gate` is a **stable code** (`MASTERY_BELOW_THRESHOLD`), never a sentence. The
interface layer translates; Arabic and English clients stay consistent because
neither is authoritative.

### Teacher / Parent — capabilities only, no UI

**Teacher:** class mastery distribution · misconception clusters (which
misconception, how many learners) · at-risk learners · prerequisite gap
analysis · plan authoring + publication · intervention loop · item analytics
(p-value, discrimination — `reliability.ts` not yet ported).

**Parent:** own children only, verified server-side per request (never from a
client-supplied id) · plain-language progress · obligations and due dates ·
support loop · **no raw psychometrics** — θ and BKT posteriors are not
parent-facing, they invite misreading.

All three dashboards are rebuilt from these contracts. Legacy component trees,
layouts, routes, state management and visual design are **not** references.

---

# Gate outcome

Deliverables A–G complete. Implementation order that follows from the graph:

1. **Identity (16)** — the sole remaining blocker for Assignments; required so
   an obligation is an *authorised* act.
2. **Assignments (11)** — `InstructionalPlan` + `LearnerObligation` in a new
   **Instruction** context, no mastery column, calling the completion gate.
3. Interventions & support loops (15), then Exams assignment (5).

Assignments may begin once Identity exists. Not before — not because auth is
generally important, but because an obligation without a verified author and a
verified recipient cannot be authorised, audited, or safely shown to a parent.

---

# Revision 1 — critical re-examination of A–G

Re-audited before starting Identity. Four amendments, each from evidence found
while preparing the implementation. Recording them because a gate that is never
revised is decoration.

## R1. Capability 16 was under-specified — **permission regression** (amends A, C)

The matrix listed Identity as `PARTIAL` with "no endpoint issues a token". True
but incomplete: legacy had **permission-level RBAC**, not role-level.

| Legacy | New |
|---|---|
| `Role`, `Permission (key, module)`, `RolePermission`, `UserRoleAssignment` | `RoleName` enum + `UserRole` |

Legacy could express *"this role may do this specific thing"*. The rebuild can
only express *"this user is a TEACHER"*. Every authorisation check therefore
hardcodes role lists at call sites — which is how permission logic scatters, the
same failure mode as four mastery formulas.

**Decision: accept the simplification now, but name it.** Roles are a coarse
approximation of permissions and are correct while the role set is small and
fixed (6 values). Introducing `Permission`/`RolePermission` today would add two
tables and a join to every request for zero present benefit.

**The condition for revisiting is explicit:** the moment any check needs
finer granularity than the six roles — e.g. "a TEACHER may edit questions for
their own subject but not publish a textbook" — permissions must be introduced
rather than encoded as another role. This is recorded so the decision is
deliberate, not accidental.

Matrix status for 16 corrected to: `PARTIAL` (role-level only; permission-level
`DEFERRED` with a named trigger).

### R1 re-evaluated, 2026-09-13 — **decision upheld, trigger sharpened**

Re-examined on request. The trigger has **not** fired, and measuring legacy
turned the usual argument on its head. Full analysis:
`docs/PERMISSION-TABLE-ANALYSIS.md`. Summary of the evidence:

| Measurement of the legacy system | Result |
|---|---|
| Permissions defined | 48 |
| Route files enforcing any permission | **1 of 20** |
| Route files with **no guard at all** | **14 of 20** |
| Permission keys actually referenced | 8 of 48 |
| `ADMIN`'s grant in the matrix | `['*']` |

So legacy's permission system was largely decorative, and its real exposure was
unguarded routes — not coarse roles. The new system has **zero** unguarded route
files, achieved without a permission table.

Every authorisation decision in the codebase today has one of three shapes:
**role** (`hasRole`, six sets over six roles, one pure function), **scope**
(`schoolId` — a permission string cannot express *whose* record), or
**relationship** (`learner-access.ts`: a verified `GuardianLink`, with ACT never
delegable). Permissions address only the first, which is the least troublesome.
Even content approval — "an author may not approve their own submission" — is a
relationship check, not a capability grant.

The trigger is now **executable rather than documented**:
`tests/unit/authorization-surface.test.ts` fails if any route file ships without
a guard, and if any permission-style check (`requirePermission`/`hasPermission`)
appears. A deferred decision recorded only in prose is a decision nobody
re-reads.

## R2. Scoped roles are stored but not enforced — **a real hole** (amends C, G)

`UserRole` is deliberately school-scoped:

```prisma
// Roles are scoped: a TEACHER at school A is not a TEACHER at school B.
schoolId String? @db.Uuid
@@unique([userId, role, schoolId])
```

But `Actor` carries `roles: readonly string[]` — the scope is **dropped** at the
HTTP boundary, and `requireRole` does a flat `includes`. A teacher at school A
currently satisfies `requireRole('TEACHER')` for school B's data.

Nothing exploits this yet because no multi-school endpoint exists. It becomes a
live authorisation bug the moment Instruction ships, since a plan targets a
cohort inside a school.

**Decision: fix in Identity, not later.** `Actor.roles` becomes
`{ role, schoolId }[]`, and role checks that concern school-owned data must
match scope. Shipping Identity with a known scope-dropping bug would mean every
capability built on top inherits it.

## R3. No refresh-token persistence — **logout cannot work** (amends A, and D indirectly)

The matrix said "`POST /auth/login`, `/refresh`, `/logout`" without noticing
there is no table to support them. Legacy `refreshSession:213` verifies a
self-contained JWT and re-issues — meaning **legacy logout was cosmetic**: a
stolen refresh token stayed valid until expiry because nothing could revoke it.

Legacy did get one thing right and it is worth keeping: `verifyToken:232`
refuses a token with `type === 'refresh'`, so a refresh token can never be
replayed as an access token.

**Decision: add a `Session` table.** A refresh token is a *server-side fact*,
not a claim. Storing a hash of it with `revokedAt` is what makes logout real,
enables "sign out everywhere", and lets a compromised session be killed. This is
one table and it is the difference between a security control and a UI gesture.

Consequence for the matrix: capability 16's persistence line gains `Session`.

## R4. Audit has no actor context (amends A, G)

`AuditEntry` records `actorId`, `action`, `entity`, `before/after`, `ip` — but
nothing links an entry to the request that caused it, and `requestId` already
exists on every response. Without it, "who changed this and in which operation"
is only half answerable.

**Decision: add `requestId` to `AuditEntry`** when Identity writes the first
audit entries. Cheap now, impossible to backfill later.

## What survived the re-examination unchanged

- **D (Assignment split).** Re-checked `materializeForStudents:1855`; the
  plan/obligation fan-out is unambiguous. No change.
- **E (Engagement retained).** The whole-word grep result stands. No change.
- **F (Flashcards calibrated).** No change.
- **B (dependency graph).** R2 and R3 *strengthen* the ordering argument:
  scoped roles and revocable sessions are prerequisites for authorising an
  obligation, so Identity-before-Assignments is more clearly right, not less.
- **G (dashboard contract).** Unchanged, except that `obligations[]` will carry
  scope once R2 lands.

---

# Revision 1 — outcome

All four amendments are implemented, and each is verified against a running
server rather than only against a unit test with a fake.

| # | Amendment | Landed as | Proof |
|---|---|---|---|
| R1 | Role-level RBAC accepted, trigger recorded — **re-evaluated 2026-09-13, upheld on measurement** (legacy enforced 8 of 48 permissions in 1 of 20 route files; 14 had no guard at all) | `contexts/identity/domain/roles.ts` · `docs/PERMISSION-TABLE-ANALYSIS.md` | `hasRole` tests; no `Permission` table added; trigger now **executable** in `tests/unit/authorization-surface.test.ts` |
| R2 | `Actor.roles` carries scope | `middleware/context.ts`, `roles.ts` | `GET /auth/me` returns `[{role:"STUDENT",schoolId:"932efbf4…"}]` |
| R3 | Sessions are revocable | `Session` table, rotation + reuse detection | logout → refresh returns `auth.session_expired` |
| R4 | Audit carries `requestId` | `AuditEntry.requestId` | every `auth.*` row has a non-null `requestId` |

**Reuse detection, observed end to end:** rotating once, then replaying the
spent token, returns `auth.session_compromised` — *and* the freshly issued
token is dead too, because the whole family is revoked when a token is seen
twice. That is the behaviour that makes a stolen refresh token detectable
rather than merely long-lived.

## Two decisions made while implementing

**A refresh token must never authenticate a request.** `authenticate` now
rejects any bearer token whose `typ` is `refresh`, and pins HS256 in
`jwt.verify`. Without the pin, the algorithm is attacker-controlled; without
the `typ` check, a 30-day credential silently becomes a 15-minute one's
replacement. Verified: presenting a refresh token as a bearer yields 401.

**Unknown roles are dropped at the boundary.** A JWT is user-supplied input, so
`authenticate` discards any role name this build does not recognise instead of
carrying an arbitrary string into the actor. A string that no check can match
is not harmful today, but it is exactly the kind of value that later gets
compared with `.includes()`.

## Deliverable G is now enforced

`interface/http/learner-access.ts` is the single resolver for "whose data is
this request about". A learner defaults to themselves and cannot name anyone
else; staff read within their role scope; a guardian must have an
`isVerified` link, checked **per request**. A forbidden learner and a
nonexistent one return the identical error, so the endpoint cannot be used to
enumerate learner keys.

Verified live: `?learnerKey=lrn_someone_else` returns 403
`learning.learner_not_accessible`.

## A bug the tests found

The seed stored a hardcoded bcrypt string commented as `bcrypt("demo1234")`.
It matched no password at all — it was a copy-pasted example hash. Nothing
caught it because until now no code had ever verified a password; the login
path's first real execution failed on the documented demo credentials.

The seed now hashes `DEMO_PASSWORD` at run time. **A credential that no test
exercises is a credential that does not work**, and the same applies to the
next fixture someone pastes in.

---

# Revision 2 — learner access unified; Assignments gated

## The remaining inconsistency is closed

`assessment.routes.ts` and `tutoring.routes.ts` read `actor.learnerKey`
directly while `learning.routes.ts` used the resolver. That divergence is
closed: all learner-scoped routes now go through `learner-access.ts`, and
**rule L1** fails the build if any route reads `actor.learnerKey` again. The
rule was confirmed by planting a violation and observing the failure.

## READ and ACT are different questions

Unifying the routes surfaced a distinction the first resolver did not make.
Learning routes *observe* a learner; Assessment and Tutoring *act as* one —
submitting answers, opening attempts, spending AI quota.

**Delegation is not impersonation.** A verified guardian may read their child's
mastery. Nobody — not a guardian, not a teacher, not an admin — may submit an
answer as a learner:

> Mastery is computed from ordered evidence, and it is only meaningful because
> every observation in it came from the learner. A parent submitting on a
> child's behalf corrupts the belief silently and unrecoverably, because
> recomputation is a pure function of that evidence.

So this is a *pedagogical integrity* rule that happens to also be a security
rule. `resolveLearnerAccess(..., mode)` takes `READ | ACT`; ACT is refused for
everyone but the learner. Assessment and Tutoring additionally accept no
`learnerKey` input at all, so acting-as cannot even be expressed — defence in
depth, verified live.

## Assignments are not yet unblocked

Identity being finished does not make the Assignment *design* ready. Before any
schema change, see **[`ASSIGNMENT-GATE.md`](ASSIGNMENT-GATE.md)**, which decides
ownership and lifecycle against the five delivery cases and records the legacy
evidence — including `StudentAssignment.masteryAchieved` being PATCHable over
HTTP (`learning-plans.controller.ts:524`), the exact violation rule M2 exists
to prevent.

**Identity is now frozen** at: User, authentication, Session, Actor, roles,
role scope, guardian access. Rosters and classes belong to Instruction.
