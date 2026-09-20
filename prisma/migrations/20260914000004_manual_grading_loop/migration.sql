-- Manual grading loop for essay and other pending-review answers.
ALTER TABLE "attempt_items"
  ADD COLUMN "manualGradedByUserId" UUID,
  ADD COLUMN "manualGradedAt" TIMESTAMP(3),
  ADD COLUMN "manualFeedback" TEXT;

CREATE INDEX "attempt_items_verdict_answeredAt_idx" ON "attempt_items"("verdict", "answeredAt");
