# modules/question-bank: JSON import usage

This document explains how to preview sample JSON imports using the prototype API.

1. Place your sample JSON file under `modules/question-bank/sample/`, e.g. `questions.json` (already included).
2. Start the prototype server (from repository root):
   - cd modules/question-bank
   - npm install
   - node ./dist/backend/server.js  # or run ts-node for direct execution during development
3. Call the preview endpoint:
   - POST http://localhost:4001/api/v1/imports/preview-from-sample
   - Body: { "sampleFile": "questions.json" }
4. The endpoint returns a jobId and an array of preview items with `fingerprint` and any `errors`.

Notes
- This is a prototype import preview. The next PHASE will add approval and DB persist steps.
