# Remediation & Recommendations — design gate

**Status:** decided · 2026-09-12
**Precedes:** any schema change or implementation for ledger items 2 and 10.

---

## 0. Legacy evidence

There is no remediation model in the old project. What exists is a **flag on an
assignment**:

| Evidence | What it shows |
|---|---|
| `learning-plans.controller.ts:683` `getRemedialTracker` | "Remediation tracking" is `studentAssignment.findMany({ where: { originType: 'REMEDIAL' } })` |
| `RemedialTrackerPanel.tsx:33-44` | The tracker row *is* an assignment row: `status`, `masteryAchieved`, `minimumMastery`, `dueDate`, `isOverdue` |
| `learning-plans.controller.ts:524` | `masteryAchieved` is **PATCHable** — a teacher could type in the number that decides whether remediation worked |
| `QuickInterventionModal.tsx` | The teacher's intervention creates… another assignment |

So the legacy answer to "did the remediation work?" was: *whatever someone last
wrote into `masteryAchieved` on the assignment row.*

Three consequences, all of which the new design must refuse:

1. **A gap only existed if a human created an assignment for it.** The engine
   diagnosed `REMEDIATE` on every call and the diagnosis evaporated.
2. **Closure was an assertion, not a measurement.**
3. **`originType: 'REMEDIAL'` made Assignment the owner of remediation** — the
   exact god-object growth the Assignment gate rules out.

---

## 1. What a remediation episode *is*

> **A remediation episode is a persisted claim that a specific learner has a
> specific gap, opened by evidence and closed by evidence.**

