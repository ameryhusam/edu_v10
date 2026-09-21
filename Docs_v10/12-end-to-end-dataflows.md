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

    subject + grade + term + printedEdition
              ↓
          Textbook.key

Example:

    T01/G04/SCI/ED2026
              ↓
    EDU-SCI-G04-T1-ED2026

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
