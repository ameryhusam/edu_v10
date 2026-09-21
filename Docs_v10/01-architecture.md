# Architecture and Bounded Contexts

**Status:** ADOPTED; implementation must converge toward this model.

## 1. Architectural shape

Edu_v10 is a TypeScript/Node.js application organized as Clean Architecture with bounded contexts.

Dependency direction is inward:

```text
interface → application → domain
infrastructure → application/domain contracts
composition → wires implementations
```

The dependency rule is more important than folder names.

### Domain

Pure business rules, value objects, policies, domain types, deterministic decisions.

Domain must not import Prisma, Express, filesystem APIs, provider SDKs, environment readers, or UI code.

### Application

Use cases, orchestration, ports, transaction boundaries, authorization coordination, and cross-domain workflows.

Application must not contain persistence implementation or provider SDK details.

### Infrastructure

Prisma repositories, object/file storage, PDF/workspace readers, AI provider adapters, HTTP clients, hashing, streaming, MIME handling.

Infrastructure implements contracts; it does not invent product policy.

### Interface

HTTP routes/handlers, input validation, authentication middleware, response mapping, and frontend delivery.

Routes translate requests into use cases. React renders server decisions and manages interaction state.

### Composition

The composition root is the only normal place where concrete adapters are created and connected. Do not construct repositories, AI providers, or storage adapters inside routes, React components, domain code, or arbitrary scripts.

## 2. Bounded-context ownership

| Context | Owns | Must not own |
|---|---|---|
| Identity | users, sessions, roles, guardian links, access boundary, audit identity | pedagogy |
| Content | textbook tree, concepts, prerequisites as content relationships, questions, answer keys, resources, flashcard content, content readiness | learner state |
| Assessment | attempts, grading, exam definition, evidence production | mastery |
| Mastery | mastery computation, retention/decay, learner misconception state | grading |
| Learning | next activity, eligibility, progression, completion policy, progress, remediation decisions | content writes, mastery writes, assignments |
| Instruction | instructional plans, learner obligations, human interventions, due work | grading, mastery, adaptive pedagogy |
| Tutoring | grounded tutoring and refusal policy | canonical content authoring |
| Engagement | XP/streaks/badges/challenges | mastery/evidence/learning decisions |
| Analytics | read models and reporting | transactional ownership of source facts |
| Administration/catalogue | school/grade/subject/term institutional setup | learner pedagogy |

## 3. One owner per decision

Every business decision has one owner.

Examples:

- canonical key → shared identity contract;
- answer verdict → Assessment;
- evidence emission → Assessment;
- mastery → Mastery;
- next activity → Learning;
- assignment status → Instruction, derived from Learning's completion policy;
- publication/readiness → Content;
- learner authorization → Identity/application access boundary;
- learning-path inclusion → Learning/Content contract, not React;
- XP → Engagement.

A consumer may read a decision, but must not recreate it.

## 4. Hard boundaries

These are architectural invariants:

1. Assessment → Evidence → Mastery is the only educational state path.
2. Assessment never writes mastery.
3. Mastery never treats Attempt rows as a substitute for evidence.
4. Learning never patches mastery or evidence.
5. Instruction never owns scores, mastery, or pedagogical next-step decisions.
6. Engagement is a terminal sink with respect to pedagogy.
7. Python/content-engine code never writes PostgreSQL.
8. AI providers never receive Prisma access.
9. React never decides authorization, publication, mastery, completion, canonical identity, or deduplication.
10. No second write path may be created when a canonical owner already exists.

## 5. Change placement test

Before adding code, answer:

- Which context owns this decision?
- Is the behavior a pure rule, a use case, an adapter, or an interface concern?
- Does a canonical implementation already exist?
- Which existing contract will the new code call?
- Does the change create a second source of truth?

If these cannot be answered, stop and audit before implementing.

## 6. Architecture verification

Use the repository's actual scripts from `package.json`; do not invent commands. At the current snapshot the repository exposes:

- `npm run typecheck`
- `npm test`
- `npm run arch:check`
- `npm run verify`

`verify` is the preferred grouped gate before accepting a coherent implementation.

## 7. Target-state principle

If code and the adopted architecture disagree, do not rewrite the architecture to match accidental current code. Record the discrepancy, preserve working behavior while safe, then implement the target through the canonical owner and compatibility path.
