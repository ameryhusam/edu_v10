# Audit_codex

Guardrail for changes made by Codex, ChatGPT, or normal Git commits.

## Purpose

Compare the latest two commits and produce a short report containing:

- old/new line counts per changed file
- added/deleted line counts
- files that are additions-only
- likely deleted function signatures
- likely added function signatures
- a simple decision signal:
  - `LOW_RISK_SIGNAL`: additions-only at line level
  - `REVIEW_REQUIRED`: deletions exist or function signatures disappeared
  - `NO_CHANGE`: no textual changes

## Run from the repository root

```bash
python Audit_codex/audit_commit_changes.py
```

By default it compares `HEAD~1` with `HEAD`.

To compare explicit commits:

```bash
python Audit_codex/audit_commit_changes.py <old-commit> <new-commit>
```

## Important limitation

This is a safety/monitoring guardrail, not a proof that the code is correct. It detects common TypeScript/JavaScript/Python function signatures, but a function can be renamed, moved, declared across multiple lines, or changed semantically without its signature disappearing.

Recommended workflow:

1. Let Codex/ChatGPT make the change.
2. Commit the change.
3. Run this audit.
4. If a function deletion is reported, inspect the diff before continuing.
5. Run the project's normal build/tests after the audit passes review.
