# إرشادات الاختبارات (Unit و Integration)

توفر الوحدة اختبارات وحدة للمقيّمين وبعض إشارات لاختبارات اندماجية. إرشادات التشغيل:

1) إعداد بيئة الاختبار السريعة (SQLite)
- من داخل modules/question-bank:
  export TEST_DATABASE_URL="file:./tmp-test.db"
- ثم:
  npm run prisma:generate
  # قد تحتاج لتشغيل migrate مبدئي على TEST_DATABASE_URL
  npx prisma migrate deploy --schema=prisma/question_bank/schema.prisma
- تنفيذ اختبارات الاندماج:
  npm run test:integration

2) تشغيل اختبارات الوحدة (Vitest)
- npm test

ملاحظات
- اختبارات الاندماجية محجوزة افتراضياً حتى تقوم بتأمين TEST_DATABASE_URL.
- يوصى بتشغيل اختبارات اندماجية على Postgres في CI قبل النشر، لتلافي فروق السلوك بين SQLite وPostgres.
