# modules/question-bank

This module contains early domain code, evaluators and a deterministic exam builder used during PHASE 2 development.

Notes
- This module is intentionally self-contained and does not run database migrations or touch Prisma.
- It provides canonical types, evaluator implementations and unit tests to validate algorithms before integrating with the main backend.

How to run tests
- From repository root, install dev deps inside this module (optional):
  cd modules/question-bank
  npm install
  npm test

