-- Phase G1: persistent physical content assets.
CREATE TYPE "ContentAssetType" AS ENUM (
  'TEXTBOOK_PDF', 'UNIT_PDF', 'LESSON_PDF', 'PAGE_IMAGE',
  'PAGE_TEXT', 'RESOURCE_FILE', 'AUDIO', 'VIDEO'
);

CREATE TABLE "content_assets" (
  "id" UUID NOT NULL,
  "key" TEXT NOT NULL,
  "assetType" "ContentAssetType" NOT NULL,
  "originalName" TEXT NOT NULL,
  "relativePath" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL,
  "publicUrl" TEXT,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "sha256" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "scope" TEXT NOT NULL,
  "pageStart" INTEGER,
  "pageEnd" INTEGER,
  "title" TEXT,
  "altText" TEXT,
  "caption" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "textbookId" UUID NOT NULL,
  "unitId" UUID,
  "lessonId" UUID,
  "conceptId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "content_assets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "content_assets_key_key" ON "content_assets"("key");
CREATE INDEX "content_assets_textbookId_scope_idx" ON "content_assets"("textbookId", "scope");
CREATE INDEX "content_assets_unitId_idx" ON "content_assets"("unitId");
CREATE INDEX "content_assets_lessonId_idx" ON "content_assets"("lessonId");
CREATE INDEX "content_assets_conceptId_idx" ON "content_assets"("conceptId");
CREATE INDEX "content_assets_sha256_idx" ON "content_assets"("sha256");

ALTER TABLE "learning_resources" ADD COLUMN "assetId" UUID;
CREATE INDEX "learning_resources_assetId_idx" ON "learning_resources"("assetId");

ALTER TABLE "content_assets" ADD CONSTRAINT "content_assets_textbookId_fkey"
  FOREIGN KEY ("textbookId") REFERENCES "textbooks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "content_assets" ADD CONSTRAINT "content_assets_unitId_fkey"
  FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "content_assets" ADD CONSTRAINT "content_assets_lessonId_fkey"
  FOREIGN KEY ("lessonId") REFERENCES "lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "content_assets" ADD CONSTRAINT "content_assets_conceptId_fkey"
  FOREIGN KEY ("conceptId") REFERENCES "concepts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "learning_resources" ADD CONSTRAINT "learning_resources_assetId_fkey"
  FOREIGN KEY ("assetId") REFERENCES "content_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
