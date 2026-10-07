# Question Bank — Product Scope

This document defines the scope, constraints and goals for the "بنك الأسئلة / Question Bank" product to be developed inside the repo branch `feat/question-bank`.

Key constraints (non-negotiable)
- Do NOT include/use Concepts, Mastery, School, Teacher accounts/profiles, Parent/Guardian, Enrollment, Learning Path, XP, Instructional Plan, academic-term relationships or any other LMS constructs inside the Question Bank product.
- Educational linkage for questions MUST be exactly:
  Subject → Grade → Unit → Lesson → Question
- `Part` (PART_1 / PART_2) is Content context only (display/filter metadata), not an academic `term`.
- `explanation` is optional; it MUST NOT be returned in any API response while an exam is in progress — only returned in review after submission.
- Matching and Ordering MUST be supported as interactive question types by the client; the backend provides canonical data and evaluation only.

Primary product goals
- A standalone Question Bank engine (minimal footprint inside the mono-repo) that provides:
  - Canonical Question Model and JSON Schemas per question type.
  - Import pipeline (JSON / Excel / Gemini) as draft specs (no imports run yet).
  - Deterministic Exam Builder (Fixed, Rule-based, Simple Adaptive).
  - Grading/evaluation engines per question type.
  - Attempt lifecycle + question review + per-lesson/unit/subject performance metrics.
  - Android student app contract & screen spec (implementation later).

Phase constraints for the work you approved
- PHASE 0 (this deliverable): repository audit, reuse mapping and analysis.
- PHASE 1 (this deliverable set): detailed specs, canonical model, JSON Schemas, API contract, DB mapping recommendations (no migrations), import templates and exam algorithms.
- No Prisma migrations or backend code will be created in PHASE 0/1.

Deliverables from PHASE 0/1
- Inventory mapping of repo files to `reuse / adapt / ignore` decisions.
- Docs_v10/question-bank/ 01..05 (this phase) and additional docs per plan.
- CanonicalQuestion JSON schema drafts and per-type schema drafts.
- API endpoint list and request/response contracts (high-level).
- DB mapping document that reuses the existing Prisma schema and lists fields/tables that will be added later (with rationale).

Acceptance criteria for PHASE 0/1
- Documents exist in `Docs_v10/question-bank/` and capture every item listed above.
- Clear list of files in the repo we will reuse, adapt or not use.
- Concrete list of DB changes required for PHASE 2 (but not applied yet).

