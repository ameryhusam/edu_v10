# Data, Identity and Schema Contract

Status: ADOPTED
Last reviewed: 2026-09-22
Primary persistence fact source: prisma/schema.prisma

## Schema authority
Prisma is the persisted-data source of truth. Do not add models/fields/enums merely for UI, AI prompt, script or documentation convenience.

## Identity normalization
Normalize before lookup, uniqueness checks, Workspace resolution and import comparison.

G4 → G04
G07 → G07
T1 → T01 filesystem term coordinate
T01 → T01 filesystem term coordinate

Physical part coordinates are P1/P2/PB and must not be confused with term coordinates.

## Textbook key
Adopted examples use keys such as EDU-SCI-G07-T1-ED2026. Exact persistence constraints must be checked against current Prisma before implementation.

## Textbook versus adoption
Textbook is reusable content identity. TextbookAdoption represents institutional/year deployment.

If the current schema couples Textbook to Term/AcademicYear, that remains a schema fact. Cross-year reuse requires an explicit schema/domain gate.

## Important entities
Textbook, TextbookAdoption, ContentAsset, TextbookPage, ContentChunk, LearningResource, Question, QuestionOrigin and QuestionType are distinct contracts.

orderIndex controls presentation order and never becomes identity.

Historical data migrations require affected-path analysis, explicit backfill/default strategy, compatibility planning and verification.
