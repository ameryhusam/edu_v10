# Migrating from the legacy codebase

The parent repository is a **behavioural reference**, not a source to copy. This
document records what was kept, what was redesigned, and what was deliberately
dropped — so the decisions are reviewable rather than implicit.

---

## 1. Kept (the good ideas)

These were correct in the legacy project and survive largely intact:

| Idea | Legacy location | Now |
|---|---|---|
| BKT for mastery | `src/engine/knowledge-tracing/bkt.ts` | `contexts/mastery/domain/bkt.ts` |
| IRT 3PL + Fisher information | `src/engine/psychometrics/irt.ts` | `contexts/assessment/domain/irt.ts` |
| CAT with exposure control | `src/engine/psychometrics/cat.ts` | `contexts/assessment/domain/adaptive-selection.ts` |
| Ebbinghaus forgetting | `src/engine/knowledge-tracing/mastery-decay.ts` | `contexts/mastery/domain/retention.ts` |
| Evidence contract | `src/services/assessment/answer-evidence.ts` | `contexts/assessment/domain/evidence.ts` |
| Versioned evaluator | `evaluation/canonical-evaluator.ts` | `contexts/assessment/domain/evaluation.ts` |
| Arabic normalisation | scattered | `evaluation.ts` — one policy, steps recorded |
| Deterministic keys | `utils/curriculum-code.generator.ts` | `shared/kernel/identifiers.ts` |
| Response envelope | `utils/envelope.ts` | `shared/http/envelope.ts` |
| Grounded AI + refusal sentence | `ai/ai_gateway.interface.ts` | `contexts/tutoring/domain/grounding.ts` |
| Deterministic AI fallback | `ai/providers/deterministic_fallback.provider.ts` | `infrastructure/ai/deterministic.provider.ts` |
| Content hierarchy & prerequisites | `prisma/schema.prisma` | same shape, cleaner constraints |
| Misconception-tagged distractors | `QuestionChoice.misconceptionId` | kept — it is the basis of remediation |
| WASM schema-engine workaround | `scripts/setup-wasm-engines.mjs` | ported for Postgres |
| Demo curriculum data | `data/demo/*.json` | informs the seed |

The Arabic-language architecture docs (`EDU7_TARGET_ARCHITECTURE.md`,
`LEARNING_DOMAIN_BLUEPRINT`) had already diagnosed most problems correctly. This
build implements those conclusions rather than re-deriving them.

---

## 2. Redesigned

| Legacy | Problem | Now |
|---|---|---|
| 51 models, string statuses | typos became runtime bugs | 39 tables, 12 real Postgres enums |
| 20+ migrations | conflicted; not replayable | **one baseline migration** |
| SQLite with 3 URL resolvers | `db push` and the server used different files | PostgreSQL, URL resolved once in `prisma.config.ts` |
| `Int` autoincrement ids | collide across environments | UUID `id` + canonical `key` |
| 4 mastery formulas, 5 write sites | numbers nobody could defend | one estimator, one write path, enforced by rule `M1` |
| Mastery patched incrementally | drifted; not reproducible | recomputed from the evidence stream |
| Decay stored in a column | needed a mutation job | projected at read time |
| `engine/` global facade | imported by React components | per-context `domain/` folders, no facade |
| Item choice by difficulty distance | not psychometrics | Fisher-information CAT |
| Services returning Prisma rows | UI re-derived business rules | use cases return decisions with rationale |
| `/api` + `/api/v1` | two contracts | one version |
| Prisma in ~100 files | database was the architecture | ports + adapters, rule `P2` |
| `process.env` everywhere | failures at request time | validated once at boot |
| `Attempt.kind` as string | — | `AttemptKind` enum, `EXPIRED` distinguished from `ABANDONED` |
| XP as a mutable counter | drifted | append-only ledger |

### Naming

The legacy project agonised over `Curriculum` vs `Textbook`, with a schema model
named one thing and a product language using the other. Resolved: the model is
`Textbook`, matching the product language. No mapping layer, no ambiguity.

---

## 3. Dropped

| Dropped | Why |
|---|---|
| `docs/archive/`, duplicated audit reports | superseded; history is in git |
| `verify-*.ts` scripts (~30) | replaced by 71 real tests + 11 architecture rules |
| `src/engine-client/`, `src/generators/` | experimental; no production path |
| Lab UIs importing engines into the browser | documented as labs, banned as product |
| Google Drive / Excel / PDF import | valuable, but not foundational — re-add against the new ports |
| `AUDIT-*.txt` at repo root | doc sprawl was itself a symptom |

Nothing is deleted from the legacy repository; it remains intact as reference.

---

## 4. Bugs found while rebuilding

Both were caught by the new tests and rules, which is the argument for having
them:

1. **Zero-weight evidence still advanced mastery.** The BKT learning transition
   was applied even for observations carrying no signal, so submitting blank or
   ungradable answers nudged mastery upward. Fixed in `bktReplay`; locked by a
   test.

2. **Mastery recompute was not idempotent.** Memory stability was seeded from
   the previously *stored* value, so each run compounded on the last and the
   same evidence produced a different answer every time. Fixed by seeding from a
   constant; locked by a three-run regression test.

The legacy schema would have permitted both indefinitely.

---

## 5. Porting a feature

1. Write the rule as a pure function in the owning `contexts/*/domain/`.
2. Test it — no database, no mocks.
3. Declare what it needs as a port in `application/ports.ts`.
4. Write the use case; it orchestrates only.
5. Implement the port in `infrastructure/`.
6. Wire it in `composition/container.ts`.
7. Add the route.
8. `npm run arch:check && npm test`.

If step 1 is hard because the rule needs the database, the rule is probably two
rules — split it.

---

## 6. Data migration

Not yet written, and it should be evidence-first when it is:

1. Reference data (years, terms, grades, subjects, schools).
2. Content, deriving canonical keys from academic coordinates.
3. Questions, answer keys, misconception links.
4. Users and learner profiles.
5. **`StudentAnswerHistory` → `MasteryEvidence`**, preserving real answer
   timestamps.
6. Run `RecomputeMastery` for every learner.

Step 6 matters: legacy `ConceptMastery` values were produced by four different
formulas and should not be copied. Recompute them from the evidence instead —
which is possible precisely because evidence carries `observedAt`.
