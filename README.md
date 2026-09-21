# Edu_v10 — Adaptive Learning Platform

Clean Architecture + Bounded Contexts + grounded AI content preparation.

## Canonical documentation

All current architecture and engineering guidance is under:

**[Docs_v10/](Docs_v10/00-README.md)**

Read these first:

1. [Documentation index](Docs_v10/00-README.md)
2. [Architecture](Docs_v10/01-architecture.md)
3. [Domain contracts](Docs_v10/02-domain-contracts.md)
4. [Content authoring and delivery](Docs_v10/03-content-authoring-delivery.md)
5. [Assessment, mastery and learning](Docs_v10/04-assessment-learning-mastery.md)
6. [Content ingestion and AI](Docs_v10/05-content-ingestion-ai.md)
7. [AI developer instructions](Docs_v10/09-ai-developer-instructions.md)
8. [Current repository state](Docs_v10/11-current-state.md)

The old `docs/` directory is temporarily retained as historical source material while the documentation migration is verified. It is **not authoritative** for new development.

## Core architectural flow

```text
Interface
   ↓
Application use cases
   ↓
Domain rules
   ↑
Infrastructure adapters
   ↑
Composition root
```

Educational state:

```text
Assessment → Evidence → Mastery → Learning
```

## Important content rule

**PUBLISHED means ready for learner use; it does not mean immutable.**

Content may continue to be corrected and enriched after publication through the canonical authoring path.

Publication/readiness is separate from learning-path inclusion. A backend-owned learning-path control is the target contract for deciding whether a published lesson is eligible for guided progression.

## Quick start

```bash
npm install
npm run db:dev
cp .env.example .env
npm run db:apply
npm run db:seed
npm run dev
```

Health:

```bash
curl localhost:3000/api/v1/health
```

## Verification

Use the scripts actually defined in `package.json`:

```bash
npm run typecheck
npm run arch:check
npm test
npm run verify
```

Do not treat a green typecheck as proof that architecture, persistence, security, or the complete user flow is correct.

## Repository rules

- Prisma schema is the persistence source of truth.
- One owner per business decision.
- No duplicate write paths.
- No Prisma/provider SDKs in domain/application.
- Python/content engine never writes PostgreSQL.
- AI never directly writes canonical educational state.
- React renders backend decisions; it does not recreate them.
- Historical learner data is protected.
- Canonical keys never depend on order/index/position.
- Imports are validated, deduplicated, dry-run capable and idempotent.
