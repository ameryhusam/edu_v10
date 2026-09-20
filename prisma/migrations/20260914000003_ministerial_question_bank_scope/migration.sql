-- Add ministerial provenance and scoped teacher-bank visibility.
ALTER TYPE "QuestionOrigin" ADD VALUE IF NOT EXISTS 'MINISTERIAL';

CREATE TYPE "QuestionVisibility" AS ENUM ('PRIVATE', 'SCHOOL', 'SUBMITTED_FOR_REVIEW', 'GLOBAL');

ALTER TABLE "questions"
  ADD COLUMN "authorUserId" UUID,
  ADD COLUMN "schoolId" UUID,
  ADD COLUMN "visibility" "QuestionVisibility" NOT NULL DEFAULT 'GLOBAL';

CREATE INDEX "questions_schoolId_visibility_idx" ON "questions"("schoolId", "visibility");
CREATE INDEX "questions_authorUserId_visibility_idx" ON "questions"("authorUserId", "visibility");
