# End-to-End Data Flows, Algorithms and Operational Workflows

**Status:** ADOPTED target production contract.  
**Purpose:** define complete data movement, decision points, required fields, idempotency, audit/provenance and operational algorithms for major Edu7 workflows.  
**Implementation status:** tracked only in Docs_v10/11-current-state.md.

## 1. Global workflow rule

Every major workflow has one entry point, one canonical owner per business decision, deterministic identity, validation before persistence, idempotent retry, audit/provenance, observable status and a terminal outcome.

General pattern:

    Input
     ↓
    Normalize
     ↓
    Identify
     ↓
    Validate
     ↓
    Reconcile
     ↓
    Decide
     ↓
    Canonical write
     ↓
    Audit/read-model invalidation
     ↓
    Result

## 2. Operational envelope

Long-running or multi-step operations should carry an operational envelope, even if the final persistence model is introduced later.

| Field | Purpose |
|---|---|
| operationKey | stable business/idempotency key |
| requestId | request/correlation tracing |
| actorId | initiating identity |
| sourceType | UI/upload/library/AI/import/system |
| sourceKey | source identity |
| textbookKey | target textbook |
| lessonKey | target lesson |
| inputChecksum | supplied artifact/package fingerprint |
| schemaVersion | package/contract version |
| status | workflow state |
| startedAt/completedAt | timing |
| errorCode/errorDetails | safe diagnostics |
| dryRun | whether canonical writes were skipped |
| createdCount/updatedCount/unchangedCount/conflictCount/invalidCount | reconciliation summary |

These fields are operational metadata, not a reason to create duplicate domain entities.

## 3. Book intake: three paths

### A. New raw PDF

    PDF upload
     → checksum
     → identity/edition
     → TOC
     → printed↔PDF mapping
     → segmentation
     → page rendering
     → grounding
     → validation
     → READY_FOR_IMPORT

### B. Already-prepared workspace/package

    prepared package
     → package fingerprint
     → manifest/schema validation
     → identity validation
     → completeness validation
     → compare with existing textbook
     → REUSE_EXISTING / RECONCILE / CONFLICT / NEW

A prepared book must not be re-extracted merely because it was uploaded again.

### C. Same textbook, new material

Examples: new AI page explanations, corrected page image, additional question file, flashcards or physical resource.

    new material
     → fingerprint
     → target textbook/lesson resolution
     → asset/content reconciliation
     → append/register missing material
     → audit

A different printed edition is a new textbook identity, not an update to the previous printed book.

## 4. Textbook identity

Canonical identity:

    subject + grade + physicalPart + printedEdition
              ↓
          Textbook.key

Example:

    P1/G04/SCI/ED2026
              ↓
    EDU-SCI-G04-P1-ED2026

Academic year of school use is not part of printed-book identity.

## 5. Prepared-book readiness

The product must distinguish uploaded, prepared, importable and learner-ready.

| State | Meaning | Learner delivery |
|---|---|---|
| RECEIVED | input accepted/fingerprinted | No |
| IDENTIFYING | identity/edition unresolved | No |
| PREPARING | extraction/segmentation/rendering | No |
| PREPARED | package exists; validation pending | No |
| READY_FOR_IMPORT | all import gates pass | No |
| IMPORTING | canonical reconciliation/apply is running | No |
| READY | canonical content/assets satisfy delivery prerequisites | Yes, subject to entitlement |
| NEEDS_REVIEW | non-fatal or human-review issue | No |
| BLOCKED | required prerequisite failed | No |
| FAILED | processing failed | No |
| ARCHIVED | intentionally inactive | No |

Readiness is derived from gates, not a UI boolean.

READY_FOR_IMPORT requires:

    identity valid
    AND supported package schema
    AND manifest valid
    AND hierarchy valid
    AND printed↔PDF mapping valid where required
    AND required files/assets exist
    AND checksums validate
    AND no blocking errors

READY additionally requires successful canonical reconciliation and learner-delivery prerequisites.

## 6. Duplicate/prepared upload algorithm