It is not a task, not an assignment, and not a recommendation. It is the
*tracked existence of a problem*. Tasks may be issued in response to it (that is
Instruction's job); resources may be suggested for it (that is the
recommendation's job); but the episode itself outlives any particular task.

The distinction that makes this worth a table:

| Question | Answered by |
|---|---|
| "What should this learner do right now?" | `decideNextActivity` — stateless, recomputed every call |
| "Does this learner have an unresolved gap, since when, and did it close?" | **Remediation episode** — persisted |

`decideNextActivity` already answers the first question well. It cannot answer
the second, because it keeps nothing. That is the entire gap this capability
fills.

---

## 2. Ownership

| Concern | Owner | Not |
|---|---|---|
| Detecting a gap | **Learning** (from Mastery + Misconception evidence) | not Mastery — it never decides |
| Persisting the episode + its lifecycle | **Learning** | not Instruction |
| Suggesting *what to do* about it | **Learning** (recommendation) | not Content |
| Issuing a task for it | **Instruction** (`InstructionalPlan`) | not Learning |
| Grading anything | **Assessment** | never here |
| Recomputing mastery | **Mastery** | never here |

**Remediation must not become a second assignment system.** An episode has no
due date, no assignee, no submission, and no completion endpoint. If a teacher
wants a learner to *do* something about a gap, they publish an instructional
plan — and the plan links to the episode, not the other way round.

---

## 3. Two triggers, one episode type

An episode opens for exactly two reasons, both of which are already produced by
existing, tested code:

| Trigger | Source | Meaning |
|---|---|---|
| `MISCONCEPTION` | `LearnerMisconception.isResolved = false` | A diagnosed wrong mental model. Poisons everything built on it |
| `MASTERY_GAP` | effective mastery below the concept threshold, with enough evidence to be believed | The learner has genuinely not got it |

Deliberately **not** triggers:

- *A single wrong answer.* Noise. BKT already smooths this.
- *Decay* (`REVIEW`). Forgetting is normal and self-correcting; opening an
  episode every time retrievability dips would open one for every learner every
  week and the list would be ignored.
- *A locked prerequisite* (`UNBLOCK`). The gap is on the prerequisite concept,
  and an episode is already open there. Opening a second on the blocked concept
  would double-count one problem.

### 3.1 Confidence gate

A `MASTERY_GAP` episode requires **at least 3 observations** on the concept.
Below that the estimate is mostly the BKT prior (`pL0 = 0.10`), so every
untouched concept would open an episode the moment a learner glanced at the
lesson. An unstarted concept is not a gap — it is unstarted. This mirrors the
`INSUFFICIENT_DATA` rule already used in item analysis.

---

## 4. The lifecycle

```
                  ┌────────────────────────────────────────┐
   evidence  →    │  OPEN  ──────────────────────────────► │ RESOLVED
                  │    │                                   │  (evidence)
                  │    └──► SUPERSEDED (content changed)   │
                  └────────────────────────────────────────┘
```

| State | Meaning | Entered by |
|---|---|---|
| `OPEN` | The gap exists and is unaddressed | Detection |
| `RESOLVED` | The gap closed | **Evidence only** — mastery recovered above threshold, or the misconception was marked resolved |
| `SUPERSEDED` | The question stopped being meaningful — the concept was archived or removed from the book | Content lifecycle |

**There is no `DISMISSED` and no manual close.** This is the direct correction of
the legacy `masteryAchieved` PATCH. A teacher who believes an episode is wrong is
either right — in which case the learner's next attempt will close it on
evidence — or wrong, in which case closing it hides a real gap. Neither case is
improved by a button.

`RESOLVED` is **not terminal for the learner**: if the same gap reappears later,
a *new* episode opens. Re-opening the old row would destroy the history of how
long the first gap took to close, which is the main thing a teacher wants to know.

### 4.1 Idempotent detection

Detection runs as a pure function of evidence, exactly like mastery recompute:

```
detectEpisodes(evidence, existingOpenEpisodes) → { toOpen, toResolve }
```

Running it twice must produce no second episode. The function is the guarantee;
the database constraint is the backstop, and it is not a plain `@@unique` — see
§6 for why, and for the partial index that was used instead.

---

## 5. Recommendations are *derived*, not stored

A recommendation is "here is a resource that would help with this episode".

**Decision: recommendations are computed at read time and never persisted.**

Reasoning: a stored recommendation is stale the moment the content changes or
the learner's mastery moves. Legacy's failure mode was different but related —
recommendations were recomputed and forgotten. The fix is not to persist the
*suggestion*; it is to persist the *problem* (§1) and recompute the suggestion
against current content each time.

What is persisted about a recommendation is only what has consequences:
`LearningDecisionLog` already records what was suggested and why. That table is
the audit trail; the suggestion itself is a projection.

### 5.1 Ranking

Resources for an episode are ranked by:

1. `REMEDIAL` kind first for `MISCONCEPTION` episodes — a misconception needs
   correction, not re-exposition.
2. `WORKED_EXAMPLE` before `READING` for `MASTERY_GAP` — a learner who has
   already read the lesson and still has the gap needs a different modality.
3. Shorter `estimatedMins` first, as a tie-break. A 5-minute resource that gets
   attempted beats a 40-minute one that does not.

Inactive resources are excluded, and this must reuse the published-content
filter — a remediation that points at a draft resource is a dead end.

---

## 6. Identity

Episode key:
`REM-<trigger initial><fp8 of learnerKey + conceptKey + trigger + misconceptionKey + openedAt>`.

The misconception is part of the fingerprint. Without it, two misconceptions
diagnosed on the same concept in the same millisecond derive the same key, and
the second row is silently dropped as a duplicate — the learner is then shown
one gap when they have two. Found while writing the live proof, not by tests:
the unit fake generated keys the same way, so it agreed with the bug.

Not `@@unique([learnerId, conceptId, trigger])` — that would forbid the
re-opening required by §4, since a resolved episode would block a genuine new
one. Uniqueness is enforced instead on **open** episodes only, via a partial
index:

```sql
CREATE UNIQUE INDEX remediation_one_open_per_gap
  ON remediation_episodes (
    "learnerId", "conceptId", trigger,
    COALESCE("misconceptionId", '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE status = 'OPEN';
```

The `COALESCE` is load-bearing. `misconceptionId` is null for every
`MASTERY_GAP` row, and in SQL null never equals null, so without it two open
gaps on the same concept would both be accepted and the index would enforce
nothing for the trigger that produces most of the rows.

The index is emitted by `scripts/generate-baseline.mjs`, not hand-written into
the migration: that script regenerates `migration.sql` wholesale from the Prisma
schema, and a partial index typed into the output by hand disappears the next
time anyone touches the schema.

This is the constraint that makes detection idempotent at the database level
rather than only in application logic — the lesson recorded from the obligation
work, where an application-level de-dupe was backstopped by a real constraint.

---

## 7. Acceptance criteria

1. Detection is idempotent: running it twice opens one episode.
2. An episode cannot be closed by any endpoint — only by evidence.
3. A `MASTERY_GAP` episode does not open below 3 observations.
4. Decay alone never opens an episode.
5. A resolved gap that reappears produces a **new** episode, and the first one's
   duration is still readable.
6. Recommendations exclude unpublished and inactive resources.
7. A `MISCONCEPTION` episode ranks `REMEDIAL` resources first.
8. The partial unique index rejects a second open episode for the same gap.
9. Remediation writes no mastery, no evidence, and no assignment.
10. A teacher can see open episodes for their school; a learner sees only their
    own; a guardian reads their child's (READ delegation, per the learner-access
    boundary).

