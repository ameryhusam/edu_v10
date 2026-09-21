# Domain Contracts and Data Integrity

**Status:** ADOPTED.

## 1. Identity

Every business entity normally has:

- `id`: internal UUID for relations.
- `key`: stable business identifier when the entity is externally referenceable.
- `orderIndex`/ordinal: display or sequence position, never identity.

### Key rules

- Keys are deterministic and business-derived.
- Keys must not depend on UUIDs, timestamps, randomness, or order.
- `orderIndex` must never be an input to key derivation.
- Slugs may be generated from names at creation, optionally overridden, then frozen.
- Arabic and Unicode names must normalize correctly.
- Renaming a display name must not silently regenerate a frozen key.
- Reordering must not rename content.

## 2. Textbook identity

`Textbook` represents a printed book/edition.

Identity is based on subject + grade + term + printed edition.

Academic year of use belongs to `TextbookAdoption`, not the textbook identity.

Do not introduce a version/revision entity merely to model editorial improvement. A genuinely different printed edition is a new textbook identity.

## 3. Publication/readiness

Edu7 does not approve or officially publish an external textbook.

The external authority approves the source. Edu7 determines whether its ingested representation is ready for use.

The canonical state axis remains:

```text
DRAFT → IN_REVIEW → PUBLISHED → ARCHIVED
```

But the meaning is:

- **DRAFT** — being prepared.
- **IN_REVIEW** — under internal review.
- **PUBLISHED** — ready to be served to learners in Edu7.
- **ARCHIVED** — not normally served.

### Critical correction

`PUBLISHED` does **not** mean immutable.

Published content may be edited through the same canonical authoring services. Structural and pedagogical changes require the appropriate validation, audit, compatibility checks, and historical-data protection. Do not create a fake versioning system merely because editing is allowed.

If a future requirement needs immutable historical snapshots/diffs, design that explicitly as an audit/history capability rather than smuggling it into publication status.

## 4. Learning-path inclusion

Publication and learning-path inclusion are separate.

Recommended target contract:

```text
published = learner may receive/read the content
learning-path eligible = adaptive/progression engine may place it in the guided path
```

A lesson can therefore be:

| Published | In learning path | Meaning |
|---|---|---|
| no | no | authoring/review only |
| no | yes | invalid learner state; inclusion cannot expose unpublished content |
| yes | no | available as direct/reference content but not selected by the guided path |
| yes | yes | normal guided learning content |

The backend must enforce this. A UI toggle alone is insufficient.

The exact field name and storage location must be verified against the current schema before migration. Do not add a field solely because a UI asks for it.

## 5. Historical learner data

Attempts, evidence, mastery observations, decision logs, XP ledger entries, and grading results are historical records.

Content changes must not silently:

- delete them;
- rewrite their meaning;
- change old question answers;
- alter historical evidence;
- recalculate history using a new evaluator without versioning.

If a grading rule changes, record evaluator version. If an existing question needs a materially different identity, create a new question identity rather than silently changing the historical item.

## 6. Idempotency

Any externally retriable operation must be safe to repeat.

Examples:

- import package;
- content asset registration;
- question batch;
- assignment materialisation;
- XP award;
- session refresh;
- workspace reconciliation.

Idempotency keys must be derived from business identity, never timestamps/randomness.

## 7. Duplicate policy

Deduplication belongs to the owner of the entity.

A typical import result is:

```text
unchanged | create | conflict | invalid | skipped
```

Missing incoming data does not mean delete.

Same identity + same canonical content → unchanged.

Same identity + conflicting content → explicit conflict/review.

No silent overwrite of historical educational entities.

## 8. Schema authority

`prisma/schema.prisma` is the canonical persistence contract.

Do not add fields/models because a seed file, UI, Python script, AI response, or spreadsheet wants them.

When a real domain requirement needs a schema change:

```text
domain contract → schema/migration → adapter compatibility → tests → implementation
```

Seed follows schema, never the reverse.
