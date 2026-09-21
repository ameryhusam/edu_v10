# Edu7 — Adaptive Learning Platform

A clean-architecture rebuild: adaptive learning, assessment, and grounded AI
tutoring, built as layered bounded contexts over PostgreSQL.

> Rebuilt from first principles. The repository at the parent directory is kept
> only as a **behavioural reference** — its capabilities and curriculum data
> informed this design, its structure was not carried over. See
> [`Docs_v10/ARCHITECTURE.md`](Docs_v10/ARCHITECTURE.md) for the reasoning behind every
> boundary, and [`Docs_v10/MIGRATION-FROM-LEGACY.md`](Docs_v10/MIGRATION-FROM-LEGACY.md)
> for what was kept, changed, or dropped.

---

## Quick start

```bash
npm install

# 1. Start the embedded Postgres (PGlite — no installation required)
npm run db:dev

# 2. In a second terminal: create the schema and seed a demo slice
cp .env.example .env
npm run db:apply
npm run db:seed

# 3. Run the API
npm run dev            # http://localhost:3000
```

Verify:

```bash
curl localhost:3000/api/v1/health
```

Using a real PostgreSQL instead? Point `DATABASE_URL` at it, set
`DATABASE_POOL_MAX=10`, and run `npx prisma migrate deploy`. Same schema, same
migrations.

---

## What exists

| Capability | Where | State |
|---|---|---|
| Bayesian Knowledge Tracing | `contexts/mastery/domain/bkt.ts` | ✅ tested |
| Forgetting curve & spaced review | `contexts/mastery/domain/retention.ts` | ✅ tested |
| IRT 1PL/2PL/3PL + EAP ability | `contexts/assessment/domain/irt.ts` | ✅ tested |
| Adaptive item selection (CAT) | `contexts/assessment/domain/adaptive-selection.ts` | ✅ tested |
| Answer grading, 9 item types, Arabic-aware | `contexts/assessment/domain/evaluation.ts` | ✅ tested |
| Evidence contract | `contexts/assessment/domain/evidence.ts` | ✅ tested |
| Prerequisite graph & root-gap analysis | `contexts/learning/domain/prerequisite-graph.ts` | ✅ tested |
| Adaptive next-activity decision | `contexts/learning/domain/next-activity.ts` | ✅ tested |
| Attempt lifecycle (start/resume/submit) | `contexts/assessment/application/*-attempt.use-case.ts` | ✅ tested |
| Grounded AI with hard refusal | `contexts/tutoring/domain/grounding.ts` | ✅ tested |
| Canonical key derivation | `shared/kernel/identifiers.ts` | ✅ tested |
| Authentication, rotating sessions, scoped RBAC | `contexts/identity/**` | ✅ tested |
| Guardian access control (verified links only) | `interface/http/learner-access.ts` | ✅ tested |
| Architecture fitness checks | `scripts/check-architecture.ts` | ✅ 13 rules |

**152 tests, 14 architecture rules, 0 violations.**

Not yet built: the authoring API, the React frontend, analytics dashboards,
Excel/PDF import, assignments/obligations, flashcard storage. The layers and
ports for these exist; the implementations do not.

Read these in order before changing anything:

1. [`Docs_v10/ARCHITECTURAL-GATE.md`](Docs_v10/ARCHITECTURAL-GATE.md) — the governing
   decisions (A–G), **Revision 1** (two real authorisation bugs found by
   re-reading the plan against the schema) and **Revision 2** (one learner
   access boundary; READ vs ACT).
2. [`Docs_v10/PUBLISHING-LIFECYCLE-GATE.md`](Docs_v10/PUBLISHING-LIFECYCLE-GATE.md) —
   **closed, then corrected**. **Read §10 first:** Edu7 does *not* publish or
   approve textbooks — a textbook enters as an externally approved source, and
   the lifecycle governs only whether Edu7's own ingested copy is ready to
   serve. §§1–9 predate that correction and use "publish" to mean "activate
   inside Edu7". The rest: the one-axis state machine replacing legacy's
   `status` + `isPublished`, why a corrected edition is a new row rather than a
   version entity, and the authoring write path. Background in
   [`Docs_v10/CONTENT-LIFECYCLE-GATE.md`](Docs_v10/CONTENT-LIFECYCLE-GATE.md).
3. [`Docs_v10/ASSIGNMENT-GATE.md`](Docs_v10/ASSIGNMENT-GATE.md) — what an Assignment
   owns and delegates, decided **before** any schema exists, plus
   [`Docs_v10/CLASS-ROSTER-INVESTIGATION.md`](Docs_v10/CLASS-ROSTER-INVESTIGATION.md)
   — why a class is a query, not a table.
4. [`Docs_v10/REMEDIATION-GATE.md`](Docs_v10/REMEDIATION-GATE.md) — **closed**: why a
   remediation episode is a *claim about a learner*, opened and closed by
   evidence, rather than a task. §8 records the outcome against each acceptance
   criterion, and the one decision that changed during implementation.
5. [`Docs_v10/CAPABILITY-LEDGER.md`](Docs_v10/CAPABILITY-LEDGER.md) — what the legacy
   system did, item by item, and whether it survived. **Updated every round**;
   §8 is the changelog. Currently 17 of 20 capabilities fully built.
