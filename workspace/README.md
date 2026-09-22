# Edu7 prepared workspaces

Generated content-preparation workspaces live here, outside `edu7-content-engine/`.

Canonical layout uses the physical textbook part, never the academic term:

- `P1/G04/MATH/ED2026/` → physical `PART_1`
- `P2/G04/MATH/ED2026/` → physical `PART_2`

`T01/T02` belong to `TextbookAdoption`/academic-term coordinates and are not Workspace identity segments. A combined source PDF is split into independent P1/P2 workspaces before import; no PB Workspace is emitted.
