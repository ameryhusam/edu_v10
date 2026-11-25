# Data, Identity and Schema Contract

Status: ADOPTED
Last reviewed: 2026-11-25
Primary persistence fact source: `prisma/schema.prisma`

## Schema authority

Prisma is the persisted-data source of truth. Do not add models/fields/enums merely for UI, AI prompt, script or documentation convenience. Any schema addition must close a demonstrated persistence or integrity gap.

## Identity normalization

Normalize before lookup, uniqueness checks, Workspace resolution and import comparison.

- Grade aliases: G4 → G04.
- Physical part aliases: P1 → PART_1; P2 → PART_2.
- T01/T02 are academic-term coordinates only. They are not textbook identity or Workspace part coordinates.
- The mapping is explicit and must not be inferred by string replacement between term and part tokens.

## Textbook and printed-edition identity

Canonical textbook identity is:

`subject + grade + physicalPart + printedEdition`

Examples:

- `EDU-SCI-G04-P1-ED2026`
- `EDU-SCI-G04-P2-ED2026`

The current `Textbook` model already contains `edition` and has uniqueness on `[subjectId, gradeId, part, edition]`. A genuinely different printed edition is a separate `Textbook` row with its own Unit/Lesson hierarchy and edition-scoped generated content.

Do not create a separate `Edition` model for this workflow. Do not encode the edition in the Workspace directory path.

## Source fingerprint

The Workspace `book_manifest.json` contains `sourceSha256`. The application must bind that fingerprint to the selected `Textbook` edition so it can detect stale, replaced or mismatched lesson PDFs.

The current `Textbook` model does not have a textbook-level `sourceSha256` field. Before adding one, verify whether an existing persisted source record already provides an exact, durable binding. If not, add only an optional `Textbook.sourceSha256` field and index it appropriately. Do not create a generic Edition table or duplicate source identity in several unrelated records.

A source SHA identifies the exact uploaded PDF bytes; it does not define printed-edition identity. Two scans of the same printed edition may have different SHA values and require explicit source-revision review.

## Workspace relationship

The Workspace path is independent of edition:

`workspace/<gradeKey>/<subjectKey>/[componentKey]/`

The Workspace holds the currently prepared edition's lesson PDFs and the structural/control files required by the existing `indexer2` contract. The active edition is resolved through its textbook identity and source fingerprint, not through an `EDITION` directory.

Only one edition is active in the physical Workspace for a given Workspace coordinate. Historical edition content remains in the database.

## Textbook versus adoption

`Textbook` represents reusable content identity for one printed edition.
`TextbookAdoption` represents institutional/year deployment and carries school, academic year and the explicit term link.

P1/P2 are physical textbook parts. Their mapping to an academic term occurs through adoption policy, not by changing textbook identity.

## Edition-scoped content

The existing hierarchy provides edition isolation:

`Textbook → Unit → Lesson → Concept`

Questions, learning resources, flashcards and assets are attached to the corresponding lesson/concept/textbook. New generated content must resolve and persist against the selected edition's lesson, never a lesson with the same title or order in another edition.

When switching editions, API queries must be scoped by the selected `Textbook` identity. No implicit content sharing or cross-edition fallback is allowed.

## Important entities

`Textbook`, `TextbookAdoption`, `Unit`, `Lesson`, `Concept`, `ContentAsset`, `TextbookPage`, `ContentChunk`, `LearningResource`, `Question`, `QuestionOrigin` and `QuestionType` are distinct contracts.

`orderIndex` controls presentation order and never becomes identity.

## Historical data

Historical data migrations require affected-path analysis, explicit backfill/default strategy, compatibility planning and verification. Do not rewrite old-edition content to point at the newest textbook.
