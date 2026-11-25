# Lesson Source PDFs and Generated Content Storage Contract

Status: ADOPTED TARGET ARCHITECTURE
Decision date: 2026-11-25
This contract supersedes the previous page-image/AI-draft-in-Workspace design.

## Storage boundary

The existing `indexer2` Workspace is retained as-is for prepared lesson PDFs and the structural metadata required to discover and validate them. `edu_v10` stores generated explanations, summaries, questions, flashcards, interactive JSON and HTML through its canonical database/content services. Generated content and AI analysis files are not written into Workspace.

PostgreSQL stores semantic content, identity, metadata, checksums and relations. Binary files that must outlive Workspace use ContentStorage/object storage and ContentAsset; binary bytes do not belong in normal PostgreSQL rows.

## Canonical Workspace layout

```text
workspace/<gradeKey>/<subjectKey>/[componentKey]/
├── cover.png
├── index.json
├── validation_report.json
├── book_manifest.json
├── manual_review/slice_approval_index.json
├── P01/units/unit_01/lesson_01.pdf
└── P02/units/unit_02/lesson_01.pdf
```

The actual `indexer2` directory and file names are authoritative. Do not add an edition folder, rename lesson files, introduce slug-based lesson directories or implement another slicing algorithm in `edu_v10`.

## Edition policy

Workspace path does not include edition. The existing `Textbook.edition` and uniqueness on `[subjectId, gradeId, part, edition]` represent printed editions. Each edition has its own Textbook row and its own Unit/Lesson/content relations. No separate Edition model is required.

Only the latest confirmed edition occupies active Workspace. A newer edition is staged and validated before replacing it. Older-edition uploads are rejected before slicing. Replacing Workspace does not delete historical generated content in PostgreSQL.

Edition switching selects the corresponding Textbook identity and its own Unit/Lesson/content through the API. Historical content can still be displayed from the database. Historical source lesson PDFs are not available after Workspace replacement unless separately retained in edition-owned ContentStorage; that retention is outside this phase.

## Lesson discovery and serving

The `edu_v10` Workspace Reader lists existing roots, reads `index.json` and `book_manifest.json`, discovers P01/P02 lessons, validates safe relative paths and file existence, checks fingerprints, resolves the selected Textbook edition, and exposes authenticated lesson metadata/PDF streaming APIs. A Workspace path is never a public learner URL.

## Generated content and security

AI uses the selected edition's lesson PDF and a server-owned Task Specification. Output is schema-validated, semantically checked, persisted as an edition-scoped draft, reviewed, then published through canonical services. Prefer structured JSON for interactive lessons; HTML is untrusted and must run in an isolated/sandboxed WebView. The browser never calls Gemini directly and never receives API keys.

## Required tests

- discover the exact `indexer2` tree without re-slicing;
- reject traversal, missing files and checksum mismatch;
- bind Workspace source fingerprint to the selected Textbook edition;
- reject older edition before slicing;
- atomically replace Workspace after successful newer-edition validation;
- preserve old edition DB content and isolate edition-switch API queries;
- verify generated AI output is stored outside Workspace;
- verify JSON renderer contract and HTML isolation.
