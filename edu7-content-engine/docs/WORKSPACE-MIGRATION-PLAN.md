# Edu7 Content Preparation — Workspace Migration & Import-Ready Plan

## Goal

Make the preparation engine produce one deterministic, database-aligned workspace
for every textbook while keeping source PDFs and generated data completely
separate from the Python engine.

## Target contract

`workspace/<PART>/<GRADE>/<SUBJECT>/<EDITION>/`

Examples:

`workspace/P1/G04/SCI/ED2026/`
`workspace/P2/G04/SCI/ED2026/`

The coordinates have different roles:

| Level | Source of truth | Example |
|---|---|---|
| Physical part | Textbook physical part | `P1` / `P2` |
| Grade folder | Edu7 Grade ordinal | `G04` |
| Subject folder | Prisma `Subject.key` | `SCI` |
| Edition folder | Printed textbook edition | `ED2026` |

Academic term is deliberately absent from the Workspace path. It is an adoption/deployment fact, not textbook identity.

The Python implementation mirrors the canonical TypeScript textbook-key rule;
it does not invent a second key format.

## Execution phases

### Phase A — Data boundary

- [x] Remove tracked sample/generated workspaces from
  `edu7-content-engine/workspaces/`.
- [x] Remove the tracked source PDF from
  `edu7-content-engine/books_input/`.
- [x] Add repository-root `books_input/`.
- [x] Add repository-root `workspace/`.
- [x] Ignore generated source/workspace data in Git.
- [x] Make the CLI resolve these roots from the repository, not from the
  current working directory.

**Gate A:** running from `edu7-content-engine/` cannot recreate
`edu7-content-engine/workspaces/`.

### Phase B — Identity and coordinates

- [x] Normalize physical-part aliases: `P1`/`PART_1` and `P2`/`PART_2`.
- [x] Normalize `G04/G07` filesystem grade names.
- [x] Require the subject value to be the canonical database `Subject.key`.
- [x] Derive textbook identity from `subject + grade + physical part + printed edition`.
- [x] Keep academic term outside textbook identity; it is resolved by `TextbookAdoption`.
- [x] Stop using the PDF filename as textbook identity.
- [x] Split a combined source into independent P1/P2 packages before Workspace emission; ambiguous boundaries route to review.

**Gate B:** two files with different filenames but identical
subject/grade/term/edition coordinates target the same textbook workspace.

### Phase C — Book artifact normalization

The existing PDF reader, page mapper, TOC extraction, lesson segmentation and
grounding implementation remain the single processing path.

A thin workspace finalizer then:

- [x] renames the internal `textbook/textbook.pdf` artifact to
  `source/<Textbook.key>.pdf`;
- [x] moves its source manifest under `source/`;
- [x] keeps unit/lesson/grounding artifacts under the book workspace;
- [x] emits a stable `book-manifest.json`;
- [x] upgrades package metadata to the import-package contract;
- [x] preserves `index.json` and `edu7-content-package.json`.

**Gate C:** no canonical output path contains a generic `textbook/` directory
or generic `textbook.pdf` identity.

### Phase D — Complete content package

Next implementation stage:

1. Unit and lesson manifests must expose canonical keys/coordinates and not
   only slugs.
2. Every physical asset gets deterministic checksum/provenance metadata.
3. Missing rendered pages become a blocking condition when the source is an
   image-based PDF and visual processing is required; no silent `except pass`.
4. Lesson resources are separated by semantic role:
   `resources/text`, `resources/images`, `resources/audio`,
   `resources/video`, `resources/remedial` as applicable.
5. Grounding manifests retain printed-page canonical numbering, PDF physical
   numbering, chunk hashes, source checksum and lesson references.
6. AI analysis remains draft-only and is written under the lesson's
   `analysis/` area with provider/model/prompt/provenance metadata.
7. Refresh remains append-only and deduplicated; an updated source asset gets a
   new checksum/version rather than silently replacing an immutable asset.

**Gate D:** a single book directory is self-contained enough for dry-run import
without reaching outside its book workspace except for declared source roots.

### Phase E — Import contract

The Python package produces a package; it does not write Prisma.

Node import must be the only canonical write path:

`workspace package → dry-run validation → ContentImportService → Prisma`

The importer will resolve:

- `subjectKey`
- `gradeKey`
- physical part (`PART_1`/`PART_2`)
- printed edition
- `textbookKey`
- unit/lesson keys
- adoption term only when the deployment/adoption operation explicitly supplies it
- ContentAsset identity/checksum
- concepts/questions/flashcards/resources
- grounding/provenance

AI records remain proposed until the explicit approval/import gate.

**Gate E:** the same prepared package can be dry-run repeatedly without creating
duplicate canonical records.

### Phase F — CLI and validation

Required commands:

```bash
PYTHONPATH=src python -m edu7_content.cli.main prepare \
  books_input/<book>.pdf \
  --subject SCI --grade G04 --term T01 --edition 2026 \
  --model gemini-3.6-flash --no-ollama
```

Expected root:

```
workspace/T01/G04/SCI/ED2026/
```

Validation gates:

- compile/import check
- CLI help check
- source-root resolution check from engine directory
- output-path check
- manifest schema/JSON validation
- checksum consistency
- scanned-PDF visual rendering check
- TOC extraction check
- printed↔PDF page mapping check
- grounding completeness check
- Node dry-run import check

No local runtime test has been claimed in this commit; execution remains to be
performed in the user's Termux environment after pulling the changes.
