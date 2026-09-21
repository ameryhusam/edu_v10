# Current Repository State — edu_v10

**Review date:** 2026-09-21  
**HEAD at review:** a085a306acbdb74ca800dad64ab9910f30310dcc

## Repository facts

- Repository: ameryhusam/edu_v10
- Default branch: main
- Stack: Node.js + TypeScript + Prisma + PostgreSQL/PGlite + React
- API convention: /api/v1
- Architecture check: scripts/check-architecture.ts
- Current package scripts include typecheck, test, arch:check and verify.

## Recent content direction

The latest implementation commits on 2026-09-21 establish the current content/AI direction. This file is the only Docs_v10 document whose primary purpose is to describe the repository snapshot:

- G1 content AI foundation merged to main.
- Lesson page and AI explanation viewer added.
- Physical lesson/media assets exposed to staff UI.
- Asset storage policy was finalized.
- SVG asset support was added.
- Learner entitlement for lesson page assets remains a tracked gap.

## Current schema facts

The current schema includes:

- Textbook → Unit → Lesson → Concept.
- PublicationStatus: DRAFT, IN_REVIEW, PUBLISHED, ARCHIVED.
- TextbookAdoption for academic-year usage.
- canonical key/slug fields for content.
- orderIndex for presentation order.
- ContentAsset, TextbookPage, ContentChunk, LearningResource.
- Question/AnswerKey/QuestionChoice/QuestionConcept.
- Attempt/AttemptItem/MasteryEvidence/ConceptMastery.
- InstructionalPlan/LearnerObligation.
- AuditEntry/AiInteraction/ContentReviewReport.

## Important discrepancy requiring documentation precedence

Some historical lifecycle documents describe PUBLISHED as structurally immutable.

**That rule is superseded by the current owner decision:** PUBLISHED means ready for learner use and content may continue to be edited through the canonical authoring path.

This document therefore treats immutability as a historical rule, not a current requirement.

## Learning-path control

The current schema snapshot does not show a dedicated lesson-level `includedInLearningPath` field.

The product requirement is adopted as a target contract:

- published content may be learner-visible;
- a separate backend-owned inclusion flag controls guided learning-path eligibility.

Before adding a field, inspect existing `isActive` semantics and the Learning context. Do not reuse `isActive` merely because it exists.

## Current ingestion boundary

Current G1–G4 work establishes:

```text
PDF → Python workspace/grounding → Node reconciliation → canonical services → DB
```

AI lesson analysis remains draft-only and workspace-based until human Apply.

## Current known gaps

1. Canonical persistence of grounding manifests into page/chunk entities.
2. AI provenance/source fingerprint persistence.
3. Preview/dedup/human Apply flow.
4. Complete question authoring/update/merge workflow.
5. Advanced question package support.
6. Learner entitlement-aware lesson asset endpoint.
7. Explicit learning-path inclusion control.
8. Broader integration/E2E coverage for content assets and AI workflows.

## Verification policy

This file records repository inspection. It does not claim a command was executed during documentation migration unless a later commit records that evidence.

Before merging implementation work, run the relevant verification commands and update this document only when the state materially changes.


## Workspace ZIP synchronization implementation update

The current repository now includes a safe workspace ZIP exchange path:
- full workspace ZIP import;
- partial workspace ZIP import when textbookKey is supplied;
- isolated extraction and archive safety limits;
- SHA-256 comparison of incoming versus existing workspace files;
- staged merge that preserves files omitted from partial updates;
- dry-run reconciliation before apply;
- canonical content/asset import before the staged workspace becomes the new snapshot;
- textbook-keyed ZIP export of the actual workspace tree.

Current HTTP operations:
- POST /api/v1/content/workspace/import-zip
- GET /api/v1/content/workspaces/:textbookKey/export-zip

The implementation deliberately keeps semantic ownership separate: a physical question/flashcard file discovered under resource/ becomes a physical ContentAsset until a dedicated canonical semantic importer processes its contents.

Known production gaps remain:
1. distributed per-textbook operation lock/idempotency record;
2. durable operation/readiness history rather than process-local status;
3. dedicated semantic ZIP import adapters for QuestionBank and Flashcard updates;
4. stronger append-only ContentAsset versioning when a binary at the same relative path changes;
5. end-to-end tests for full round-trip ZIP, partial update, duplicate/no-op, changed asset, identity conflict, malformed ZIP and rollback/retry cases.