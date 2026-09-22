# AI, Evidence, Page Classification and Provenance

Status: ADOPTED
Last reviewed: 2026-09-22
Detailed algorithms: Docs_v10/13-content-storage-page-classification-and-import-algorithms.md

## AI authority
AI is an adapter/proposal generator, not canonical truth.

Evidence → AI analysis/classification → Proposal/Draft → schema/evidence validation → human approval when required → canonical application

AI must not directly write PostgreSQL, approve, publish, alter mastery, create learner evidence, alter authorization/entitlement, invent canonical identity, or bypass canonical services.

## Book segmentation and two-part detection
For books containing multiple physical parts, AI may analyze the table of contents/index and a configurable initial-page window (default proposal: first 15 PDF pages) together with page images/text and neighboring evidence.

AI may propose part boundary, unit/lesson boundaries, printed-page ranges, lesson type/branch and page roles.

The final Workspace manifest records the selected result, evidence and confidence. Conflicting evidence routes to review.

Physical routing is P1 for PART_1 and P2 for PART_2. There is no PB Workspace package. T01/T02 are academic-term coordinates and are not textbook identity components.

## Page classification
Page classification is semantic metadata. It is never encoded by renaming the image.

The original pages/page_NNN.* asset remains unchanged. page_classification.json describes how the page participates in different downstream uses.

A page can simultaneously be lesson content, question/exercise source, unit-assessment source, or mixed content.

Classification therefore supports independent routing flags rather than one mutually exclusive filename/category.

Conceptual fields include printedPageNumber, pdfPageIndex, contentType, branch, lessonType, questionRole, questionBlocks, lessonContent, unitAssessment, includeInLessonView, includeInQuestionExtraction, includeInUnitAssessment, confidence, evidence and source.

## Grounding
AI inputs should be grounded in textbook identity, physical part, unit/lesson, printed page, PDF index, neighboring-page metadata, extracted text, page image, TOC evidence, subject/branch profile and the allowed output schema.

## Classification precedence
1. explicit manual/validated manifest
2. validated deterministic mapping
3. TOC/index evidence
4. subject/branch profile
5. AI proposal
6. unresolved/review

The final classification records its evidence source.

## Provenance
Where supported by the schema/contract, record provider, model, task/purpose, source fingerprint, prompt/schema version, input identity, output status, review/approval state and correlation/request identifier.

Do not invent schema fields merely to satisfy documentation. If persistence is not supported, record the gap and pass through the schema/domain gate.

## Questions
A page is evidence, not automatically a Question row.

classified page → question blocks → structured question → QuestionType validation → normalization → fingerprint → dedup/conflict → canonical Question service

QuestionType and QuestionOrigin are independent dimensions. Origin describes provenance, not exercise shape.

## Human review
AI confidence routes review; it is not approval. A model's own claim that output is correct is never human approval.

## Detailed-document rule
The exact JSON schema, threshold values, configuration file shape and implementation steps belong to Docs_v10/13. This architecture document defines the invariant that classification is metadata and supports multi-purpose/mixed pages.