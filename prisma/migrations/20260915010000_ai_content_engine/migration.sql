-- AI Content Engine (plan §6): closes the GENERATE_QUESTIONS gap and adds a
-- read-only content review report — no AiQuestionDraft, no
-- AiMisconceptionSuggestion, no parallel question-workflow table. Question
-- generation reuses Question.origin = 'AI' (already forces status = DRAFT,
-- see item-bank.service.test.ts); this migration only adds what that reuse
-- and the review report actually need: a new AiTask value, a purpose column
-- to keep authoring AI usage off the learner tutoring quota, and one new
-- table for review reports.

-- AlterEnum: add REVIEW_CONTENT to the existing AiTask enum used by
-- ai_interactions.task.
ALTER TYPE "AiTask" ADD VALUE 'REVIEW_CONTENT';

-- CreateEnum
CREATE TYPE "AiPurpose" AS ENUM ('TUTORING', 'CONTENT_GENERATION', 'CONTENT_REVIEW');

-- AlterTable: every interaction logged before this column existed was a
-- tutoring interaction — the default preserves that history truthfully
-- without a backfill script.
ALTER TABLE "ai_interactions" ADD COLUMN "purpose" "AiPurpose" NOT NULL DEFAULT 'TUTORING';

CREATE INDEX "ai_interactions_purpose_userId_createdAt_idx"
  ON "ai_interactions" ("purpose", "userId", "createdAt");

-- CreateEnum
CREATE TYPE "ReviewReportStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'DISMISSED');

-- CreateTable
CREATE TABLE "content_review_reports" (
    "id"          UUID NOT NULL,
    "key"         TEXT NOT NULL,
    "textbookKey" TEXT,
    "lessonKey"   TEXT,
    "questionKey" TEXT,
    "issues"      JSONB NOT NULL,
    "status"      "ReviewReportStatus" NOT NULL DEFAULT 'OPEN',
    "providerId"  TEXT NOT NULL,
    "requestedBy" UUID,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_review_reports_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "content_review_reports_key_key" ON "content_review_reports" ("key");
CREATE INDEX "content_review_reports_status_createdAt_idx" ON "content_review_reports" ("status", "createdAt");
CREATE INDEX "content_review_reports_textbookKey_idx" ON "content_review_reports" ("textbookKey");
CREATE INDEX "content_review_reports_lessonKey_idx" ON "content_review_reports" ("lessonKey");
CREATE INDEX "content_review_reports_questionKey_idx" ON "content_review_reports" ("questionKey");

ALTER TABLE "content_review_reports"
  ADD CONSTRAINT "content_review_reports_requestedBy_fkey"
  FOREIGN KEY ("requestedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
