# Phase 1 — Integrate the existing indexer2 Workspace into edu_v10

Status: implementation baseline and acceptance contract  
Base branch: `main` at `da136988965aa498c993d4eacee4f2c67f66b6b7`  
Working branch: `feat/indexer2-workspace-integration-phase1`

## 1. Non-negotiable compatibility decision

The existing `indexer2` workspace is the canonical physical workspace. `edu_v10` must consume it as-is.

Do not:
- change the directory names or relative paths produced by indexer2;
- change or reimplement PDF slicing;
- generate a second edu_v10-specific workspace tree;
- require a ZIP export/import round trip for normal lesson discovery;
- treat a workspace scan as permission to overwrite canonical content.

The indexer2 workspace contract documented in the repository is:

```text
workspace/
  <gradeKey>/
    <subjectKey>/
      [<componentKey>/]
        index.json
        book_manifest.json
        P01/
          units/
            unit_01/
              lesson_01.pdf
              lesson_02.pdf
        P02/
          units/
            unit_02/
              lesson_01.pdf
```

The documented workspace root is `CURRICULUM_WORKSPACE_DIR` (default `./workspace` in indexer2). Each lesson PDF path follows the existing pattern `P01/units/unit_01/lesson_01.pdf` or `P02/units/unit_02/lesson_01.pdf`. The exact unit-to-part assignment comes from `partKey` on each unit, not from guessing based on filenames.

Canonical index file: `index.json` (indexer2 documents `edu.book_index.v2`). The companion `book_manifest.json` records source PDF identity and sliced lesson paths/ranges. A reader must validate both files and the physical lesson PDFs; it must not rewrite them.

## 2. What Phase 1 delivers

1. Configure edu_v10 to read the existing indexer2 workspace root through an explicit environment setting, without changing the existing `WORKSPACE_ROOT` behavior used by edu_v10's legacy workspace importer.
2. Discover grade/subject/component workspaces and parse their canonical `index.json` and `book_manifest.json`.
3. Resolve each unit and lesson to its existing PDF slice using the explicit path in the index/manifest first, then the documented canonical path as a constrained fallback.
4. Verify path containment, file existence, PDF MIME/extension, byte size, SHA-256, and consistency between index and manifest. Never accept a path escaping the configured workspace root.
5. Present a dry-run preview that identifies the target textbook, source workspace, units/lessons, page ranges, existing database matches, missing files, and conflicts.
6. Let an authorized content administrator select an existing edu_v10 textbook (the target material) and synchronize only the selected physical part's units/lessons into that textbook.
7. Use the existing content write path (`ContentImportService` → `ContentAuthoringService`) for Unit/Lesson records and the existing `ContentAssetService` for lesson PDF assets. Do not write Prisma rows from the filesystem reader.
8. Make synchronization idempotent: repeat sync of an unchanged source does not create duplicate units, lessons, or assets.
9. Expose lesson PDF assets through the existing content asset streaming API so the current web/student lesson surfaces can display the lesson source without a new file-serving mechanism.

Phase 1 does not alter indexer2, PDF slicing, Prisma schema, or the existing edu_v10 workspace import/export flow.

## 3. Important identity rule: BOTH is a workspace property, not an edu_v10 textbook part

The indexer2 index may describe a merged source with `partKey: BOTH`, while individual units carry `partKey: P01` or `P02`. edu_v10's `Textbook.part` currently supports only `PART_1` and `PART_2`.

Therefore:
- never create a `BOTH` textbook in edu_v10;
- synchronization targets one existing textbook at a time;
- target `PART_1` imports only units assigned `P01`;
- target `PART_2` imports only units assigned `P02`;
- a merged workspace can be synchronized twice, once per target textbook;
- if a unit has no valid part assignment, stop and report it; do not infer one;
- if grade, subject, edition, or part does not match the selected textbook, reject the sync.

This preserves the current database model and avoids a migration.

## 4. Mapping into the existing edu_v10 content model

| indexer2 source | edu_v10 target | Rule |
|---|---|---|
| `gradeKey` | `Grade.key` | exact canonical key match |
| `subjectKey` | `Subject.key` | exact canonical key match |
| `partKey` / unit `partKey` | `Textbook.part` | P01 → PART_1; P02 → PART_2 |
| edition metadata | `Textbook.edition` | must resolve to selected textbook; no invented edition |
| unit number/title | `Unit` | stable slug derived deterministically from source unit identity |
| lesson number/title | `Lesson` | stable slug derived deterministically from source lesson identity |
| physical PDF page range | `Lesson.startPage/endPage` | use already-calculated PDF range; do not apply offset a second time |
| `Pxx/units/unit_xx/lesson_xx.pdf` | `ContentAsset(LESSON_PDF)` | copy/register through ContentAssetService; original workspace remains unchanged |
| PDF bytes | `ContentStorage` | calculate and persist SHA-256 from actual bytes |

