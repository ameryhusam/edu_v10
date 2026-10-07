# Import pipeline specification

The Question Bank uses a single canonical pipeline for all import sources.

Sources
- JSON
- Excel (.xlsx)
- Gemini-generated drafts
- Manual entry

Common pipeline
1. Source file upload or generation request
2. Create ImportJob record (PENDING, VALIDATING, READY_FOR_REVIEW, IMPORTED, FAILED)
3. Parse source into intermediate items
4. Normalize each item into canonical question form
5. Validate against type schema and canonical constraints
6. Run duplicate detection
7. Create ImportItem records with validation errors and recommended action (INSERT / UPDATE / SKIP)
8. Admin review and approve
9. Persist to Question / QuestionChoice / AnswerKey tables
10. Mark ImportJob imported and link question source metadata

Important rules
- No import source writes to DB directly.
- Gemini is a proposal engine only; it does not directly insert into the bank.
- All import items must pass the same validators as API/manual creation.

JSON import
- Top-level payload must include subject, grade, part, unit, lesson, questions[]
- Each question item includes type, text, points, difficulty, hint, explanation, answerData
- Each item must be validated with the same canonical schema as DB/API.

Excel import
- Require a canonical Excel template with fixed columns.
- Each row must include:
  - subject
  - grade
  - unit
  - lesson
  - questionType
  - text
  - points
  - difficulty
  - answerData JSON (or structured columns for each supported type)
- Parse rows, group matching/ordering entries using a stable `groupId` if needed.

Gemini import
- The model is used as a drafting generator.
- Gemini output becomes a candidate canonical draft only after validation.
- Store provider metadata:
  - provider = GEMINI
  - model
  - promptVersion
  - sourceRef
  - generatedAt
  - rawGeneratedPayload
- The admin must approve before DB insert.

Duplicate detection
- Compute a normalized fingerprint using:
  - question type
  - question text (normalized)
  - options (normalized)
  - answer structure
  - lessonId
- Deduplicate within the same import job and against existing bank entries.
- Flag duplicates for preview but allow admin override.

Import safety
- Import must be idempotent: running the same file twice should not create duplicates.
- Duplicate detection should be deterministic given the same normalized inputs.

