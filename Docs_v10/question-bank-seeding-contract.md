# Question Bank — Database Seeding Contract

Status: ADOPTED for the feat/question_bank workstream.

## Purpose

This workstream intentionally does not use Workspace as the runtime content source. Prepared JSON is stored in a dedicated repository seeding area and is written directly to PostgreSQL through a dedicated seeding/import path.

The product is a lightweight learner-evaluation system. It keeps the textbook catalogue and educational/question data needed for assessment, but does not preserve textbook PDFs as database content.

## Canonical ownership

- Prisma schema remains the source of truth for persistence.
- JSON is input, never a second schema.
- Seed code maps JSON to existing canonical Prisma models.
- The database is the canonical runtime store.
- The seed runner is not an alternative domain service and must not duplicate canonical application services where an existing service is suitable.

## Textbook catalogue

A textbook record must contain enough identity to resolve a stable bookKey, subject, grade, physical part when applicable, edition, title, issuer/publisher, and publication year when known.

The current database requires Textbook.part to be PART_1 or PART_2. A source that contains both semesters must not create a BOTH textbook part.

The supplied geography source therefore remains reviewable until its physical part is explicitly resolved.

## TOC-to-content mapping

TOC extraction preserves the printed source: original entry text, original printed page number, original entry order, and PDF pages containing the TOC.

For seeding, normalized structural records are derived from those entries:

Textbook -> Unit -> Lesson

A TOC entry must never invent a lesson end page. Where a range is required by the database, it is populated only from separately verified structural data.

Unit and lesson keys must be deterministic and stable.

## Concepts

Concepts are attached to a Lesson using the existing Concept model.

A concept seed may contain conceptKey, lessonKey, name/nameEn, description, orderIndex, difficulty, importance, masteryThreshold, isCore, pageNumber, bloomsLevel, and sourceRef.

The seed must not create learner mastery records. ConceptMastery is runtime learner state.

## Cross-grade concept relationships

The existing ConceptPrerequisite model is the canonical relationship.

Example:

MATH-G07-C-FRACTIONS requires MATH-G06-C-FRACTION-BASICS.

The relationship is stored by stable concept keys and resolved to IDs during seeding.

Required relationship fields are conceptKey, prerequisiteKey, strength, and requiredMastery.

The relationship source may be a reviewed JSON configuration file or an Android authoring/curation tool that produces the same canonical JSON contract.

Android must not write arbitrary database rows directly; it emits or updates the same validated seed contract.

## Questions

The existing Question model is used for all question origins.

Allowed origins already present in Prisma are TEXTBOOK, MINISTERIAL, AI, TEACHER, and UNKNOWN.

This workstream initially focuses on textbook questions, ministerial questions, and AI-generated questions.

Every question seed must identify a stable questionKey, lessonKey, type, text, origin, optional textbookRole, optional source/provenance, choices when applicable, answer key when applicable, and concept links.

AI-generated questions remain origin AI. They are not silently converted to textbook or ministerial questions.

## Supported question types

Use only the current Prisma QuestionType enum unless an audited schema change is approved:

MCQ_SINGLE, MCQ_MULTI, TRUE_FALSE, NUMERIC, SHORT_TEXT, FILL_BLANK, MATCHING, ORDERING, ESSAY.

## Deduplication and idempotency

The seed runner must be safe to execute repeatedly.

1. Stable keys prevent duplicate canonical records.
2. Repeated identical input produces no duplicate rows.
3. Question identity/content fingerprints may be used for normalized duplicate detection.
4. Conflicting records are reported rather than silently overwriting canonical content.
5. Existing learner attempts and historical evidence are never rewritten by content seeding.

## Learner evaluation boundary

The seed process creates educational facts only.

It does not seed learner attempts, mastery results, mastery evidence, learner misconceptions, adaptive decisions, XP, or completion history.

Those are runtime facts.

## No textbook binary storage

Do not create ContentAsset, TextbookPage.imageUrl, or LearningResource rows merely to preserve a textbook PDF.

Only create source/resource records when the product requirement explicitly needs semantic content delivery or provenance and the record has a valid canonical storage boundary.

For this lightweight evaluation scope, the essential persisted textbook representation is the catalogue/structure plus question/concept data.

## Seed package contract

Each package should declare:

{
  "schema_version": "1.0.0",
  "package_type": "QUESTION_BANK_SEED",
  "package_key": "EDU-AR-G07-P1-ED2026",
  "source": {
    "kind": "TOC_EXTRACTION",
    "source_file": "..."
  },
  "records": []
}

The JSON schema validates shape; the seeder validates referential integrity against PostgreSQL.

## Implementation gate

Before adding large question/concept datasets:

1. Freeze the seed JSON contract.
2. Implement one idempotent seeder.
3. Seed one textbook.
4. Verify Unit/Lesson/Concept/Question relations.
5. Verify repeated execution.
6. Verify cross-grade prerequisites.
7. Only then bulk-load the remaining books/questions.

No Prisma migration is part of this initial gate.
