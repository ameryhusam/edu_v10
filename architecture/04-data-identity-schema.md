# Data, Identity and Schema Contract

Status: ADOPTED
Last reviewed: 2026-09-22
Primary persistence fact source: prisma/schema.prisma

## Schema authority
Prisma is the persisted-data source of truth. Do not add models/fields/enums merely for UI, AI prompt, script or documentation convenience.

## Identity normalization
Normalize before lookup, uniqueness checks, Workspace resolution and import comparison.

Grade aliases: G4 → G04; G07 → G07.
T01/T02 are academic-term coordinates only. They are NOT textbook identity or Workspace part coordinates.
Physical Workspace part coordinates are P1 → PART_1 and P2 → PART_2.
The mapping is explicit and must not be inferred by string replacement between term and part tokens.

## Textbook key
Adopted textbook keys use EDU-SCI-G07-P1-ED2026 and EDU-SCI-G07-P2-ED2026.
The textbook key contains physical part, not academic term. Exact persistence constraints are defined by the current Prisma contract and migration.

## Textbook versus adoption
Textbook is reusable content identity. TextbookAdoption represents institutional/year deployment.
Textbook is reusable content identity. TextbookAdoption carries school, academic year and the explicit term link; P1 maps to term 1 and P2 to term 2 for that academic year.

## Important entities
Textbook, TextbookAdoption, ContentAsset, TextbookPage, ContentChunk, LearningResource, Question, QuestionOrigin and QuestionType are distinct contracts.
orderIndex controls presentation order and never becomes identity.

## Two-part invariant
A two-part printed source is split during preparation. P1 and P2 become independent Workspace packages and independent canonical textbook identities because physical part is part of Textbook.key. PB is not a canonical Workspace/package identity.

## Historical data
Historical data migrations require affected-path analysis, explicit backfill/default strategy, compatibility planning and verification.