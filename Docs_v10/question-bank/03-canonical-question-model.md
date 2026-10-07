# Canonical Question Model (draft)

This is the single canonical JSON model every component uses (DB, API, Import, Android renderer, Grading, Review).

CanonicalQuestion (fields and descriptions)
- id: UUID (string) — database PK
- key: string|null — human/reference id
- subject: { id, key, name }
- grade: { id, key, name }
- unit: { id, key, title }
- lesson: { id, key, title }
- type: string enum — one of MCQ_SINGLE, MCQ_MULTI, TRUE_FALSE, NUMERIC, SHORT_TEXT, FILL_BLANK, MATCHING, ORDERING, ESSAY
- text: string — the question stem
- media: array of { id, url, mime } — optional media attachments
- points: integer
- difficulty: string enum (EASY|MEDIUM|HARD|UNKNOWN)
- hint?: string|null
- explanation?: string|null  // IMPORTANT: do NOT include in exam-in-progress responses
- answerData: object (type-specific canonical structure) — must validate against the JSON Schema for the given type
- metadata?: object (lang, timeEstimateSec, fingerprint, sourceRef)
- status: enum (DRAFT|READY|PUBLISHED|ARCHIVED)
- createdAt, updatedAt

answerData examples (brief)
- MCQ_SINGLE / MCQ_MULTI:
  {
    options: [{id: "A", text: "...", media?: []}],
    correctOptions: ["A"],
  }
- TRUE_FALSE:
  { value: true }
- NUMERIC:
  { min: 12.3, max: 12.7 }
- SHORT_TEXT:
  { accepted: ["answer 1", "answer two"], caseSensitive: false }
- FILL_BLANK:
  { blanks: [{index: 0, accepted: ["a", "b"]}], scoring: { perBlank: true } }
- MATCHING:
  { left: [{id:"L1", text:"..."}], right: [{id:"R1", text:"..."}], pairs: [{leftId:"L1", rightId:"R1"}] }
- ORDERING:
  { items: [{id:"I1", text:"..."}], correctOrder:["I3","I1","I2"] }
- ESSAY:
  { rubric: { manualReview: true, criteria: [...] } }

Validation
- Each answerData must validate against the JSON Schema for its `type`.
- The import pipeline and API must enforce validation server-side.

Snapshot rule
- When an exam is created, each ExamItem MUST store `question_snapshot` (CanonicalQuestion) so historical attempts and reviews remain stable if a question is edited later.