1. Compute SHA-256 of the supplied input/package.
2. Read declared identity, if present.
3. Derive and validate printed edition.
4. Derive canonical textbook key.
5. Find an existing canonical textbook by key.
6. Compare source/package fingerprint where operational metadata exists.
7. Compare manifest/schema and structural fingerprint.
8. Classify:

| Classification | Action |
|---|---|
| SAME_PREPARED_INPUT | reuse existing prepared result |
| SAME_TEXTBOOK_NEW_ASSETS | reconcile only new assets |
| SAME_TEXTBOOK_CORRECTION | dry-run and explicit review/apply |
| NEW_PRINTED_EDITION | create sibling textbook identity |
| IDENTITY_CONFLICT | stop for review |
| INVALID_PACKAGE | reject with diagnostics |

Never silently overwrite a canonical textbook.

## 7. Workspace contract

    ED2026/
    ├── cover/cover.png
    ├── unit_01_<slug>/
    │   └── lesson_01_<slug>/
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

Printed page number is educational identity; PDF page number is physical location.

## 8. Workspace → canonical import

    Workspace
     ↓
    schema/package validation
     ↓
    textbook identity reconciliation
     ↓
    unit reconciliation
     ↓
    lesson reconciliation
     ↓
    page/chunk reconciliation
     ↓
    asset reconciliation
     ↓
    resource/question/concept reconciliation
     ↓
    dry-run
     ↓
    human Apply when required
     ↓
    canonical application services
     ↓
    transaction + audit

Each entity returns:

    entityKey
    action = CREATE | UPDATE | UNCHANGED | CONFLICT | INVALID | SKIP
    reason
    sourceChecksum
    existingChecksum
    warnings[]
    errors[]

Missing input rows never mean delete.

## 9. AI lesson/page workflow

    grounded lesson/page
     ↓
    selected page/chunk evidence
     ↓
    AI provider
     ↓
    structured proposal
     ↓
    schema validation
     ↓
    evidence validation
     ↓
    normalization/deduplication
     ↓
    PROPOSED / NEEDS_REVIEW
     ↓
    human review
     ↓
    canonical Apply

Required provenance:

- lessonKey;
- pageStart/pageEnd;
- source asset checksum(s);
- grounding/chunk keys;
- providerId;
- modelId;
- promptVersion;
- task/purpose;
- operationKey;
- createdAt.

AI never directly writes canonical learner state.

For AI page explanations, the original pages asset is never overwritten. Pair by:

    textbookKey + lessonKey + printedPageNumber

not PDF index or array position.

## 10. Question import/update/merge

Inputs:

- one or more files;
- target lesson when applicable;
- optional existing batch/file;
- source/origin;
- schema version;
- source checksum.

Algorithm:

1. Parse all files.
2. Normalize Arabic/Unicode and structure.
3. Validate QuestionType.
4. Derive candidate fingerprint.
5. Resolve lesson/concept references.
6. Compare with existing questions.
7. Classify UNCHANGED / CREATE / CONFLICT / INVALID.
8. Preview.
9. Human Apply where required.
10. Persist through canonical Question services.
11. Preserve historical questions.

Supported canonical forms include future word ordering, ascending/descending ordering and greater/less fill-in-the-blank.

## 11. Assessment → evidence → mastery → learning

    Question
     ↓
    Attempt
     ↓
    AttemptItem
     ↓
    canonical evaluator
     ↓
    MasteryEvidence
     ↓
    ConceptMastery
     ↓
    Learning decision
     ↓
    LearningDecisionLog

Required provenance includes learner, question/concept, observedAt, verdict, evaluatorVersion, evidence weight, mastery result, learning rule and rationale.

No downstream context rewrites an upstream decision.

## 12. Instruction workflow

    InstructionalPlan
     ↓
    validate scope/activity
     ↓
    publish
     ↓
    materialize LearnerObligation
     ↓
    learner performs activity
     ↓
    canonical completion policy
     ↓
    obligation status

Instruction records commitment, not achievement.

Core fields:

    planKey
    origin
    activityType
    activityKey
    school/grade/term scope
    targetLearnerId when direct
    availableAt
    dueAt
    status

## 13. Learner delivery

