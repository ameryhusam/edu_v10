-- Teacher specialisation belongs to one or more catalogue subjects, not to a free-text field.
CREATE TABLE "educator_subject_specialties" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "educatorId" UUID NOT NULL,
  "subjectId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "educator_subject_specialties_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "educator_subject_specialties"
  ADD CONSTRAINT "educator_subject_specialties_educatorId_fkey"
  FOREIGN KEY ("educatorId") REFERENCES "educator_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "educator_subject_specialties"
  ADD CONSTRAINT "educator_subject_specialties_subjectId_fkey"
  FOREIGN KEY ("subjectId") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "educator_subject_specialties_educatorId_subjectId_key"
  ON "educator_subject_specialties"("educatorId", "subjectId");
CREATE INDEX "educator_subject_specialties_subjectId_idx"
  ON "educator_subject_specialties"("subjectId");
