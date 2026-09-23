# Edu7 Content Workspace — Canonical Storage Contract v2

## 1. Single source of persisted PDF content

The workspace is a **lesson-PDF store**, not a book-PDF or unit-PDF store.

- The uploaded source book is temporary input.
- The full source book PDF is never copied into `workspace/`.
- Unit PDFs are never persisted.
- The reconstructed full-book PDF is never persisted.
- Page images are not persisted as part of normal preparation.
- The only canonical PDF artifact persisted by preparation is **one PDF per lesson**.
- Unit/book PDFs are deterministic derived artifacts rebuilt on demand from ordered lesson PDFs.
- AI-generated explanatory images and teacher-added images are separate learning resources; they are not copies of textbook page images.

This prevents the same pages from being stored three times as book + unit + lesson PDFs.

## 2. Canonical layout

```text
edu_v10/
├── books_input/                         # temporary source inputs
│   └── <uploaded-book>.pdf
├── workspace/                           # persisted preparation state
│   └── P1/
│       └── G04/
│           └── SCI/                     # exact Prisma Subject.key
│               └── EDU-SCI-G04-P1-ED2026/
│                   ├── book-manifest.json
│                   ├── book-source-manifest.json
│                   ├── index.json
│                   ├── edu7-content-package.json
│                   ├── unit_01_<stable-slug>/
│                   │   ├── unit_manifest.json
│                   │   ├── lesson_01_<stable-slug>/
│                   │   │   ├── lesson_manifest.json
│                   │   │   ├── L_01_<stable-slug>.pdf
│                   │   │   ├── lesson_full_text.txt
│                   │   │   ├── text/
│                   │   │   │   └── page_001.txt
│                   │   │   ├── grounding_manifest.json
│                   │   │   ├── analysis/
│                   │   │   └── resources/
│                   │   └── ...
│                   └── ...
└── edu7-content-engine/                # code only
```

## 3. Upload/import lifecycle

### A. Book upload

1. User uploads a textbook PDF.
2. The upload is held in temporary input storage.
3. Python `edu7-content` opens the PDF.
4. The engine detects the PDF backend and determines whether rendering/OCR is required.
5. The engine extracts or detects the TOC.
6. Printed-page ↔ physical-PDF-page mapping is calculated.
7. Lesson ranges are finalized.
8. The engine slices each lesson into exactly one persisted lesson PDF.
9. The temporary source book can be removed after successful preparation/verification.

The workspace therefore contains the preparation result, not a duplicate copy of the uploaded book.

### B. Lesson AI analysis

For an AI request, the engine loads the **existing lesson PDF**.

- Text PDFs: extract text/grounding as needed.
- Scanned PDFs: render lesson pages temporarily in memory or temporary files.
- Do not persist textbook page images merely to support AI.
- Send the lesson PDF or the temporary rendered page set to the selected AI task.
- Save only AI draft/provenance outputs under `analysis/`.

The AI never writes directly to the canonical database.

## 4. Identity

Filesystem coordinates:

1. `P1` = physical textbook part coordinate.
2. `G04` = grade coordinate.
3. `SCI` = exact Prisma `Subject.key`.
4. `EDU-SCI-G04-P1-ED2026` = exact `Textbook.key`.
5. Lesson identity is carried by stable manifest fields and stable lesson slug/key, not by the source filename.

The source filename is never canonical identity.

## 5. Manifests

### `book-manifest.json`

Entry point for the workspace and reconstruction/import policy.

### `book-source-manifest.json`

Stores source provenance such as original filename, source checksum, page count and mapping metadata. It explicitly records that the source PDF is **not persisted**.

### `index.json`

Complete deterministic hierarchy and lesson ordering.

### `unit_manifest.json`

Logical unit metadata plus the ordered lesson references. It contains no unit PDF.

### `lesson_manifest.json`

Printed/physical page mapping, lesson PDF path, checksum, grounding references and lesson identity.

### `grounding_manifest.json`

Deterministic page/chunk evidence coordinates. It is not an AI-generated content store.

### `analysis/`

AI draft output, validation, provenance and review state.

## 6. Reconstruction

A unit or book is a **view/derived artifact**, not another canonical asset.

Examples:

```bash
# one lesson
PYTHONPATH=src python -m edu7_content.cli.main rebuild \
  workspace/P1/G04/SCI/ED2026 \
  --scope lesson --ref lesson-01-name --out /tmp/lesson.pdf

# complete unit
PYTHONPATH=src python -m edu7_content.cli.main rebuild \
  workspace/P1/G04/SCI/ED2026 \
  --scope unit --ref unit-01-name --out /tmp/unit.pdf

# complete prepared content book
PYTHONPATH=src python -m edu7_content.cli.main rebuild \
  workspace/P1/G04/SCI/ED2026 \
  --scope book --out /tmp/book-reconstructed.pdf
```

The reconstructed book represents the ordered lesson content. It is **not guaranteed to be byte-for-byte identical to the original upload**, because covers, front matter, unassigned pages and other non-lesson pages are intentionally not stored.

## 7. Resources

Persisted resources are semantic/pedagogical assets, not duplicated textbook pages:

- AI-generated explanation images
- teacher-added images
- audio/video/supporting files
- question/flashcard/concept drafts
- provenance and checksums

Textbook page images are temporary processing artifacts unless explicitly promoted to a pedagogical resource.

## 8. Import boundary

Python prepares and validates the package.

Node `ContentImportService` is the only canonical database writer.

