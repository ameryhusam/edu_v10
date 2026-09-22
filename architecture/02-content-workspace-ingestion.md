# Content Workspace and Ingestion Contract

Status: ADOPTED
Last reviewed: 2026-09-22
Detailed references: Docs_v10/12-end-to-end-dataflows.md, Docs_v10/13-content-storage-page-classification-and-import-algorithms.md, Docs_v10/14-developer-content-ingestion-guide.md

## Workspace identity
Canonical physical workspace mapping:

Workspace/
  P1/
    G07/
      SCI/
        ED2026/

P1, P2 and PB are physical textbook-part coordinates. PART_1, PART_2 and BOTH may be domain values. The mapping must remain explicit.

T1/T01 is a term alias concern, not a physical part coordinate.

## Book/lesson structure
ED2026/
  cover/
  unit_01_<slug>/
    lesson_01_<slug>/
      lesson_manifest.json
      grounding_manifest.json
      page_classification.json
      lesson_full_text.txt
      text/
      pages/
      ai_pages/
      resource/
        questions/
        flashcards/
        concepts/
        misconceptions/
        audio/
        video/

pages/ is original page evidence. ai_pages/ is an AI-derived representation linked to the same printed page. resource/ contains physical resource artifacts.

## Page identity
Printed page number is the educational identity. Physical PDF page index is a rendering/storage coordinate.

PDF page → printed-page mapping → TextbookPage → ContentChunk

Stable filenames include page_025.png and page_025.txt. Classification is metadata, not filename identity.

## Preparation and persistence
Source PDF → Python Content Preparation → Workspace → Node/TypeScript reconciliation → canonical services → database + ContentStorage.

Python may extract TOC, segment lessons, render pages, create grounding artifacts and produce AI proposals. It must not write directly to PostgreSQL.

## Synchronization
Workspace is a controlled exchange snapshot, not a live two-way database mirror. Manual changes become an import operation:
normalize → validate → fingerprint → identify → reconcile → dry-run → canonical apply → audit

Partial imports never imply deletion.

## Physical asset boundary
ContentAsset represents physical-file identity and metadata. Binary bytes live in ContentStorage/object storage or the configured storage adapter. Workspace paths are never learner-facing URLs.

## Import safety
Inspect ZIPs before extraction; reject traversal, absolute paths, duplicate entries and unsafe links; enforce archive limits; use isolated staging; validate identity/package mode; dry-run before apply; preserve existing workspace on failed operations; retain operation information for retry.

Physical question/flashcard files are assets/provenance until a canonical semantic importer creates or updates semantic records.
