# Content Authoring, Readiness, Delivery and Learning Path

**Status:** ADOPTED; target production contract. Implementation status is tracked only in `Docs_v10/11-current-state.md`.

## 1. Content hierarchy

Canonical hierarchy:

```text
Textbook
  └─ Unit
      └─ Lesson
          └─ Concept
```

Supporting entities include prerequisites, questions, answer keys, resources, flashcards, pages, chunks, misconceptions and assets.

Content owns authored facts. Learning owns learner decisions.

## 2. Authoring vs delivery

Authoring is a staff capability. Delivery is a learner capability.

Authoring reads may inspect DRAFT, IN_REVIEW, PUBLISHED and ARCHIVED according to role.

Learner-facing reads must apply backend predicates for:

1. readiness/publication;
2. entitlement;
3. authorization;
4. learning-path inclusion where the endpoint is a guided progression endpoint.

Do not duplicate these predicates in React.

## 3. Publishing/readiness workflow

```text
DRAFT
  ↓ submit
IN_REVIEW
  ↓ approve
PUBLISHED
  ↓ archive
ARCHIVED
```

Rejection may return IN_REVIEW → DRAFT with a reason.

PUBLISHED may be edited. A publish state is a serving/readiness state, not a content lock.

Every edit to published content must pass the normal authoring policy:

- validate the changed structure;
- preserve canonical identity;
- preserve historical learner references;
- audit meaningful changes;
- re-evaluate any derived indexes/read models affected;
- never expose an invalid intermediate state.

## 4. Content editing rules

### Identity fields

Keys/slugs are frozen after creation unless an explicit migration workflow exists.

### Structural fields

Changes to hierarchy, prerequisites, concept meaning, question identity, or other fields consumed by pedagogical engines require stronger validation and historical compatibility.

The system must not equate "published" with "cannot edit".

### Presentation fields

Names/descriptions/media metadata can normally be edited through the canonical authoring path, subject to validation.

### Order

`orderIndex` is presentation order. Reordering must not change keys.

## 5. Learning-path toggle

The product requires a backend-owned control to distinguish:

- content available for direct use;
- content eligible for the learner's guided learning path.

Preferred contract:

```text
publication/readiness → availability
includeInLearningPath → progression eligibility
```

Do not use the current `isActive` flags as a substitute without auditing their existing semantics.

Do not let the frontend filter a published lesson out of the path as the authoritative decision. The Learning use case must consume the canonical backend value.

A future schema change should be introduced only after:

1. domain name and ownership are decided;
2. affected use cases are listed;
3. migration is designed;
4. existing content receives an explicit default;
5. tests prove published-but-excluded content remains directly readable but is not selected by next-step/path logic.

## 6. Questions

Question identity is stable and lesson-owned.

Keep separate:

- Question;
- QuestionChoice;
- AnswerKey;
- QuestionConcept.

Answer keys are never exposed to learners.

Question origin and visibility are distinct concepts.

Supported origin vocabulary currently includes TEXTBOOK, TEACHER, MINISTERIAL, AI, UNKNOWN.

## 7. Flashcards

Flashcards are learning objects/content, not automatically children of questions.

They do not own learner scheduling state. Retention/mastery owns learner-state calculations.

## 8. Resources and assets

A physical file is not automatically a pedagogical resource.

- ContentAsset → physical binary identity/provenance.
- LearningResource → pedagogical meaning.
- TextbookPage/ContentChunk → source/grounding material.

Storage keys and checksums belong to asset infrastructure. Internal filesystem paths never reach clients.

## 9. Content review

Structural validation should be pure and return all relevant failures.

At minimum validate:

- hierarchy completeness;
- duplicate order;
- valid order continuity where required;
- prerequisite scope;
- prerequisite cycles;
- threshold ranges;
- required content layers;
- concept reachability.

AI review can report issues, but it cannot approve or publish canonical content.

## 10. External source distinction

An externally approved textbook is a source.

Edu7's `PUBLISHED` state means the Edu7 representation is ready for learner use. It does not claim official educational publication or ministry approval.
