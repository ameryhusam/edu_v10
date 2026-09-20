# Legacy ↔ New Architecture Reconciliation

**Purpose.** Establish what educational capability the legacy system actually
delivered, decide for each item whether it is *preserved*, *corrected*,
*deferred*, or *rejected*, and identify capabilities the new architecture
requires that the legacy system never had.

**This is not a migration plan.** No legacy file is ported. Capabilities are
reconstructed from behaviour, against the new architecture as the source of
truth.

**Method.** Endpoint inventory, service inventory by LOC, schema model
diffing, and reading the pedagogical services directly. Numbers below are
measured, not estimated.

---

## 0. Scale of the legacy surface

| Measure | Legacy | New (today) |
|---|---|---|
| HTTP endpoints | **360** | 6 |
| Prisma models | 51 | 38 |
| Service files | ~115 across 14 areas | — |
| Engine (pure algorithms) | 2,222 LOC | ported + tested |
| Largest service area | `textbook/` 12,535 LOC, 23 files | — |
| Tests | ~30 `verify-*.ts` scripts | 71 unit tests |

The 360 → 6 gap is mostly **not** missing capability. A large share of legacy
endpoints are CRUD variants, admin utilities, and duplicated read paths. But it
is not zero either, and §4 states precisely what is genuinely absent.

---

## 1. Preserved and already reconstructed

Verified working in the new system, with tests.

| Capability | Legacy origin | New home | Change |
|---|---|---|---|
| Bayesian Knowledge Tracing | `engine/knowledge-tracing/bkt.ts` | `mastery/domain/bkt.ts` | **Corrected** — zero-weight evidence no longer advances mastery |
| Forgetting / spaced review | `engine/knowledge-tracing/mastery-decay.ts` | `mastery/domain/retention.ts` | **Corrected** — applied at read, never stored |
| IRT 3PL + Fisher information | `engine/psychometrics/irt.ts` | `assessment/domain/irt.ts` | Preserved; EAP over MLE |
| Adaptive item selection | `engine/psychometrics/cat.ts` | `assessment/domain/adaptive-selection.ts` | Preserved; exposure control kept |
| Answer evaluation, 9 types | `services/assessment/evaluation/` | `assessment/domain/evaluation.ts` | Preserved; versioned |
| Arabic normalisation | scattered | inside `evaluation.ts` | **Corrected** — one policy, steps recorded per answer |
| Evidence contract | `services/assessment/answer-evidence.ts` | `assessment/domain/evidence.ts` | **Elevated** to the sole context boundary |
| Prerequisite graph | 2 diverged copies (see §2) | `learning/domain/prerequisite-graph.ts` | **Corrected** — one implementation |
| Grounded AI + refusal | `ai/ai_gateway.interface.ts` | `tutoring/domain/grounding.ts` | Preserved; refusal now precedes the provider call |
| Deterministic AI fallback | `ai/providers/deterministic_fallback.provider.ts` | `infrastructure/ai/deterministic.provider.ts` | Preserved |
| Misconception diagnosis | `QuestionChoice.misconceptionId` | same, wired into feedback | Preserved |
| Deterministic keys | `utils/curriculum-code.generator.ts` | `shared/kernel/identifiers.ts` | Preserved; branded types |

---

## 2. Defects found in legacy behaviour

Recorded because they are the evidence for the boundaries in the new design.
Each is now structurally prevented, not merely fixed.

1. **Four mastery formulas.** `mastery-estimator.ts`,
   `mastery-observation-reducer.ts`, `mastery.service.ts`, and
   `adaptive-learning.service.ts` each computed mastery differently. Now: one
   estimator, one write path, enforced by architecture rule `M1`.

2. **Prerequisite services diverged into two copies.**
   `concept-prerequisite-{network,relink,rules}.service.ts` exist in *both*
   `services/curriculum/` and `services/textbook/` — and are **not identical**
   (163 vs 26, 194 vs 88, 96 vs 80 lines). Two different answers to
   "is this concept unlocked?" were reachable depending on the caller. This is
   the single strongest argument for one owner per decision.

3. **Mastery patched incrementally** from five call sites, so a retry inflated
   it and no value could be re-derived. Now recomputed from evidence.

4. **`StudentAnswerHistory.status` was a free-text string** carrying the
   canonical verdict (`correct|incorrect|partially_correct|invalid|…`) in a
   comment. Now a real enum.

