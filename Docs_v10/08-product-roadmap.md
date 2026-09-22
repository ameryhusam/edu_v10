# Product and Engineering Roadmap

**Status:** ADOPTED target roadmap.  
**Purpose:** define the production capability graph, workflow order, dependencies, algorithms and completion gates.  
**Repository implementation status:** tracked only in Docs_v10/11-current-state.md.

## 1. Production target

Edu7 converges on one educational platform where Content owns educational facts/readiness; Assessment owns attempts/grading; Evidence is historical; Mastery owns learner state; Learning owns progression; Instruction owns commitments; Engagement owns XP/streak/badges; Identity owns authorization; Python prepares source material but never writes PostgreSQL; AI proposes grounded content but never becomes a canonical writer; Web and Android consume the same authorized API.

## 2. Capability graph

    Institutional setup / Identity
            ↓
    Textbook catalogue + Content preparation
            ↓
    Content authoring + readiness
            ↓
    Content delivery
            ↓
    Assessment
            ↓
    Evidence
            ↓
    Mastery
            ↓
    Learning decisions
            ↓
    Instruction / learner obligations
            ↓
    Analytics / engagement

Cross-cutting: Security + Audit + Observability + AI governance + Data quality.

## 3. Workstream A — book intake and readiness

A1 raw PDF:

    upload → fingerprint → identity → prepare → ground → validate → READY_FOR_IMPORT

A2 prepared package:

    package → fingerprint → manifest validation → completeness → identity comparison → REUSE / RECONCILE / CONFLICT / NEW

A3 readiness catalogue:

    RECEIVED → IDENTIFYING → PREPARING → PREPARED → READY_FOR_IMPORT → IMPORTING → READY

with terminal review/failure states NEEDS_REVIEW, BLOCKED, FAILED and ARCHIVED.

Definition of done: duplicate upload is safe, readiness reason is visible, checksums are available, retry is idempotent and false READY states are prevented.

## 4. Workstream B — workspace and grounding

Deliver deterministic printed↔PDF mapping, hierarchy, page text/images, grounding chunks, checksums, manifests, cover and resource folders.

Gate: every learner-visible source claim is traceable to page/chunk/asset evidence.

## 5. Workstream C — canonical reconciliation/import

    read package
     → validate
     → identify
     → reconcile
     → dry-run
     → human Apply
     → canonical services
     → transaction
     → audit

Deliver textbook/unit/lesson reconciliation, TextbookPage/ContentChunk persistence, asset registration, resources/questions import, import result report and idempotency.

## 6. Workstream D — AI enrichment

    grounded input
     → provider-neutral AI
     → structured proposal
     → evidence validation
     → normalization
     → deduplication
     → human review
     → canonical Apply

Deliver concepts, explanations, questions, flashcards, misconceptions and full provenance: source fingerprint, page/chunk, provider/model and prompt version.

## 7. Workstream E — question bank evolution

Required: multi-file import, merge into existing batch/file, exact/normalized/identity dedup, conflict review, origin/provenance, advanced question types, safe corrections and historical safety.

## 8. Workstream F — authoring and readiness

Deliver DRAFT → IN_REVIEW → PUBLISHED → ARCHIVED, editable published content through canonical authoring, readiness validation, audit, learner delivery predicates and independent learning-path eligibility.

## 9. Workstream G — learner delivery

    request
     → auth
     → authorization
     → entitlement
     → publication/readiness
     → content query
     → asset authorization
     → response

Guided path adds learning-path eligibility, prerequisites, mastery and progression policy.

## 10. Workstream H — assessment/evidence

    Question → Attempt → AttemptItem → evaluator → MasteryEvidence → Mastery

Every result records evaluatorVersion and observedAt. Historical evidence is never silently rewritten.

## 11. Workstream I — mastery/adaptive learning

Mastery:

    ordered evidence → canonical mastery calculation → ConceptMastery

Learning:

    content structure + mastery + prerequisites + policy
      → next activity
      → LearningDecisionLog

Assignment due dates do not become implicit adaptive signals.

## 12. Workstream J — instruction

    InstructionalPlan
     → publish
     → obligation materialization
     → completion policy
     → LearnerObligation

Instruction records commitment, not grading/mastery/next-step.

## 13. Workstream K — analytics/engagement

Analytics consumes read models and historical facts.

Engagement consumes explicit eligible events and writes append-only ledger entries.

Neither mutates assessment/mastery/learning facts.

## 14. Workstream L — security/operations

Every capability requires backend authorization, resource-level access, audit, request correlation, stable errors, idempotency, metrics/logging and safe retries.

## 15. Dependency roadmap

### Phase 1 — Content foundation

identity → raw/prepared intake → workspace → grounding → assets → readiness

### Phase 2 — Canonical import

validation → reconciliation → dry-run → human Apply → page/chunk persistence → resources/questions

### Phase 3 — Authoring and delivery

authoring → review → publication/readiness → entitlement → learner delivery

### Phase 4 — AI enrichment

grounding → AI proposals → provenance → dedup → human review → canonical Apply

### Phase 5 — Assessment and adaptive learning

assessment → evidence → mastery → learning decisions → remediation

### Phase 6 — Instruction and engagement

learning decisions → instructional plans → obligations → completion → analytics/XP

### Phase 7 — Scale/integrations

reusable content → external libraries → bulk import/export → richer analytics → operational scaling

## 16. Milestone gate

A milestone is accepted only when:

