-- Canonical textbook identity: subject + grade + physical part + printed edition.
-- Academic term is deployment context and belongs to TextbookAdoption.
--
-- Safe migration:
-- 1. derive P1/P2 from the existing textbook term ordinal;
-- 2. copy that term into each adoption;
-- 3. rename legacy T1/T2 textbook keys to P1/P2;
-- 4. remove Textbook.termId;
-- 5. make the adoption term relation explicit.
--
-- Any textbook/adoption using a term ordinal other than 1 or 2 is rejected.
-- No data is silently assigned to a part or term.

CREATE TYPE "TextbookPart" AS ENUM ('PART_1', 'PART_2');

ALTER TABLE "textbooks" ADD COLUMN "part" "TextbookPart";

UPDATE "textbooks" AS t
SET "part" = CASE
  WHEN term."ordinal" = 1 THEN 'PART_1'::"TextbookPart"
  WHEN term."ordinal" = 2 THEN 'PART_2'::"TextbookPart"
  ELSE NULL
END
FROM "terms" AS term
WHERE term."id" = t."termId";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "textbooks" WHERE "part" IS NULL) THEN
    RAISE EXCEPTION 'Cannot migrate textbooks: every textbook must map to term ordinal 1 or 2 before physical-part identity is adopted';
  END IF;
END $$;

ALTER TABLE "textbooks" ALTER COLUMN "part" SET NOT NULL;

ALTER TABLE "textbook_adoptions" ADD COLUMN "termId" UUID;

UPDATE "textbook_adoptions" AS a
SET "termId" = term."id"
FROM "textbooks" AS t, "terms" AS term
WHERE t."id" = a."textbookId"
  AND term."academicYearId" = a."academicYearId"
  AND term."ordinal" = CASE WHEN t."part" = 'PART_1' THEN 1 ELSE 2 END;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "textbook_adoptions" WHERE "termId" IS NULL) THEN
    RAISE EXCEPTION 'Cannot migrate textbook adoptions: the required term for the textbook part does not exist in the adoption academic year';
  END IF;
END $$;

ALTER TABLE "textbook_adoptions" ALTER COLUMN "termId" SET NOT NULL;

ALTER TABLE "textbook_adoptions"
  ADD CONSTRAINT "textbook_adoptions_termId_fkey"
  FOREIGN KEY ("termId") REFERENCES "terms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "textbooks" DROP CONSTRAINT IF EXISTS "textbooks_termId_fkey";

DROP INDEX IF EXISTS "textbooks_subjectId_gradeId_termId_edition_key";

UPDATE "textbooks"
SET "key" = REPLACE(REPLACE("key", '-T1-', '-P1-'), '-T2-', '-P2-');

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "textbooks"
    WHERE "key" !~ '^EDU-[A-Z0-9]+-G[0-9]{2}-(P1|P2)-ED.+$'
  ) THEN
    RAISE EXCEPTION 'Cannot migrate textbooks: one or more keys are not convertible to the canonical P1/P2 identity';
  END IF;
END $$;

CREATE UNIQUE INDEX "textbooks_subjectId_gradeId_part_edition_key"
  ON "textbooks"("subjectId", "gradeId", "part", "edition");

ALTER TABLE "textbooks" DROP COLUMN "termId";

CREATE INDEX "textbook_adoptions_termId_idx" ON "textbook_adoptions"("termId");
