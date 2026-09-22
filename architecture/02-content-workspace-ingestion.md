# Content Workspace, Preparation and Synchronization Contract

Status: ADOPTED
Last reviewed: 2026-09-22
Detailed implementation algorithms: Docs_v10/12-end-to-end-dataflows.md, Docs_v10/13-content-storage-page-classification-and-import-algorithms.md, Docs_v10/14-developer-content-ingestion-guide.md

## 1. Ownership and boundary

Python Content Preparation owns PDF inspection, OCR/text extraction, page rendering, TOC analysis, printed↔PDF mapping, unit/lesson segmentation, page classification proposals and generation of Workspace artifacts.

Node.js/TypeScript owns identity resolution, validation/reconciliation, canonical semantic writes, ContentAsset registration, import transactions, publication/readiness and synchronization with PostgreSQL/ContentStorage.

Workspace is a controlled preparation/exchange snapshot. It is not a second database and it is not live two-way replication.

## 2. Books containing two physical parts

A source book may contain two physical parts. The Content Engine must determine part membership from source evidence before creating the Workspace package.

Required evidence order:
1. explicit publisher/book metadata when available;
2. table-of-contents/index evidence;
3. printed-page ranges and section boundaries;
4. deterministic structural rules;
5. AI analysis of the TOC/first pages and surrounding evidence;
6. review when evidence conflicts or confidence is insufficient.

For a two-part book:

    source PDF
      ↓
    identify book + printed edition
      ↓
    analyze TOC/index and first ~15 pages (configurable)
      ↓
    detect Part 1 / Part 2 boundaries
      ↓
    segment units → lessons → printed page ranges
      ↓
    assign each segment to physicalPart
      ↓
    P1 for PART_1; P2 for PART_2; PB only for explicitly shared content
      ↓
    validate cross-part identity and page mappings

P1/P2/PB are physical Workspace coordinates. They must not be confused with term aliases T1/T01.

The AI may propose a boundary; it does not make an unreviewed canonical database decision. The manifest preserves the evidence and confidence used for the assignment.

## 3. Canonical Workspace layout

    Workspace/
      P1/G07/SCI/ED2026/
        cover/
        unit_01_<slug>/lesson_01_<slug>/
          lesson_manifest.json
          grounding_manifest.json
          page_classification.json
          lesson_full_text.txt
          text/
          pages/
          ai_pages/
          resource/
      P2/G07/SCI/ED2026/...
      PB/G07/SCI/ED2026/...

pages/ contains original page evidence. ai_pages/ contains derived AI representations and never replaces the original page asset.

Page filenames remain stable (page_025.png, page_025.txt). Classification is metadata, never filename identity.

## 4. Page identity and classification

Printed page number is the educational identity. PDF page index is the physical/rendering coordinate.

A lesson may contain lesson-only pages, question/exercise pages, assessment/review pages, mixed pages, and pages adjacent to structural boundaries.

The system MUST NOT decide learner-visible lesson pages, question extraction pages, or unit-assessment pages by renaming or changing image filenames.

page_classification.json is the authoritative per-page classification artifact after validation.

Minimum conceptual fields:
    printedPageNumber
    pdfPageIndex
    contentType
    branch
    lessonType
    questionRole
    questionBlocks[]
    lessonContent
    unitAssessment
    includeInLessonView
    includeInQuestionExtraction
    includeInUnitAssessment
    confidence
    evidence[]
    source

A page may be MIXED: lessonContent=true and questionBlocks non-empty. A page may be excluded from a specific use while remaining lesson evidence.

## 5. Configurable classification vocabulary

Classification labels and rules are configuration, not hard-coded assumptions scattered through Python, Node and UI.

The configuration defines, at minimum: TOC/index page detection; first-page analysis window (default 15 PDF pages, configurable); part-boundary signals; content types; subject/branch lesson types; question roles; unit-assessment roles; mixed-page handling; confidence/review thresholds; and precedence.

Precedence:
    explicit validated manifest
      > validated deterministic mapping
      > TOC/index evidence
      > subject/branch profile
      > AI proposal
      > unresolved/review

Configuration changes are versioned and recorded in preparation/provenance metadata.

## 6. Export algorithm

    request textbook/part
      ↓ resolve canonical identity
      ↓ resolve Workspace package
      ↓ validate manifest + references + checksums
      ↓ collect selected package tree
      ↓ deterministic ZIP rooted at canonical identity
      ↓ return package

Export never includes learner mastery, attempts, XP, assignments or other runtime learner state.

## 7. Import / Workspace synchronization algorithm

    receive
      ↓ fingerprint
      ↓ safe archive inspection/staging
      ↓ normalize aliases/coordinates
      ↓ validate package + identity + schema
      ↓ validate hierarchy + printed↔PDF mappings
      ↓ validate page classifications
      ↓ reconcile physical assets
      ↓ reconcile semantic units/lessons/pages/resources/questions
      ↓ dry-run
      ↓ human Apply when required
      ↓ canonical Node services
      ↓ transactional DB/ContentStorage application
      ↓ commit validated Workspace snapshot
      ↓ audit + readiness recomputation

Reconciliation uses stable semantic identity and checksums, not filenames alone.

For PARTIAL packages, omitted files never mean deletion. For FULL packages, deletion/replacement still requires an explicit supported change operation; absence alone is not a deletion command.

## 8. Synchronization invariants

- One canonical owner/write path per semantic decision.
- Python never writes PostgreSQL directly.
- Workspace files are evidence/assets, not implicit semantic rows.
- Same fingerprint → idempotent no-op.
- New artifact → create/reconcile through canonical service.
- Changed artifact → staged replacement and review according to policy.
- Identity conflict → stop; never silently overwrite.
- Failed validation/apply → existing canonical state and existing Workspace remain intact.
- Every operation has an operation key and source fingerprint sufficient for safe retry.
- Concurrent imports for the same textbook must be serialized before production-scale multi-worker mutation.

## 9. Detailed-document rule

This file records architecture, ownership, invariants and algorithm boundaries only.

Docs_v10/12 is the normative end-to-end workflow specification; Docs_v10/13 owns detailed storage/page-classification/import algorithms; Docs_v10/14 is the developer operating guide. Do not copy their step-by-step procedures into this file. If a detailed algorithm changes, update its Docs_v10 owner and update this file only when the architectural contract changes.