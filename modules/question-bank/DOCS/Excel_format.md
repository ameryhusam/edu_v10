# مواصفات تنسيق ملف Excel للاستيراد (Excel format)

الغرض
- يوضّح هذا الملف الأعمدة المتوقعة في ملف Excel المستخدم لاستيراد الأسئلة إلى بنك الأسئلة.

ملاحظة
- العمود `answerData` يجب أن يحمل JSON صالحاً كنص لتمثيل خيارات MCQ أو أزواج المطابقة أو عناصر الترتيب.

الرؤوس المتوقعة (Header row)
- subjectKey
- subjectName
- gradeKey
- gradeName
- unitKey
- unitTitle
- lessonKey
- lessonTitle
- questionKey
- type                (قيمة واحدة من: MCQ_SINGLE, MCQ_MULTI, TRUE_FALSE, NUMERIC, SHORT_TEXT, FILL_BLANK, MATCHING, ORDERING, ESSAY)
- text
- points
- difficulty
- hint
- explanation
- answerData          (نص JSON، مثال أدناه)

ملاحظات حول answerData حسب النوع
- MCQ_SINGLE / MCQ_MULTI:
  answerData = { "options": [ { "id": "A","text":"اختيار 1","isCorrect":false }, ... ], "correctIds": ["A"] }
- TRUE_FALSE:
  answerData = { "value": true }
- NUMERIC:
  answerData = { "value": 42 }
- MATCHING:
  answerData = { "left": [ {"id":"L1","text":"..."} ], "right": [ {"id":"R1","text":"..."} ], "pairs": [ {"leftId":"L1","rightId":"R1"} ] }
- ORDERING:
  answerData = { "items": [ {"id":"I1","text":"..."}, ... ], "correctOrder": ["I2","I1","I3"] }
- FILL_BLANK:
  answerData = { "blanks": [ {"index":0,"answers":["...","..."]} ] }
- ESSAY:
  answerData = { }

مثال صف (CSV/Excel):
| subjectKey | subjectName | gradeKey | ... | type | text | answerData |
| MATH       | Mathematics | G05      | ... | MCQ_SINGLE | ما هي ...؟ | {"options":[{"id":"A","text":"1"},{"id":"B","text":"2"}],"correctIds":["B"]}

تحقّق وصلاحية
- عند استيراد Excel تجري عملية parse ثم validation؛ أي صف يحتوي answerData غير قابل للـJSON سيُعلَن كـvalidation error في preview.

