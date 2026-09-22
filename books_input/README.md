# Edu7 source books

Place source schoolbook PDFs here. This directory is intentionally outside `edu7-content-engine/`.

Source PDFs are inputs, not canonical textbook identities. The engine resolves the physical part (`PART_1`/`PART_2`) and derives the Edu7 `Textbook.key` from subject, grade, physical part, and printed edition.

For a combined source PDF, use `BOTH` only as source-input mode. Preparation must split it into independent `P1`/`P2` workspaces before canonical import; `BOTH`/`PB` is never a persisted textbook or Workspace identity.
