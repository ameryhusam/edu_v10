# Runbook وعمليات الترحيل والنشر (Runbook)

الهدف: إرشاد خطوة بخطوة لتطبيق الترحيلات، تشغيل الـseed، والبدء في بيئة staging.

تحذير: طبق الخطوات التالية على قاعدة بيانات منفصلة (لا تنفذ على قواعد الإنتاجية المشتركة).

1) تحضير بيئة
- جهّز قاعدة PostgreSQL فارغة
- اضبط متغيرات البيئة:
  - DATABASE_URL
  - JWT_SECRET

2) ترحيل وتوليد Prisma
- cd modules/question-bank
- npm install
- npm run prisma:generate
- npm run prisma:migrate

3) تشغيل seed
- npm run build
- npm run seed

4) تشغيل الخدمة
- npm run start
- التحقق: curl http://localhost:4001/api/v1/health

5) تحديثات لاحقة
- عند إضافة نموذج جديد في `prisma/question_bank/schema.prisma`:
  - عدِّل المهاجرات: `prisma migrate dev --name <desc> --schema=prisma/question_bank/schema.prisma`
  - ارفع ملفات الترحيل إلى الفرع قبل تنفيذ `prisma:migrate` في staging

6) نسخ احتياطي واسترجاع
- احفظ نسخة احتياطية من القاعدة قبل تنفيذ أي `migrate` في بيئة تحتوي بيانات هامة.
- لاسترجاع الملفات المصدرية من الأرشيف داخل هذا الفرع:
  git checkout feat/question-bank -- archive/orphaned-before-cleanup/20261007_191800/<path>