5. **Answer keys mixed into the question model** (`QuestionAnswerKey.answerData`
   as JSON-or-plain-text, `answerType` as string). Now a separate table, a
   separate repository call, and never serialised to a learner.

6. **Decay needed a mutation job**, so stored mastery depended on whether the
   job had run.

7. **Both `/api` and `/api/v1` were live**, with drift between them.

None of these were bad ideas poorly typed — they were *ownership* failures. The
layer rules exist to make each one impossible.

---

## 3. Preserved in principle, not yet reconstructed

Real educational capability that must return. Priority reflects pedagogical
weight, not implementation cost.

### P1 — Required to make the platform usable

| Capability | Legacy behaviour worth keeping | Correction required |
|---|---|---|
| **Authentication & RBAC** | `auth.service.ts`, `rbac.service.ts`, roles + permissions | Endpoints don't exist yet; the middleware, `User/UserRole` tables and bcrypt seed do. Tokens are currently minted by hand. |
| **Content authoring** | Textbook → unit → lesson → concept CRUD | Rebuild as *Authoring* use cases, deliberately separate from delivery reads (Open edX split). No generic CRUD. |
| **Question authoring & linking** | `question.service.ts`, `question-linking.service.ts` | Keep concept-linking with weights; keep answer keys out of learner payloads. |
| **Attempt lifecycle** | `exam.service.ts`, attempt context | `StartAttempt`/`SubmitAttempt` use cases. `SubmitAnswer` exists and works; there is no way to *open* an attempt over HTTP yet. |

### P2 — Core pedagogy present in legacy, absent in new

| Capability | Legacy behaviour worth keeping | Correction required |
|---|---|---|
| **Completion policy (LD-4)** | `completion-policy.service.ts` — a genuinely good pure gate: ordered gates `NOT_ATTEMPTED → ASSESSMENT_REQUIRED → CONTENT_REQUIRED → PRACTICE_REQUIRED → MASTERY_BELOW_THRESHOLD`, each with a reason; mastery gates **only** when assessment is required | Port as `learning/domain/completion-policy.ts`. Already pure — the cleanest legacy file. Return `rule` + `rationale` like every other decision. Rationale strings must move out of the domain (they are Arabic UI copy). |
| **Assignments & learning plans** | `StudentAssignment`, `TeacherLearningPlan`, `AssignmentTracking`, `originType` (`PARENT`/`REMEDIAL`/`ADAPTIVE`) | Needs new tables. Keep signed `originType` — it is what makes a task's provenance auditable. |
| **Support loops (LD-6)** | `support-loop.service.ts` — parent and teacher recommendation → **approved** resource → task → progress → mastery, refusing with a named error at every missing link | Excellent design, wrong layer (raw Prisma + zod + Arabic errors in a service). Rebuild as a use case over ports. Preserve the refusal-by-name behaviour and the `reviewStatus=APPROVED` requirement. |
| **Remedial content** | `RemedialContent` keyed by concept, typed `TEXT/VIDEO/HINT/ANALOGY` | Fold into `LearningResource` (already has `REMEDIAL`) rather than a parallel table; keep misconception targeting. |
| **Guardian/parent access** | `ParentProfile`, `ParentStudentRelationship`, `parent.controller.ts` | `GuardianProfile`/`GuardianLink` exist in the new schema; no use cases yet. Relationship must be verified server-side on every read. |
| **Analytics** | `getStudentDashboardData`, `getClassAnalytics`, `calculateBloomMastery`, stability/velocity/confidence/forgetting-rate metrics | Rebuild as read-model use cases. Bloom-level mastery is worth keeping — `bloomsLevel` is already in the curriculum data. |
| **Gamification** | `xp.ts` (base `15 + difficulty·5`, +5 under 15s, streak ×≤2.0), `XPTransaction` with `idempotencyKey` | `XpLedgerEntry` table exists; the rule is not ported. The legacy idempotency key was correct — keep it. |

### P3 — Valuable, safely deferred

| Capability | Note |
|---|---|
| Excel/PDF/Drive import (`io/`, `materials/`, ~14k LOC incl. `textbook/`) | The largest legacy area by far and the least architecturally settled. Rebuild against ports, one adapter at a time, after authoring exists. |
| Content extraction / TOC / PDF slicing | Depends on import. |
| Flashcards | `Flashcard` is content-only — **no per-learner scheduling state, no SM-2**. Do not port as-is; the retention engine already models scheduling properly. Rebuild as a resource type driven by `retention.ts`. |
| Daily challenges, notifications, backup/archive | Engagement and ops; no pedagogical dependency. |

