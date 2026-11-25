# Architecture Decision Register

Status: ADOPTED
Last reviewed: 2026-11-25

| ID | Decision |
|---|---|
| ADR-001 | Node.js + TypeScript owns application/backend implementation. |
| ADR-002 | Prisma is persistence schema source of truth. |
| ADR-003 | `indexer2` owns the existing book-preparation and lesson-PDF slicing workflow. `edu_v10` consumes its Workspace and does not introduce a competing slicing engine. |
| ADR-004 | Workspace is a controlled, read-only-to-edu_v10 preparation snapshot, not an uncontrolled second database or live two-way mirror. |
| ADR-005 | Physical part uses P1/P2; T01/T02 are academic-term coordinates and are never textbook identity components. |
| ADR-006 | Printed page identity is distinct from physical PDF page index. |
| ADR-007 | ContentAsset represents physical artifact identity/metadata; semantic records use canonical services. |
| ADR-008 | AI output is proposal/draft content and cannot directly approve, publish or mutate canonical learner state. |
| ADR-009 | QuestionType and QuestionOrigin are independent dimensions. |
| ADR-010 | Publication/readiness and learning-path inclusion are independent backend-owned decisions. |
| ADR-011 | React is not the owner of authorization, entitlement, mastery, grading, completion, next-step, identity or deduplication. |
| ADR-012 | Assessment → Evidence → Mastery → Learning is the educational state boundary. |
| ADR-013 | One canonical owner/write path exists per business decision. |
| ADR-014 | Workspace reconciliation uses validation, identity resolution, checksums, idempotency and audit before any canonical write. |
| ADR-015 | Partial packages never imply deletion. |
| ADR-016 | Historical learner facts are not silently rewritten/deleted. |
| ADR-017 | Codex implementation is followed by latest-project-commit Audit_codex. |
| ADR-018 | Historical chats and commit comparisons are evidence, not current decision sources. |
| ADR-019 | `~/edu_v10` is the canonical local working directory. |
| ADR-020 | Durable architecture changes require repository documentation and stale-reference scanning. |
| ADR-021 | A two-part source book is represented as independent P1/P2 textbook identities; PB is not a canonical textbook identity. |
| ADR-022 | Page filenames are stable evidence identifiers; classification and downstream routing are metadata, not filenames. |
| ADR-023 | TOC/index detection, page roles, lesson types, question roles and review thresholds are configuration-driven and versioned. |
| ADR-024 | Workspace operations are controlled snapshot/reconciliation operations; no uncontrolled filesystem watcher or live bidirectional mirror. |
| ADR-025 | Raw PDF identity is resolved before any database write; identity conflicts require confirmation/review. |
| ADR-026 | `edu_v10` uses the existing `indexer2` Workspace layout exactly; no edition directory or alternative lesson-PDF layout is allowed. |
| ADR-027 | Workspace contains the currently prepared edition's lesson PDFs and required structural/control metadata only. AI-generated content is persisted in the database, not in Workspace. |
| ADR-028 | Each printed edition is a separate `Textbook` row; reuse `Textbook.edition` and its existing uniqueness constraint. No separate Edition model is introduced. |
| ADR-029 | Only the latest confirmed edition occupies active Workspace. Older uploads are rejected before slicing; newer editions replace Workspace only after staged validation. Historical generated content remains in PostgreSQL. |
| ADR-030 | Edition switching selects the corresponding Textbook identity and never borrows content from another edition. Historical source PDFs are unavailable after Workspace replacement unless separately retained in ContentStorage. |
| ADR-031 | Task Specifications are server-owned/versioned; the UI has no competing prompt/schema copy, and Gemini is called only through edu_v10. |

## Conflict rule

If a proposal conflicts with an adopted ADR, do not implement it as if approved. Inspect schema/code, propose a superseding decision, and update this register and affected documents only after adoption.

This register describes adopted architecture, not proof that every decision is implemented. Consult `Docs_v10/11-current-state.md` and current code/schema for implementation status.
