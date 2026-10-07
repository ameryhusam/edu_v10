# مخطط معماري مُختصر (Architecture)

مكوّنات رئيسية
- Prisma schema (prisma/question_bank/schema.prisma)
  - يمثل الكيانات: User, Subject, Grade, Unit, Lesson, Question, QuestionChoice, ImportJob, ImportItem, Exam, ExamItem, Attempt, AttemptAnswer
- Backend
  - Express server: endpoints في `src/backend/server_prisma.ts`
  - Services: `src/services/*` (import.service, excel-import.service, question.service, exam.service, attempt.service)
  - Auth: JWT + bcrypt (`src/backend/auth.ts`)
- Frontend
  - صفحات ثابتة في `modules/question-bank/frontend/` تستخدم fetch / api.js

تدفق استيراد (Import)
1. Upload Excel أو Preview JSON → parse → create ImportJob + ImportItems (PREVIEW)
2. Admin approves → persistImportJob → create Subject/Grade/Unit/Lesson/Question/QuestionChoice
3. Questions available عبر /api/v1/questions

تدفق امتحان/محاولة (Exam/Attempt)
1. Instructor/creator ينشئ exam (fixed أو rule-based)
2. Student يبدأ attempt → يتم حفظ Attempt
3. Student يرسل إجابات (AttemptAnswer)
4. عند submit يتم تقييم الإجابات وفق evaluators وحفظ نتائج

