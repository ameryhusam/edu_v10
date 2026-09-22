# Edu7 Architecture — Canonical Reference

Status: ADOPTED — primary architectural reference
Repository: ameryhusam/edu_v10
Branch: 03_build_algorithm_and_new_Docs
Last reviewed: 2026-09-22

## Purpose
This directory is the primary architectural reference for Edu7. It prevents architectural drift between ChatGPT conversations, Codex sessions, audits, and repository documentation.

A new development conversation or coding agent must consult this directory before changing architecture, domain ownership, data contracts, Workspace, ingestion, AI, API/security, frontend boundaries, or the development workflow.

## Authority
1. Current prisma/schema.prisma — persisted-data fact.
2. Current source code and executable architecture checks — implemented behavior.
3. architecture/ — durable adopted architectural decisions.
4. Docs_v10/ — detailed capability contracts, algorithms, roadmap and current-state evidence.
5. Historical documents, conversation exports and audit history — evidence/rationale only.

If an adopted decision is not implemented yet, label it ADOPTED / TARGET. Never present target behavior as current implementation.

## Reading order
00-canonical-architecture.md
01-domain-boundaries.md
02-content-workspace-ingestion.md
03-ai-evidence-provenance.md
04-data-identity-schema.md
05-api-security-frontend.md
06-development-change-audit.md
07-documentation-change-control.md
08-decision-register.md

Then consult the relevant Docs_v10 document. Architecture defines stable ownership and invariants; Docs_v10 owns detailed algorithms and operational procedures.

## Change rule
A change must not silently contradict architecture/. If a proposal conflicts with an adopted decision, stop, inspect schema/code, identify the conflict, obtain the decision to supersede it, update the canonical documents, scan for stale references, and only then implement.

## Conversation continuity
ChatGPT history is contextual, not the permanent architecture store. A new conversation must resolve the repository, branch, current HEAD, architecture documents, relevant Docs_v10 documents, and latest project-change audit before making implementation decisions.

A conversation can propose a decision; discussion alone does not make it authoritative. The repository record does.

## Core flows
Application:
Interface → Application → Domain
Infrastructure → Application/Domain contracts
Composition → concrete wiring

Educational:
Content → Assessment → Evidence → Mastery → Learning

Content preparation:
Source PDF → Python Content Preparation → Canonical Workspace → Node/TypeScript reconciliation → Canonical Content Services → Prisma/PostgreSQL + ContentStorage → API → React Server State → UI

## Non-negotiable principles
- Node.js + TypeScript owns the application/backend.
- Prisma is persistence schema authority.
- Python prepares content/evidence and never writes PostgreSQL directly.
- AI produces proposals/evidence and never directly approves, publishes, or mutates canonical domain state.
- One owner/write path exists for each business decision.
- React does not own authorization, entitlement, publication, mastery, grading, completion, next-step, canonical identity, or deduplication.
- Workspace is a controlled preparation/exchange snapshot, not an uncontrolled second database.
- ContentAsset represents physical artifact identity/metadata; semantic records are created through canonical services.
- Printed page identity is distinct from physical PDF page position.
- Publication/readiness is independent from learning-path inclusion.
- Historical learner facts are not silently rewritten or deleted.
- Imports are validated, reconciled, deduplicated, idempotent, auditable, and safe to retry.
- Codex implementation is followed by an independent Audit_codex checkpoint.


## Documentation layering rule

Do not duplicate the same algorithm in architecture/ and Docs_v10/.

- architecture/ answers: what is authoritative, who owns the decision, what invariants cannot be violated, and the high-level flow.
- Docs_v10 answers: exact algorithm steps, package/JSON contracts, configuration details, edge cases, implementation procedures and current gaps.
- prisma/schema.prisma answers: what persistence actually supports today.
- source code and executable checks answer: what is currently implemented.
- historical sources answer: why a decision was considered or changed.

For content preparation specifically:
- architecture/02-content-workspace-ingestion.md owns the Python/Node/Workspace boundary, P1/P2/PB rule, two-part invariant, page-metadata principle and synchronization invariants.
- architecture/03-ai-evidence-provenance.md owns AI authority and evidence/provenance invariants.
- Docs_v10/12 owns the end-to-end operational flow.
- Docs_v10/13 owns the detailed storage, page-classification, two-part segmentation and import algorithms.
- Docs_v10/14 owns developer-facing execution guidance.

A change to a detailed procedure does not require copying it into architecture/. A change to an architectural invariant requires updating architecture/ and then scanning affected Docs_v10/code references.