---

## 4. Genuine gaps — capability the new architecture requires

These are not legacy features. They are obligations created by the new design.

| # | Requirement | Why the new architecture demands it |
|---|---|---|
| G1 | ~~Attempt lifecycle use cases~~ | **CLOSED.** `StartAttempt` (resume-by-default) and `SubmitAttempt` (server-derived totals) implemented, routed, and tested. |
| G2 | **Auth endpoints** | `authenticate` consumes a JWT nothing issues. |
| G3 | **Integration tests against a real database** | 71 unit tests cover domain purity; the two bugs that survived longest (zero-weight evidence, non-idempotent recompute) were only caught by *running* the system. `tests/integration/` is empty. |
| G4 | ~~`LearningDecisionLog` written nowhere~~ | **CLOSED.** `DecisionLogWriter` port + Prisma adapter; `GetNextStep` records every decision best-effort (a failed audit write never blocks a learner). |
| G5 | **`AuditEntry` unused** | Legacy had `audit-log.service.ts`. Guardian access and grade changes need an audit trail. |
| G6 | **Mastery recompute is manual** | `MasteryRecomputeTrigger` runs inline. Fine now; needs an explicit queue seam before scale. |
| G7 | **No authoring/delivery separation in practice** | Asserted in the architecture doc, unproven until authoring exists. |
| G8 | **AI quota enforcement unverified** | 50/day/learner is implemented but has no test. |
| G9 | **Seed covers one lesson** | Cannot exercise cross-unit progression or class analytics. |

---

## 5. Rejected — deliberately not reconstructed

| Rejected | Reason |
|---|---|
| 360-endpoint CRUD surface | Endpoints should be use cases. Generic CRUD is how pedagogy leaked into clients and diverged. |
| `engine/` global facade + `engine-client/` | React imported learning algorithms directly. Domain logic stays server-side. |
| `verify-*.ts` scripts (~30) | Replaced by real tests and 11 enforced architecture rules. |
| Parallel `curriculum/` + `textbook/` areas | The diverged prerequisite services (§2.2) are the direct cost. |
| `Flashcard` as a separate scheduling concept | Superseded by `retention.ts`. |
| Integer autoincrement IDs | Collide across environments; replaced by UUID + canonical key. |
| String enums with meaning in comments | Real Postgres enums. |
| Legacy migration history | The original pain point. |
| Google Drive as a first-class dependency | Import path, not a platform primitive. |

---

## 6. Sequenced plan

Ordered so each step is verifiable and unblocks the next.

**Step 1 — Close the assessment loop. ✅ DONE.** `StartAttempt` /
`SubmitAttempt`, attempt routes, `LearningDecisionLog` writes (G1, G4).
*Verified over HTTP:* open → resume returns the same key → answer graded
CORRECT → submit returns `percentage 1.0` and the affected concept → second
submit rejected with `assessment.attempt_closed` → decision log row persisted.

**Step 2 — Identity.** Login/refresh/logout, `requireRole` on real routes,
guardian link verification, `AuditEntry` on sensitive reads (G2, G5, P1).
*Verifies:* no hand-minted tokens; a guardian sees only their own child.

**Step 3 — Integration tests.** Real Postgres, seeded, exercising
answer → evidence → mastery → next-step, plus AI quota (G3, G8).
*Verifies:* the class of bug that unit tests structurally cannot catch.

**Step 4 — Completion policy + assignments.** Port LD-4 as a pure domain
function; assignment tables with signed `originType`; support loops as use
cases (P2).
*Verifies:* the strongest legacy pedagogy, correctly layered.

**Step 5 — Authoring.** Textbook/unit/lesson/concept/question authoring use
cases, separate from delivery reads; richer seed (P1, G7, G9).

**Step 6 — Analytics & gamification.** Read models; XP ledger with
idempotency (P2).

**Step 7 — Import.** Excel first, against ports (P3).

---

## 7. Standing judgements

1. **Legacy pedagogy was better than legacy architecture.** The completion
   policy, support loops, evidence contract and misconception-tagged distractors
   are genuinely good. They were undermined by ownership failures, not by being
   wrong.

2. **Reconstruct behaviour, never structure.** Every item above re-enters
   through a domain function and a port. The rule that a capability is "already
   written in legacy" is not an argument for its shape.

3. **A capability is not preserved until it is tested.** §1 lists only items
   with tests. Everything else is a claim.
