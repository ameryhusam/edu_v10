# Edu7 Content Workspace Contract

## Purpose

The Python content engine is a processor, not the content store.

- Engine code: `edu7-content-engine/`
- Source PDFs: repository-root `books_input/`
- Generated workspaces: repository-root `workspace/`
- Database writing: Node `ContentImportService` only
- AI output: draft/proposed artifacts only; never direct canonical DB writes

The engine may be launched from inside `edu7-content-engine/`, but all default
input/output paths resolve from the Edu7 repository root.

## Canonical layout

```
edu_v10/
├── books_input/
│   ├── <source-book>.pdf
│   └── ...
├── workspace/
│   ├── T01/
│   │   ├── G04/
│   │   │   └── MATH/
│   │   │       └── EDU-MATH-G04-T1-ED2026/
│   │   │           ├── book-manifest.json
│   │   │           ├── index.json
│   │   │           ├── edu7-content-package.json
│   │   │           ├── source/
│   │   │           │   ├── EDU-MATH-G04-T1-ED2026.pdf
│   │   │           │   └── book-source-manifest.json
│   │   │           ├── unit_01_<stable-name>/
│   │   │           │   ├── unit_manifest.json
│   │   │           │   ├── U_01_<stable-name>.pdf
│   │   │           │   └── lesson_01_<stable-name>/
│   │   │           │       ├── lesson_manifest.json
│   │   │           │       ├── L_01_<stable-name>.pdf
│   │   │           │       ├── lesson_full_text.txt
│   │   │           │       ├── grounding_manifest.json
│   │   │           │       ├── pages/
│   │   │           │       ├── text/
│   │   │           │       ├── analysis/
│   │   │           │       └── resources/
│   │   │           └── ...
│   │   └── G07/
│   │       └── SCI/
│   │           └── EDU-SCI-G07-T1-ED2026/
│   └── T02/
└── edu7-content-engine/
    └── src/
```

### Identity rules

The folder hierarchy is organizational and import-friendly:

1. `T01/T02` is the filesystem term coordinate.
2. `G04/G07` is the filesystem grade coordinate.
3. `MATH/SCI/ARAB/... ` is exactly the canonical `Subject.key`.
4. The textbook directory is exactly the canonical `Textbook.key`.
5. The textbook key is derived from subject + grade + term + printed edition,
   matching `src/shared/kernel/identifiers.ts`:
   `EDU-MATH-G04-T1-ED2026`.
6. The PDF filename is not the identity. It is source input only.
7. Unit and lesson identities are derived from stable names/slugs, never their
   order index.

## JSON contract

Every book uses the same manifest filenames and schema family:

- `book-manifest.json`: filesystem/package entry point and DB import coordinates.
- `index.json`: complete generated hierarchy and asset inventory.
- `edu7-content-package.json`: canonical import package.
- `unit_manifest.json`: one unit and its lessons.
- `lesson_manifest.json`: one lesson, printed/physical page mapping, assets,
  and grounding references.
- `grounding_manifest.json`: deterministic evidence pages/chunks.
- `analysis/*`: AI draft output, validation, provenance and review state.

The files are structurally identical across books. Identity is carried by fields
such as `textbookKey`, `subjectKey`, `gradeKey`, `termKey`, and asset
references rather than by inventing a different JSON schema per book.

## Resources

A lesson is not only a PDF. Its package can contain:

- source lesson PDF
- rendered page images
- extracted page text
- deterministic grounding pages/chunks
- AI analysis drafts
- concepts/objectives/misconceptions
- flashcards
- question candidates
- learning resources
- supporting images/audio/video/files
- provenance and asset checksums

The Python engine prepares these artifacts. The Node import path decides what is
canonical and writes the database.

## Source/input isolation

Do not put source books or generated workspaces under
`edu7-content-engine/`.

The engine package must remain portable and reproducible. Root directories are
data boundaries:

- `books_input/`: immutable source inputs for a preparation run.
- `workspace/`: generated, refreshable preparation state.
- `edu7-content-engine/`: executable processing code and tests.

Generated workspace data is ignored by Git; large PDFs must not become part of
normal source-code commits.

## CLI examples

From anywhere inside the repository:

```bash
cd edu7-content-engine
source .venv/bin/activate

PYTHONPATH=src python -m edu7_content.cli.main prepare   books_input/science_part1_4th.pdf   --subject SCI   --grade G04   --term T01   --edition 2026   --model gemini-3.6-flash   --no-ollama
```

Expected destination:

```
../workspace/T01/G04/SCI/EDU-SCI-G04-T1-ED2026/
```

No database connection is required by the Python preparation command.
