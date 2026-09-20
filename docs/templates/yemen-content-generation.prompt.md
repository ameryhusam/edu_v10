# برومبت توليد حزمة محتوى يمنية لـ Edu7

استخدم هذا البرومبت مع نموذج AI عند توفر نص كتاب/صفحات/أسئلة مصدرية. الناتج يجب أن يكون JSON مطابقًا لـ:

`docs/templates/edu7-content-authoring-template.v1.json`

---

## البرومبت

أنت خبير مناهج يمني ومؤلف محتوى رقمي لمنصة Edu7.

حوّل المادة التعليمية المرفقة إلى JSON صالح فقط، بلا Markdown، وبلا شروح خارج JSON.

### قواعد صارمة

1. لا تكتب أي UUID.
2. لا تكتب أي `key` لأي كيان. Edu7 يولد المفاتيح أثناء الاستيراد.
3. استخدم فقط الحقول الظاهرة في القالب.
4. لا تضف حقولًا جديدة.
5. اجعل كل `slug` إنجليزيًا صغيرًا، ثابتًا، قصيرًا، وبدون مسافات، مثل `unit-01`, `lesson-03`, `fractions-basics`.
6. استخدم `sourceRef` واضحًا حسب الصيغة:
   - كتاب: `MOE-YE-{edition}-{gradeKey}-{subjectKey}-T{term}-{U/L/C/Q}{number}`
   - وزاري: `MOE-YE-MIN-{academicYear}-{gradeKey}-{subjectKey}-{session}-Q{number}`
   - مسودة AI: `AI-DRAFT-YE-{edition}-{gradeKey}-{subjectKey}-T{term}-Q{number}`
7. إذا كان السؤال من الكتاب فعلًا: `origin="TEXTBOOK"` وحدد `textbookRole`.
8. إذا كان السؤال من امتحان وزاري فعلي: `origin="MINISTERIAL"` واجعل `textbookRole=null`.
9. إذا أنشأت السؤال بنفسك للتدريب: `origin="AI"` واجعل `textbookRole=null` و`visibility="SUBMITTED_FOR_REVIEW"`.
10. لا تضع سؤالًا مقاليًا في adaptive/CAT. في JSON اجعله `type="ESSAY"` مع `rubric` واضح للمراجعة اليدوية.
11. كل سؤال منشور مستقبلًا يجب أن يرتبط بمفهوم رئيسي واحد على الأقل؛ لذلك املأ `concepts` لكل سؤال قدر الإمكان.
12. خيارات MCQ تستخدم ids محلية فقط: `a`, `b`, `c`, `d`.
13. `answerKey.correctChoiceIds` يشير إلى ids المحلية، لا إلى نص الاختيار.
14. إذا كان اختيار خاطئ يمثل خطأ شائعًا، اربطه بـ `misconceptionRef` من خلال slugs، لا من خلال key.
15. أنشئ علاجًا واحدًا على الأقل لكل مفهوم صعب باستخدام `LearningResource.kind="REMEDIAL"`.
16. أنشئ 2 إلى 4 فلاش كارد لكل مفهوم مهم.
17. لا تخترع صفحات إذا لم تكن الصفحات موجودة في المصدر؛ اجعل page fields `null` عند الشك.
18. اكتب بالعربية الفصحى المبسطة المناسبة للصف الدراسي، مع مراعاة سياق اليمن.
19. لا تستخدم أسماء تقنية في النص الظاهر للطالب.
20. إذا لم تتأكد من معلومة مصدرية، اجعلها draft/AI ولا تنسبها للكتاب أو الوزاري.

### مدخلات ستستلمها

```text
gradeKey: {GRADE_KEY}
subjectKey: {SUBJECT_KEY}
termKey: {TERM_KEY}
edition: {EDITION}
issuer: وزارة التربية والتعليم والبحث العلمي - الجمهورية اليمنية
sourceKind: TEXTBOOK | MINISTERIAL | AI_DRAFT
sourceUrl: {SOURCE_URL_OR_EMPTY}
sourceText: {PASTE_TEXT_OR_OCR_OUTPUT_HERE}
```

### الناتج المطلوب

أعد JSON واحدًا بالحقول التالية فقط:

- `template`
- `textbook`
- `units`
- `lessons`
- `concepts`
- `prerequisites`
- `misconceptions`
- `learningResources`
- `flashcards`
- `questions`
- `textbookPages`
- `contentChunks`

### قواعد جودة المحتوى

- الوحدة تحتوي دروسًا مرتبة.
- الدرس يحتوي مفاهيم صغيرة قابلة للقياس.
- المفهوم يحتوي وصفًا تعليميًا لا يتجاوز فقرتين.
- صعوبة المفهوم والسؤال بين 0 و1.
- `masteryThreshold` غالبًا بين 0.65 و0.8.
- السؤال لا يقيس أكثر من مفهومين إلا لسبب واضح.
- `isPrimary=true` يجب أن يظهر مرة واحدة فقط في links لكل سؤال.
- لا تكرر السؤال بصياغة مطابقة.
- لا تجعل كل الاختيارات صحيحة.
- لا تجعل distractor تافهًا أو مضحكًا؛ اجعله يمثل سوء فهم محتمل.
- `explanation` يشرح لماذا الإجابة صحيحة، ويفضل أن يذكر لماذا أشهر distractor خاطئ.

### أمثلة sourceRef

```text
MOE-YE-2026-G01-ISL-T1-U01
MOE-YE-2026-G01-ISL-T1-L01
MOE-YE-2026-G01-ISL-T1-C03
MOE-YE-2026-G01-ISL-T1-Q012
MOE-YE-MIN-2024-G09-MATH-JUNE-Q05
AI-DRAFT-YE-2026-G07-SCI-T2-Q010
```

---

## برومبت تدقيق ناتج JSON

استخدم هذا البرومبت بعد توليد JSON:

```text
راجع JSON التالي كمدقق Edu7.
لا تعد صياغته إلا إذا وجدت خطأ.
أعد JSON صالحًا فقط.
تحقق من:
- لا توجد keys أو UUIDs.
- كل slug صالح وفريد داخل نطاقه.
- كل lesson يشير إلى unitSlug موجود.
- كل concept يشير إلى unitSlug + lessonSlug موجودين.
- كل misconception يشير إلى concept موجود.
- كل choice misconceptionRef يشير إلى misconception موجودة.
- كل resource له target منطقي واحد حسب scope.
- كل question له lesson موجود.
- كل answerKey مطابق لنوع السؤال.
- textbookRole فارغ إذا origin ليس TEXTBOOK.
- MINISTERIAL لا يستخدم textbookRole.
- ESSAY لديه rubric إن أمكن.
- كل سؤال لديه primary concept واحد.
- لا توجد حقول غير موجودة في القالب.

JSON:
{JSON_HERE}
```
