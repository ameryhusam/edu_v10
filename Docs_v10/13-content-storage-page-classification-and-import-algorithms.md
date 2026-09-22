# Content Storage, Page Classification and Import Algorithms

**Status:** ADOPTED target implementation contract  
**Branch:** 03_build_algorithm_and_new_Docs

## 1. Storage decision

Edu7 does not store binary educational files inside PostgreSQL.

PostgreSQL stores semantic and operational data:
- Textbook, Unit, Lesson and Concept identity
- TextbookPage metadata and extracted page text
- ContentChunk grounded text
- ContentAsset metadata, storageKey, relativePath and SHA-256
- LearningResource semantic records
- Question semantic records
- provenance, checksums, workflow status and audit

ContentStorage/object storage/controlled local storage stores:
- PDFs
- page images
- audio/video
- question/resource source files
- other binary assets

ContentAsset therefore records the physical file identity and location; it does not contain the binary bytes.

TextbookPage.text and ContentChunk.text are persisted because they are canonical searchable/grounding text.

A Workspace path must never become a learner-facing URL. Learner asset delivery goes through the authorized content/asset API.

## 2. Synchronization policy

Workspace and the database are synchronized, but they are not equal sources of truth.

External/Python preparation
→ Workspace package
→ validation + identity normalization
→ reconciliation / dry-run
→ canonical services
→ PostgreSQL + ContentStorage

There is no unrestricted live two-way sync. A manual Workspace change becomes a new import/update operation. Database writes use canonical services.

For a changed physical file:
- same logical identity + same SHA → UNCHANGED
- same logical identity + new SHA → UPDATE/REVIEW
- new logical identity → CREATE
- identity ambiguity → CONFLICT

A successful operation records which Workspace artifact produced each canonical entity.

## 3. Alias normalization

Accepted aliases include:
- T1 ↔ T01
- T2 ↔ T02
- G4 ↔ G04
- G5 ↔ G05

Normalization occurs before Workspace path resolution, textbook-key generation, database lookup, ZIP validation and comparison.

Canonical persisted conventions remain:
- filesystem term coordinate: T01, T02, ...
- filesystem grade coordinate: G04, G05, ...
- textbook key term token: T1, T2, ...
- textbook key example: EDU-SCI-G04-T1-ED2026

T01 and T1 are therefore compatible but retain distinct meanings. G4 and G04 resolve to one canonical Grade row.

## 4. Page filenames

Page files must remain:
- pages/page_001.png
- pages/page_002.png
- text/page_001.txt
- text/page_002.txt

The importer must not rename page images to encode classification, branch, lesson type or question type.

Printed page number, PDF page number and classification are metadata.

## 5. Manual page classification manifest

A lesson may contain page_classification.json at its root:

    lesson_01_<slug>/
      lesson_manifest.json
      grounding_manifest.json
      page_classification.json
      pages/
        page_001.png

A unit-level manifest may provide defaults. Lesson-level values override unit defaults.

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
          "branch": "READING",
          "lessonType": "READING",
          "questionRole": "EXERCISE",
          "addToQuestionBank": true
        }
      ]
    }

For classification fields:
- explicit value → apply it
- null → do not add/override that dimension
- missing → do not add/override that dimension
- empty string → invalid input

Null or missing values never create an entity.

## 6. Classification dimensions

Page content may use configured values such as:
READING, EXPLANATION, QUESTIONS, EXERCISE, SELF_TEST, REVIEW, UNIT_ASSESSMENT, PRACTICE, MIXED, OTHER.

Subject branches are configuration/profile values.

Arabic examples:
READING, GRAMMAR, SPELLING, MORPHOLOGY, EXPRESSION.

Islamic Studies:
FAITH, FIQH, HADITH, SEERAH.

Quran:
MEMORIZATION, TAJWEED, RECITATION.

Lesson type is a separate dimension. It must not be inferred solely from the word "lesson".

## 7. Arabic and branch-aware materials

Generic detection may treat "الدرس الأول" as a lesson heading, but Arabic books frequently contain several branches inside one unit.

Therefore:
generic detector
→ subject profile
→ manual page/branch manifest when supplied
→ AI fallback when needed

A manual classification manifest takes precedence over generic lexical rules.

Arabic, Islamic Studies and Quran require branch-aware profiles before automatic segmentation is considered authoritative.

## 8. TOC precedence

TOC supplies evidence for:
- unit
- branch
- lesson
- printed page range
- ordering

TOC does not override an explicit manual manifest.

Decision precedence:
1. explicit manifest
2. validated deterministic mapping
3. TOC evidence
4. subject profile rules
5. AI proposal
6. unresolved/review

The final classification records its evidence source.

## 9. AI classification

AI is a classifier/proposal generator, never the canonical writer.

Prompt input should include:
- textbook identity
- subject and grade
- unit/lesson
- page number
- neighboring page metadata
- extracted page text
- page image when available
- TOC evidence
- subject profile
- allowed labels
- precedence rules
- exact output schema

Expected output includes pageNumber, contentType, branch, lessonType, questionRole, confidence, evidence and needsReview.

Suggested configurable thresholds:
- 0.90 or higher → auto-eligible
- 0.70–0.89 → review
- below 0.70 → unresolved/review

AI output is schema-validated, normalized, retained as provenance and never directly persisted as canonical content.

## 10. Question extraction from pages

