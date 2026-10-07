# Database mapping and recommendations (PHASE 0/1)

Objective
- Reuse the existing Prisma schema (`prisma/schema.prisma`) as the source of truth.
- Identify which existing models are usable for Question Bank and which changes (if any) are required later.
- Do NOT apply migrations in PHASE 0/1. Produce a migration plan but keep schema changes gated until after sign-off.

Summary of existing models to reuse (no changes now)
- Subject (subject metadata) — reuse as-is.
- Grade (grade metadata) — reuse as-is.
- Unit (unit under a textbook) — reuse as-is.
- Lesson (lesson under a unit) — reuse as-is; Question already references Lesson.
- Question — existing model contains most required fields: id, key, type, text, lessonId, hint, explanation, points, status, origin, choices, answerKey. Reuse as canonical storage for questions.
- QuestionChoice — use for MCQ options.
- AnswerKey — use as authoritative answerData container (accepts arrays, json fields already present).
- Exam, ExamItem, Attempt — reuse as basis for exams and attempts; we will extend exam/attempt behavior at application layer.

Fields / entities that likely need to be added later (do not add in PHASE 0/1)
- exam_item.question_snapshot (jsonb) — store canonical question snapshot at exam creation time; required so historical attempts are not affected by later edits.
- attempt_answer (or AttemptItem) detailed fields to store answer_payload, question_snapshot, evaluation_meta (jsonb) — if existing AttemptItem lacks these, plan a migration.
- import_jobs and import_items — tables to support the import preview/approve pipeline (staging). Recommended: add `import_jobs` and `import_items` in PHASE 2 if approved.
- exam_assignments table (optional) — initial approach can use `Exam.metadata` (json) to store assignment scope; add a dedicated table later if admin UI requires listing/filtering.

Design decisions & rationale
- Reuse existing Question/AnswerKey structure for canonical storage to avoid a disruptive schema split. The current schema maps well to the requested CanonicalQuestion model.
- Use JSON fields (AnswerKey.expectedPairs / AnswerKey.rubric / question snapshot fields) to store type-specific data rather than many new typed columns.
- Keep `QuestionConcept` and `Concept` intact in the schema but do NOT use them for the Question Bank flow. Do not remove them; existing code depends on them.

Indexes and performance recommendations (for later migrations)
- Add index on questions.fingerprint (text) to accelerate duplicate detection.
- Index on question.lessonId, lessons.unitId.
- exam_attempts.user_id + submitted_at index.

Migration plan (draft — apply only after PHASE 1 approval)
1. Add `exam_items.question_snapshot` jsonb column (nullable) — backfill from current question rows when existing exams are created/updated.
2. Add `attempt_answers` table or extend `AttemptItem` to include `question_snapshot jsonb`, `answer_payload jsonb`, `evaluation_meta jsonb`.
3. Add `import_jobs` and `import_items` tables with FK to users.
4. Add index on questions.fingerprint.

PHASE 0/1 constraint: no migrations created or applied. This document lists the required changes for planning and review only.

