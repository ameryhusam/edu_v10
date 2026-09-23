# Question-bank JSON contract

Prisma schema is the source of truth.

Deterministic keys:
- Book: EDU-{SUBJECT}-{GRADE}-{PART}-{EDITION}
- Unit: {BOOK_KEY}-U{NN}
- Lesson: {UNIT_KEY}-L{NN}
- Concept: {SUBJECT}-{GRADE}-C-{CONCEPT_SLUG}

The educational index is Book → Unit → Lesson. Concepts come from the actual educational knowledge/skills represented by lessons, not from every title in the table of contents.

JSON packages live in `seeding/question_bank/packages/`.

Import all packages with:
`npm run db:import`

Import one package with:
`npm run db:import -- seeding/question_bank/packages/FILE.json`

The importer is transactional and idempotent. It does not use Workspace, Python or PDF storage.
