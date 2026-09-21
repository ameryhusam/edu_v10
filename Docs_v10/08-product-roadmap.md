# Product and Engineering Roadmap

**Status:** ADOPTED target roadmap. Repository implementation status is tracked in `Docs_v10/11-current-state.md`, not here.

## 1. Production target

Edu7 is intended to converge on one production architecture in which bounded contexts own their business decisions, canonical application services own writes, Prisma is the persistence source of truth, Python prepares content but never writes the database, AI proposes grounded drafts but never becomes a canonical writer, Web and Android consume the same authorized API contracts, and learner state remains historical, reproducible and server-owned.

This roadmap describes the target capability graph and dependency order, not a claim that every capability already exists.


## 2. Content direction

The content platform is converging on:

```text
Textbook
 → Units
 → Lessons
 → Concepts
 → Resources / Questions / Flashcards / Misconceptions
 → Pages / Chunks / Assets
```

The content engine remains an external producer/evidence boundary.

## 3. Immediate content gaps

1. Canonical mapping of grounding manifests into TextbookPage/ContentChunk.
2. AI provenance/source fingerprint persistence.
3. Preview → deduplicate → human Apply.
4. Question batch update/merge with deduplication.
5. Advanced question-type contracts.
6. Explicit learning-path inclusion control.
7. Entitlement-aware learner page endpoint.
8. Asset replacement/version semantics and E2E coverage.

## 4. Product gaps

Depending on the current capability ledger and repository state:

- full question authoring/review;
- learning resources CRUD;
- exams authoring/scheduling;
- remediation lifecycle;
- assignments/instruction;
- analytics/read models;
- engagement ledger behavior;
- richer seed data;
- import/export tooling.

Do not implement these by copying the old project's structure.

## 5. Recommended order

```text
Identity/access hardening
       ↓
Content authoring + delivery correctness
       ↓
Assessment/evidence/mastery integration
       ↓
Learning-path controls
       ↓
Instruction/assignments
       ↓
Analytics/engagement
       ↓
Import and external library adapters
```

This is a dependency order, not a product ranking.

## 6. Target content update model

Content is continuously editable after publication.

For every update:

```text
request
 ↓
authorization
 ↓
canonical authoring use case
 ↓
identity/relationship validation
 ↓
content validation
 ↓
historical compatibility check
 ↓
transaction
 ↓
audit
 ↓
read-model/cache invalidation where required
```

## 7. Learning-path model

The guided path should select only content satisfying:

```text
PUBLISHED
AND entitled
AND authorized
AND includedInLearningPath
AND prerequisite/learning rules
```

Direct content browsing can use a broader published set, subject to entitlement/authorization.

## 8. Content import model

```text
source
 ↓
workspace / package
 ↓
schema validation
 ↓
relationship validation
 ↓
dedup/conflict
 ↓
dry run
 ↓
canonical apply
 ↓
audit
```

No direct DB writes from Python or import scripts.

## 9. Definition of done for a capability

A capability is done only when:

- owner is explicit;
- write path is unique;
- public contract is defined;
- persistence is safe;
- authorization is enforced;
- architecture checks pass;
- regression behavior is tested;
- user-visible flow works where applicable;
- documentation reflects the actual state.

