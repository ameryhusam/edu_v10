# API, Security and Frontend Boundaries

**Status:** ADOPTED; implementation is partially complete.

## 1. API

One stable API surface should be preferred. Current repository convention is `/api/v1`.

Endpoints represent use cases, not database tables.

Preferred route flow:

```text
parse/validate
  ↓
authenticate
  ↓
authorize
  ↓
application use case
  ↓
result mapping
  ↓
response envelope
```

Do not add a parallel API version or generic CRUD surface to patch one local problem.

## 2. Authorization

Authorization is a backend responsibility.

Roles are scoped to institutions where applicable.

A token claim is not sufficient to prove access to another learner.

Guardian access requires a verified guardian link and a per-request server-side check.

Authorization must be tested at the use-case/route boundary, not assumed because the UI hides a button.

## 3. Authentication

Sessions are server-controlled and refresh tokens are revocable/rotating.

Cookie security must respect deployment context. `SameSite=None` requires `Secure`.

Do not infer browser behavior from curl/jsdom-only checks.

## 4. Frontend architecture

```text
API
 ↓
server/query state
 ↓
UI
```

React owns:

- presentation;
- interaction;
- loading/error/empty/retry states;
- cache/revalidation;
- accessibility;
- navigation.

React does not own:

- mastery;
- grading;
- next-step;
- completion;
- canonical keys;
- authorization;
- entitlement;
- publication;
- deduplication;
- educational formulas.

## 5. Content/admin UI

Admin/authoring UI can display all statuses permitted by role.

Learner UI must receive already-authorized/readiness-filtered data from the backend.

A toggle such as "show in learning path" is a command to a backend use case, not a local boolean that changes the UI only.

## 6. Web and Android readiness

Web and Android should consume the same API contracts.

Do not make either client depend on local workspace paths, Prisma, internal storage keys, or server filesystem structure.

Binary assets should be streamed through authorized API endpoints.

## 7. Design system

Current frontend design direction uses Tailwind v4 semantic tokens and theme values in the design-system token layer.

Components should use semantic tokens rather than palette-specific literals.

Do not reintroduce arbitrary hex/rgb/hsl values or duplicate token systems.

Accessibility and responsive behavior are product requirements, not post-processing.

## 8. API error semantics

Business refusal should have stable machine-readable error codes.

UI copy belongs at the interface/i18n layer, not inside domain rules.

A route must not catch a domain error and replace it with an unrelated generic success.

## 9. Entitlement

Publication is necessary but not sufficient for learner access.

The backend should combine:

```text
publication/readiness
+ entitlement
+ authorization
+ learning-path eligibility (when relevant)
```

The current lesson asset listing is staff-scoped; a learner-facing entitlement-aware endpoint remains a tracked gap.