Direct content:

    request
     ↓
    authenticate
     ↓
    authorize
     ↓
    entitlement/readiness
     ↓
    content query
     ↓
    asset authorization
     ↓
    response/stream

Guided path additionally evaluates learning-path eligibility, prerequisites, mastery and progression policy.

React never reconstructs these predicates.

## 14. Asset lifecycle

    physical file
     ↓
    checksum + MIME + size
     ↓
    business relationship
     ↓
    asset metadata
     ↓
    storage
     ↓
    authorized stream

A changed physical file must not silently masquerade as the previous binary. Register a new asset/replacement according to the target versioning policy.

## 15. Retry/recovery

1. Locate operation by operationKey.
2. If terminal success, return existing result.
3. If resumable, continue from the durable checkpoint.
4. If input fingerprint differs, start a new operation.
5. Never duplicate canonical rows.
6. Preserve diagnostics.
7. Route conflicts to human review.

## 16. Production completion gate

A workflow is complete only when its input/output contract, deterministic identity, status/readiness, idempotency, authorization, canonical write owner, recovery behavior, audit/provenance and relevant tests are defined.

## 17. Reference patterns from mature LMS platforms

Open edX currently uses centralized Content Libraries for reusable authoring, publishing and synchronization across consuming courses. Edu7 should use the same architectural principle—author/prepare centrally and reconcile to canonical content—without copying its schema. citeturn0search0turn0search3

Canvas uses explicit module requirements/prerequisites and conditional Mastery Paths. Edu7 should preserve explicit progression gates while keeping Assessment, Evidence, Mastery and Learning as separate owners. citeturn1search24turn1search14

Moodle connects activity completion with competencies and evidence. Edu7 can use this pattern for future content-to-concept progression while retaining the stricter Assessment → Evidence → Mastery → Learning boundary. citeturn1search9turn1search10

These are comparative references, not copied schemas.

## 18. Non-goals

Do not create a second textbook registry, Python→PostgreSQL writer, AI→canonical DB writer, UI-owned readiness/deduplication, filename-based identity, silent same-key overwrite, or permanent source-PDF retention merely for convenience.


## 13. Workspace ↔ Content Administration Synchronization

The workspace is the physical preparation/reconciliation source for content artifacts; it is not a second canonical database. Synchronization is always performed through the Node canonical content services.

### 13.1 Canonical ownership

| Concern | Owner |
|---|---|
| PDF segmentation, printed-page mapping, page rendering | Python Content Engine |
| Workspace files/manifests/grounding | Workspace |
| Textbook/unit/lesson/concept/question/resource canonical records | Node canonical services + PostgreSQL |
| Physical binaries | ContentStorage + ContentAsset |
| Learner mastery/evidence/XP/completion | Their owning bounded contexts, never workspace |

Therefore a file appearing in workspace/.../resource/ is not by itself a QuestionBank row, LearningResource row, mastery fact, or learner assignment. The correct canonical importer decides what the file represents.

### 13.2 New educational resource intake

Every new resource follows:

upload -> fingerprint -> identify target -> validate -> stage -> compare -> reconcile -> canonical import -> publish/readiness

1. Calculate SHA-256 before accepting the file as a candidate.
2. Resolve the textbook/lesson target from the canonical textbook key and workspace coordinates.
3. Reject path traversal, unknown target, malformed manifest, checksum mismatch, unsupported file type, or identity conflict.
4. Place the physical artifact only under its canonical workspace location.
5. Compare (relativePath, sha256, size, metadata) with the existing workspace.
6. UNCHANGED: do not rewrite.
7. NEW: add the file and register a new ContentAsset through the canonical service.
8. UPDATED: stage the replacement, validate it, then replace the workspace file only after validation.
9. Never delete an existing file merely because it is absent from an incoming partial package.
10. For structural/question/resource records, run the corresponding canonical import service; a physical file is evidence/artifact, not permission to invent a database record.

### 13.3 Re-importing an already prepared book

A prepared book is identified by the derived Textbook.key and package fingerprint, not by the uploaded filename.

Decision algorithm:

ZIP
 ↓
safe inspection/extraction
 ↓