Do not create concepts, questions, mastery evidence, or student records from lesson-index metadata. Those are separate content-generation or assessment tasks.

## 5. Proposed application boundary

Introduce a read-only filesystem adapter and a synchronization use case:

```text
Indexer2WorkspaceReader (filesystem adapter)
    ├── discover workspaces
    ├── read index.json
    ├── read book_manifest.json
    ├── resolve lesson PDF safely
    ├── verify hashes and ranges
    └── return a normalized WorkspaceSnapshot
                 |
                 v
Indexer2WorkspaceSyncService (application)
    ├── resolve selected Textbook in edu_v10
    ├── filter units by P01/P02
    ├── build a ContentPackage
    ├── dry-run / conflict report
    ├── ContentImportService
    └── ContentAssetService
                 |
                 v
          PostgreSQL + ContentStorage
```

The reader must not depend on Prisma. The application service must not manipulate filesystem paths except through the reader port. All structure writes must continue through the existing content authoring/import services.

## 6. API surface

Suggested endpoints under `/api/v1/content`:

- `GET /indexer2-workspaces` — list discovered workspaces and their metadata/health.
- `GET /indexer2-workspaces/:workspaceKey` — inspect units, lessons, page ranges, PDF availability, and validation warnings.
- `POST /indexer2-workspaces/:workspaceKey/sync-preview` — body contains `textbookKey`; returns a dry-run plan and conflicts only.
- `POST /indexer2-workspaces/:workspaceKey/sync` — body contains `textbookKey` and explicit confirmation; imports the selected P01/P02 structure and registers lesson PDF assets.

All endpoints require authentication. Discovery/preview may be available to staff readers; sync requires content-authoring/admin authorization. The sync endpoint must reject any request whose preview fingerprint changed since preview.

Do not expose arbitrary absolute filesystem paths to the client. Return opaque workspace keys and safe relative paths only.

## 7. Lesson viewing

The database remains the catalogue and authorization source:
- student selects grade/subject/textbook;
- API returns the canonical Unit/Lesson tree from PostgreSQL;
- each lesson response includes the registered `LESSON_PDF` asset reference when available;
- the client opens the PDF through the existing asset streaming endpoint, not by reading the workspace path directly;
- later generated explanation/summary/interactive content is returned as separate approved content records, not mixed into the PDF asset.

This gives the Android client the same stable API contract as the web client and keeps filesystem access server-side.

## 8. Gemini and Task Specification integration (next workstream after lesson discovery)

Do not copy Gemini calls into controllers or frontend code. Reuse the existing `GeminiContentEngine` / `ContentEnrichmentService` boundary and make Task Specifications the single source of prompt and response-schema versions.

For each generation request:
1. Resolve the selected canonical textbook/unit/lesson in edu_v10.
2. Resolve the lesson PDF asset and verify its SHA-256.
3. Load the server-side Task Specification: taskType, promptVersion, responseSchema, schemaVersion, outputContract, examples, validationRules, reviewPolicy.
4. Build the prompt from the task template and trusted lesson context. Never accept a client-supplied schema as authoritative.
5. Send the lesson PDF (or approved source extracts) and prompt to Gemini with JSON response mode/schema where supported.
6. Apply bounded retry/fallback for transient provider errors only; record provider/model without recording secrets.
7. Parse and validate the JSON locally against the same response schema, then run task-specific semantic/source checks.
8. Store the raw generation attempt as a non-published artifact with input hash, output hash, task/prompt/schema versions, provider/model, validation result, and timestamps.
9. Return the candidate to the review UI. Only an explicit save/review action may persist it as student-facing content.

Important schema finding: current edu_v10 Prisma schema has `ContentAsset`, `ContentChunk`, and `AiInteraction`, but does not currently define `LessonContent`, `LessonContentVersion`, `ContentGenerationRun`, or `ContentSourceReference`. Do not pretend these tables already exist. Phase 1 lesson structure/PDF sync needs no migration; durable versioned AI content will need a separate minimal schema decision after lesson discovery is proven. Do not overload `ContentChunk` or `AiInteraction` to impersonate versioned instructional content.

## 9. Python and slicing

Phase 1 does not invoke Python and does not run a slicer. It only consumes the already-generated indexer2 artifacts and lesson PDFs.

