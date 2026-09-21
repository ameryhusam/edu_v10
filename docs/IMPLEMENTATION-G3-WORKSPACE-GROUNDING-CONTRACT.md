# G3 — Workspace grounding contract

## Status

Implemented on `feature/content-ai-foundation-g1`.

This gate keeps the workspace as the physical/evidence boundary before AI-generated
content is allowed to become canonical database content.

## Contract

1. The printed textbook page number is canonical.
2. The PDF page number is physical and is never used as the learner-facing page identity.
3. The Python content engine owns PDF reading, page mapping, slicing, rendering and
   deterministic grounding artifact generation.
4. Node.js only reconciles the generated workspace and persists through canonical
   application services.
5. Grounding artifacts are evidence, not authored educational entities.
6. Grounding chunks are deterministic text chunks; they do not contain AI-generated
   claims.
7. Every grounding page records both printed and physical PDF page numbers and a
   SHA-256 fingerprint of the extracted page text.
8. Every grounding chunk records its stable ordinal, printed/PDF page pair, text and
   SHA-256 fingerprint.
9. Missing or checksum-mismatched source/assets remain blocking workspace errors.
10. This gate does not write TextbookPage or ContentChunk directly from Python. The
    later canonical import gate will map the validated grounding contract through
    the application layer.

## Files

- `edu7-content-engine/src/edu7_content/pdf/segmentation.py`
  - fixes the pypdf path so it no longer depends on a PyMuPDF-only document object.
  - emits `grounding_manifest.json` per lesson.
  - emits deterministic page/chunk evidence with hashes.
- `edu7-content-engine/src/edu7_content/pdf/reader.py`
  - remains the backend abstraction and PyMuPDF → pypdf fallback boundary.
- `src/infrastructure/storage/workspace-manager.ts`
  - remains the Node reconciliation boundary.

## Explicit limitation

No local Python/TypeScript execution was available in this session. Therefore this
gate is source-reviewed and committed, not execution-verified. In particular,
pypdf/PyMuPDF runtime behavior and TypeScript compilation still require CI or a
local environment.

The next gate should consume this contract through a canonical application service
for TextbookPage/ContentChunk persistence, with idempotency and source fingerprint
checks.