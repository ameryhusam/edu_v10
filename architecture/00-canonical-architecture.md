# Canonical Architecture

Status: ADOPTED
Last reviewed: 2026-09-22

## Application architecture
Edu7 uses Node.js + TypeScript with Clean Architecture and bounded contexts.

Interface → Application → Domain
Infrastructure → Application/Domain contracts
Composition → wiring

Domain contains pure rules and must not import Prisma, Express, filesystem APIs, provider SDKs, environment readers, or UI code.

Application owns use cases, orchestration, ports, authorization coordination and transaction boundaries.

Infrastructure owns Prisma repositories, ContentStorage, workspace/PDF adapters, AI provider adapters, hashing, MIME handling and streaming.

Interface owns HTTP translation, validation, authentication middleware, response mapping and frontend delivery.

## Decision ownership
canonical content identity → Content/shared identity contract
grading/answer verdict → Assessment
historical evidence → Assessment
mastery → Mastery
progression/next activity → Learning
learner obligations → Instruction
publication/readiness → Content
authorization/entitlement → Identity + application access boundary
learning-path inclusion → Learning/Content contract
XP/streak/badges → Engagement

A consumer may read a decision but must not recreate it.

## Hard boundaries
1. Assessment never writes mastery.
2. Mastery never substitutes raw attempts for evidence.
3. Learning never patches mastery/evidence.
4. Instruction never owns scores, mastery or adaptive next-step decisions.
5. Engagement does not change mastery or learning truth.
6. Python never writes PostgreSQL.
7. AI providers never receive Prisma access.
8. React never becomes a business-rule authority.
9. Do not create a second canonical service/repository/write path.
10. Keys are never derived from presentation order.

## Publication
PUBLISHED means ready/eligible for learner use subject to backend readiness and access rules. It does not mean immutable.

Publication/readiness and learning-path inclusion are independent dimensions. Changing one must not silently change the other.

## Historical data
Attempts, evidence, mastery history, grading results, decision logs and XP ledger facts are historical records. Changes affecting their meaning require an explicit migration/version/evaluator strategy.
