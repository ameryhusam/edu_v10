# Content Ingestion, Workspace, Grounding and AI

**Status:** ADOPTED; target production contract. Implementation status is tracked only in `Docs_v10/11-current-state.md`.

## 1. Canonical pipeline

```text
External source
      ↓
Python Content Engine
  PDF reading / TOC / page mapping / segmentation / rendering
      ↓
Workspace + grounding artifacts
      ↓
Node reconciliation + validation
      ↓
Canonical application services
      ↓
PostgreSQL / asset storage
```

AI enrichment sits after deterministic grounding:

```text
Source pages
  ↓
grounding
  ↓
AI proposal
  ↓
normalization
  ↓
evidence validation
  ↓
PROPOSED / NEEDS_REVIEW
  ↓
human review
  ↓
canonical authoring/import
```

## 2. Python boundary

Python may:

- read PDFs;
- inspect TOCs;
- map printed pages to physical PDF pages;
- segment units/lessons;
- render page images;
- generate deterministic grounding manifests;
- run local/remote AI preparation;
- write workspace files.

Python must not:

- import Prisma;
- connect to PostgreSQL;
- publish content;
- write mastery/evidence/XP;
- enforce authorization;
- become a second canonical authoring service.

## 3. Printed page vs PDF page

Printed page number is educational identity.

PDF page number is physical location.

Both must be preserved when known.

Grounding records should include:

- printed page;
- PDF page;
- text;
- stable ordinal;
- SHA-256 fingerprint.

Missing source, invalid mapping, or checksum mismatch is a blocking error for grounded analysis.

## 4. Canonical workspace

The workspace is an evidence/preparation boundary, not a database.

A lesson workspace may contain:

```text
lesson/
  lesson_manifest.json
  grounding_manifest.json
  lesson_full_text.txt
  pages/
    page_<printed>.png
  text/
    page_<printed>.txt
  ai_pages/
    page_<printed>.png
  resource/
    questions/
    concepts/
    misconceptions/
    flashcards/
    audio/
    video/
  analysis/
    <provider>/
```

The printed page number is the stable page identity. AI explanation pages pair with original pages by printed page identity, not random filenames.

## 5. Asset contract

Binary files stay in storage.

JSON contains metadata, relative references, checksums and provenance.

Database stores asset metadata/storage key/checksum/relationships.

Never expose internal filesystem paths.

Assets should support streaming, cache metadata, MIME correctness and checksum validation.

## 6. AI provider boundary

AI is behind an application port and infrastructure adapter.

Provider SDKs must not appear in domain, routes or React.

AI output is never canonical merely because it passed JSON schema validation.

Evidence validation proves source grounding exists; it does not prove pedagogical correctness.

## 7. AI safety

AI must not autonomously:

- approve content;
- publish content;
- change mastery;
- create learner evidence;
- change assignments;
- alter authorization;
- silently overwrite existing canonical questions/content.

AI failure must not corrupt valid data.

Use bounded retry, timeout, explicit refusal, and compensation/rollback where a workflow has already written state.

## 8. Import contract

Recommended import flow:

```text
input package
  ↓
schema validation
  ↓
relationship validation
  ↓
duplicate/conflict detection
  ↓
dry-run
  ↓
canonical application service
  ↓
transaction
  ↓
idempotent persistence
```

No direct DB writes from import adapters.

Missing input rows never imply deletion.

## 9. Question updates

Question ingestion must support:

- adding multiple files;
- merging new questions into an existing batch/file;
- semantic/identity deduplication;
- conflict reporting;
- preserving existing historical questions;
- explicit replacement/correction workflows.

Advanced types currently include ORDERING and should allow future educational formats such as word ordering and ascending/descending ordering through a canonical question-type contract rather than UI-only special cases.

## 10. Local/free model strategy

The content-preparation engine may support local models and remote providers behind one provider-neutral contract.

Provider choice must not alter the canonical import contract.

## 11. Implementation staging

The production architecture may be implemented incrementally through foundation gates such as workspace/assets/provider transport, deterministic TOC and PDF-reader fallback, grounding manifests/checksums, draft-only lesson AI analysis, preview/deduplication/human Apply, canonical page/chunk persistence, and page/resource authoring. These are implementation stages, not separate architectural owners or alternative pipelines.

## 12. External library integration

Google Drive or another library is an adapter/source, not a platform primitive.

Folder taxonomy may help humans organize source material, but the canonical identity remains the Edu7 content contract.

Never make the database depend on a provider's folder naming convention.
