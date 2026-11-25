# Content Workspace, Preparation and Synchronization Contract

Status: ADOPTED TARGET ARCHITECTURE
Decision date: 2026-11-25
Implementation status: pending in edu_v10; the current code still contains legacy Python-workspace assumptions.
Workspace producer contract: the existing `indexer2` implementation. Do not redefine or duplicate its slicing algorithm here.

## 1. Single ownership boundary

- `indexer2` remains the producer and owner of the existing Workspace layout and PDF lesson slicing.
- `edu_v10` consumes that Workspace. It must discover, validate, resolve and serve the existing lesson files; it must not re-slice the source PDF or create a second Workspace format.
- Gemini calls, Task Specifications, AI response validation, review and generated-content persistence belong to `edu_v10`.
- PostgreSQL is the canonical store for textbook-edition identity and generated educational content.
- Workspace stores the prepared lesson PDFs and the structural/control metadata required to locate and validate them. AI-generated explanations, summaries, questions, interactive lesson bodies and other generated content are not written into Workspace.

This is a one-way consumption boundary, not a live two-way mirror.

## 2. Canonical indexer2 Workspace layout — preserve exactly

The current `indexer2` root is:

```text
workspace/
└── <gradeKey>/
    └── <subjectKey>/
        └── [componentKey]/
            ├── cover.png
            ├── index.json
            ├── validation_report.json
            ├── book_manifest.json
            ├── manual_review/
            │   └── slice_approval_index.json
            ├── P01/
            │   └── units/
            │       └── unit_01/
            │           └── lesson_01.pdf
            └── P02/
                └── units/
                    └── unit_02/
                        └── lesson_01.pdf
```

Rules:

1. Preserve the actual `indexer2` directory/file names and relative paths.
2. `index.json` is the canonical structural index.
3. `book_manifest.json`, `validation_report.json` and `manual_review/slice_approval_index.json` retain their existing roles.
4. Lesson PDFs remain at `P01/units/unit_NN/lesson_NN.pdf` or `P02/units/unit_NN/lesson_NN.pdf`.
5. Do not add an edition directory, slug directory, alternate lesson-PDF naming scheme or second manifest tree.
6. Do not move the existing slicing algorithm into `edu_v10`. The Workspace Reader must consume the files produced by `indexer2`.
7. Do not put generated AI output under lesson folders. Generated content is persisted through `edu_v10` canonical services.

The root may contain the existing structural metadata and cover artifact. “Lesson-only Workspace” means that lesson PDFs are its canonical prepared PDF content; it does not mean deleting the index and validation metadata required to identify and safely read those lessons.

## 3. Edition identity is a database concern, not a Workspace path

There is deliberately no `ED2026/` directory in the canonical Workspace path.

The current Prisma model already has:

- `Textbook.edition`;
- `Textbook.publishYear`;
- uniqueness on `[subjectId, gradeId, part, edition]`;
- `Unit → Textbook`;
- `Lesson → Unit`;
- edition-scoped relations for questions, concepts, resources and assets through their lesson/textbook parents.

Therefore:

- Each printed edition is a separate `Textbook` row.
- Each edition owns its own Unit/Lesson hierarchy and generated content.
- No separate `Edition` model is required for this workflow.
- No edition folder is added to Workspace.
- Academic adoption remains separate in `TextbookAdoption`; term is not part of edition identity.

The existing schema does not currently expose a textbook-level source PDF fingerprint. Add only `Textbook.sourceSha256` if no existing persisted source record can safely bind the current Workspace manifest's `sourceSha256` to the exact edition. Do not add an Edition table or duplicate the textbook hierarchy.

## 4. Current Workspace edition and replacement policy

The Workspace path represents the currently prepared edition for its grade/subject/component/physical-part coordinates. Historical generated content remains in PostgreSQL under its historical `Textbook` edition.

On a new PDF upload:

1. Resolve subject, grade, physical part and printed edition explicitly.
2. Compute/read the source SHA-256 and compare it with the current Workspace manifest and the edition record.
3. Compare edition chronology only from explicit, verified edition metadata. Never compare edition strings lexically or infer edition from filename/academic year.
4. If the uploaded PDF is older than the current Workspace edition, stop before slicing. Leave the current Workspace untouched.
5. If edition and source SHA are unchanged, return an idempotent no-op.
6. If the same printed edition has a different source SHA, classify it as a source revision/conflict and require review; do not silently treat it as a new printed edition.
7. If a newer printed edition is confirmed, let the existing `indexer2` preparation/slicing workflow produce the replacement Workspace in staging. Validate its index, approval evidence, lesson list, file existence and checksums.
8. Replace the current Workspace atomically only after the new preparation passes validation. Remove the previous edition's lesson slices from the active Workspace after successful replacement.
9. Never delete or overwrite the previous edition's textbook, lessons, questions, resources or generated content in PostgreSQL.

A failed or incomplete preparation must leave the previous active Workspace intact. An older upload must never downgrade the active Workspace.

## 5. Edition switching in the application

The API resolves the selected `Textbook` edition, then reads content through that edition's own Unit/Lesson relationships.

- The latest Workspace edition is the default for current source-PDF access and new generation.
- Historical editions remain selectable for viewing their previously generated database content.
- Switching edition changes the selected textbook identity and its lesson/content query; it does not rename or mutate lesson records from another edition.
- If no generated content exists for a selected historical lesson, the API returns an explicit empty state; it must not borrow content from the current edition.

Important limitation: because Workspace retains only the currently prepared edition's lesson PDFs, switching to an older edition can display its retained database content but cannot display or regenerate from its old source lesson PDF unless that PDF is separately retained in edition-owned ContentStorage. Historical PDF retention is not part of this phase.

## 6. edu_v10 Workspace Reader and API boundary

The implementation target is:

```text
indexer2 Workspace
    │
    ▼
edu_v10 Workspace Reader
    ├── list workspaces/books
    ├── read index.json and book_manifest.json
    ├── discover P01/P02 units and lesson PDFs
    ├── verify safe relative paths and checksums
    ├── resolve the selected Textbook edition
    └── expose lesson metadata and PDF streaming endpoints
             │
             ▼
        Content / Gemini APIs
             │
             ▼
        Task Specification + prompt/schema versions
             │
             ▼
        validation → review → canonical DB persistence
```

The Workspace Reader is read-only with respect to the source Workspace. It must reject path traversal, missing lesson files, checksum mismatches, ambiguous textbook identity and edition/hash mismatch.

AI generation uses the lesson PDF as source input but writes its output to the database through existing canonical application services. The browser never calls Gemini directly and never receives provider secrets.

## 7. Synchronization and safety invariants

- One canonical Workspace layout: the current `indexer2` layout.
- One canonical index file: `index.json`.
- One owner for slicing: `indexer2`.
- One canonical database writer: `edu_v10` application services.
- Workspace contains lesson source PDFs and structural/control metadata, not generated AI lesson content.
- Same edition + same source fingerprint → no-op.
- Older edition → reject before slicing.
- Newer edition → staged preparation, validation, then atomic replacement.
- Failed preparation → preserve previous Workspace.
- Replacing Workspace never deletes historical database content.
- Generated content is always scoped to a specific textbook edition and lesson.
- No automatic fallback from one edition's generated content to another edition.
- No filesystem watcher or uncontrolled bidirectional synchronization.

## 8. Documentation authority

This document is the canonical Workspace ownership/layout/replacement contract.

`architecture/04-data-identity-schema.md` owns edition identity and schema implications.
`architecture/03-ai-evidence-provenance.md` owns AI provenance and review boundaries.
`architecture/08-decision-register.md` records the adopted decisions.

Older documents describing Python-owned segmentation, `EDITION` Workspace directories, page-image trees or AI draft files inside Workspace are historical records only. They must not be used as active implementation instructions.