find exactly one package (if full-book package)
 ↓
derive/verify textbookKey
 ↓
resolve canonical workspace
 ↓
build staged candidate = existing workspace + incoming files
 ↓
SHA-256 compare
 ├─ all unchanged → NOOP / READY
 ├─ only new assets → ADD
 ├─ changed assets/records → UPDATE
 ├─ coordinates differ → NEW PRINTED EDITION
 └─ identity conflict → NEEDS_REVIEW / STOP
 ↓
dry-run canonical import against merged candidate
 ↓
apply canonical import
 ↓
commit staged workspace
 ↓
recompute readiness/inspection

The merge is append-preserving: files omitted from a partial ZIP are retained. A full export/import round trip may replace changed files, but it must never silently delete unrelated workspace material.

### 13.4 ZIP contract

A full workspace export is named <Textbook.key>.zip.

Archive root equals the textbook key:

EDU-SCI-G04-P1-ED2026.zip
└── EDU-SCI-G04-P1-ED2026/
    ├── index.json
    ├── edu7-content-package.json
    ├── cover/
    ├── unit_01_.../
    │   └── lesson_01_.../
    │       ├── L_01_....pdf
    │       ├── lesson_manifest.json
    │       ├── grounding_manifest.json
    │       ├── lesson_full_text.txt
    │       ├── text/
    │       ├── pages/
    │       ├── ai_pages/
    │       └── resource/
    └── ...

Import accepts a full package or a partial workspace ZIP. A partial ZIP must provide textbookKey externally when the package manifest is absent. It is merged into the existing workspace and never creates a different textbook by guessing.

### 13.5 ZIP safety gates

Archive processing must:
- reject absolute paths and .. traversal;
- reject duplicate member names;
- reject symbolic links;
- enforce archive entry count, per-file, total-uncompressed, and compression-ratio limits;
- extract only into an isolated staging directory;
- never extract directly into the canonical workspace;
- reject more than one workspace package in one archive;
- validate the package textbook identity against its coordinates;
- perform dry-run reconciliation before apply;
- retain the old workspace until the staged candidate has passed canonical validation;
- clean temporary files on success and failure.

These controls are intentional because compressed archives can exhaust disk space and can contain unsafe paths; the Python standard library itself warns against extracting untrusted archives without inspection. See the Python zipfile security guidance.

### 13.6 Export algorithm

request textbookKey
 ↓
resolve canonical workspace
 ↓
require valid index + package
 ↓
verify workspace references/checksums
 ↓
walk the complete workspace tree
 ↓
create deterministic ZIP rooted at textbookKey
 ↓
stream <textbookKey>.zip
 ↓
delete temporary archive

The export is a workspace export, not a PostgreSQL dump. It preserves physical preparation artifacts, manifests, grounding files, page images, AI-page images, and resource files that are actually present in the workspace. Derived learner state is never exported.

### 13.7 Important distinction: physical resource vs QuestionBank update

A ZIP can contain:
- a new page image → ContentAsset;
- an audio/video/resource file → ContentAsset;
- a question JSON/data package → canonical QuestionBank import;
- a flashcard package → canonical Flashcard import;
- concept/misconception data → canonical content import.

The physical file is first placed in the workspace and registered as provenance/asset. The semantic record is then reconciled by its canonical service. This prevents the filesystem from becoming an unauthorized second database.

### 13.8 Failure decisions

| Failure | Operational decision |
|---|---|
| Invalid ZIP | Reject; no workspace/DB changes |
| ZIP bomb/resource limit | Reject; no extraction into canonical storage |
| Multiple packages | Reject; require one textbook package |
| Missing textbook identity | Reject unless textbookKey is explicitly supplied for partial import |
| Identity mismatch | Stop; NEEDS_REVIEW |
| Same checksum | No-op |
| New file | Add |
| Changed file | Stage + validate + update |
| Missing incoming file | Retain existing file |
| Dry-run failure | Do not apply |
| Canonical import failure | Keep existing workspace; discard staged candidate |
| Final filesystem commit failure after canonical import | Mark operation retryable; canonical DB/storage remain authoritative and the workspace commit must be retried |
| Unsupported semantic file | Keep physical asset only if its placement is valid; do not invent a QuestionBank/LearningResource record |
| Concurrent import for same textbook | Must be serialized by textbook operation lock before production-scale concurrent use |