Keep the existing edu_v10 Python archive dependency unchanged for now. Removing it is unrelated to discovering and linking existing lesson PDFs and must be handled as a separate compatibility change.

## 10. Acceptance tests

- discovers a valid workspace at grade/subject/component depth;
- accepts indexer2 `index.json` and `book_manifest.json` without rewriting either;
- discovers P01 and P02 lesson PDFs at their exact existing paths;
- handles a BOTH source by filtering units to the selected PART_1/PART_2 textbook;
- rejects a unit with missing/unknown part assignment;
- rejects grade/subject/edition/part mismatch;
- rejects traversal paths and symlink escapes;
- reports missing lesson PDF and index/manifest disagreement;
- verifies PDF byte hash and records the computed hash;
- dry-run makes no database or storage writes;
- repeated sync is idempotent;
- lesson asset can be streamed through the existing API;
- student API does not expose unapproved generated content;
- no Prisma migration is introduced by Phase 1;
- existing edu_v10 workspace importer/archive tests remain unchanged and pass.

## 11. Explicitly out of scope for Phase 1

- changing indexer2's folder names or manifests;
- changing PDF slicing or page-range calculation;
- migrating indexer2 Prisma tables;
- porting all prompts at once;
- generating AI lessons/questions automatically during workspace sync;
- HTML execution in a WebView;
- changing learner assessment/mastery models;
- deleting the Python content engine or archive module.


## 12. Repository baseline audit (2026-11-25)

Open pull requests found in edu_v10:

| PR | Branch | Scope | Current finding | Decision |
|---|---|---|---|---|
| #8 | `feat/content-structure-engine-v2` | Python educational structure extraction, TOC/page mapping, semantic blocks, question grouping, lesson-boundary evidence | Draft; 25 commits; 12 files; no check runs/statuses reported; mergeable=false | Do not use as Phase 1 base. It changes the extraction engine, while this phase consumes the already-built workspace and does not change slicing/extraction. |
| #9 | `feature/ai-provider-key-rotation` | Gemini/OpenAI multi-key and model fallback in tutoring AI providers | Draft; 15 commits; 9 files; latest `verify` check failed in backend type/architecture/tests step; later frontend/build/Python steps were skipped; mergeable=false | Relevant provider work, but do not build directly on this branch or cherry-pick blindly. Rebase/fix CI first, then assess whether the provider logic should be shared with the content engine. |

Repository branches inspected:
- `main`: `da136988965aa498c993d4eacee4f2c67f66b6b7`, 2026-10-14 — newest branch head found.
- `feature/ai-provider-key-rotation`: 2026-10-09.
- `feat/content-structure-engine-v2`: 2026-09-23.
- `dev`: 2026-09-22.
- `03_build_algorithm_and_new_Docs`: 2026-09-22.
- `feature/content-ai-foundation-g1`: 2026-09-21.
- `feature/content-ai-g2-smart-toc-pypdf-fallback`: 2026-09-20.
- `fix/python-both-part-detection`: 2026-09-22.

The GitHub repository's default branch is `main`; its head is newer than the heads of the open PR branches. Therefore the Phase 1 branch is based on `main`, not on an older open PR branch.

## 13. Existing Gemini API implementation audit

There are two distinct Gemini integrations in edu_v10 and they must not be conflated:

1. `src/infrastructure/ai/gemini.provider.ts` implements the general `AiProvider` used by tutoring. PR #9 changes this adapter.
2. `src/infrastructure/content/gemini-content-engine.ts` implements content ingestion/generation and is injected into `ContentEnrichmentService`. It owns a separate `GoogleGenAI` client and its own `generateWithFallback` method.

The current content engine:
- sends PDF bytes as base64 `inlineData` with `mimeType: application/pdf`;
- embeds task prompts directly in TypeScript methods;
- uses `responseMimeType: application/json` for structured outputs in the inspected methods;
- currently does not attach the task's JSON Schema as `responseJsonSchema` in those content-engine calls;
- has its own retry/fallback behavior (three retries with configured delays and a hard-coded secondary model choice).

Consequently PR #9 does not by itself complete the content-generation integration requested here. The correct adaptation is to retain the GoogleGenAI transport boundary and multimodal PDF capability, but move prompt text and response schemas into the server-side Task Specification registry. The content engine should receive a resolved task specification and validated input, pass the specification's response schema to Gemini where supported, and always validate the returned JSON locally. Retry/model/key policy should be one shared, tested policy rather than two independent fallback implementations.

The API key and model remain server-only. Neither the prompt registry nor the browser receives credentials.
