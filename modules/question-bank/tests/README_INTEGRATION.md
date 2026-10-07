### Running integration tests (SQLite quick start)

1. Ensure you have the repo checked out and working Node environment.
2. From repo root:
   cd modules/question-bank
3. Set TEST_DATABASE_URL to an sqlite file for fast local tests (example):
   export TEST_DATABASE_URL="file:./tmp-test.db"
4. Generate prisma client for test schema if needed and apply migrations (see README_db.md). For a quick smoke test you can skip migration, but integration tests expect schema applied.
5. Run:
   npm run test:integration

Notes:
- For a reliable integration run use a Postgres test DB and set TEST_DATABASE_URL accordingly.
- These tests are intentionally guarded — they will not run unless TEST_DATABASE_URL is present to avoid accidental runs against production DBs.
