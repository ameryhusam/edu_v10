# Assessment, Evidence, Mastery, Learning, Instruction and Engagement

**Status:** ADOPTED.

## 1. Assessment

Assessment owns:

- question delivery to attempts;
- attempt lifecycle;
- answer evaluation;
- evaluator version;
- assessment evidence emission;
- exam definition and adaptive selection.

A submitted answer is graded once by the canonical evaluator.

## 2. Evidence boundary

The hard boundary is:

```text
Assessment
    ↓
Evidence
    ↓
Mastery
    ↓
Learning
```

Assessment emits evidence.

Mastery consumes evidence.

Learning consumes mastery and content structure.

No context may bypass this chain to patch another context's state.

## 3. Evidence requirements

Evidence is historical and append-only.

Ordering uses the learner's observed/answered time, not row ID or insertion order.

Evidence must preserve enough provenance to reproduce why it exists.

Zero-information observations must follow the domain contract and must not accidentally move mastery.

## 4. Mastery

Mastery is deterministic, replayable, idempotent computation over the complete ordered evidence stream.

Stored `ConceptMastery` is the latest observed state. Retention/decay may be calculated at read time from the last observation rather than silently rewriting historical mastery.

Mastery has exactly one canonical write path.

Never:

- compute mastery in React;
- patch mastery from an assignment;
- derive mastery directly from Attempt rows;
- create a second mastery formula in Learning or Assessment.

## 5. Misconceptions

Content owns the misconception catalogue.

Mastery owns learner misconception state.

Assessment supplies evidence that may support diagnosis.

A remediation episode is a persisted claim that a learner has a gap, not a task.

## 6. Learning

Learning owns:

- prerequisite eligibility;
- next activity;
- progression;
- completion policy;
- progress derivation;
- learning path;
- remediation decisions;
- flashcard ordering.

Next-step is purely pedagogical.

Assignment due dates and overdue work must not silently affect next-step selection.

## 7. Completion

Completion is derived from canonical gates. It must not become a manually writable achievement flag.

Instruction may display/update an obligation status based on the completion decision.

The only human-asserted exception is an explicitly audited waiver.

## 8. Instruction

Instruction owns the commitment:

```text
InstructionalPlan → LearnerObligation
```

An obligation answers who, what, when, and delivery status.

It does not own:

- score;
- mastery;
- attempts count;
- next-step;
- XP;
- answer keys.

Class/group scope resolves to learner obligations; do not invent a persistent class entity without a new domain reason.

Parent/self-authored work may be advisory and must not silently acquire academic authority.

## 9. Engagement

Engagement owns XP/streak/badge/challenge state.

XP is an append-only ledger with an idempotency key.

Engagement must never write mastery, evidence, completion, prerequisites, or next-step decisions.

## 10. Decision provenance

Important decisions should expose:

- rule;
- rationale;
- supporting evidence;
- timestamp;
- relevant entity keys.

This is necessary for teacher-facing explanations and safe debugging.

## 11. Historical safety

If a learner answered question Q under evaluator version V1, changing Q or the evaluator must not rewrite that historical result.

Content improvement is allowed; historical meaning must remain auditable.

## 12. Parent access

A parent/guardian may read only through a verified relationship and server-side access boundary.

A role claim alone is not proof of access to a specific learner.

Delegation is not impersonation: a guardian may read a learner's data but does not create learner evidence.
