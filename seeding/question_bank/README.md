# Question-bank seeding

ضع ملفات JSON الخاصة بفهرس الكتب وبنك الأسئلة داخل:
`seeding/question_bank/packages/`

استيراد جميع الملفات:
`npm run db:import`

استيراد ملف محدد:
`npm run db:import -- seeding/question_bank/packages/FILE.json`

الاستيراد transactional وidempotent، وPrisma schema هو المرجع النهائي للحقول والعلاقات.