A page classified as questions/exercises is a source page, not automatically a Question row.

Pipeline:
page
→ classify
→ segment question blocks
→ extract structured question
→ validate QuestionType
→ normalize
→ fingerprint
→ deduplicate
→ preview
→ canonical Question service

A page can be MIXED, so extraction operates on blocks/chunks.

TextbookQuestionRole describes the printed role of a textbook question. QuestionOrigin describes provenance. They are not interchangeable.

## 11. Question-file merge

Question files should declare:
- schemaVersion
- questionSetKey
- origin
- expectedCount
- mergeMode

Default merge mode: APPEND_DEDUP.

The importer:
1. parses all files
2. validates declared counts
3. normalizes Arabic/Unicode whitespace and structure
4. validates answers/options/type
5. derives semantic fingerprints
6. compares with existing questions
7. creates only new questions
8. reports unchanged duplicates
9. sends same-identity conflicts to review
10. records per-file provenance

expectedCount is a validation/reporting field. It must never cause silent truncation or invention.

## 12. Full and partial packages

The package manifest explicitly declares packageMode = FULL or PARTIAL.

Missing files in PARTIAL never mean deletion.

FULL also must not cause implicit deletion. Deletion/replacement requires an explicit change instruction and approved policy.

## 13. Import algorithm

Receive
→ safe archive inspection
→ isolated staging
→ alias normalization
→ textbook identity resolution
→ manifest/schema validation
→ hierarchy and page validation
→ classification validation
→ file fingerprinting
→ physical asset reconciliation
→ semantic resource/question reconciliation
→ dry-run
→ human Apply when required
→ canonical DB transaction + ContentStorage commit
→ Workspace snapshot commit
→ audit + operation result

A failure must not fall through to a partial silent commit.

## 14. Recovery and concurrency

Imports for the same canonical textbook must be serialized by a durable operation key/lock.

Minimum identity:
textbookKey + operationKey + inputChecksum

Replaying the same operation returns the previous safe result when applicable.

A crash must preserve enough operation/staging information to determine:
- whether DB commit happened
- whether Workspace commit happened
- what can be retried
- how to avoid duplicate questions/assets

## 15. Verification gates

A package is importable only when:
- identity resolves to one canonical textbook
- aliases normalize deterministically
- files pass safety checks
- page coordinates are valid
- classification labels are configured
- page images retain page_{number} naming
- semantic targets are valid
- checksums are recorded
- no blocking conflicts remain
- retry is idempotent


## 16. Schema gate: Textbook and academic-year coupling

The current Prisma schema must be treated as the persisted-data source of truth during implementation review. It currently defines Textbook.termId, and Term belongs to AcademicYear; Textbook also has a uniqueness constraint over subjectId + gradeId + termId + edition.

Therefore the target rule that a printed textbook identity is reusable across academic years is a **target decision, not a current schema fact**. TextbookAdoption already models school + academic year usage, but the existing Textbook.termId relation still couples the current row to a Term/AcademicYear.

Do not silently solve this by documentation only. Before implementing cross-year reuse, perform a dedicated schema/domain gate:

1. decide whether Textbook should remain term-scoped;
2. if not, define the smallest compatible schema change;
3. migrate existing keys/data without creating duplicate textbooks;
4. update canonical key resolution and import reconciliation;
5. verify TextbookAdoption remains the owner of school/year deployment.

Until that gate is approved, import code must resolve against the current schema rather than assuming the target separation already exists.


## 26. Two-part source book segmentation

A source PDF may contain Part 1 and Part 2. Preparation resolves the physical-part boundary before unit/lesson artifacts are committed to Workspace.

Evidence order:

    publisher metadata
      → TOC/index
      → printed-page ranges and structural boundaries
      → deterministic rules
      → AI proposal using the TOC/index and configurable first-page window
      → review on conflict/low confidence

The default first-page analysis window is approximately the first 15 PDF pages and is configurable.

Validated routing:

    PART_1 → Workspace/P1/<grade>/<subject>/<edition>
    PART_2 → Workspace/P2/<grade>/<subject>/<edition>
    BOTH/shared → Workspace/PB/<grade>/<subject>/<edition>

P1/P2/PB are physical-part coordinates only. T1/T01 remain term identity aliases and must never be used as substitutes for P1/P2.

The part assignment is recorded in the package/lesson manifest and provenance. AI may propose the boundary, but unresolved conflicts block automatic canonical import.

## 27. Page classification as routing metadata

Page filenames remain stable and represent page evidence only. A page can serve more than one downstream use.

The validated page_classification.json records, per page:

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

A MIXED page may have lessonContent=true and questionBlocks[]. The same page can therefore be referenced by the lesson view and question extraction without renaming or duplicating the image.

## 28. Configuration contract

The classification configuration is versioned and owns:

- TOC/index page detection;
- first-page analysis window;
- Part 1/Part 2 boundary signals;
- contentType vocabulary;
- subject/branch and lessonType vocabulary;
- questionRole vocabulary;
- unit-assessment roles;
- mixed-page policy;
- AI confidence and review thresholds;
- classification precedence.

Precedence is:

    explicit validated manifest
      > validated deterministic mapping
      > TOC/index evidence
      > subject/branch profile
      > AI proposal
      > unresolved/review

The active configuration version is included in preparation provenance. Exact storage location and schema are implementation details; do not add Prisma fields unless the schema/domain gate approves them.