```text
temporary uploaded book
        ↓
edu7-content Python preparation
        ↓
lesson-only workspace
        ↓
AI draft / validation / human approval
        ↓
Node ContentImportService
        ↓
Edu7 database
```

## 9. Gemini failover contract

The Gemini transport uses one unified failover layer.

Recommended configuration:

```env
GEMINI_MODELS=gemini-3.8-flash,gemini-3.7-flash,gemini-3.6-flash,gemini-3.5-flash
GEMINI_MODEL=gemini-3.8-flash
GEMINI_MAX_RETRIES=3
GEMINI_TIMEOUT_SECONDS=120
```

The transport:

- detects HTTP 429 and classifies rate pressure versus quota exhaustion where the response identifies it;
- performs bounded exponential backoff for short-lived rate pressure;
- advances to the next configured API key/model when the current combination is exhausted or unavailable;
- retries transient 408/5xx/network failures before failover;
- rotates credentials for authentication/access failures;
- never prints API keys.

Important: Gemini rate limits are project-level, not key-level. Multiple keys in the same project do **not** multiply the project's quota. Keys from separate projects can provide separate project quota, subject to Google's current account/project limits. Model-specific limits can also differ. Therefore failover is a resilience mechanism, not a promise that daily quota can always be bypassed. 

Current Google model IDs include Gemini 3.8 Flash, 3.7 Flash, 3.6 Flash and 3.5 Flash. Availability, limits and pricing must be treated as provider configuration rather than hard-coded assumptions.

## 10. Storage invariant

For every lesson page range:

```text
1 source lesson PDF
0 unit PDF copies
0 book PDF copies
0 permanent textbook page-image copies
N optional pedagogical resource files
```

This is the invariant the workspace/import implementation must preserve.


## 11. Page classification manifest

When automatic rules are insufficient, a lesson may contain `page_classification.json` at the lesson root. Branch/domain classification is owned by the lesson, while page-level `branch` remains per-page routing/classification metadata. There is no Unit-owned branch value; Unit remains structural.

Example:

    {
      "schemaVersion": "1",
      "lessonKey": "EDU-AR-G04-T1-ED2026-U01-L03",
      "pages": [
        {
          "pageNumber": 41,
          "contentType": "READING",
          "branch": "READING",
          "lessonType": "READING",
          "addToResources": true,
          "addToQuestionBank": false
        },
        {
          "pageNumber": 42,
          "contentType": "QUESTIONS",
          "branch": "GRAMMAR",
          "lessonType": "GRAMMAR",
          "questionRole": "EXERCISE",
          "addToQuestionBank": true
        }
      ]
    }

Null or missing values mean no addition/override. Empty strings are invalid. Classification is metadata only; page images remain named page_{number}.

## 12. Subject-aware classification

Generic detection of the word “lesson” is not authoritative. Arabic, Islamic Studies and Quran use branch-aware subject profiles. Arabic may require manual classification for reading, grammar, spelling, morphology and expression because one unit may contain several repeated lesson headings.

Classification precedence:

    explicit manifest
      > deterministic mapping
      > TOC evidence
      > subject profile
      > AI proposal
      > review

AI output is a proposal and must include confidence/evidence. It never directly writes the canonical database.

## 13. Identifier normalization

Before creating directories or resolving database identity, normalize:

    PART_1 → P1 filesystem physical-part coordinate
    PART_2 → P2 filesystem physical-part coordinate
    BOTH → PB filesystem physical-part coordinate
    G4/G04 → G04 canonical grade coordinate

The business textbook key continues to use T1, for example EDU-SCI-G04-P1-ED2026. Alias normalization must occur before uniqueness checks so G4 cannot create a second Grade row and T01 cannot create a second textbook identity.

## 14. Storage and synchronization boundary

Workspace is the preparation/exchange snapshot. PostgreSQL is the canonical semantic store. Binary files are held by ContentStorage/object storage.

The engine must not connect to PostgreSQL. Node ContentImportService owns canonical persistence.

The synchronization contract is:

    Workspace/package
      → validate
      → normalize
      → reconcile
      → dry-run
      → canonical import
      → DB + ContentStorage
      → Workspace commit

This is controlled synchronization, not an unrestricted filesystem watcher or live two-way mirror.


## 11A. Physical part detection contract

The Python preparation engine must resolve the physical textbook part before creating the canonical Workspace coordinate.

- Inspect the first five PDF pages as the cover/front-matter identity window.
- الفصل الدراسي الأول or الجزء الأول identifies PART_1.
- الفصل الدراسي الثاني or الجزء الثاني identifies PART_2.
- If both first/second semester or part terms appear in the early source/TOC, identify the source as BOTH.
- If neither term appears in the first five pages, record a bothIndicator. This is a signal for further investigation, not proof of BOTH and not permission to split automatically.
- A TOC that explicitly lists الفصل الدراسي الأول and الفصل الدراسي الثاني is strong combined-book evidence.
- The exact P1/P2 physical boundary must still be established from a later structural heading or equivalent validated evidence before the PDF is split.
- A TOC mention of الجزء الثاني alone must not be used as the physical split page.
- BOTH without a validated boundary remains review-only.
- Once a boundary is validated, the source is split temporarily into PART_1 and PART_2, and each part is prepared into its own P1/P2 Workspace. BOTH is never a canonical Textbook identity.

The detection result must preserve detectedPart, confidence, evidence pages, boundaryPdfPage when known, and a human-readable reason.