---

## 8. Outcome

Implemented and verified at `398af10`. Every criterion in §7 is met, and each is
proved by something that would fail if it were not.

| # | Criterion | Proof |
|---|---|---|
| 1 | Detection is idempotent | `check-remediation.mjs` "a second refresh changes nothing"; unit test asserts on what was **requested** of the port, not only on the row count |
| 2 | No endpoint closes an episode | four legacy-shaped routes (`PATCH`, `/complete`, `/dismiss`, `DELETE`) all 404; rule **RW2**; a unit test greps the service's own prototype |
| 3 | No `MASTERY_GAP` below 3 observations | `remediation.test.ts`; `MIN_OBSERVATIONS_FOR_GAP` |
| 4 | Decay never opens an episode | gaps judged on **raw** mastery; the evidence reader carries both values and the domain reads the undecayed one |
| 5 | A relapse opens a new episode | live proof: two episodes on one concept, distinct keys, the first still `RESOLVED` with its duration intact |
| 6 | Recommendations exclude unpublished content | reused `PrismaResourceReader`, which already filters `isActive` + `publishedConcept` — no second filter to drift |
| 7 | `MISCONCEPTION` ranks `REMEDIAL` first | live proof, on a concept whose mastery is **fine**, so the trigger is shown doing independent work |
| 8 | The partial index rejects a duplicate open | proved directly against Postgres: second `OPEN` rejected, `OPEN` after `RESOLVED` accepted |
| 9 | Writes no mastery, evidence or assignment | rule **RW1** (single writer) + **M1** + **IW1**; all three fire on planted violations |
| 10 | Teacher / learner / guardian visibility | live proof through the canonical learner-access boundary; learner refused the tracker with `remediation.forbidden` |

### One decision changed during implementation

`POST /refresh` is gated as **READ**, not ACT. The first draft of the live proof
asserted that a teacher would be refused, on the reading that any `POST` is an
action. That was wrong, and the failing check was the useful part.

`refresh` records nothing about who did anything. It re-derives conclusions from
evidence the caller was already permitted to read, takes no payload that can
influence the outcome, and running it twice — or never — leaves identical state.
The ACT rule exists to keep the evidence stream honest about **who did the
work**, and no work is recorded here. Gating it as ACT would have meant a
teacher looking at a stale tracker with no way to say "look again", while
changing nothing about what the system believes.

The ACT boundary is unchanged and still proved, on an endpoint that does produce
evidence: a teacher calling `tutoring/ask` for a learner is refused.

