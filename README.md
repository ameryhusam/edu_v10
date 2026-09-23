# edu_v10 — Question Bank Mobile

Minimal Android-ready evaluation profile. This branch is rebuilt from a clean tree and intentionally excludes Workspace, Python, PDF storage, schools, teachers, authors, reviewers, curriculum provisioning, and content workflow.

Roles: SYSTEM_ADMIN, PARENT, CHILD.

Runtime: PostgreSQL + Prisma API. Android consumes REST; the server owns assessment and mastery state.

Core: grades, subjects, books, units, lessons, concepts, cross-grade prerequisites, questions, question-concepts, attempts, concept states, users and parent-child links.

Setup: copy `.env.example` to `.env`, then run `npm install`, `npm run db:generate`, `npm run db:push`, `npm run db:seed`, `npm run dev`.
