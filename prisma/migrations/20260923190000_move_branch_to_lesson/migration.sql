-- Move subject/domain branch classification from Unit to Lesson.
-- Existing Unit.type=BRANCH rows are normalized to UNIT because branch is
-- semantic lesson classification, not structural unit type.

UPDATE "units"
SET "type" = 'UNIT'
WHERE "type" = 'BRANCH';

CREATE TYPE "ContentNodeType_new" AS ENUM ('UNIT', 'SECTION');

ALTER TABLE "units"
  ALTER COLUMN "type" DROP DEFAULT;

ALTER TABLE "units"
  ALTER COLUMN "type" TYPE "ContentNodeType_new"
  USING ("type"::text::"ContentNodeType_new");

ALTER TABLE "units"
  ALTER COLUMN "type" SET DEFAULT 'UNIT';

DROP TYPE "ContentNodeType";

ALTER TYPE "ContentNodeType_new" RENAME TO "ContentNodeType";

ALTER TABLE "lessons"
  ADD COLUMN "branch" TEXT;

CREATE INDEX "lessons_branch_idx" ON "lessons"("branch");
