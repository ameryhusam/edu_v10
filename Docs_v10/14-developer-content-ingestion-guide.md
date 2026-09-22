# Developer Guide — Preparing, Classifying and Importing Educational Content

**Status:** ADOPTED developer-facing guide  
**Audience:** content engineers, backend/frontend developers, content-preparation developers and reviewers.

## 1. Required identity before adding content

Collect:
- subjectKey, for example SCI
- gradeKey, for example G04
- part, one of `PART_1`, `PART_2`
- printedEdition, for example ED2026
- derived textbookKey, for example EDU-SCI-G04-P1-ED2026
- packageMode: FULL or PARTIAL
- source SHA-256
- academic-year adoption only when assigning the book to a school/year

Do not create a second database identity for aliases such as G4.

## 2. Workspace structure

    Workspace/P1/G04/SCI/ED2026/...
      cover/
      unit_01_<slug>/
        lesson_01_<slug>/
          lesson_manifest.json
          grounding_manifest.json
          page_classification.json
          text/
            page_001.txt
          pages/
            page_001.png
          resource/
            questions/
            flashcards/
            concepts/
            audio/
            video/

Page filenames remain page_{number}.

## 3. Automatic versus manual classification

Use deterministic/TOC rules when the structure is stable and unambiguous.

Use manual classification when branch-specific structure cannot be safely inferred.

Arabic is the main example because the word "الدرس" can appear repeatedly while the actual distinction is often reading, grammar, spelling, morphology or expression.

The validated page classification manifest overrides generic detection. Page filenames remain page_{number}; classification never requires renaming files.

## 4. Manual classification example

    {
      "schemaVersion": "1",
      "lessonKey": "EDU-AR-G04-P1-ED2026-U01-L03",
      "page": {
        "printedPageNumber": 41,
        "pdfPageIndex": 44,
        "contentType": "MIXED",
        "lessonContent": true,
        "questionBlocks": ["q1", "q2"],
        "unitAssessment": false,
        "includeInLessonView": true,
        "includeInQuestionExtraction": true,
        "includeInUnitAssessment": false
      },
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
          "branch": "READING",
          "lessonType": "READING",
          "questionRole": "EXERCISE",
          "addToQuestionBank": true
        }
      ]
    }

A null or missing classification property means no value is added or overridden.

## 5. Adding resources

A physical file under resource/ is first a ContentAsset.

It becomes a LearningResource only when its semantic contract identifies:
- resource kind
- title
- target textbook/unit/lesson/concept
- optional page range
- associated asset

A filename or folder name alone never creates a semantic resource.

## 6. Adding questions

Multiple files are supported:

    resource/questions/
      set_01.json
      set_02.json
      set_03.json

Each file should declare questionSetKey, expectedCount, origin and mergeMode when supported.

Default: APPEND_DEDUP.

Duplicate detection normalizes Arabic/Unicode, whitespace, options, answer representation and relevant question structure.

Same identity with different meaning goes to review instead of silent overwrite.

## 7. Ministerial exam PDF

Use:

PDF
→ source checksum
→ exam metadata
→ page classification
→ question block segmentation
→ extraction
→ validation
→ semantic deduplication
→ QuestionOrigin=MINISTERIAL
→ canonical Question service

The PDF is a source asset. Extracted questions are semantic database records with provenance.

Ministerial is provenance, not QuestionType.

## 8. ZIP import

Never extract directly over canonical Workspace.

ZIP
→ safe inspection
→ isolated staging
→ manifest validation
→ alias normalization
→ identity resolution
→ comparison
→ dry-run
→ Apply
→ Workspace commit + canonical persistence

Reject path traversal, duplicate entries, suspicious archive structures, excessive file counts/sizes and invalid manifests.

## 9. P1/PART_1 and G04/G4

Normalize before identity lookup.

P1 → PART_1, P2 → PART_2.
T01/T02 are academic-term coordinates only and never textbook identity components.
G4 → G04 canonical grade.

