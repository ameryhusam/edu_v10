# AI, Evidence, Page Classification and Provenance

Status: ADOPTED TARGET ARCHITECTURE
Last reviewed: 2026-11-25

## AI authority

AI is a proposal/generation service, not canonical truth.

`lesson source → Task Specification → Gemini → response validation → draft persistence → human review → canonical content state`

AI must not directly approve, publish, alter mastery, create learner evidence, alter authorization/entitlement, invent canonical identity or bypass canonical application services.

The browser calls the `edu_v10` API. It never calls Gemini directly and never receives provider secrets.

## Workspace and source evidence

The existing `indexer2` Workspace is the physical source boundary. `edu_v10` reads its approved lesson PDFs and structural metadata; it does not re-run PDF slicing or create a parallel Workspace.

Workspace is not the AI-generated content store. Generated explanations, summaries, questions, flashcards, structured JSON lessons and HTML lessons are persisted through `edu_v10` database/content services, with file/object storage used only for binary assets that cannot appropriately live in database fields.

## Edition and source grounding

Every AI generation request must resolve:

- textbook key and printed edition;
- unit and lesson keys belonging to that textbook;
- source PDF SHA-256 and lesson PDF SHA-256 when available;
- lesson page range and printed/PDF page mapping where present;
- task type, prompt version, response-schema version and output contract;
- provider/model and request correlation metadata.

Generated content is edition-scoped. An artifact generated for one edition must never be attached to a lesson in another edition solely because the title, lesson number or slug looks similar.

## Task Specifications

Every AI task is loaded from one server-owned, versioned Task Specification. The specification governs:

- taskType;
- promptTemplate and promptVersion;
- responseSchema and schemaVersion;
- outputContract;
- examples;
- validationRules;
- reviewPolicy.

The UI may display task metadata and collect allowed input values, but it does not carry a competing prompt or schema copy. The server is the only authority for prompt rendering and response validation.

## Validation and review

The sequence is:

1. validate the request and target edition/lesson;
2. load the approved lesson PDF and required context;
3. render the prompt from the active Task Specification version;
4. call the configured Gemini provider through the server-side AI provider boundary;
5. parse and validate the response against the versioned schema;
6. apply semantic/source-grounding validation and deduplication;
7. persist a draft with provenance and edition/lesson foreign keys;
8. require the configured review/approval policy before publishing to learners.

Schema validity is not pedagogical correctness. Source quotation matching is not human approval. Rejected or failed drafts are never served as approved learner content.

## Persistence and provenance

Persist, where supported by canonical content models:

- taskType and task-specification identifier;
- promptVersion, schemaVersion and outputContract;
- provider/model;
- textbook edition and lesson identity;
- source and input fingerprints;
- generation request/status/timestamps;
- validation report and review/approval state;
- output fingerprint and version.

Do not put generated drafts or AI analysis manifests into Workspace. Reuse existing canonical models first; add the smallest persistence extension only when a real provenance/versioning gap is demonstrated.

## Page and question classification

Classification is metadata, not a filename convention. A page or question block is source evidence; it does not automatically become a learner-visible content record. Question candidates must pass question-type validation, normalization, deduplication and the canonical Question service.

## Human review

AI confidence routes review; it is not approval. A model's own claim that output is correct is never human approval.
