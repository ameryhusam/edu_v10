# Implementation G4 — Lesson AI Analyze (Draft-Only)

## Purpose

G4 adds a deterministic, auditable lesson-analysis stage after G3 grounding.

Flow:

`Lesson workspace + grounding artifacts → AI provider → normalized draft → evidence validation → analysis manifest`

This gate does **not** write concepts, questions, misconceptions, flashcards, mastery, XP, assignments, authorization, or any other canonical educational state to the database.

## Contract

1. AI-generated concepts, questions, and flashcards remain `PROPOSED`.
2. Evidence that cannot be verified against the lesson text becomes `NEEDS_REVIEW`.
3. The validator never changes an item to `APPROVED`.
4. Human approval is required before canonical import.
5. The analysis output is written only inside the workspace under:
   - `analysis/<provider>/normalized.json`
   - `analysis/<provider>/validation-report.json`
   - `analysis/<provider>/analysis-manifest.json`
6. The analysis manifest records:
   - mode = `ANALYZE`
   - status = `DRAFT`
   - provider
   - lesson manifest
   - grounding manifest
   - normalized output
   - validation report
   - `databaseWrite = false`
   - `humanApprovalRequired = true`

## Evidence policy

Evidence comparison normalizes whitespace and common Arabic letter variants before checking whether the generated evidence occurs in the lesson text.

This is an evidence gate, not a semantic approval gate. A matching quotation proves only that the supplied evidence exists in the source; it does not prove pedagogical correctness.

## Separation of responsibilities

- Python Content Engine owns PDF reading, segmentation, grounding artifacts and AI draft files.
- Node Content services remain the canonical persistence path.
- The AI provider does not receive Prisma access.
- No AI output is imported automatically.

## Next gate

G5 can add preview → deduplicate → human Apply for concepts. The Apply step must call the existing canonical content authoring service rather than introducing an AI-specific database writer.