### 13.9 Remaining production gap

The current implementation now provides safe ZIP staging/import/export and workspace reconciliation, but a durable distributed operation lock/idempotency record is still required before multiple API workers can safely mutate the same textbook concurrently. The implementation must also add dedicated semantic import adapters for question/flashcard packages that are stored under resource/; merely discovering those files as ContentAsset is not equivalent to updating the QuestionBank.


## 20. Canonical storage and synchronization

The database is the canonical semantic store; Workspace is the controlled preparation/exchange snapshot. Binary bytes are kept in ContentStorage/object storage. PostgreSQL stores ContentAsset metadata and checksum plus TextbookPage/ContentChunk semantic text.

Synchronization is controlled reconciliation, not live bidirectional mirroring:

    Workspace → normalize → validate → reconcile → dry-run → canonical services → DB/ContentStorage → commit Workspace

A Workspace edit is therefore an import operation. A database update is not allowed to bypass canonical services. A raw Workspace path is never a learner-facing URL.

## 21. Page classification algorithm

For each page:

    page image/text
      ↓
    page coordinate validation
      ↓
    explicit page_classification.json lookup
      ↓ if absent
    deterministic rules
      ↓
    TOC evidence + neighboring pages
      ↓
    subject/branch profile
      ↓
    AI classifier when configured
      ↓
    confidence/review gate
      ↓
    classification result + provenance

Precedence is explicit manifest > deterministic mapping > TOC > subject profile > AI > review.

The page file remains page_{number}.png. Classification never changes the filename.

Null or missing classification fields mean no addition/override. Empty strings are invalid.

Arabic, Islamic Studies and Quran are branch-aware. In Arabic, “الدرس” is not sufficient to identify the semantic lesson type because a unit may contain reading, grammar, spelling, morphology and expression branches. Manual JSON classification is authoritative when supplied.

## 22. Page-to-question algorithm

    classified page
      ↓
    detect question blocks
      ↓
    extract structured question
      ↓
    validate QuestionType
      ↓
    normalize
      ↓
    semantic fingerprint
      ↓
    compare existing Question
      ↓
    CREATE / UNCHANGED / CONFLICT / INVALID
      ↓
    canonical Question service

A MIXED page is split into blocks; the whole page is never assumed to be one Question role.

## 23. Identifier normalization algorithm

Before any path or database lookup:

    input grade G4/G04 → canonical G04
    input part P1/PART_1 → canonical PART_1
    input part P2/PART_2 → canonical PART_2

Textbook identity never contains academic term. Canonical examples are EDU-SCI-G04-P1-ED2026 and EDU-SCI-G04-P2-ED2026.

Normalization must happen before uniqueness checks so an import using G4 cannot create a second Grade row or an alias spelling can create a second physical-part identity.

## 24. Page classification JSON contract

Recommended lesson-level file:

    lesson_01_<slug>/page_classification.json

Minimum structure:

    {
      "schemaVersion": "1",
      "lessonKey": "...",
      "textbookKey": "EDU-SCI-G07-P1-ED2026",
      "part": "P1",
      "pages": [
        {
          "pageNumber": 1,
          "contentType": "READING",
          "branch": "READING",
          "lessonType": "READING",
          "questionRole": null,
          "addToQuestionBank": false,
          "addToResources": true
        }
      ]
    }

Only configured labels are accepted. The file controls classification, not physical filenames.

## 25. Roadmap implementation gate

The algorithm roadmap is:

    storage boundary
      ↓
    alias normalization
      ↓
    TOC/mapping
      ↓
    subject-aware segmentation
      ↓
    manual page classification
      ↓
    AI classification fallback
      ↓
    semantic question/resource import
      ↓
    ZIP reconciliation
      ↓
    durable idempotency/locking
      ↓
    E2E verification

Detailed developer steps are maintained in Docs_v10/14-developer-content-ingestion-guide.md.
