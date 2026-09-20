# Edu7 — Architecture

This document explains **why** the code is shaped the way it is. Rules stated
here are enforced by `npm run arch:check`, not by good intentions.

---

## 1. The problem this structure solves

The previous codebase had good ideas and a structure that could not hold them:

| Symptom | Root cause |
|---|---|
| Migrations conflicted and could not be replayed | 20+ incremental migrations, each patching the last; no single source of truth for the schema |
| Four different mastery formulas | No owner for the decision; every service computed what it needed |
| Mastery written from five call sites | No enforced write path |
| Business rules duplicated in React components | Domain logic lived in services that returned rows, so the UI re-derived meaning |
| `/api` and `/api/v1` disagreed | Two live contract versions |
| Prisma imported in ~100 files | No dependency inversion; the database *was* the architecture |

Every rule below exists to make one of those failures **structurally impossible**
rather than merely discouraged.

---

## 2. Layers

Dependencies point **inward only**. Nothing in an inner ring may know about an
outer one.

```
        ┌─────────────────────────────────────────────┐
        │  interface/   HTTP, routing, auth, envelope │   ← knows: application
        ├─────────────────────────────────────────────┤
        │  composition/ the wiring (the only `new`)   │   ← knows: everything
        ├─────────────────────────────────────────────┤
        │  infrastructure/  Prisma, AI SDKs, adapters │   ← knows: ports
        ├─────────────────────────────────────────────┤
        │  contexts/*/application/  use cases, ports  │   ← knows: domain
        ├─────────────────────────────────────────────┤
        │  contexts/*/domain/   pure business rules   │   ← knows: nothing
        └─────────────────────────────────────────────┘
                    shared/kernel — types only
```

