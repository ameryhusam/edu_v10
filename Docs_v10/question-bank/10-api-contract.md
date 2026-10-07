# API contract (draft)

This is a high-level contract for the backend APIs used by Android and web clients.

Authentication
- POST /api/v1/auth/login
  - Body: { username, password }
  - Response: { token, user }

Student routes
- GET /api/v1/subjects?grade=G05
  - returns subject list with optional part info
- POST /api/v1/exams/self-generate
  - Body: { subjectId, gradeId?, part?, scope, lessons?, units?, count, strategy }
  - Response: { examId }
- GET /api/v1/exams/assigned
  - returns assigned exams for current student
- GET /api/v1/exams/:id
  - returns exam metadata only; no correct answer / explanation while in progress
- POST /api/v1/exams/:id/start
  - creates an Attempt and returns { attemptId, firstItem }
- GET /api/v1/attempts/:id/item/:n
  - returns question N from the current attempt
- POST /api/v1/attempts/:id/answer
  - Body: { examItemId, answerPayload, responseTimeMs }
  - stores normalized answer
- POST /api/v1/attempts/:id/submit
  - evaluates attempt and returns result summary
- GET /api/v1/attempts/:id/review
  - returns Q&A review only after submission
- GET /api/v1/performance?studentId=me&subjectId=&unitId=&lessonId=
  - returns performance metrics

Admin routes
- POST /api/v1/questions
  - create question manually
- GET /api/v1/questions
  - list/search/filter question bank
- PUT /api/v1/questions/:id
  - update question
- POST /api/v1/questions/import
  - upload/import JSON/Excel or trigger Gemini draft generation
- GET /api/v1/imports/:jobId
  - preview validation results
- POST /api/v1/imports/:jobId/approve
  - final approval + insert to bank
- POST /api/v1/exams
  - create fixed or rule-based exam
- POST /api/v1/exams/:id/assign
  - assign exam to student or grade

Security rules
- Do not return `correctAnswer` or `explanation` in any route while attempt is in progress.
- Do not expose `answerData` with answers for exam items before submission.
- Root permission: admin endpoints require admin role.

