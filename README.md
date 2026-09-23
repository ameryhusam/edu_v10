# edu_v10 — Question Bank Mobile

Minimal Android-oriented evaluation profile.

Roles: SYSTEM_ADMIN, PARENT, CHILD.

Runtime: PostgreSQL + Prisma API. Android consumes REST; the server owns assessment and mastery state.

Core: grades, subjects, books, units, lessons, concepts, cross-grade prerequisites, questions, question-concepts, attempts, concept states, users and parent-child links.

## Data import

Put deterministic JSON book/index packages in `seeding/question_bank/packages/`.

`npm run db:import`

or:

`npm run db:import -- seeding/question_bank/packages/FILE.json`

The importer is transactional and idempotent.

## Development

`npm install`
`npm run db:generate`
`npm run db:push`
`npm run db:seed`
`npm run dev`

For the Android emulator, the app uses `10.0.2.2:3000` to reach the development machine API.
