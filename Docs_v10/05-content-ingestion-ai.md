# Content Ingestion, Workspace, Grounding and AI

**Status:** ADOPTED; target production contract.  
**Implementation status:** tracked only in Docs_v10/11-current-state.md.

## 1. Purpose

The ingestion system turns an external educational source into a validated, traceable Edu7 content package and then canonical content.

It supports both a raw PDF and an already-prepared workspace/package. Re-uploading a prepared book must not force PDF extraction again.

## 2. Canonical pipeline

    External source
          ↓
    input fingerprint + identity
          ↓
    Python Content Engine
      PDF / TOC / mapping / segmentation / rendering
          ↓
    workspace + grounding
          ↓
    readiness validation
          ↓
    Node reconciliation
          ↓
    dry-run
          ↓
    human Apply when required
          ↓
    canonical application services
          ↓
    PostgreSQL / asset storage

AI enrichment is downstream of deterministic grounding.

## 3. Upload modes

### Mode A — raw PDF

    PDF
     → SHA-256
     → identity/edition
     → TOC
     → printed↔PDF mapping
     → segmentation
     → page rendering
     → grounding
     → package validation

### Mode B — prepared package/workspace

Use when textbook identity, lesson hierarchy, extracted pages, page text and manifests already exist.

    prepared package
     → fingerprint
     → manifest/schema validation
     → identity validation
     → completeness validation
     → compare/reconcile

No raw PDF is required when the package satisfies the import contract.

### Mode C — same textbook, new material

Examples: AI page explanations, corrected page image, question file, flashcards or physical resource.

These are additive/reconciliation operations and must not recreate the textbook.

## 4. Prepared-book readiness model

The product must distinguish uploaded, prepared, importable and learner-ready.

| State | Meaning | Learner delivery |
|---|---|---|
| RECEIVED | accepted and fingerprinted | No |
| IDENTIFYING | identity/edition unresolved | No |
| PREPARING | extraction/segmentation/rendering | No |
| PREPARED | package exists; validation pending | No |
| READY_FOR_IMPORT | all import gates pass | No |
| IMPORTING | canonical reconciliation/apply | No |
| READY | canonical content/assets satisfy delivery prerequisites | Yes, subject to entitlement |
| NEEDS_REVIEW | review issue blocks automatic readiness | No |
| BLOCKED | prerequisite failed | No |
| FAILED | processing failed | No |
| ARCHIVED | intentionally inactive | No |

State is derived from backend gates, never a React-only boolean.

## 5. Readiness gates

READY_FOR_IMPORT requires:

    identity valid
    AND supported package schema
    AND textbook manifest valid
    AND unit/lesson hierarchy valid
    AND printed↔PDF mapping valid where required
    AND required files/assets exist
    AND checksums validate
    AND no blocking errors

READY additionally requires successful canonical reconciliation and learner-delivery prerequisites.

## 6. Duplicate/prepared-upload behavior

Canonical workspace:

    workspace/T01/G04/SCI/ED2026/

Canonical textbook key:

    EDU-SCI-G04-T1-ED2026

Identity derives from subject + grade + term + printed edition.

For every upload:

1. compute SHA-256;
2. read/derive printed edition;
3. derive canonical textbook key;
4. compare with existing canonical textbook;
5. compare source/package fingerprint where available;
6. compare manifest/schema and structural fingerprint;
7. classify as SAME_PREPARED_INPUT, SAME_TEXTBOOK_NEW_ASSETS, SAME_TEXTBOOK_CORRECTION, NEW_PRINTED_EDITION, IDENTITY_CONFLICT or INVALID_PACKAGE;
8. reuse, reconcile, create sibling identity or stop for review.

Never silently overwrite a canonical textbook.

## 7. Workspace contract

    ED2026/
    ├── cover/cover.png
    ├── unit_01_<slug>/
    │   └── lesson_01_<slug>/
    │       ├── L_01_<slug>.pdf
    │       ├── lesson_manifest.json
    │       ├── grounding_manifest.json
    │       ├── lesson_full_text.txt
    │       ├── text/page_001.txt
    │       ├── pages/page_001.png
    │       ├── ai_pages/page_001.png
    │       └── resource/
    │           ├── flashcards/
    │           ├── questions/
    │           ├── concepts/
    │           ├── misconceptions/
    │           ├── audio/
    │           └── video/

