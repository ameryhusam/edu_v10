# وثيقة واجهات برمجة التطبيقات (API)

هذا الملف يلخّص مسارات API المهمة والـpayloads المتوقعة لبنك الأسئلة.

1) Authentication
- POST /api/v1/auth/login
  - body: { username, password }
  - success: { token, user }

2) Import flow
- POST /api/v1/imports/preview-from-sample
  - body: { sampleFile }
  - returns: { jobId, items }

- POST /api/v1/imports/preview-from-excel
  - multipart form-data: file=@questions.xlsx
  - returns: { jobId, items }

- GET /api/v1/imports
  - returns: list of jobs (with status/items)

- POST /api/v1/imports/:jobId/approve
  - Authorization required (admin)
  - persists items into DB
  - returns: { imported: N }

3) Export
- GET /api/v1/export?lessonKey=...
  - returns: { count, data: [ { subject, grade, unit, lesson, questions } ] }
- GET /api/v1/export.xlsx?lessonKey=...
  - returns: XLSX file (attachment)

4) Questions
- GET /api/v1/questions?lessonId=...
- GET /api/v1/questions/:id
- POST /api/v1/questions  (admin create)
- PUT /api/v1/questions/:id
- DELETE /api/v1/questions/:id

5) Exams & Attempts (flow)
- POST /api/v1/exams  -- create exam with questionIds or criteria
- POST /api/v1/exams/:id/start  -- returns attempt & first item
- POST /api/v1/attempts/:id/answer  -- { examItemId, answerPayload }
- POST /api/v1/attempts/:id/submit  -- evaluate and return review


Headers
- Authorization: Bearer <token> for protected routes (imports approve, admin operations)

