# بنك الأسئلة — وثائق الوحدة

هذه الوثائق توضح كيفية تشغيل وتطوير وحدة "Question Bank" الموجودة في المسار `modules/question-bank` ضمن الفرع `feat/question-bank`.

نظرة سريعة
- المسار الرئيسي للوحدة: `modules/question-bank`
- يحتوي على: backend (Prisma + Express)، frontend بسيط واجهات ثابتة، سكربتات Prisma (migrations + seed)، دعم استيراد/تصدير JSON وExcel.

الهدف
- تمكين إدارة الأسئلة (استيراد، تعديل، تصدير) وإنشاء امتحانات، ومحاكاة محاولات التقدير (evaluation) محلياً أو على بيئة staging منفصلة.

المحتويات الأساسية لهذه الوثيقة
- تعليمات التشغيل السريعة
- متغيرات البيئة المطلوبة
- قائمة endpoints المهمة
- تعليمات الاختبار (unit + integration)
- ملاحظات هامة حول الأمان والنسخ الاحتياطي

---

## تشغيل سريع (Local / Staging)
1. انسخ المستودع وتبديل إلى الفرع:
   git fetch origin
   git checkout feat/question-bank

2. إعداد متغيرات البيئة (قاعدة منفصلة - لا تستخدم قاعدة مشاركة):
   ```bash
   export DATABASE_URL="postgresql://user:pass@localhost:5432/question_bank_dev"
   export JWT_SECRET="replace-with-secret"
   ```

3. تثبيت الحزم وبناء المشروع:
   ```bash
   cd modules/question-bank
   npm install
   npm run prisma:generate
   npm run prisma:migrate   # راجع ملفات migrations قبل التنفيذ
   npm run build
   npm run seed
   npm run start
   ```

4. افتح الواجهة:
   http://localhost:4001/static/login.html


## Endpoints رئيسية
- GET  /api/v1/health
- POST /api/v1/auth/login  -- { username, password }
- POST /api/v1/imports/preview-from-sample  -- { sampleFile }
- POST /api/v1/imports/preview-from-excel  -- multipart/form-data file=@questions.xlsx
- POST /api/v1/imports/:jobId/approve  -- (Authorization: Bearer <token>)
- GET  /api/v1/imports  -- قائمة import jobs
- GET  /api/v1/export?lessonKey=...  -- تصدير JSON
- GET  /api/v1/export.xlsx?lessonKey=...  -- تصدير XLSX
- POST /api/v1/exams  -- إنشاء امتحان
- POST /api/v1/exams/:id/start
- POST /api/v1/attempts/:id/answer
- POST /api/v1/attempts/:id/submit


## ملاحظات أمان
- لا تنفّذ `prisma:migrate` على قواعد إنتاجية؛ استخدم قاعدة منفصلة للـQuestion Bank.
- استبدل كلمات المرور الافتراضية الناتجة عن seed فور التشغيل.
- احفظ قيمة `JWT_SECRET` في مكان آمن ولا تكشفها في السجلات.

---

لمزيد من التفاصيل حول تنسيق Excel وواجهات API وملف التشغيل، راجع ملفات الوثائق داخل `modules/question-bank/DOCS/`.
