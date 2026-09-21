# Edu_v10 Documentation System

**Status:** Canonical documentation set  
**Repository:** ameryhusam/edu_v10  
**Branch:** 03_build_algorithm_and_new_Docs  
**Last reviewed:** 2026-09-21

## Purpose

Docs_v10 replaces the previous collection of overlapping planning, audit, gate, roadmap, and implementation documents with one normalized documentation system.

The old `docs/` directory remains temporarily as historical source material. It is **not authoritative** once Docs_v10 is committed.

## Authority order

When documents disagree, resolve them in this order:

1. Current `prisma/schema.prisma` for persisted data shape.
2. Current source code and enforced architecture checks for implemented behavior.
3. Docs_v10 normative architecture decisions for the target architecture.
4. Current tests and executable contracts.
5. Historical documents only as evidence, never as a current rule.

A documented target-state decision may intentionally describe behavior that code does not yet implement. It must be labeled **TARGET / NOT YET IMPLEMENTED** and becomes the implementation contract for the next change.

## Documentation status vocabulary

- **CURRENT** — implemented and verified in the current repository.
- **ADOPTED** — normative decision approved for the architecture, implementation may still be pending.
- **TARGET** — planned future behavior; not yet an implementation fact.
- **HISTORICAL** — retained only to explain why a decision was made.
- **DEPRECATED** — superseded; never copy its rules into new code.

## Document map

| File | Responsibility |
|---|---|
| 01-architecture.md | architecture, dependency direction, bounded contexts, ownership |
| 02-domain-contracts.md | identity, lifecycle, content ownership, evidence/mastery, historical data |
| 03-content-authoring-delivery.md | textbook/content lifecycle, authoring, learner delivery, learning-path visibility |
| 04-assessment-learning-mastery.md | assessment, evidence, mastery, learning decisions, remediation, instruction, engagement |
| 05-content-ingestion-ai.md | PDF/workspace/grounding/import/AI/asset pipeline |
| 06-api-security-frontend.md | API contracts, authorization, frontend boundaries, Web/Android |
| 07-data-operations-quality.md | Prisma, migrations, transactions, idempotency, observability, testing |
| 08-product-roadmap.md | capability state, implementation order, open gaps |
| 09-ai-developer-instructions.md | short operational system instruction for AI coding agents |
| 10-documentation-governance.md | how Docs_v10 is maintained and how obsolete docs are retired |
| 11-current-state.md | verified repository snapshot and gaps at the review date |\n| 12-end-to-end-dataflows.md | complete operational data flows, algorithms, status model, field contracts and workflow boundaries |
| 13-content-storage-page-classification-and-import-algorithms.md | storage boundary, Workspace synchronization, page classification, aliases, AI classification and import algorithms |
| 14-developer-content-ingestion-guide.md | developer-facing preparation, classification, ZIP import, question/resource and troubleshooting workflow |

## Operational workflow rule\n\nDocs_v10 defines both architecture and end-to-end data movement. For major workflows, 12-end-to-end-dataflows.md is the normative reference for entry conditions, required fields, state transitions, reconciliation, idempotency, audit/provenance and terminal outcomes.\n\n## Core architectural flow

```text
External sources / UI / AI
        ↓
Interface / adapters
        ↓
Application use cases
        ↓
Domain rules
        ↓
Application ports
        ↑
Infrastructure adapters
        ↑
Composition root
        ↓
PostgreSQL / storage / external providers
```

For educational decisions:

```text
Content → Assessment → Evidence → Mastery → Learning decision
                 │                         │
                 └──── historical data ────┘
```

Instruction assigns work; it does not own grading or mastery.

## Important product ruling

**PUBLISHED means learner-ready, not immutable.**

It means Edu7 has decided that the current content is eligible to be served to learners. Content can continue to be corrected, enriched, and improved after it is published.

A separate learning-path visibility decision must control whether a lesson/content node participates in the learner's guided path. The preferred future model is an explicit backend-owned toggle/field such as `includedInLearningPath` (exact name to be confirmed against the schema before migration). It must not be implemented as UI-only filtering.

Publication and learning-path inclusion are independent dimensions:

```text
Publication/readiness  ── can the learner access this content?
Learning-path inclusion ── should adaptive progression place this content in the path?
```

Changing one must not silently change the other.

## Migration rule

Do not delete `docs/` until:

- every current decision has a home in Docs_v10;
- obsolete contradictions are explicitly classified;
- links and README references point to Docs_v10;
- current code/docs discrepancies are recorded in 11-current-state.md;
- an architecture check and repository verification have passed.

After that, delete the old `docs/` directory in a separate cleanup commit.
