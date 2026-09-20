-- Exactly one CURRENT enrollment per learner (G1, P0.1 — the constraint the
-- schema comment on model Enrollment has promised since the baseline but
-- never actually created).
--
-- Not expressible as a plain Prisma `@@unique`: uniqueness must hold only
-- among rows where `isCurrent = true`. A learner may accumulate many
-- historical (isCurrent = false) enrollments across years/terms — that is the
-- whole point of the isCurrent flag — so a full unique index on `learnerId`
-- would forbid the history the model exists to keep. A *partial* unique index
-- is the only way to say "at most one current row" without also saying "at
-- most one row ever".
--
-- Before this migration, "at most one current enrollment" was an application
-- convention only (see contexts/administration enrollment writes) — nothing
-- in the database enforced it, so a bug or a concurrent write could silently
-- leave a learner with two CURRENT enrollments, which is exactly the
-- ambiguity every "which grade is this learner in right now" read implicitly
-- assumes cannot happen.
CREATE UNIQUE INDEX "enrollments_one_current_per_learner"
  ON "enrollments" ("learnerId")
  WHERE "isCurrent" = true;
