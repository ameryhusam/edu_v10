/*
  Warnings:

  - You are about to add the column `lessonId` to the `learning_resources` table without a default. This is not possible if the table is not empty, but the seed recreates content on every run and development databases hold no authored resources that are not re-seeded, so the column is genuinely nullable for every row that exists.

*/
-- AlterTable
ALTER TABLE "learning_resources" ADD COLUMN     "lessonId" UUID;

-- CreateIndex
CREATE INDEX "learning_resources_lessonId_idx" ON "learning_resources"("lessonId");

-- CreateIndex
CREATE INDEX "learning_resources_lessonId_kind_idx" ON "learning_resources"("lessonId", "kind");

-- AddForeignKey
ALTER TABLE "learning_resources" ADD CONSTRAINT "learning_resources_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
