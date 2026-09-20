# Assignment Ownership & Lifecycle — Design Gate

**Status: gate document. No schema change and no Assignment implementation may
land until this is accepted.**

Gate A–G placed Assignments at depth 7 of the dependency graph, needing both
Identity (16) and Completion (9). Identity is now built. This document decides
what an Assignment *is* before any table exists, because the failure mode here
is not a missing feature — it is a correct-looking model that quietly absorbs
grading, mastery and scheduling until it becomes the thing we rebuilt the
project to escape.

Everything below is evidence-led: the legacy models and call sites are cited by
path and line so the decisions can be checked rather than trusted.

---

## 0. What the legacy system actually did

Five models carried assignment semantics, in **two parallel and incompatible
mechanisms**:

| Model | Shape | Mechanism |
|---|---|---|
| `TeacherLearningPlan` | class-scoped authoring | plan |
| `StudentAssignment` (`schema.prisma:1056`) | per-learner row, **progress fused in** | plan → materialised rows |
| `HomeLearningTask` | parent-authored task | plan |
| `ExamAssignment` (`schema.prisma:821`) | exam → students\|grade\|concept | **separate** plan |
| `AssignmentTracking` (`schema.prisma:937`) | per-student status for an `ExamAssignment` | recipient row |

Two observations decide most of what follows.

