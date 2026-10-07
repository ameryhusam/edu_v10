# Running migrations and seed for Question Bank (instructions)

Prerequisites
- Node 18+
- A PostgreSQL database and DATABASE_URL env var set
- From repository root, ensure you have a working `pnpm/npm` environment

Steps
1. From repo root, generate Prisma client for question bank schema:
   cd modules/question-bank
   npm run prisma:generate

2. Apply migrations to the target DB (creates tables in the DB):
   npm run prisma:migrate

3. Build the module and run the seed script to populate initial data:
   npm run build
   npm run seed

4. Start the prototype server (serves API + frontend):
   npm run start

Notes
- The Prisma client for the Question Bank schema writes into the same DATABASE_URL you configure. If you want a separate DB, set DATABASE_URL accordingly before running migrations.
- Migrations are included in the `prisma/question_bank/migrations` folder in this branch (draft). Review them before applying in production.