### A second bug the live proof found, in the proof itself

The first version of `check-remediation.mjs` cleaned up by restoring the demo
learner's mastery to a **guessed** 0.9, and by leaving behind a mastery row for
a concept that previously had none. Both looked harmless. Neither was:
`check-assignments.mjs` reads the same demo learner and went from 46/46 to
42/46, concluding the homework was already complete and refusing to waive it.

The cleanup now snapshots the exact prior state and asserts, as a numbered
check, that it was restored. The rule this leaves behind: **a live-proof script
shares seed state with every other live-proof script, so restoring "something
reasonable" is a way of making your failure someone else's.**


---

## 9. Closing the two loops the first round left open

The first implementation round built the capability and proved it, but left two
edges of §4's lifecycle diagram unattached. Both are now wired at the
composition root, which is the only file permitted to know that two contexts
exist at once.

### 9.1 `OPEN` — detection follows evidence, without being asked

Episodes only appeared if somebody called `POST /refresh`. That is the legacy
failure restated: a remedial flag that is correct only when a human remembers
to set it. §1 says an episode is *opened by evidence*, so the trigger belongs
on the evidence path.

Detection is now chained onto `MasteryRecomputeTrigger` in the container — the
one place an answer already turns into mastery:

```
submit answer → append evidence → recompute mastery → detect remediation
```

Three properties make this safe rather than merely convenient:

* **Ordering.** Detection runs *after* the recompute, because it reads mastery.
  Before it, every decision is made on the previous answer's numbers.
* **Scope.** Only the concepts just touched. A full-profile sweep on every
  answer is quadratic in a learner's history, and nothing else can have changed.
* **Failure is absorbed.** A detection error is logged, never propagated. A
  learner losing their submitted answer because a downstream detector fell over
  would be a far worse bug than a gap noticed one attempt later — and since
  detection is a pure function of evidence holding no state, the next answer
  re-derives it.

Assessment still knows nothing about Learning. It calls a port it already had.

### 9.2 `SUPERSEDED` — archiving retires the claim

§4 assigned `SUPERSEDED` to "content lifecycle", but nothing called it:
`supersedeForConcepts` was dead code. A learner with an open gap on an archived
concept is in an unwinnable position — the gap cannot close on evidence,
because no evidence for retired content can ever be produced.

Content now announces retirement through a new outbound port,
`ConceptRetirementNotifier`, modelled on the existing `ContentAuditWriter`:
Content states that concepts stopped being teachable and does not know or care
who listens. The container subscribes remediation to it.

Two details are load-bearing:

* **The concept list is read *before* the status changes.** Afterwards the
  published-content filters exclude the whole book, so the query that names the
  retired concepts comes back empty and the announcement is silently a no-op. A
  unit test plants exactly this and fails when the read is moved.
* **`SUPERSEDED`, never `RESOLVED`.** The gap did not close; the question
  stopped being meaningful. Recording it as a resolution would inflate the "we
  fixed it" figure every time a textbook was reorganised.

### 9.3 Two bugs found by running the proof, not by reading it

**A seeded mastery number proves nothing.** The first version of the new section
wrote `mastery = 0.2` with SQL and then answered a question. The recompute
rebuilds mastery *from the evidence stream*, so it immediately overwrote the
seeded value and no gap appeared. Corrected to seed evidence rows, which is what
the system actually reads.

**A live-proof script must clean up what it causes, not only what it writes.**
The script deleted its tagged rows, but the answer it submits produces an
ordinary evidence row carrying no tag. Left behind, those accumulated: each run
made the learner look better until, on the fourth, mastery cleared the threshold
and the gap stopped opening. It passed in isolation and failed in the suite —
the worst failure mode there is. Cleanup now snapshots evidence ids up front and
deletes anything not present before, and the section was re-run three times
consecutively and then in full suite order to prove it.