**Observation 1 — the god-object is real, and measurable.**
`StudentAssignment` carries `masteryAchieved`, `attemptsCount`, `startedAt`,
`lastActivityAt`, `progressNotes` directly on the assignment row (a comment in
the schema records this as a deliberate merge: *"كتلة ب — دمج
StudentAssignmentProgress"*). So the assignment stored a **copy** of state
owned by Mastery and Assessment.

**Observation 2 — that copy was writable over HTTP.**
`learning-plans.controller.ts:524` passes a client-supplied
`req.body.masteryAchieved` into `markProgress`. A teacher could PATCH a mastery
number onto an assignment. This is precisely what architecture rule **M2**
forbids, and it is the strongest possible argument for the split below: the
legacy design did not merely permit the violation, it exposed it as an
endpoint.

**Observation 3 — exam and lesson assignment never converged.** An exam
assigned to a grade produced `ExamAssignment` + `AssignmentTracking`; a lesson
assigned to a class produced `TeacherLearningPlan` + `StudentAssignment`. Same
concept, two schemas, two lifecycles, two status vocabularies. Any new design
that leaves these separate has learned nothing.

---

## 1. Definition

> **An Assignment is an instructional commitment: a named authority requires a
> named learner to engage with a specified activity, within a window.**

It answers exactly four questions — **WHO · WHAT · WHEN · STATUS** — and it
answers them by *reference*. It stores no achievement of its own.

The load-bearing consequence:

```
An assignment records that something was ASKED.
It never records how well it was DONE.
```

"How well" is Assessment's (grading) and Mastery's (belief) answer, always read
through their own contexts. An assignment that stores a score is a cache, and a
cache with no invalidation rule is a second source of truth.

### Ownership table

| Concern | Owner | Assignment's relationship |
|---|---|---|
| Who must do it | **Instruction** | owns |
| What must be done | **Content** / **Assessment** | references by key |
| When it is due | **Instruction** | owns |
| Delivery status | **Instruction** | owns (derived, see §6) |
| Grading a response | **Assessment** | reads |
| Mastery belief | **Mastery** | reads |
| Whether it counts as complete | **Learning** (completion policy) | reads |
| What to do next | **Learning** | reads — never writes |
| Remediation content | **Learning** / **Content** | references |
| XP | **Engagement** | never touches |
| Question text / answer keys | **Content** | never touches |

**Five explicit non-ownerships**, per the review: Assignment does **not** own
grading, mastery, recommendation, question content, or XP.

---

## 2. The five cases

### Case 1 — Teacher assigns a normal lesson

**Decision: `Assignment → LearningActivity`, not `Assignment → Lesson`.**

A single polymorphic target, not one foreign key per assignable thing. The
target is `(activityType, activityKey)` where `activityType ∈ LESSON |
CONCEPT | EXAM | REVIEW_SET | REMEDIATION_PLAN`.

*Why not a direct `lessonId`:* legacy proved the alternative. `StudentAssignment`
took `lessonId`, so when exams needed assigning, a whole second mechanism was
built rather than a column added. Each new assignable type would repeat that.
A closed activity-type vocabulary absorbs new types without a new lifecycle.

The referenced activity is **validated on creation, resolved on read**. Legacy
already did the validation half correctly and it is worth keeping verbatim
(`learning-plans.service.ts:1868`, rule LD-2): a lesson must actually belong to
the textbook the plan is scoped to, *"رفض مُسمّى قبل أي كتابة"* — a named
refusal before any write.

### Case 2 — Teacher assigns an exam

**Decision: `Assignment → activityType: EXAM`, and grading stays entirely in
Assessment.**

This is the same Assignment with a different `activityType`. `ExamAssignment`
and `AssignmentTracking` both disappear.

The seam is already built and tested: an exam assignment creates no attempt.
The learner starts an attempt through the normal Assessment path, and the
attempt carries the assignment key as **provenance** (why this attempt exists),
never as an owner. Evidence flows Assessment → Mastery exactly as it does for
unassigned practice.

*Consequence worth stating:* an assigned exam and a self-started exam produce
**identical** evidence. If they did not, mastery would depend on who asked for
the work, which is pedagogically indefensible.

### Case 3 — Teacher assigns remediation

**Decision: remediation is a Learning decision; Assignment is only the delivery
mechanism.**

`decideNextActivity` already owns the REMEDIATE rule (`open_misconception_first`)
and gate F owns flashcard tiering. Those must not be duplicated.

Two distinct flows, deliberately kept apart:

```
ADAPTIVE remediation  →  Learning decides  →  surfaced in next-step
                                              (no assignment row)

TEACHER remediation   →  Learning proposes →  teacher confirms
                                           →  Assignment (originType REMEDIAL,
                                              activityType REMEDIATION_PLAN)
```

The adaptive loop **must not** silently write assignment rows. If every
adaptive suggestion materialised an obligation, a learner's list would fill
with system-generated homework nobody assigned, and `originType` would become
meaningless. An assignment exists when a *person* commits a learner to work.

`originType ∈ TEACHER | PARENT | REMEDIAL | ADAPTIVE | SELF` is retained from
gate D — legacy derived it historically (`teacherPlanId→TEACHER`,
`homeTaskId→PARENT`, else `SYSTEM`), which is exactly the sort of inference a
first-class column removes. Note `ADAPTIVE` remains in the vocabulary for the
case where a human *accepts* a system proposal; the system never writes it
unattended.

### Case 4 — Teacher assigns to an entire class

**Decision: 1 plan + N recipient rows. Two entities, as gate D specified.**

```
InstructionalPlan          one row   — the authored intent
      │
      └── LearnerObligation  N rows  — one per learner, the unit of status
```

This is the one place legacy got the shape right, and both mechanisms
independently converged on it (`materializeForStudents:1855` for lessons,
`ExamAssignment`+`AssignmentTracking` for exams). Two independent arrivals at
the same shape is good evidence it is forced by the problem.

*Why not N standalone assignments:* editing the due date for a class would
become N writes with no record that they were ever one act, and "how is 7-B
doing on this?" would have no row to hang off.

*Why not 1 row with a recipient list:* status is per learner. A JSON array of
learner states inside one row cannot be queried, indexed, or updated
concurrently without lost updates.

Three properties carried over from `materializeForStudents`:

1. **Idempotent materialisation** — re-publishing must not duplicate
   obligations. Legacy keyed on (student, lesson, plan) and skipped existing
   rows; the new unique constraint is `[planId, learnerId]`.
2. **Named refusal before any write** — scope conflicts are rejected up front
   (LD-2), not partially applied.
3. **A plan may target a class; an obligation always names one learner.**

Late enrolment is a real case legacy did not handle: a learner joining after
publication has no obligation. Resolution — materialisation is a **function of
plan + current roster**, re-runnable, and idempotent by the constraint above.

### Case 5 — Student completes an assignment

**Decision: Assignment never computes completion. It reads the canonical
owners' verdict.**

This is the case that most needs the ledger, because legacy got it wrong in the
most expensive way (`masteryAchieved` on the row, PATCHable over HTTP,
`controller:524`).

```
Learner works
     ↓
Assessment  → grades the response, emits Evidence   (sole A→M contract)
     ↓
Mastery     → recomputes belief from ordered evidence  (M1: one write path)
     ↓
Learning    → completion policy evaluates the gates
     ↓
Instruction → obligation status reflects that verdict
```

Completion is already built and tested: gates `NOT_ATTEMPTED →
ASSESSMENT_REQUIRED → CONTENT_REQUIRED → PRACTICE_REQUIRED →
MASTERY_BELOW_THRESHOLD`, and mastery only gates when `requiresAssessment`.
Assignment reuses it unchanged.

**Status is derived, never asserted.** No endpoint accepts a mastery value, a
score, or a "mark complete" for a gated obligation. The mirror of legacy's
mistake would be a new `PATCH /obligations/:key {masteryAchieved}` — that
endpoint must never exist.

Three status transitions *are* genuinely owned by Instruction, because they are
facts about the commitment rather than about achievement:

| Transition | Trigger | Owner |
|---|---|---|
| `PENDING → IN_PROGRESS` | first attempt/view observed | derived |
| `→ COMPLETED` | completion policy returns ALLOW_NEXT | derived |
| `→ EXPIRED` | window closed, gates unmet | derived (time) |
| `→ WAIVED` | a human excuses the learner | **asserted, audited** |

`WAIVED` is the sole human-asserted transition, and it must be audited with
actor and reason — legacy had `overrideReason`/`overriddenById`, which was the
right instinct, now backed by `AuditEntry.requestId`.

---

## 3. What this rules out

Stated as explicit non-goals so a future reviewer can catch drift:

- ❌ `masteryAchieved`, `score`, or `attemptsCount` columns on any assignment
  entity. **Rule M2 already enforces this** and will fail the build.
- ❌ A second completion formula. Learning's policy is the only one.
- ❌ Assignment appearing on the evidence path. Evidence must be identical
  whether or not work was assigned.
- ❌ Assignment writing XP. Engagement is a terminal sink (rule G1).
- ❌ Assignment resolving *what to do next*. That is `decideNextActivity`.
- ❌ Any endpoint that accepts an achievement value for an obligation.

---

## 4. Boundary with Identity — frozen

Per the review, Identity is **frozen** at: `User`, authentication, `Session`,
`Actor`, roles, role scope, guardian relationship and the access boundary.

Assignments therefore introduce **no roster entity at all** — see §5.3. Identity
answers *who is this actor and what may they touch*; Instruction answers *which
learners does this scope resolve to*, by querying `Enrollment`. The resolver
`learner-access.ts` stays as it is — a per-request access check, not a policy
engine.

One consequence to respect: authoring a plan for a class requires a
`TEACHER` grant **scoped to that school** (the R2 fix), and the roster read
must be school-scoped too. A teacher at school A must not be able to name a
learner at school B as a recipient.

---

## 5. Open questions for the owner

These were genuine forks I did not think should be settled unilaterally.
**All three are now closed.**

1. ~~**Can a parent assign?**~~ — **CLOSED 2026-09-12 by the owner.** Yes, as a
   real capability, but **advisory only**. A parent-authored obligation may
   appear in the learner's task feed and supports parent–child accountability.
   It must **never**: gate lesson/unit/path progression · count toward academic
   completion · alter mastery · emit assessment evidence · change prerequisite
   eligibility · affect official academic progress. Only teacher/staff origin
   participates in academic obligation and completion policies.

   > "This distinction must be enforced in the domain/application layer, not
   > merely hidden in the UI."

   **Implemented** in `instruction/domain/assignment-authority.ts`, which holds
   the allow-list of origins with academic authority (`TEACHER`, `REMEDIAL`,
   `ADAPTIVE`) and is consulted by plan progress, Due Work and the parent
   surface. `SELF` was classified advisory by the same argument that keeps a
   learner from marking their own mastery. The list is an *allow*-list so a
   future origin is advisory until deliberately argued into authority.

   The parent write surface (`application/parent-task.service.ts`) has no
   `origin` parameter at all — `PARENT` is hard-coded — so no client payload
   can request academic authority. A parent's reach is one *verified* child,
   checked per request against the guardian-link table; a `PARENT` role claim
   in a token grants nothing on its own.

2. ~~**Do obligations affect `next-step` ordering?**~~ — **CLOSED 2026-09-12 by
   the owner.** No.

   > "Keep next-step purely pedagogical. […] Do not implement it as a hidden
   > branch inside next-step."

   Outstanding and overdue work is a **separate capability**: *Assignment
   Follow-up and Overdue Work Management*
   (`application/due-work.service.ts`, `GET /instruction/due-work`). It derives
   overdue status from `dueAt` + status, returns academic and advisory work in
   **separate arrays** so no client can total a mixed list, and alerts staff
   when overdue academic work passes a threshold — without inventing a mastery
   conclusion from lateness.

   Made structural by architecture rule **NS1**: nothing under
   `contexts/learning/` may reference an obligation, assignment, plan or due
   date. The rule was mutation-tested by planting a `hasOverdueObligation`
   helper in `next-activity.ts`; it fired, and was then restored. One
   `if (hasOverdueWork)` inside `decideNextActivity` is exactly the cheap
   mistake this rule exists to make impossible.
3. ~~**Class model shape**~~ — **CLOSED 2026-09-11.** A class is a *query* over
   `Enrollment`, not a persistent entity: it fails all three entity tests
   (independent lifecycle, ownership, business responsibility), and legacy
   recorded the same conclusion as decision **DR-5**, returning `class_name:
   null` at six call sites rather than fabricate one. Plan scope is
   `{schoolId, gradeId, termId}`; recipients are resolved at publish time.
   Full argument and the named triggers that would overturn it:
   [`CLASS-ROSTER-INVESTIGATION.md`](CLASS-ROSTER-INVESTIGATION.md).

---

## 6. Acceptance criteria for the implementation that follows

The gate is satisfied only if all of these hold:

1. `InstructionalPlan` and `LearnerObligation` exist; the five legacy models do
   not reappear in any form.
2. `@@unique([planId, learnerId])`; re-publication is idempotent.
3. No achievement column on either entity — verified by rule M2.
4. Assigned and unassigned work produce byte-identical evidence.
5. Obligation status is derived from the existing completion policy; `WAIVED`
   is the only asserted transition, and it is audited.
6. Exam and lesson assignment use **one** mechanism.
7. A named refusal precedes any write when the activity is out of the plan's
   scope (LD-2 preserved).
8. Cross-school assignment is impossible, enforced through scoped roles.
9. **Advisory origin cannot acquire academic authority.** A `PARENT` or `SELF`
   plan never gates progression, never enters an academic completion figure,
   and never reaches mastery or evidence. Enforced by
   `domain/assignment-authority.ts`; the parent write surface exposes no
   `origin` parameter through which `TEACHER` could be requested.
10. **Learning's recommendation never reads an obligation.** Enforced by
    architecture rule **NS1** over `contexts/learning/`, mutation-tested.
    Outstanding work is served by Due Work as a separate capability.
