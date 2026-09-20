-- Scoped classroom exams and safe learner-specific instructional plans.
ALTER TABLE "exams"
  ADD COLUMN "authorUserId" UUID,
  ADD COLUMN "schoolId" UUID,
  ADD COLUMN "visibility" "QuestionVisibility" NOT NULL DEFAULT 'GLOBAL';

CREATE INDEX "exams_schoolId_visibility_idx" ON "exams"("schoolId", "visibility");
CREATE INDEX "exams_authorUserId_visibility_idx" ON "exams"("authorUserId", "visibility");

ALTER TABLE "instructional_plans"
  ADD COLUMN "targetLearnerId" UUID;

ALTER TABLE "instructional_plans"
  ADD CONSTRAINT "instructional_plans_targetLearnerId_fkey"
  FOREIGN KEY ("targetLearnerId") REFERENCES "learner_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "instructional_plans_targetLearnerId_idx" ON "instructional_plans"("targetLearnerId");
