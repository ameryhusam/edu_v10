# API, Security and Frontend Boundaries

Status: ADOPTED
Last reviewed: 2026-09-22

## API
Current convention: /api/v1. Endpoints represent capabilities/use cases, not a generic database-table CRUD mirror.

Request flow:
validate → authenticate → authorize → application use case → result mapping → response

## Authorization and entitlement
Authorization is server-side. Role claims do not prove access to an arbitrary school, learner or resource. Guardian access requires verified relationship and per-request scope checks.

Learner access combines applicable publication/readiness, authorization, entitlement and learning-path eligibility. The backend owns the predicate.

## Assets
Workspace/local storage paths are never public learner URLs. Binary assets are delivered through authorized asset endpoints/streaming adapters.

## Frontend
API → React Server State → UI

React owns presentation, interaction, cache/revalidation, loading/error/empty states, navigation and accessibility.

React does not own authorization, entitlement, publication, mastery, grading, completion, next-step, canonical identity, deduplication or educational formulas.

## Clients
Web and Android consume the same API contracts and do not depend on Prisma, database internals or server filesystem paths.

## Errors
Business refusals use stable machine-readable codes. User-facing copy belongs at the interface/i18n layer.
