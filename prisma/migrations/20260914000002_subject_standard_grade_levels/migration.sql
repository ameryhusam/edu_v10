-- The legacy provisioningPolicy.gradeLevels, as a first-class column with a
-- runtime consumer (the grade × subject matrix and its fill-from-policy).

-- AlterTable
ALTER TABLE "subjects" ADD COLUMN     "standardGradeLevels" INTEGER[];

-- CreateIndex
CREATE INDEX "subjects_standardGradeLevels_idx" ON "subjects"("standardGradeLevels");
