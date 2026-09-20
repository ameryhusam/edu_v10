# Class / Roster Ownership — Investigation

**Question:** should Edu7 have a persistent `Class` entity?

**Method (as directed):** start from the null hypothesis that it should **not**,
and overturn it only if the product requirements and legacy behaviour
demonstrate an *independent lifecycle*, *ownership*, and *business
responsibility*. Absence of evidence for those three is a verdict, not a gap.

**Verdict: null hypothesis holds. Class is a QUERY, not an entity.**

No schema change is proposed. This closes open question 3 from the Assignment
gate.

---

## 1. The three tests a persistent entity must pass

An entity earns a table when it has:

1. **Independent lifecycle** — it is created, changes, and is destroyed on its
   own schedule, not as a side effect of something else.
2. **Ownership** — it owns attributes that live nowhere else.
3. **Business responsibility** — decisions are made *about it*, not merely
   *using it*.

A thing that fails all three is a **derived set**, and giving it a table
creates a second source of truth that must then be kept in sync with the first.

---

## 2. Evidence

### 2.1 The legacy schema has no Class model — in ~40k lines

```
grep "^model " prisma/schema.prisma | grep -iE "class|section|roster|cohort"
→ (nothing)
```

The only enrolment-shaped model is `AcademicEnrollment` (`schema.prisma:586`):

```prisma
model AcademicEnrollment {
  studentId, schoolId, academicYearId, gradeId, termId, isCurrent
  @@unique([studentId, academicYearId, gradeId, termId])
}
```

A "class" in the legacy system is the tuple **(school, grade, term)** plus
`isCurrent`. There is no name, no teacher, no roster row, no identity.

### 2.2 This was a deliberate, documented decision — not an oversight

The strongest evidence is that the legacy team **hit this exact question and
answered it**. Decision record **DR-5** is cited at six independent call sites:

| Site | Behaviour |
|---|---|
| `analytics.routes.ts:162` | `class_name: null` — *"no Class model exists (DR-5) — naming a class here would be fabricated"* |
| `analytics.routes.ts:289` | `class_name: null` — *"تسمية الشعبة كانت تلفيقاً"* (naming the section was fabrication) |
| `analytics.routes.ts:115` | no invented section names |
| `learning.routes.ts:1025` | no invented section name for a learner |
| `SupervisorDashboardView.tsx:109` | explicit empty state instead of fabricated data |
| `SupervisorDashboardView.tsx:267` | *"requires a canonical Section/Class model linked to teachers and students — not yet defined in the architecture (DR-5)"* |

This is decisive in a way a mere absence would not be. The legacy system ran
**with a supervisor dashboard that wanted class comparison**, and rather than
introduce a Class model it returned `null` and rendered an honest empty state.
The pressure existed; the entity still was not justified.

### 2.3 Class-wide assignment already works without a Class

The Assignment gate's Case 4 asked how a teacher assigns to a whole class.
Legacy answers at `learning-plans.service.ts:1825`:

```ts
private async resolvePlanTargets(opts: { explicit?, schoolId?, gradeId?, termId? }) {
  ...
  const enrollments = await prisma.academicEnrollment.findMany({
    where: { isCurrent: true, schoolId, gradeId, termId },
    select: { studentId: true },
  });
  return unique(enrollments.map(e => e.studentId));
}
```

