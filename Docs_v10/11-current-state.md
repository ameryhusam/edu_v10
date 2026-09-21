# Current Repository State — edu_v10

**Review date:** 2026-09-21  
**HEAD:** 7f2eb50cef7a078c62143799acff29f8e850c8da

## Repository facts

- Repository: ameryhusam/edu_v10
- Default branch: main
- Stack: Node.js + TypeScript + Prisma + PostgreSQL/PGlite + React
- API convention: /api/v1
- Architecture check: scripts/check-architecture.ts
- Current package scripts include typecheck, test, arch:check and verify.

## Recent content direction

The latest commits on 2026-09-21 establish the current content/AI direction:

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
