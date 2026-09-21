# Developer Guide — Preparing, Classifying and Importing Educational Content

**Status:** ADOPTED developer-facing guide  
**Audience:** content engineers, backend/frontend developers, content-preparation developers and reviewers.

## 1. Required identity before adding content

Collect:
- subjectKey, for example SCI
- gradeKey, for example G04
- termKey, for example T01
- printedEdition, for example ED2026
- derived textbookKey, for example EDU-SCI-G04-T1-ED2026
- packageMode: FULL or PARTIAL
- source SHA-256
- academic-year adoption only when assigning the book to a school/year

Do not create a second database identity for aliases such as G4.

## 2. Workspace structure

    workspace/T01/G04/SCI/ED2026/
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

The manual page classification manifest overrides generic detection.

## 4. Manual classification example

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

## 9. T01/T1 and G04/G4

Normalize before identity lookup.

T1 → T01 filesystem term coordinate
T01 → T01 filesystem term coordinate
G4 → G04 canonical grade
G04 → G04 canonical grade

Do not create:
EDU-SCI-G4-T1-ED2026
EDU-SCI-G04-T01-ED2026

when the canonical identity is:
EDU-SCI-G04-T1-ED2026

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
