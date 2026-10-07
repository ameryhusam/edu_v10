# Database migration plan — PHASE 2A

This document lists the proposed database migrations (DDL) to implement in PHASE 2A for the Question Bank product. No migration will be applied until you explicitly approve and assign owners. This plan intentionally avoids adding any snapshot/versioning fields per the approved decision.

Goals for PHASE 2A
- Provide persistence for imports (ImportJob, ImportItem) so the import pipeline can preview and approve questions before insertion.
- Provide a minimal AttemptAnswer storage (attempt_answers) to store student's submitted answers and evaluation metadata. This is required to implement grading and performance metrics without introducing snapshots.
- Optionally add an exam_assignments table if you choose to manage assignments explicitly (this can be deferred and stored as `exam.criteria` JSON instead).
- Add indexes that will be useful for duplicate detection and analytics.

NOTE: All changes below are proposed Prisma DDL / SQL statements to be executed as migrations. Do NOT apply them until review and approval.

Proposed additions (Prisma model snippets and SQL equivalents)

1) ImportJob
Prisma model (draft):

model ImportJob {
  id         String   @id @default(uuid()) @db.Uuid
  jobType    String   // JSON | EXCEL | GEMINI | MANUAL
  inputMeta  Json?
  status     String   @default("PENDING") // PENDING, VALIDATING, READY_FOR_REVIEW, IMPORTED, FAILED
  createdBy  String?  @db.Uuid
  createdAt  DateTime @default(now())
  completedAt DateTime?
  dedupeReport Json?

  items      ImportItem[]

  @@map("import_jobs")
}

2) ImportItem

model ImportItem {
  id                String   @id @default(uuid()) @db.Uuid
  jobId             String   @db.Uuid
  canonicalQuestion Json
  validationErrors  Json?
  fingerprint       String?
  action            String?  // SKIP | INSERT | UPDATE
  createdAt         DateTime @default(now())

  job ImportJob @relation(fields: [jobId], references: [id], onDelete: Cascade)

  @@map("import_items")
}

3) AttemptAnswer (or extend AttemptItem)
- Purpose: store student's serialized answer payload and evaluation metadata.
- We will create a standalone table to avoid changing existing Attempt/AttemptItem if the current schema lacks a suitable table.

model AttemptAnswer {
  id               String   @id @default(uuid()) @db.Uuid
  attemptId        String   @db.Uuid
  examItemId       String?  @db.Uuid
  questionId       String?  @db.Uuid
  answerPayload    Json
  isCorrect        Boolean?
  pointsAwarded    Int?
  evaluationMeta   Json?
  responseTimeMs   Int?
  createdAt        DateTime @default(now())

  // Add relation if Attempt model exists
  // attempt Attempt @relation(fields: [attemptId], references: [id], onDelete: Cascade)

  @@index([attemptId])
  @@map("attempt_answers")
}

4) Optional: ExamAssignment (defer if using exam.criteria JSON)

model ExamAssignment {
  id        String   @id @default(uuid()) @db.Uuid
  examId    String   @db.Uuid
  targetType String  // GRADE | STUDENT
  targetValue String // grade key or user id
  assignedAt DateTime @default(now())
  expiresAt DateTime?

  @@map("exam_assignments")
}

Indexes and performance
- Add index on questions.fingerprint: CREATE INDEX idx_questions_fingerprint ON questions (fingerprint);
- Ensure index on question.lessonId already exists (it does in current schema).
- Add index on import_items.fingerprint for fast duplicate lookup.

Backfill considerations
- No backfill required for import tables.
- AttemptAnswer will be empty initially; historical attempts remain as-is.

Rollback strategy
- Each migration must be reversible via DROP TABLE or ALTER TABLE DROP COLUMN in the reverse migration.

Owners and responsibilities
- DB Migration: infra-team (must run migrations in staging and verify backups)
- Backend endpoints wiring imports/attempt storage: backend-team
- Import preview UI and admin: frontend-team

Next steps after approval
1. Create Prisma migration files implementing the above models (if using Prisma) or SQL migrations if direct SQL is preferred.
2. Deploy migration to a staging database, run tests.
3. Implement backend endpoints to manage ImportJob and ImportItem records and to store AttemptAnswer rows when students submit answers.

