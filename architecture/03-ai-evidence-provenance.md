# AI, Evidence and Provenance

Status: ADOPTED
Last reviewed: 2026-09-22

## AI authority
AI is an adapter/proposal generator, not canonical truth.

Evidence → AI analysis/classification → Proposal/Draft → schema/evidence validation → human approval when required → canonical application

AI must not directly write PostgreSQL, approve, publish, alter mastery, create learner evidence, alter authorization/entitlement, invent canonical identity, or bypass canonical services.

## Grounding
AI inputs should be grounded in textbook identity, unit/lesson, printed page, neighboring-page metadata, extracted text, page image, TOC evidence, subject/branch profile and the allowed output schema.

## Classification precedence
1. explicit manual manifest
2. validated deterministic mapping
3. TOC evidence
4. subject profile
5. AI proposal
6. unresolved/review

Arabic and other branch-rich subjects require branch-aware profiles. The word “lesson” alone is insufficient to determine semantic lesson type.

## AI pages
Original pages/page_NNN.* remains unchanged. AI-derived representations may be stored under ai_pages/ and linked to the same printed page. Temporary provider bundles must not become accidental permanent storage.

## Provenance
Where supported by the schema/contract, record provider, model, task/purpose, source fingerprint, prompt/schema version, input identity, output status, review/approval state and correlation/request identifier.

Do not invent schema fields merely to satisfy documentation. If persistence is not supported, record the gap and pass through the schema/domain gate.

## Questions
A page is evidence, not automatically a Question row.

classified page → question blocks → structured question → QuestionType validation → normalization → fingerprint → dedup/conflict → canonical Question service

QuestionType and QuestionOrigin are independent dimensions. Origin describes provenance, not exercise shape.

## Human review
AI confidence routes review; it is not approval. A model's own claim that output is correct is never human approval.
