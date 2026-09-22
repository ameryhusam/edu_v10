# Architecture Decision Register

Status: ADOPTED
Last reviewed: 2026-09-22

| ID | Decision |
|---|---|
| ADR-001 | Node.js + TypeScript owns application/backend implementation. |
| ADR-002 | Prisma is persistence schema source of truth. |
| ADR-003 | Python Content Engine prepares content/evidence and never writes PostgreSQL directly. |
| ADR-004 | Workspace is a controlled preparation/exchange snapshot, not an uncontrolled second database. |
| ADR-005 | Physical Workspace uses P1/P2/PB; T1/T01 remains a separate term identity concern. |
| ADR-006 | Printed page identity is distinct from physical PDF page index. |
| ADR-007 | ContentAsset represents physical artifact identity/metadata; semantic records use canonical services. |
| ADR-008 | AI output is proposal/draft evidence and cannot directly approve, publish or mutate canonical state. |
| ADR-009 | QuestionType and QuestionOrigin are independent dimensions. |
| ADR-010 | Publication/readiness and learning-path inclusion are independent backend-owned decisions. |
| ADR-011 | React is not the owner of authorization, entitlement, mastery, grading, completion, next-step, identity or deduplication. |
| ADR-012 | Assessment → Evidence → Mastery → Learning is the educational state boundary. |
| ADR-013 | One canonical owner/write path exists per business decision. |
| ADR-014 | Imports use validation, reconciliation, deduplication, dry-run, canonical apply, idempotency and audit. |
| ADR-015 | Partial imports never imply deletion. |
| ADR-016 | Historical learner facts are not silently rewritten/deleted. |
| ADR-017 | Codex implementation is followed by latest-project-commit Audit_codex. |
| ADR-018 | Historical chats and commit comparisons are evidence, not current decision sources. |
| ADR-019 | ~/edu_v10 is the canonical local working directory. |
| ADR-020 | Durable architecture changes require repository documentation and stale-reference scanning. |

## Conflict rule
If a proposal conflicts with an ADR, do not implement it as if approved. Inspect schema/code, propose a superseding decision, and update this register and affected documents only after adoption.

This register describes adopted architecture, not proof that every decision is implemented. Consult Docs_v10/11-current-state.md and current code/schema for implementation status.
