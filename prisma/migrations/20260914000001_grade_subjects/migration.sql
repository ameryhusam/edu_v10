-- The curriculum matrix: which subject is offered in which grade.
-- Catalogue data, not school data (see the model's doc comment).

-- CreateTable
CREATE TABLE "grade_subjects" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "gradeId" UUID NOT NULL,
    "subjectId" UUID NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "grade_subjects_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "grade_subjects_key_key" ON "grade_subjects"("key");

-- CreateIndex
CREATE UNIQUE INDEX "grade_subjects_gradeId_subjectId_key" ON "grade_subjects"("gradeId", "subjectId");

-- CreateIndex
CREATE INDEX "grade_subjects_gradeId_idx" ON "grade_subjects"("gradeId");

-- CreateIndex
CREATE INDEX "grade_subjects_subjectId_idx" ON "grade_subjects"("subjectId");

-- AddForeignKey
ALTER TABLE "grade_subjects" ADD CONSTRAINT "grade_subjects_gradeId_fkey" FOREIGN KEY ("gradeId") REFERENCES "grades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_subjects" ADD CONSTRAINT "grade_subjects_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