1. owner is explicit;
2. canonical write path is unique;
3. input/output fields are documented;
4. authorization is server-side;
5. retry is idempotent;
6. historical data is safe;
7. relevant tests exist;
8. E2E works where user-visible;
9. observability exists;
10. Docs_v10 and implementation status agree.

## 17. Mature LMS comparison

Open edX demonstrates centralized reusable content libraries, publishing and synchronization. Edu7 should implement reusable canonical content without coupling identity to a course instance. citeturn0search0turn0search11

Canvas demonstrates explicit module requirements/prerequisites and conditional Mastery Paths. Edu7 should retain explicit progression gates while keeping grading, evidence, mastery and progression as separate owners. citeturn1search24turn1search14

Moodle demonstrates explicit completion criteria and competency/evidence relationships. Edu7 should use these patterns while preserving the stronger server-owned Evidence → Mastery → Learning boundary. citeturn1search9turn1search10

These are comparative references, not copied requirements.

## 18. Final production sequence

    SOURCE
     ↓
    IDENTITY + FINGERPRINT
     ↓
    PREPARE / REUSE
     ↓
    READINESS
     ↓
    RECONCILE
     ↓
    DRY-RUN
     ↓
    HUMAN APPLY
     ↓
    CANONICAL CONTENT
     ↓
    PUBLISH/READY
     ↓
    ENTITLEMENT
     ↓
    LEARNER DELIVERY
     ↓
    ASSESS
     ↓
    EVIDENCE
     ↓
    MASTERY
     ↓
    LEARNING DECISION
     ↓
    INSTRUCTION / ENGAGEMENT / ANALYTICS

At every transition: identity + validation + authorization + provenance + idempotency + audit.


## Workspace exchange roadmap addition

### ZIP import/export and synchronization gate

Add to the content foundation gate:

SOURCE/ZIP → SAFE INSPECTION → IDENTITY → STAGING → SHA-256 RECONCILIATION → DRY-RUN → CANONICAL IMPORT → WORKSPACE COMMIT → READINESS

Required outcomes:
- re-importing the same prepared book is idempotent;
- a new lesson/resource is placed under its canonical workspace path;
- changed content is detected by fingerprint and staged before replacement;
- partial updates never delete unrelated existing files;
- full-book exports round-trip back to the same textbook identity;
- ZIP traversal, duplicate entries, symbolic links, and decompression-resource attacks are rejected;
- semantic QuestionBank/Flashcard updates still pass through their canonical services rather than being inferred from arbitrary physical files.

The production gate remains incomplete until per-textbook operation locking/idempotency and dedicated semantic import adapters are implemented.

## 19. Detailed content-algorithm build roadmap

### Phase A — storage boundary

1. Keep binary files in ContentStorage/object storage, not PostgreSQL.
2. Persist semantic page text/chunks and ContentAsset metadata in PostgreSQL.
3. Ensure every asset has storageKey + checksum + relativePath + provenance.
4. Expose assets through authorized API delivery, never raw Workspace paths.

### Phase B — canonical identifier normalization

1. Normalize G4/G04 to G04 before lookup.
2. Normalize physical-part aliases P1/PART_1 and P2/PART_2 before identity lookup; T01/T02 remain academic-term coordinates only.
3. Keep T1 as the textbook-key term token, avoiding a global rename.
4. Resolve normalized identifiers against existing rows before creating anything.

### Phase C — page classification

1. Define configurable page/content labels.
2. Add manual page_classification.json support at lesson root.
3. Support unit defaults with lesson-level override.
4. Keep page_{number} filenames unchanged.
5. Add TOC/deterministic classification.
6. Add Arabic/Islamic/Quran branch-aware profiles.
7. Add configurable AI classification fallback and confidence thresholds.
8. Persist classification evidence/provenance.

### Phase D — semantic extraction

1. Segment MIXED pages into question/content blocks.
2. Import resources through LearningResource canonical services.
3. Import questions through Question canonical services.
4. Support multi-file APPEND_DEDUP question packages.
5. Support ministerial PDF → QuestionOrigin=MINISTERIAL.
6. Preserve source page/provenance and semantic fingerprints.

### Phase E — synchronization and recovery

1. Add durable per-textbook operation lock/idempotency.
2. Add package revision/base-revision metadata where required.
3. Complete atomic/retryable Workspace + DB reconciliation.
4. Add full/partial ZIP round-trip tests.
5. Add duplicate, changed-file, alias, malformed ZIP and rollback tests.

### Phase F — release gate

A phase is complete only when the relevant executable contract, tests, audit/provenance, retry behavior and Docs_v10 state agree. Target documentation must remain labelled TARGET/NOT YET IMPLEMENTED until verified in source.

## 20. Algorithm configuration set

The content engine should maintain a dedicated configuration set for:

    config/
      default.yaml
      toc-detection.yaml
      lesson-segmentation.yaml
      page-classification.yaml
      question-detection.yaml
      question-import.yaml
      subjects/
        arabic.yaml
        islamic.yaml
        quran.yaml
        mathematics.yaml
        science.yaml

Each configuration carries configVersion and the processing operation records algorithmVersion. Configuration contains rules and thresholds; Python code contains algorithm implementation.

## 21. Developer guide gate

Docs_v10/14-developer-content-ingestion-guide.md is the operational checklist for developers preparing or importing content. It defines required identity, Workspace structure, classification, question/resource handling, ministerial imports, alias normalization, storage boundaries and failure decisions.