Do not create aliases that differ only in grade/part spelling. Canonical examples are:
EDU-SCI-G04-P1-ED2026
EDU-SCI-G04-P2-ED2026.

## 10. What PostgreSQL stores

Store semantic and operational data:
- Textbook / Unit / Lesson
- TextbookPage text and metadata
- ContentChunk text
- ContentAsset metadata, storageKey and checksum
- LearningResource metadata/body
- Question/AnswerKey/Choice/Concept links
- provenance, audit and workflow state

Do not store PDF/image/audio/video binary bytes in normal PostgreSQL rows.

Binary files use ContentStorage/object storage or the configured storage adapter.

## 11. Synchronization

Treat Workspace as a versioned exchange snapshot:

Workspace package → import → canonical state
canonical state + export → Workspace package

Do not implement an uncontrolled filesystem watcher.

A manual Workspace change is a new import operation with validation, reconciliation and audit.

## 12. Common errors

| Condition | Decision |
|---|---|
| Same file + same checksum | UNCHANGED |
| Same logical asset + changed checksum | UPDATE/REVIEW |
| New valid lesson | CREATE |
| G4 with existing G04 | same identity |
| T1 with existing T01 | same normalized term |
| Missing file in PARTIAL | keep existing |
| Invalid JSON | BLOCK |
| Duplicate question after normalization | UNCHANGED |
| Same question identity + different answer | CONFLICT/REVIEW |
| Ambiguous lesson target | REVIEW/BLOCK |
| Low-confidence AI classification | REVIEW |
| Unsupported question type | BLOCK or configured fallback |
| Failed DB transaction | do not publish Workspace commit |
| DB committed but Workspace commit failed | retain operation/staging for recovery |
| Same operation replayed | return prior safe result |

## 13. READY_FOR_IMPORT checklist

- textbook identity is canonical
- aliases are normalized
- unit/lesson hierarchy is valid
- page filenames were not renamed
- printed/PDF mapping is valid where required
- ambiguous pages have explicit classification
- question/resource targets are valid
- expected question counts were checked
- duplicate/conflict report was reviewed
- source checksums exist
- package mode is explicit
- missing files cannot imply deletion
- provenance is retained

## 14. Implementation boundary

Python prepares evidence and package artifacts.

Node/TypeScript canonical services own persistence.

Prisma schema remains the persisted-data source of truth.

React does not own classification, identity, deduplication, mastery, assessment or import decisions.


## 15. Two-part book preparation

When one source PDF contains Part 1 and Part 2, the Python engine must first resolve physical-part boundaries from publisher metadata, TOC/index, printed-page ranges and structural evidence, using AI as a proposal fallback. The first-page analysis window is configurable and defaults to approximately the first 15 PDF pages.

After validation:

    PART_1 → Workspace/P1/<grade>/<subject>/<edition>/
    PART_2 → Workspace/P2/<grade>/<subject>/<edition>/

A combined source is split before Workspace emission. PB is not a Workspace package.

The same printed page must not be assigned to both P1 and P2 unless the manifest explicitly declares shared content.

The exact segmentation algorithm is owned by Docs_v10/13; this guide only states the developer boundary.

## 16. Page routing without filename changes

A page image remains page_NNN.* regardless of whether it contains lesson material, exercises, unit assessment material, or a mixture.

page_classification.json is the routing contract. It can state independently whether a page:

- belongs to the lesson view;
- supplies question/exercise blocks;
- supplies unit-assessment content;
- contains mixed lesson and question content.

A page classified as MIXED is not duplicated or renamed to make it appear in multiple views. The same page evidence is referenced by multiple semantic consumers.

## 17. Configuration

The classification configuration must define the TOC/index detector, first-page analysis window, part-boundary signals, subject/branch labels, lesson types, question roles, unit-assessment roles, mixed-page policy and confidence/review thresholds.

Configuration is versioned. The active configuration version is part of preparation provenance.