# Data, Operations, Testing and Quality

**Status:** ADOPTED.

## 1. Prisma

Prisma schema is the source of truth for persistence.

Use migrations for intentional schema changes.

Do not maintain parallel hand-written data models that contradict Prisma.

## 2. Transactions

A transaction belongs at the application boundary when multiple writes form one business operation.

Repositories should expose business-relevant persistence operations rather than leaking ORM details into domain logic.

## 3. Concurrency

Operations that can be retried or run concurrently must have:

- stable identity;
- uniqueness constraints where appropriate;
- transaction boundaries;
- conflict detection;
- deterministic replay behavior.

Reordering content should operate on a complete desired ordering rather than fragile positional deltas.

## 4. Soft removal and history

Use lifecycle/status when history must remain.

Restrict destructive deletes where historical learner data depends on the row.

Never silently delete source content because it disappeared from an import package.

## 5. Observability

Meaningful mutations should be auditable.

Audit records should identify:

- actor;
- action;
- entity/key;
- before/after where appropriate;
- request/correlation ID;
- timestamp.

AI interactions should record provider/model/task/purpose and relevant safety/grounding metadata without storing secrets.

## 6. Tests

A capability is not considered complete because a model or service exists.

New behavior should be demonstrated by the smallest relevant test layers:

1. pure domain tests;
2. application/use-case tests;
3. architecture tests;
4. integration tests for persistence boundaries;
5. HTTP tests for security/contract;
6. browser/E2E tests for user-visible workflows when relevant.

Do not add noisy tests for every trivial refactor, but do add regression coverage for new business behavior and previously fixed defects.

## 7. Verification

At the current repository snapshot:

```bash
npm run typecheck
npm run arch:check
npm test
npm run verify
```

Run the command that matches the change first; run `verify` before a coherent milestone.

Do not claim execution success unless it was actually run.

## 8. Architecture checks

Architecture rules should be executable where practical.

Good examples include preventing:

- Prisma imports in domain/application;
- direct provider SDK imports;
- duplicate mastery writers;
- key derivation from order;
- learning → instruction dependency;
- publication filters bypassing the shared readiness predicate;
- Python direct DB writes.

## 9. Performance

Prefer:

- indexed business queries;
- streaming assets;
- bounded payloads;
- cache/revalidation;
- read models for expensive dashboards;
- deterministic batch operations.

Do not optimize by bypassing ownership boundaries.

## 10. Migration safety

Before migration:

- identify affected code paths;
- define default/backfill;
- preserve existing references;
- define rollback/compatibility where feasible;
- test seed/reset/apply flows.

A schema change is justified by a domain requirement, not by convenience for a UI or importer.
