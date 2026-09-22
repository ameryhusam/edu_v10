# Textbook Identity Audit — 2026-09-22

**Status:** AUDITED — no Prisma change required.

## Scope

This audit verifies the locked P1/P2 contract after the combined-PDF Workspace preparation work:

- `prisma/schema.prisma`
- `Textbook` and `TextbookAdoption`
- canonical textbook creation
- content package import
- Workspace archive import/reconciliation
- adoption resolution
- textbook key generation

## Adopted identity

`Textbook = Subject + Grade + PhysicalPart + PrintedEdition`

Canonical physical parts are only `PART_1` and `PART_2`.

`PART_1` maps to `P1`; `PART_2` maps to `P2`.

Academic year and term are deployment facts on `TextbookAdoption`.

`BOTH` is source-input mode only. `PB` is not a canonical Workspace or persistence identity.

## Findings

### 1. Prisma schema — PASS

`Textbook` contains `part TextbookPart`, `edition`, `gradeId`, and `subjectId`. `TextbookPart` contains only `PART_1` and `PART_2`.

The unique identity constraint is `@@unique([subjectId, gradeId, part, edition])`.

`Textbook` has no `termId` or `academicYearId`.

`TextbookAdoption` owns `academicYearId` and `termId`, with uniqueness on textbook + school + academic year.

**No schema migration is required for the identity contract.**

### 2. Canonical textbook creation — PASS

`ContentAuthoringService.createTextbook()` accepts `part: PART_1 | PART_2` and derives the key through `shared/kernel/identifiers.ts`.

The key builder validates the physical part and rejects any other value. The key is not supplied by the caller and cannot be derived from an academic term.

### 3. Content package import — PASS

`ContentImportService` derives a textbook key from subject + grade + physical part + printed edition when converting hierarchical packages. It writes through `ContentAuthoringService`, not Prisma directly.

### 4. Workspace archive import/reconciliation — PASS

`WorkspaceArchiveService` resolves the Workspace using the package's physical part, grade, subject, and printed edition, then delegates the actual import to the canonical Workspace importer.

No academic term is used to construct the Workspace location.

### 5. Adoption — PASS

`TextbookAdministrationService.adopt()` parses the canonical textbook key and derives the required academic term from the physical part:

- `PART_1` → term ordinal `1`
- `PART_2` → term ordinal `2`

The term is resolved within the selected academic year and stored on `TextbookAdoption`. This keeps term out of textbook identity while preserving the explicit deployment fact.

### 6. Confirmed consistency gap — documentation

`books_input/README.md` still described textbook identity as including `term`. It has now been corrected to physical part + printed edition and explicitly documents `BOTH` as source-input only.

Some older audit/history documents still contain pre-P1/P2 examples such as `EDU-MATH-G07-T1-ED2026`. Those are historical evidence, not the current architecture contract.

## Explicit negative checks

No active canonical creation/import/adoption path was found that:

- puts `termId` into `Textbook` identity;
- uses `T01`/`T02` as physical Workspace coordinates;
- persists `BOTH` or `PB` as a textbook part;
- derives a textbook key from academic year or term;
- creates a second Prisma write path for content import.

## Decision

**Keep the Prisma schema unchanged.** The P1/P2 identity contract is implemented end-to-end for the audited paths.

The next implementation work should move to the next dependency rather than introducing another identity migration.