Printed page number is educational identity; PDF index is physical location.

## 8. Persistence policy

Retain the textbook cover, lesson page images, optional AI explanation images and editable physical resources.

Do not permanently retain the full source book PDF merely because it was uploaded, duplicate unit PDFs, or permanent page images outside canonical lesson pages.

Temporary source input may be deleted after successful verification/reconciliation.

## 9. Required data contract

### Textbook

    textbookKey
    subjectKey
    gradeKey
    termKey
    printedEdition
    title
    issuer when applicable
    publicationYear when applicable
    sourceChecksum
    packageSchemaVersion

### Unit

    unitKey
    textbookKey
    slug
    title
    orderIndex

### Lesson

    lessonKey
    textbookKey
    unitKey
    slug
    title
    orderIndex
    printedPageStart
    printedPageEnd
    pdfPageStart
    pdfPageEnd

### Page

    lessonKey
    printedPageNumber
    pdfPageNumber
    textPath
    imagePath
    textChecksum
    imageChecksum

### Asset

    assetKey
    lessonKey/textbookKey
    assetType
    relativePath
    mimeType
    sizeBytes
    sha256
    pageStart/pageEnd
    originalName

### Grounding

    lessonKey
    chunkKey
    pageStart/pageEnd
    textChecksum
    sourceChecksum

### AI proposal

    operationKey
    lessonKey
    task
    providerId
    modelId
    promptVersion
    groundingRefs
    sourceChecksums
    status
    createdAt

## 10. Reconciliation

Each incoming entity is classified CREATE, UPDATE, UNCHANGED, CONFLICT, INVALID or SKIP.

Same identity + same canonical content → UNCHANGED.  
Compatible metadata/assets → UPDATE.  
Conflicting educational meaning → CONFLICT.  
Missing incoming rows never mean delete.  
Writes go through canonical application services.  
Retries are idempotent.

## 11. AI and page analysis

AI may analyze page text, page image, lesson grounding or a selected page range/chunk.

AI output remains a proposal.

For page explanations, original page assets are never overwritten. AI explanations are separate ai_pages assets paired by printed page number.

Long lessons must use explicit page-range/chunk processing rather than silently truncating evidence.

## 12. Question updates

Question ingestion supports multiple files, merge into an existing batch/file, deduplication, conflict reporting, append-only historical safety and explicit correction/replacement.

Canonical origin is distinct from ingestion method. A textbook question imported from a file remains TEXTBOOK; an AI-generated question remains AI.

Canonical QuestionType must support future educational forms including word ordering, ascending/descending ordering and greater/less fill-in-the-blank.

## 13. Python boundary

Python may read, prepare, segment, render, ground and produce proposal artifacts.

Python must never import Prisma, connect to PostgreSQL, publish content, write learner evidence/mastery/XP, enforce authorization or become a second canonical authoring service.

## 14. Canonical import boundary

    Python workspace
     ↓
    Node package reader
     ↓
    schema + relationship validation
     ↓
    identity reconciliation
     ↓
    duplicate/conflict detection
     ↓
    dry-run
     ↓
    human Apply where required
     ↓
    canonical services
     ↓
    transaction + audit

## 15. Failure/recovery

Every workflow exposes operationKey, source/package checksum, current status, blocking error code, resumable checkpoint where applicable and reconciliation counts.

Retrying the same input must not duplicate textbook, lesson, page, asset, question or resource records.

## 16. Reference patterns

Open edX Content Libraries separate centralized authoring/reuse from course consumption and support published content with controlled synchronization. Edu7 should use this separation without copying Open edX's schema. citeturn0search0turn0search3

Canvas uses explicit requirements/prerequisites and conditional Mastery Paths. This is a useful reference for explicit progression gates. citeturn1search24turn1search14

Moodle connects completion with competencies and evidence, a useful reference for future content-to-concept progression. citeturn1search9turn1search10

## 17. Non-goals

Do not create a second textbook database for prepared workspaces, direct Python→PostgreSQL writes, direct AI→canonical DB writes, UI-owned readiness, filename-based identity, silent same-key overwrite or permanent source-PDF retention for convenience.
