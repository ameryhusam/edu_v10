# Documentation and Architecture Change Control

Status: ADOPTED
Last reviewed: 2026-09-22

## Purpose
Architecture documents contain durable decisions and boundaries. Detailed implementation contracts and algorithms remain in Docs_v10 and code.

## Change procedure
Proposed decision
→ inspect architecture
→ inspect Prisma + code
→ identify conflicts
→ explicit adoption decision
→ update canonical architecture documents
→ repository-wide stale-reference scan
→ implement
→ audit
→ verify

The implementation must not silently become the source of a new architectural rule.

## Superseding a decision
When a decision changes:
1. update the canonical document;
2. record the superseded decision and rationale;
3. update affected Docs_v10 references;
4. search for stale terminology/rules;
5. add an executable regression check where practical;
6. audit the implementation commit.

## Historical sources
Conversation exports, uploaded source notes and historical documents may explain rationale. They are evidence, not automatic authority. A decision becomes current when adopted in the repository architecture reference.

## Naming
Use stable English filenames. Do not create final/new/latest/temp architecture directories. The canonical location is architecture/.

## Cross-document terms
Maintain consistency for Textbook, TextbookAdoption, ContentAsset, TextbookPage, ContentChunk, PublicationStatus, QuestionOrigin, QuestionType and Workspace identity/path conventions.