**domain/** — pure functions and value objects. No Prisma, no Express, no
`Date.now()`, no `Math.random()`. Given the same inputs it returns the same
output, forever. This is where BKT, IRT, grading and the adaptive decision live.

**application/** — use cases. Orchestrates: load state through ports, call the
domain, persist through ports. Contains no formulas and no thresholds.

**infrastructure/** — implements ports. Translates between rows and domain
types. Contains no decisions.

**interface/** — turns HTTP into a use-case call and a `Result` into a status
code. Contains no logic.

**composition/** — the single place where interfaces meet implementations.

### Why ports are declared by the consumer

`MasteryRepository` is defined in `contexts/mastery/application/ports.ts`, not
next to its Prisma implementation. The context states what it needs;
infrastructure supplies it. That inversion is what lets
`recompute-mastery.test.ts` run the real use case against a `Map` with no
database at all.

---

## 3. Bounded contexts

A context is a **business responsibility**, not a technical layer.

| Context | Owns | Must not |
|---|---|---|
| `identity` | users, roles, guardianship | — |
| `content` | textbook → unit → lesson → concept, prerequisites, misconception catalogue, resources | know about learners |
| `assessment` | questions, answer keys, attempts, grading, **evidence production**, CAT | write mastery |
| `mastery` | belief about what a learner knows; BKT; forgetting | grade answers |
| `learning` | what to do next; progression; engagement | write content, mastery or evidence |
| `tutoring` | grounded AI: explanations, hints, item drafting | answer without grounding |
| `platform` | audit, settings, AI governance | own business rules |

### The single most important boundary

```
Assessment  ──emits──►  Evidence  ──consumed by──►  Mastery
```

`Evidence` (`contexts/assessment/domain/evidence.ts`) is the *only* thing that
crosses. Assessment never writes a mastery number; Mastery never reads an
attempt row. Consequences:

- Grading can be rewritten without touching mastery.
- Any future source (a game, an oral quiz, a teacher's judgement) can feed
  mastery just by emitting `Evidence`.
- Ungradable and pending answers emit **weight 0** — recorded as observed, but
  carrying no signal. Silence is never a valid outcome.

---

## 4. Decisions worth defending

### 4.1 Mastery is recomputed, never patched

`RecomputeMasteryUseCase` replays the entire ordered evidence stream and
overwrites the stored value. More reads, and worth it:

- **Idempotent** — a retried request cannot inflate mastery.
- **Auditable** — any number can be re-derived from stored evidence.
- **Evolvable** — change BKT parameters, replay, done.

A bug found during this build proves the point: stability was initially seeded
from the *stored* record, so each run compounded on the last and the same
evidence drifted upward. It is now seeded from a constant, and
`tests/unit/recompute-mastery.test.ts` locks that in.

### 4.2 Decay is applied at read time, never stored

A stored mastery row describes the moment it was written. "What can this learner
do *today*" is a projection over elapsed time, computed on read. So there is no
nightly decay job silently mutating rows, and the write path stays idempotent.

`mastery` = belief at last observation · `effective` = after forgetting.

### 4.3 Evidence is ordered by `observedAt`

BKT is a recursive filter: the same answers in a different order give a
different belief. Repositories order by `observedAt`, never by row id.

### 4.4 Grading is versioned

Every verdict stores `evaluatorVersion` and the exact normalisation steps
applied. A score from March stays explainable in December, and "wrong" can be
justified to a parent as "we compared after unifying Arabic alef forms".

### 4.5 Two levels of adaptivity, two owners

- `learning/domain/next-activity.ts` — *what kind of activity* (review,
  remediate, learn, practise, assess).
- `assessment/domain/adaptive-selection.ts` — *which item*, via Fisher
  information.

Keeping them apart stops the two engines from silently disagreeing.

### 4.6 The AI refuses before it calls

`quota → retrieve → assess grounding → REFUSE or call → validate citations → log`

Refusal happens **before** the provider call: a model that is never asked cannot
hallucinate, and the refusal is free. The deterministic provider is always last
in the chain and always available, so an API outage degrades the experience
instead of breaking a lesson.

### 4.7 Identity: `id` and `key`

- `id` — opaque UUID, internal, never displayed.
- `key` — deterministic canonical key, e.g.
  `2026-2027-T01-G07-MATH-U01-L01-C02`.

Keys are **derived**, never typed. The same coordinates always produce the same
key, which is what makes imports idempotent and ancestry checkable without a
database (`isDescendantKey`).

### 4.8 One baseline migration

`prisma/migrations/00000000000000_baseline/` is generated from the schema. The
legacy migration history is not carried forward — that history was the problem.

---

### 4.9 An importer is an adapter, never a write path

Bulk import must call the same application services as the HTTP API. It gets no
private route to the database.

This is not a style preference. The legacy project's importer made 19 direct
Prisma calls, which meant validation, authorization, key derivation and the
textbook write-lock were all optional depending on how the data arrived. An
import that bypasses `AuthoringService` is not importing content — it is a
second, undocumented definition of what valid content is.

Two consequences follow:

**No importer without a service.** Where no canonical write path exists yet, the
importer cannot be built first, because it would have to invent one. Provisioning
services come before their importers; an importer is a bulk adapter over an
existing use case.

**Templates carry no keys for nodes they create.** Keys here are derived — a
unit key is `<textbookKey>-U-<slug>`, a question key fingerprints its text. The
domain owns identity, so a template supplies `parent reference + slug + fields`
and receives the key back in the import report. A key column for a new node
would let a spreadsheet name something the domain is responsible for naming.

Derived learner state — mastery, evidence, attempts, completion, XP, eligibility
— is never importable at all. It is computed from evidence, or it is fabricated.

## 5. Enforcement

`npm run arch:check` fails the build on:

| Rule | Prevents |
|---|---|
| D1/D2 | infrastructure or framework imports in `domain/` |
| D3 | `Date.now()`, `new Date()`, `Math.random()` in `domain/` |
| A1/A2 | Prisma, adapters or Express in `application/` |
| C1 | reaching into another context's internals |
| P1 | constructing `PrismaClient` outside its one module |
| P2 | importing Prisma outside `infrastructure/` |
| **M1** | **writing `ConceptMastery` outside the mastery repository** |
| I1 | Prisma or adapters in routes |
| E1 | reading `process.env` outside `shared/config` |

M1 is the rule that would have prevented the original five-write-sites problem.

---

## 6. Request flow

```
GET /api/v1/learning/next-step
  → interface/http/learning.routes.ts    validate input, resolve actor
  → handler.ts                           Result → HTTP envelope
  → GetNextStepUseCase                   load state via ports
      ├── ContentReader        concepts + prerequisite edges
      ├── MasteryReader        mastery, decay applied on read
      ├── MisconceptionReader  unresolved misconceptions
      └── decideNextActivity() PURE — returns activity + rule + rationale
  → ResourceReader                       resources matching the activity
  → { step, decision, progress }
```

Every response carries `rule` and `rationale`, so a teacher can always be told
*why* a learner is seeing something.

---

## 7. Verified behaviour

Confirmed end to end against a live Postgres during this build:

- Evidence → BKT → decay → `REVIEW` decision with `retrievability 0.50 < 0.70`.
- A distractor tagged with a misconception produced
  `misconceptionKey: …-C01-MIS01` on an incorrect answer.
- Submitting an answer recomputed mastery automatically (n=6 → n=7).
- Re-submitting the same question returned `assessment.question_already_answered`.
- An in-corpus question returned a grounded answer citing page 9; an off-corpus
  question was refused without calling any model.
- Three consecutive recomputes produced byte-identical results.
