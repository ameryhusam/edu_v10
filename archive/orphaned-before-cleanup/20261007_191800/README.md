Archive README — how to restore

This archive folder contains a manifest and (optionally) copies of files that were considered non‑Question‑Bank.

To restore any file that was archived, use git to checkout the path from this branch, for example:
  git checkout feat/question-bank -- archive/orphaned-before-cleanup/20261007_191800/<path>

To permanently remove the original files from the repo (non‑reversible within branch commits), confirm with "DELETE_ORIGINALS" and I will perform the deletion in a follow-up commit.
