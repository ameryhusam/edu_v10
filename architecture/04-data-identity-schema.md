# Data, Identity and Schema Contract

Status: ADOPTED
Last reviewed: 2026-09-22
Primary persistence fact source: prisma/schema.prisma

## Schema authority
Prisma is the persisted-data source of truth. Do not add models/fields/enums merely for UI, AI prompt, script or documentation convenience.

## Identity normalization
Normalize before lookup, uniqueness checks, Workspace resolution and import comparison.

Grade aliases: G4 → G04; G07 → G07.
Term aliases T1/T01 are term identity aliases where applicable. They are NOT physical Workspace part coordinates.
Physical Workspace part coordinates are P1 → PART_1, P2 → PART_2, PB → BOTH.
The mapping is explicit and must not be inferred by string replacement between T1 and P1.

## Textbook key
Adopted examples use keys such as EDU-SCI-G07-T1-ED2026.
The textbook key may retain business term token T1 even though the physical Workspace path uses P1 for Part 1. Exact persistence constraints must be checked against current Prisma before implementation.

## Textbook versus adoption
Textbook is reusable content identity. TextbookAdoption represents institutional/year deployment.
If the current schema couples Textbook to Term/AcademicYear, that remains a schema fact. Cross-year reuse requires an explicit schema/domain gate.

## Important entities
Textbook, TextbookAdoption, ContentAsset, TextbookPage, ContentChunk, LearningResource, Question, QuestionOrigin and QuestionType are distinct contracts.
orderIndex controls presentation order and never becomes identity.

## Two-part invariant
A two-part printed book is one source publication only when the declared textbook identity/edition contract says so; physical part routing is represented independently by physicalPart/Workspace P1/P2/PB. Do not create duplicate textbook identities solely because the preparation filesystem has P1 and P2.
If the current schema requires separate rows for physical parts, that is a schema fact and must be resolved through a schema/domain gate rather than by changing Workspace semantics.

## Historical data
Historical data migrations require affected-path analysis, explicit backfill/default strategy, compatibility planning and verification.