The recipient set is **computed from enrolment at publish time**. Note also
that an *explicit* student list is still filtered through enrolment (rule F-5:
*"الأهداف من تسجيلات مدرسة الخطة فقط"* — targets come only from the plan
school's enrolments). So enrolment is not merely one way to find recipients; it
is the **authority** on who may receive one.

`TeacherLearningPlan` (`schema.prisma:984`) has `schoolId`, `gradeId`, `termId`
— and **no `classId`**. The most class-shaped object in the system does not
reference a class.

### 2.4 Teacher authority is enrolment-scoped, not roster-scoped

`learning-plans.controller.ts:98` checks a teacher may act on students via:

```ts
where: { studentId: { in: ... }, schoolId: teacherProfile.schoolId, isCurrent: true }
```

"My students" means *enrolled in my school*, not *on my roster*. No membership
table is consulted because none exists.

### 2.5 Applying the three tests

| Test | Result | Evidence |
|---|---|---|
| Independent lifecycle | ❌ **Fails** | A class is created by enrolling students and dissolved by the term ending. Both are `AcademicEnrollment` events. Nothing happens to a class that is not an enrolment change. |
| Ownership | ❌ **Fails** | Every attribute a class would hold already lives elsewhere: grade → `Grade`, term → `Term`, school → `School`, membership → `AcademicEnrollment`, teacher → `TeacherProfile` + role scope. The only genuinely new attribute is a *display name* ("7-B"). |
| Business responsibility | ❌ **Fails** | No decision in the entire pedagogical core is made about a class. Mastery, evidence, completion, next-step, remediation are all per learner. Aggregation *reads across* learners; it does not decide about a group. |

**Three failures out of three.** A display name is not enough to justify an
entity, a lifecycle, and a synchronisation obligation.

---

## 3. What we would lose by adding one now

Not neutral — actively harmful at this stage:

1. **Two sources of truth for membership.** `AcademicEnrollment` says a learner
   is in grade 7 at school A; `ClassMember` says they are in 7-B. When these
   disagree — and they will, at transfer time — which decides who receives an
   assignment? Legacy avoided this by having exactly one answer.
2. **A synchronisation obligation forever.** Every enrolment change would need
   a matching roster update, or rosters silently rot.
3. **It leaks into the pedagogical core.** The moment a class is queryable,
   something will filter mastery by class, and then "class average" becomes a
   number the product must defend. Note legacy refused to compute
   `completion_rate` and `average_accuracy` without real evidence
   (`analytics.routes.ts:168`) — the same discipline applies to group metrics.
4. **It is the god-object pattern again, one level up.** The Assignment gate
   rejected an entity that absorbed grading and mastery. A Class that absorbed
   roster + teacher + schedule + analytics scope would be the same mistake in a
   different place.

---

## 4. The decision

**A class is a named query over `Enrollment`.**

```
Class ≡ { learners : Enrollment(schoolId, gradeId, termId, isCurrent = true) }
```

Assignment targeting therefore stays as gate D and the Assignment gate specify:

```
InstructionalPlan
  scope: { schoolId, gradeId, termId }   ← the "class", expressed as a filter
      │
      └── resolveRecipients(scope, roster-at-publish-time)
                │
                └── LearnerObligation × N     ← one per learner, unique [planId, learnerId]
```

This preserves the two properties already decided:

- **1 plan + N obligations** (Case 4) — unchanged, because the plan's *scope* is
  a filter and the obligation's *subject* is a learner.
- **Idempotent re-materialisation** — `@@unique([planId, learnerId])` makes
  re-running safe, which is what makes late enrolment tractable: re-resolve the
  scope and insert only what is missing.

### Where it lives

`Enrollment` stays where it is (it already exists in the new schema). The
*resolution* — turning a scope into a learner set — belongs to **Instruction**,
as an application-layer concern:

```
Instruction.resolveRecipients(scope) → learnerKey[]
```

Not Identity (frozen: who you are, what you may touch), and not Learning
(pedagogical decisions per learner).

---

## 5. What would overturn this

Stated concretely so it can be recognised, rather than left as a vague
"revisit later". Introduce `Class` when **any one** of these becomes a real
requirement:

1. **Two teachers split one grade.** Grade 7 maths at one school taught by two
   teachers with different pacing. `(school, grade, term)` can no longer
   distinguish their cohorts — the query becomes ambiguous, and that ambiguity
   is exactly what an entity resolves.
2. **A learner belongs to a group that is not their grade.** Electives, remedial
   sets, cross-grade streams. Membership stops being derivable from enrolment.
3. **Someone makes a decision about the group itself** — a class-level goal, a
   class-level schedule, a class-level intervention that is not the sum of its
   learners.
4. **A class outlives a term** and carries history forward as an identity.

Trigger 1 is the most likely, and it is a *product* question: does a school
using Edu7 have one maths teacher per grade, or several? Until that is answered
"several", the tuple is sufficient.

**Recorded as a named trigger**, in the same spirit as R1's `Permission`
trigger: the first requirement that genuinely needs a group identity must
introduce `Class` deliberately — not smuggle it in as a nullable `className`
column on a plan.

---

## 6. Consequence for the Assignment gate

Open question 3 is **closed**: a class is derived from `Enrollment`, not a
persistent roster. Questions 1 (can a parent gate?) and 2 (do obligations
affect `next-step` ordering?) remain open and still need the owner's decision.
