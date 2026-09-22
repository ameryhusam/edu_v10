# Development, Codex and Audit Protocol

Status: ADOPTED
Last reviewed: 2026-09-22
Related: system instructions.txt and Docs_v10/09-ai-developer-instructions.md

## Roles
ChatGPT inspects repository/schema/code/docs, finds root causes, proposes the smallest coherent repair and identifies documentation impact.

Codex implements the approved/proposed repair, preserves contracts and creates the project commit. Its completion message is not proof of correctness.

Audit_codex inspects the latest project commit, preserves evidence, identifies change/deletion risk and writes persistent feedback.

## Mandatory cycle
Inspect current state
→ architecture/schema/code audit
→ repair proposal
→ Codex implementation
→ project commit
→ Audit_codex latest project commit
→ read latest_commit_feedback.txt
→ inspect diff/semantic correctness
→ build/tests/verification
→ next task

## Audit target
The audit evaluates the latest project commit outside audit-tool/report-only changes.

Command:
cd ~/edu_v10
python Audit_codex/audit_commit_changes.py

Report:
Audit_codex/report/latest_commit_feedback.txt

REVIEW_REQUIRED stops the next repair decision until the affected diff/behavior is reviewed.

## Historical comparisons
Historical commit comparisons are investigation evidence only and are not current correctness evidence.

## Verification
Use actual package scripts. Known gates:
npm run typecheck
npm run arch:check
npm test
npm run verify

Never claim a command passed unless it was actually executed.

## Safety
Prefer small traceable changes, existing canonical owners and compatibility-preserving behavior. Avoid duplicate services/write paths, destructive Git operations, suppression instead of fixes, and schema changes without domain justification.
