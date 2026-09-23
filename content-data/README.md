# JSON content data

This directory is the authoring/import boundary for prepared textbook content.

The canonical flow is:

`JSON → ContentImportService → canonical domain services → database`

The Python content engine is optional. It may generate these JSON packages from a PDF, but it is not required to populate the database.

## Recommended organization

```text
content-data/
  G07/
    SCI/
      ED2026/
        P1/
          textbook.json
          index.json
          concepts.json
          questions-01.json
          questions-02.json
```

The index/structure files describe the textbook hierarchy and printed-page evidence. Question files are separate and attach to lessons/concepts. They are not the textbook index.

For a single exchange package, the existing `edu7.textbook-content` profile is preferred. The importer also accepts the hierarchical preparation shape already used by the workspace flow.

## Import

Dry-run is the default:

```bash
npm run content:import -- --file content-data/G07/SCI/ED2026/P1/content-package.json
```

Apply after the preflight passes:

```bash
npm run content:import -- --file content-data/G07/SCI/ED2026/P1/content-package.json --apply
```

Multiple question/content files can be supplied. They are processed in order and deduplicated by the canonical services:

```bash
npm run content:import -- \
  --file content-data/G07/SCI/ED2026/P1/questions-01.json \
  --file content-data/G07/SCI/ED2026/P1/questions-02.json \
  --apply
```

To refresh existing mutable content from JSON:

```bash
npm run content:import -- --file update.json --mode UPDATE --apply
```

UPDATE never bypasses domain guards. Published/frozen content or questions with learner responses can still be refused by the canonical services.

## Identity rules

- Textbook, unit, lesson, concept and question keys are derived by Edu7.
- JSON `key` fields are informational/output fields; do not invent database ids.
- Question identity is the question stem within its lesson. Keeping the same stem allows UPDATE; changing the stem creates a new question identity.
- Re-running APPEND_DEDUP is safe: existing content is reported as unchanged instead of duplicated.
