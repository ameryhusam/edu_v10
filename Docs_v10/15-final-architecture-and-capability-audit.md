# Final Architecture and Capability Coverage Audit

**Status:** ADOPTED audit baseline  
**Review date:** 2026-09-22  
**Scope:** repository code, Prisma schema, `architecture/`, and Docs_v10  
**Documentation precedence:** executable code/schema and `architecture/` are authoritative; Docs_v10 records the adopted product/operational contract. Historical `docs/` files are reference material only and are not architectural authority.

## 1. Canonical architecture

Edu7 follows:

```
Database
  ↓
Domain
  ↓
Canonical Services
  ↓
API
  ↓
React Server State
  ↓
UI
```

Backend ownership remains bounded by context. The frontend never becomes a second business-rule authority.

## 2. Education frontend boundary

`web/src/education/` is a presentation layer organized by educational responsibility.

A domain folder is valid when its responsibility is explicit. A file may not be placed directly at the education root.

### education/admin

`education/admin/` is **allowed**. It is a presentation subdomain, not a security or business-logic layer.

It may contain:
- reusable educational administration presentation components;
- textbook/content/lesson/resource/question management views that receive resolved data and callbacks as props;
- domain-specific tables, cards, drawers and visual editors;
- presentation-only formatting and interaction state.

It must not contain:
- API calls or API modules;
- React Query/server-state orchestration;
- authentication/session/role composition;
- authorization or entitlement decisions;
- canonical content/mastery/assessment/XP calculations;
- database identifiers exposed as user-facing entity selection fields;
- duplicate application/domain services;
- direct Prisma/backend imports.

Pages/features own orchestration. Backend canonical services own business decisions and authorization.

This means the architecture does not forbid the folder; it makes its responsibility explicit.

## 3. Verified capability coverage

The adopted contracts currently cover:

### Content intake and workspace
- raw PDF and prepared-package intake;
- SHA-256 fingerprinting;
- textbook identity based on subject + grade + physical part + printed edition;
- P1/P2 routing;
- G4/G04 and P1/PART_1 alias normalization;
- TOC and printed↔PDF mapping;
- unit/lesson segmentation;
- page rendering and stable page filenames;
- grounding;
- Workspace validation;
- full and partial ZIP exchange;
- staged merge;
- dry-run before apply;
- append-preserving partial updates;
- export of the physical workspace;
- failure/recovery rules.

### Page classification
- explicit manifest precedence;
- deterministic mapping;
- TOC evidence;
- subject/branch profile;
- AI proposal fallback;
- review/confidence gates;
- MIXED-page support;
- question-block extraction;
- Arabic/Islamic Studies/Quran branch-aware classification;
- configuration-driven labels and thresholds.

### Canonical import
- validation before persistence;
- identity reconciliation;
- CREATE/UPDATE/UNCHANGED/CONFLICT/INVALID/SKIP classification;
- canonical application-service writes;
- human Apply where required;
- audit/provenance;
- idempotent retry;
- operation envelope;
- no silent deletion from omitted partial files.

### Questions
- multi-file import;
- APPEND_DEDUP;
- merge into an existing set;
- semantic fingerprints;
- unchanged duplicate reporting;
- conflict review;
- per-file provenance;
- distinct QuestionOrigin and textbook question role;
- MINISTERIAL provenance;
- future question forms for word ordering, ascending/descending ordering and greater/less fill-in-the-blank.

### AI
- grounded inputs;
- provider/model/prompt provenance;
- structured proposal output;
- evidence validation;
- normalization;
- deduplication;
- human review;
- canonical Apply;
- Python and AI are never canonical database writers.

### Learning and learner state
- Assessment → Evidence → Mastery → Learning;
- canonical mastery ownership;
- misconception ownership;
- LearningDecisionLog;
- prerequisites and progression policy;
- remediation;
- InstructionalPlan/LearnerObligation separation;
- Due Work is not an adaptive-learning input;
- XP is append-only.

### Security and frontend
- backend authorization is authoritative;
- resource-level scope/entitlement;
- authorized asset delivery;
- role-specific route presentation guards;
- API → React Server State → UI;
- no raw database identifiers as visible entity labels;
- learner profiles follow people/provisioning rather than ad-hoc frontend creation.

## 4. Remaining implementation gaps

These are implementation gaps, not missing architectural decisions:

1. durable per-textbook operation lock/idempotency record for multi-worker production concurrency;
2. durable operation/readiness history;
3. semantic ZIP adapters for QuestionBank and Flashcard updates;
4. stronger append-only ContentAsset replacement/version policy;
5. end-to-end round-trip/retry/conflict/rollback tests for workspace ZIP workflows;
6. canonical persistence of grounding manifests into page/chunk entities;
7. durable AI provenance/source-fingerprint persistence;
8. complete question authoring/update/merge UI;
9. advanced question package support;
10. learner entitlement-aware lesson asset delivery;
11. explicit backend-owned learning-path inclusion control.

No UI-only workaround should be introduced for these gaps.

## 5. Administration UI placement rule

Administrative role is not itself a domain.

Use:
- `pages/admin` for route/page composition and role presentation;
- `features/*` for server-state/API-backed capabilities;
- `education/*` for reusable educational presentation;
- `education/admin/*` only when the reusable component is specifically educational administration presentation and remains presentation-only;
- backend `contexts/*` for canonical business decisions.

This prevents both extremes: a catch-all admin folder and an artificial ban on useful educational admin presentation components.

## 6. Verification gate

Before accepting a new capability:

1. identify the owning bounded context;
2. identify the canonical service/use case;
3. verify the API contract;
4. place server state in features/shared API;
5. place reusable educational presentation in education/<domain>;
6. keep role composition in pages/features;
7. verify authorization on the backend;
8. verify idempotency/audit/recovery for mutating workflows;
9. update Docs_v10 current-state when implementation status changes;
10. run `npm run verify`.

The architecture checker is a fitness function, not a file-placement preference.
