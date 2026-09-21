# AI Developer System Instruction — Edu_v10

**Purpose:** short operational boundary for AI coding agents.

You are modifying **ameryhusam/edu_v10**. Treat this repository as the only active source of implementation truth. Do not use the old edu7 repository unless the task explicitly requests comparison.

## 1. Inspect before changing

Before implementation:

1. inspect current HEAD;
2. inspect Prisma schema and affected context;
3. locate the existing owner of the behavior;
4. inspect routes/use cases/repositories/tests;
5. inspect architecture checks;
6. identify the current write path;
7. distinguish CURRENT behavior from ADOPTED target behavior in Docs_v10.

Never implement from a document alone when the code can be inspected.

## 2. Architecture

Respect:

```text
interface → application → domain
infrastructure → ports/contracts
composition → wiring
```

Domain is pure.

Application owns use cases/orchestration/ports/transactions.

Infrastructure owns Prisma/storage/network/AI provider details.

Interface translates HTTP/UI interactions.

Composition owns concrete wiring.

## 3. One owner

Every business rule has one owner.

Do not create:

- duplicate services;
- parallel repositories;
- second mastery formulas;
- second completion policies;
- second key generators;
- AI-specific database writers;
- Python database writers.

Extend or repair the canonical owner.

## 4. Educational boundary

Never bypass:

```text
Assessment → Evidence → Mastery → Learning
```

Assessment emits evidence; Mastery computes belief; Learning decides progression.

Instruction assigns work but does not own achievement.

Engagement does not influence mastery.

## 5. Content

Content owns textbook hierarchy, questions, answer keys, resources, concepts and authoring.

Use canonical keys.

Never derive a key from order/index/position.

Do not treat `orderIndex` as identity.

Do not use `curriculum` as a synonym for a printed textbook unless the domain explicitly means curriculum/catalogue.

## 6. Published content

**PUBLISHED means ready for learner use; it does not mean immutable.**

Published content may be edited through canonical authoring services.

Never turn publication into a database lock unless an explicit new product decision says so.

Publication/readiness and learning-path inclusion are separate decisions.

A future learning-path toggle must be backend-owned. UI-only filtering is not authoritative.

## 7. Historical data

Never silently rewrite/delete:

- attempts;
- evidence;
- mastery history;
- grading results;
- decision logs;
- XP ledger entries.

If a change affects historical meaning, introduce an explicit migration/versioning/evaluator strategy.

## 8. AI and Python

AI is an adapter behind a port.

Python is an external content-preparation/evidence producer.

Neither may write PostgreSQL directly.

AI output is draft/proposed until human-approved canonical application.

AI may not approve, publish, alter mastery, create learner evidence, or alter authorization.

## 9. Imports

Use:

```text
validate → reconcile → deduplicate → dry-run → canonical apply → transaction → audit
```

Retry must be idempotent.

Missing input does not mean delete.

Conflict is explicit; never silently overwrite.

## 10. Frontend

Frontend renders backend decisions.

Do not implement in React:

- authorization;
- entitlement;
- publication;
- mastery;
- grading;
- completion;
- next-step;
- canonical keys;
- deduplication.

## 11. Security

Authorization is server-side.

Guardian access requires verified relationship.

Role claims do not replace resource authorization.

Do not trust client-supplied learner identifiers without an access check.

## 12. Schema

Prisma is persistence source of truth.

Do not add schema fields/models to satisfy a UI, AI prompt, seed file, or script unless the domain requirement is established first.

## 13. Verification

Use the repository's real scripts from `package.json`.

At the current snapshot:

```bash
npm run typecheck
npm run arch:check
npm test
npm run verify
```

Do not claim tests passed unless they actually ran.

## 14. Stop conditions

Stop and re-audit if the change would:

- violate architecture checks;
- create a second write path;
- import Prisma/provider SDK into forbidden layers;
- write DB from Python;
- let AI publish/approve;
- let React decide business rules;
- derive keys from order;
- expose DRAFT to learners;
- silently mutate historical learner data;
- make assignment own mastery;
- make due work influence next-step;
- make publication imply immutability;
- introduce a schema migration without domain justification.

## 15. Delivery behavior

Prefer a small coherent change.

Preserve public contracts where possible.

Do not suppress lint/type errors instead of fixing ownership.

After implementation, verify behavior and update Docs_v10 when the architectural contract changes.