6. [`Docs_v10/NEXT-WAVE-REVIEW.md`](Docs_v10/NEXT-WAVE-REVIEW.md) — the product and
   architecture review of the remaining scope (exams, misconceptions,
   recommendations, dashboards), with a recommended sequence and its gates.
   Read §0 first: it documents a table that two shipped capabilities read and
   nothing writes — then §7, the 2026-09-12 current-state verification that
   corrects it and reconciles the ledger.
7. [`Docs_v10/FRONTEND-ARCHITECTURE.md`](Docs_v10/FRONTEND-ARCHITECTURE.md) —
   **specification only, no UI built yet.** The design-system, responsive and
   Web/Android-readiness contract the frontend must satisfy. §0 is a mandatory
   audit of the project root that must be completed and reported before any component is
   written; §14 lists the product decisions still open.
8. [`Docs_v10/RECONCILIATION.md`](Docs_v10/RECONCILIATION.md) — the audited gap list.

---

## Layout

```
src/
  shared/kernel/          Result, DomainError, Clock, canonical identifiers
  shared/http/            the one response envelope
  shared/config/          validated environment

  contexts/
    mastery/              domain/ bkt, retention, mastery-level
                          application/ recompute, profile, ports
    assessment/           domain/ irt, adaptive-selection, evaluation, evidence
                          application/ submit-answer, run-adaptive-exam, ports
    learning/             domain/ prerequisite-graph, next-activity
                          application/ get-next-step, ports
    tutoring/             domain/ grounding, prompts
                          application/ ask-tutor, ports

  infrastructure/         Prisma repositories, AI providers, retrieval
  interface/http/         routes, handler, middleware
  composition/            the container — the only place adapters are wired
```

Dependencies point inward. `domain/` imports nothing but `shared/kernel`.

---

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | API with watch reload |
| `npm test` | 152 unit tests |
| `npm run typecheck` | strict TypeScript, no emit |
| `npm run arch:check` | **enforce layer boundaries — run before every commit** |
| `npm run verify` | typecheck + arch:check + tests |
| `npm run db:seed` | idempotent demo slice |
| `npm run db:dev` | embedded Postgres |
| `npm run db:baseline` | regenerate the baseline migration |

---

## The API

One version (`/api/v1`), one envelope, always:

```jsonc
{ "ok": true,  "data": { }, "meta": { "requestId": "…", "at": "…" } }
{ "ok": false, "error": { "code": "learning.no_concepts_in_scope",
                          "message": "…" }, "meta": { } }
```

| Endpoint | Purpose |
|---|---|
| `GET /api/v1/health` | liveness |
| `POST /api/v1/auth/login` | sign in; returns an access token + rotating refresh token |
| `POST /api/v1/auth/refresh` | rotate the session; reuse of a spent token kills the family |
| `POST /api/v1/auth/logout` | revoke the session for real (`allDevices` supported) |
| `GET /api/v1/auth/me` | the current actor, with school-scoped roles |
| `GET /api/v1/learning/next-step` | **the adaptive loop** — what to do next, and why |
| `GET /api/v1/learning/mastery` | mastery profile, decay applied at read |
| `POST /api/v1/assessment/attempts` | open or resume an attempt |
| `POST /api/v1/assessment/attempts/:key/submit` | close an attempt, derive totals |
| `POST /api/v1/assessment/answers` | grade an answer, emit evidence |
| `GET /api/v1/assessment/attempts/:key/next-item` | next adaptive exam item |
| `POST /api/v1/tutoring/ask` | grounded AI question answering |

Endpoints are **use cases, not tables**. There is no generic CRUD surface,
because that is how pedagogy leaks into clients and then diverges between web
and mobile.

### Example

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "localhost:3000/api/v1/learning/next-step?textbookKey=2026-2027-T01-G07-MATH"
```

```jsonc
{
  "activity": "REVIEW",
  "conceptKey": "2026-2027-T01-G07-MATH-U01-L01-C01",
  "rule": "spaced_review_due",
  "rationale": "This concept was mastered earlier but recall probability has fallen below the review threshold…",
  "evidence": { "retrievability": 0.503, "threshold": 0.7, "masteryAtObservation": 0.978 }
}
```

Every decision returns the **rule that fired** and its supporting numbers. A
teacher asking "why is my student seeing this?" gets a real answer.

---

## Five properties to preserve

1. **Mastery has exactly one write path.** Enforced by architecture rule `M1`.
2. **Mastery is recomputed from evidence, never patched.** Running it twice
   changes nothing.
3. **The AI refuses before it calls.** Insufficient grounding returns a fixed
   sentence without invoking any model.
4. **A role is meaningless without its school.** `Actor.roles` carries
   `{role, schoolId}`; a flat list of role names would let a teacher at one
   school act at another.
5. **Whose data is this?** Learner-scoped routes resolve their subject through
   `learner-access.ts`, which checks a *verified* guardian link on every
   request. A `learnerKey` inside a JWT is a claim, not an authorisation.
   Enforced by rule `L1`.
6. **Delegation is not impersonation.** A guardian may *read* a child's data;
   nobody may *act* as a learner. Evidence must record what the learner
   actually did, or mastery means nothing.

---

## Demo credentials

`student` / `demo1234` — learner key `lrn_demo_student`, seeded with 9
observations across a three-concept prerequisite chain.

```bash
TOKEN=$(curl -s -X POST localhost:3000/api/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"identifier":"student","password":"demo1234"}' \
  | python3 -c 'import json,sys;print(json.load(sys.stdin)["data"]["tokens"]["accessToken"])')
```

The seed hashes this password at run time rather than storing a literal hash —
an earlier hardcoded one turned out to match no password at all.
