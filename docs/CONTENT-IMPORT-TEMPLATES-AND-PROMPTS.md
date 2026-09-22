# Edu7 — معيار قوالب استيراد المحتوى وبرومبتات التوليد

**التاريخ:** 2026-09-15
**الحالة:** مواصفة تنفيذية مقترحة فوق قاعدة البيانات الحالية، بلا إضافة Models في المرحلة الأولى.
**النطاق:** استيراد محتوى المنهج كاملًا من JSON أو Excel: كتب، وحدات، دروس، مفاهيم، متطلبات، أخطاء شائعة، موارد تعلم، موارد علاجية، فلاش كارد، أسئلة، صفحات/مقاطع grounding للمساعد الذكي عند توفر النص.

---

## 1. القرار المختصر

1. **لا نطلب `key` من المستخدم في القالب.**
   - المفتاح في Edu7 هو هوية مشتقة، لا حقل تعبئة.
   - المودال/المستورد يولد المفاتيح عبر `src/shared/kernel/identifiers.ts`.
   - يمكن عرض `generatedKeyPreview` في واجهة المراجعة، لكنه ليس عمودًا في Excel ولا مصدر حقيقة.

2. **القالب يستخدم `slug` وحقول المسار بدل UUID.**
   - الوحدة: `slug` داخل الكتاب.
   - الدرس: `unitSlug + slug`.
   - المفهوم: `unitSlug + lessonSlug + slug`.
   - السؤال: هويته التشغيلية الحالية مشتقة من `lessonKey + text`، لذلك يعتمد الاستيراد على `text` داخل الدرس، مع `sourceRef` للتتبع والكشف عن التكرار.

3. **الوحدات والدروس مستقرة غالبًا طوال الفصل.**
   - تستورد بنمط `FULL_STRUCTURE` أو `SEED_STRUCTURE`.
   - تعديلها بعد النشر لا يتم بإعادة استيراد صامتة؛ إما Draft قبل النشر أو طبعة/إصدار كتاب جديد عند تغيير هيكلي مؤثر.

4. **المفاهيم قابلة للإضافة على مراحل، لكن تحت قفل النشر.**
   - إضافة مفهوم إلى كتاب منشور تغيّر تفسير الإتقان؛ لذلك تكون قبل النشر أو في طبعة جديدة، إلا إذا قرر المنتج workflow خاصًا لذلك لاحقًا.

5. **الأسئلة هي الجزء المتكرر والأكثر حساسية.**
   - تستورد بنمط batch/draft.
   - لا تنشر تلقائيًا.
   - تستخدم `origin`, `sourceRef`, `visibility`, `conceptLinks` و`answerKey`.
   - تكرار نفس النص داخل نفس الدرس = نفس السؤال/unchanged.
   - نفس `sourceRef` مع نص مختلف = يحتاج مراجعة، لا overwrite صامت.

6. **الأخطاء الشائعة والموارد والفلاش كارد جزء من القالب الكامل.**
   - Misconceptions تستورد قبل الأسئلة حتى تستطيع خيارات السؤال الإشارة إليها.
   - Remedial content ليس Model منفصلًا؛ هو `LearningResource.kind = REMEDIAL`.
   - Flashcards تستخدم Model `Flashcard` الحالي، ولا تحمل جدولة SM-2 أو حالة طالب.

7. **نفس المعيار يخدم seed والاستيراد.**
   - Seed = استيراد حزمة موثوقة في بيئة bootstrap.
   - Import UI = نفس الحزمة مع dry-run ومراجعة.
   - AI Prompt = ينتج نفس القالب، لا صيغة ثالثة.

---

## 2. سياسة المفاتيح في القالب

| الكيان | هل يظهر `key` في قالب التعبئة؟ | الهوية التي يكتبها الإنسان | من يولد `key`؟ | الملاحظات |
|---|---:|---|---|---|
| Textbook | لا | `subjectKey + gradeKey + physicalPart + edition` | `textbookKey()` | academic term belongs to `TextbookAdoption`; key may be shown in preview only. |
| Unit | لا | `slug` داخل الكتاب | `unitKey(textbookKey, slug)` | تغيير slug يعني وحدة جديدة. |
| Lesson | لا | `unitSlug + slug` | `lessonKey(unitKey, slug)` | مستقر طوال الفصل غالبًا. |
| Concept | لا | `unitSlug + lessonSlug + slug` | `conceptKey(lessonKey, slug)` | يسمح بإضافة مفاهيم جديدة في Draft/edition جديد. |
| Misconception | لا | `unitSlug + lessonSlug + conceptSlug + slug` | `misconceptionKey(conceptKey, slug)` | يجب أن تسبق الأسئلة. |
| LearningResource | لا | `scope + target path + slug` | `textbookResourceKey/lessonResourceKey/learningResourceKey` | `REMEDIAL` هو مورد علاجي. |
| Flashcard | لا | `concept path + front` | fingerprint داخل `ItemBankService` | لا توجد حالة مراجعة لكل طالب. |
| Question | لا | `lesson path + text`، مع `sourceRef` للتتبع | `questionKey(lessonKey, text)` | تعديل النص ينتج سؤالًا جديدًا. |
| Choice | لا UUID | `id` محلي مثل `a,b,c,d` | adapter يولد ids التخزين | `answerKey.correctChoiceIds` يشير لهذه ids المحلية. |

**القاعدة:** أي `key` يظهر في export من النظام هو للقراءة والمراجعة فقط. أي `key` قادم من Excel/AI/JSON يتم تجاهله أو رفضه حسب وضع الاستيراد.

---

## 3. الحقول المسموحة — لا نعتمد على حقول غير موجودة

القالب التالي يستعمل حقولًا موجودة في قاعدة البيانات أو حقول ربط عامة مشتقة من حقول موجودة مثل `unitSlug` و`lessonSlug`. لا يحتوي على `sourceDocumentId` أو `importBatchId` أو `curriculumVersion` لأنها ليست موجودة حاليًا.

### 3.1 Textbook

| الحقل | النوع | مطلوب | يطابق |
|---|---|---:|---|
| subjectKey | string | نعم | `Subject.key` |
| gradeKey | string | نعم | `Grade.key` |
| termKey | string | نعم | `Term.key` |
| title | string | نعم | `Textbook.title` |
| edition | string | نعم | `Textbook.edition` |
| description | string/null | لا | `Textbook.description` |
| issuer | string/null | لا | `Textbook.issuer` |
| isbn | string/null | لا | `Textbook.isbn` |
| publishYear | number/null | لا | `Textbook.publishYear` |
| totalPages | number/null | لا | `Textbook.totalPages` |

### 3.2 Units

`slug, parentUnitSlug, name, orderIndex, startPage, endPage, sourceRef`

### 3.3 Lessons

`unitSlug, slug, name, description, orderIndex, estimatedMins, startPage, endPage, sourceRef`

### 3.4 Concepts

`unitSlug, lessonSlug, slug, name, description, orderIndex, difficulty, importance, masteryThreshold, isCore, pageNumber, sourceRef, nameEn, bloomsLevel`

### 3.5 Prerequisites

للاستخدام البشري/Excel نستخدم slug paths، ثم يحولها المستورد إلى keys:

`conceptUnitSlug, conceptLessonSlug, conceptSlug, prerequisiteUnitSlug, prerequisiteLessonSlug, prerequisiteConceptSlug, prerequisiteKey, strength, requiredMastery`

- إذا كان المتطلب داخل نفس الحزمة: استخدم مسار slug.
- إذا كان المتطلب من كتاب آخر: استخدم `prerequisiteKey` لأنه خارج نطاق slugs المحلية.

### 3.6 Misconceptions

`unitSlug, lessonSlug, conceptSlug, slug, name, description, correction`

### 3.7 LearningResources

`scope, unitSlug, lessonSlug, conceptSlug, slug, kind, title, body, url, orderIndex, pageStart, pageEnd, estimatedMins`

القيم المسموحة لـ `kind`:

`READING`, `VIDEO`, `WORKED_EXAMPLE`, `FLASHCARD_DECK`, `REMEDIAL`, `TEXTBOOK_PAGE`

### 3.8 Flashcards

`unitSlug, lessonSlug, conceptSlug, front, back, reviewPriority, difficulty`

- لا نضيف `nextReviewAt`, `easeFactor`, `interval`, `learnerId`.
- الجدولة للطالب تبقى في mastery/retention، لا في flashcards.

### 3.9 Questions

`unitSlug, lessonSlug, type, text, hint, explanation, points, difficulty01, origin, textbookRole, sourceRef, visibility`

القيم الحالية:

- `type`: `MCQ_SINGLE`, `MCQ_MULTI`, `TRUE_FALSE`, `NUMERIC`, `SHORT_TEXT`, `FILL_BLANK`, `MATCHING`, `ORDERING`, `ESSAY`
- `origin`: `TEXTBOOK`, `TEACHER`, `MINISTERIAL`, `AI`, `UNKNOWN`
- `textbookRole`: `EXERCISE`, `SELF_TEST`, `REVIEW`, `OTHER`, أو فارغ إذا لم يكن `origin=TEXTBOOK`
- `visibility`: `PRIVATE`, `SCHOOL`, `SUBMITTED_FOR_REVIEW`, `GLOBAL`

### 3.10 QuestionChoices

`questionSourceRef, questionText, id, text, orderIndex, misconceptionUnitSlug, misconceptionLessonSlug, misconceptionConceptSlug, misconceptionSlug, feedback`

المستورد يحول misconception slug path إلى `misconceptionKey` قبل استدعاء خدمة السؤال.

### 3.11 AnswerKeys

يجب إضافة الحقول الناقصة في `ContentPackage` الحالي حتى يصبح الاستيراد كاملًا لكل أنواع الأسئلة:

`questionSourceRef, questionText, correctChoiceIds, acceptedTexts, numericMin, numericMax, expectedOrder, expectedPairs, caseSensitive, allowPartialCredit, rubric`

> ملاحظة مهمة: قاعدة البيانات و`DraftAnswerKey` يدعمان `expectedOrder`, `expectedPairs`, `rubric`، لكن export profile الحالي لا يحملها كاملة. لذلك أول تعديل مطلوب في importer/exporter هو رفع profile إلى `1.2` لإضافة هذه الحقول، بلا migration.

### 3.12 TextbookPages وContentChunks — اختيارية للـAI Tutor

عند توفر استخراج نصوص PDF:

- `TextbookPages`: `pageNumber, text, imageUrl`
- `ContentChunks`: `pageNumber, unitSlug, lessonSlug, conceptSlug, text, tokenCount, ordinal`

هذه الحقول تطابق Models موجودة: `TextbookPage` و`ContentChunk`. لا تُستخدم إذا لم يكن لدينا نص مصدر موثوق.

---

## 4. Excel Workbook القياسي

اسم الملف المقترح:

`EDU7-YEMEN-{gradeKey}-{subjectKey}-T{term}-CONTENT.xlsx`

### الشيتات المطلوبة

1. `Textbook`
2. `Units`
3. `Lessons`
4. `Concepts`
5. `Prerequisites`
6. `Misconceptions`
7. `LearningResources`
8. `Flashcards`
9. `Questions`
10. `QuestionChoices`
11. `AnswerKeys`
12. `QuestionConcepts`
13. `TextbookPages` اختياري
14. `ContentChunks` اختياري

### الأعمدة

#### Textbook

```csv
subjectKey,gradeKey,termKey,title,edition,description,issuer,isbn,publishYear,totalPages
```

#### Units

```csv
slug,parentUnitSlug,name,orderIndex,startPage,endPage,sourceRef
```

#### Lessons

```csv
unitSlug,slug,name,description,orderIndex,estimatedMins,startPage,endPage,sourceRef
```

#### Concepts

```csv
unitSlug,lessonSlug,slug,name,description,orderIndex,difficulty,importance,masteryThreshold,isCore,pageNumber,sourceRef,nameEn,bloomsLevel
```

#### Prerequisites

```csv
conceptUnitSlug,conceptLessonSlug,conceptSlug,prerequisiteUnitSlug,prerequisiteLessonSlug,prerequisiteConceptSlug,prerequisiteKey,strength,requiredMastery
```

#### Misconceptions

```csv
unitSlug,lessonSlug,conceptSlug,slug,name,description,correction
```

#### LearningResources

```csv
scope,unitSlug,lessonSlug,conceptSlug,slug,kind,title,body,url,orderIndex,pageStart,pageEnd,estimatedMins
```

#### Flashcards

```csv
unitSlug,lessonSlug,conceptSlug,front,back,reviewPriority,difficulty
```

#### Questions

```csv
unitSlug,lessonSlug,type,text,hint,explanation,points,difficulty01,origin,textbookRole,sourceRef,visibility
```

#### QuestionChoices

```csv
questionSourceRef,questionText,id,text,orderIndex,misconceptionUnitSlug,misconceptionLessonSlug,misconceptionConceptSlug,misconceptionSlug,feedback
```

#### AnswerKeys

```csv
questionSourceRef,questionText,correctChoiceIds,acceptedTexts,numericMin,numericMax,expectedOrder,expectedPairs,caseSensitive,allowPartialCredit,rubric
```

#### QuestionConcepts

```csv
questionSourceRef,questionText,unitSlug,lessonSlug,conceptSlug,weight,isPrimary
```

#### TextbookPages

```csv
pageNumber,text,imageUrl
```

#### ContentChunks

```csv
pageNumber,unitSlug,lessonSlug,conceptSlug,text,tokenCount,ordinal
```

---

## 5. JSON Authoring Template القياسي

الملف العملي موجود هنا:

`docs/templates/edu7-content-authoring-template.v1.json`

هذا ليس dump من قاعدة البيانات. هو عقد تأليف عام يتم تحويله إلى `ContentPackage` الحالي/القادم ثم يمر عبر الخدمات الرسمية.

---

## 6. أوضاع الاستيراد

| الوضع | الاستخدام | ماذا يفعل | ماذا لا يفعل |
|---|---|---|---|
| `DRY_RUN` | المعاينة | يتحقق ويولد تقرير مفاتيح ومشاكل | لا يكتب |
| `SEED_STRUCTURE` | seed أولي/كتاب جديد | ينشئ textbook/units/lessons/concepts/resources/questions كـ Draft | لا ينشر ولا يعتمد للمدرسة |
| `ADD_CONTENT` | إضافة مفاهيم/موارد/أسئلة قبل النشر | يضيف الجديد ويترك الموجود unchanged | لا يعدل slugs ولا ينشر |
| `QUESTION_BATCH` | إدخال أسئلة متكرر | dedupe، concept links، provenance | لا overwrite للسؤال المنشور |
| `RESOURCE_BATCH` | موارد/علاجات | يضيف/يعيد تفعيل موارد | لا يحذف السجل التاريخي |
| `FLASHCARD_BATCH` | بطاقات | يضيف بطاقات مفاهيم | لا يحمل حالة طالب |
| `CORRECTION_PATCH` | تصحيح مسودة قبل النشر | يعدل حقول عرضية محددة عبر services | يحتاج صلاحية وموافقة واضحة |

---

## 7. ترتيب التنفيذ داخل importer

```text
parse Excel/JSON
  ↓
normalise rows
  ↓
validate schema
  ↓
derive textbookKey preview
  ↓
validate references by slug path
  ↓
validate duplicates
  ↓
validate question type/answer key
  ↓
validate provenance rules
  ↓
derive keys with identifiers.ts
  ↓
dry-run report
  ↓
apply through services only:
  ContentAuthoringService
  ItemBankService
  PublishingService only after review, never from import
```

ترتيب الكتابة:

1. Textbook
2. Units
3. Lessons
4. Concepts
5. Misconceptions
6. LearningResources
7. Flashcards
8. Prerequisites
9. Questions
10. QuestionConcepts داخل create/update question
11. TextbookPages/ContentChunks عند توفر extractor

---

## 8. قالب المنهج اليمني

### 8.1 تسمية الملفات

```text
YE-MOE-{gradeKey}-{subjectKey}-T{termOrdinal}-{edition}.xlsx
YE-MOE-{gradeKey}-{subjectKey}-T{termOrdinal}-{edition}.json
```

مثال:

```text
YE-MOE-G01-ISL-T1-2026.xlsx
YE-MOE-G07-SCI-T2-2026.json
```

### 8.2 sourceRef القياسي

```text
MOE-YE-{edition}-{gradeKey}-{subjectKey}-T{term}-{unitOrLessonOrQ}
```

أمثلة:

```text
MOE-YE-2026-G01-ISL-T1-U01
MOE-YE-2026-G01-ISL-T1-L03
MOE-YE-2026-G01-ISL-T1-C02
MOE-YE-2026-G01-ISL-T1-Q014
```

للمحتوى المولد من AI بلا نص مصدر:

```text
AI-DRAFT-YE-{edition}-{gradeKey}-{subjectKey}-T{term}-{row}
```

للوزاري الحقيقي:

```text
MOE-YE-MIN-{academicYear}-{gradeKey}-{subjectKey}-{session}-Q{number}
```

### 8.3 قواعد المصدر

- رابط PDF الرسمي يدخل كـ `LearningResource.kind=TEXTBOOK_PAGE` على مستوى الكتاب.
- نص قراءة الدرس يدخل كـ `READING` على مستوى الدرس.
- العلاج يدخل كـ `REMEDIAL` على مستوى المفهوم.
- السؤال من الكتاب: `origin=TEXTBOOK` و`textbookRole=EXERCISE/SELF_TEST/REVIEW/OTHER`.
- السؤال من النموذج الوزاري: `origin=MINISTERIAL` و`textbookRole=null`.
- السؤال الذي يولده AI دون مصدر حقيقي: `origin=AI` و`textbookRole=null`.

---

## 9. برومبت توليد حزمة محتوى كاملة

الملف العملي موجود هنا:

`docs/templates/yemen-content-generation.prompt.md`

القواعد الحاسمة في البرومبت:

1. JSON فقط.
2. لا مفاتيح `key` ولا UUID.
3. لا `PUBLISHED`.
4. لا `MINISTERIAL` دون ورقة وزارية حقيقية.
5. لا `TEXTBOOK` دون نص/صفحات من الكتاب.
6. كل سؤال مرتبط بمفهوم أو يوسم للمراجعة ولا ينشر.
7. استخدام عربية مدرسية واضحة، لا ترجمة حرفية.
8. الأسئلة المقالية تتطلب rubric وتدخل manual grading.
9. distractor misconceptions تستخدم slug path، لا key.

---

## 10. Validation Gates

### P0 validation

- القالب صالح JSON/XLSX.
- الصف/المادة/الفصل موجودة في catalogue.
- لا keys/UUID كمدخلات.
- slugs صالحة وفريدة في نطاقها.
- كل درس مرتبط بوحدة.
- كل مفهوم مرتبط بدرس.
- كل resource له target واحد فقط.
- كل سؤال له lesson.
- كل answer key مطابق للنوع.
- `textbookRole` لا يظهر إلا مع `origin=TEXTBOOK`.
- `MINISTERIAL` يحتاج `sourceRef` وزاري منظم.
- `AI` لا يدعي sourceRef صفحة كتاب إلا عند وجود source excerpt.

### P1 validation

- كل درس منشور لديه `READING` أو مورد تعليمي.
- كل مفهوم أساسي لديه سؤالان auto-gradable على الأقل قبل CAT.
- كل مفهوم لديه remediation أو flashcard بديل عند ضعف pool.
- كل سؤال منشور لديه primary concept.
- لا ESSAY في adaptive pool.
- كل خيار تشخيصي يشير إلى misconception موجودة.

### Production validation

- content coverage dashboard.
- item-health dashboard.
- import audit log.
- failed import retry.
- provenance display للمعلم/المؤلف.
- no silent overwrite.

---

## 11. Backlog التنفيذ المباشر للقوالب

1. رفع `ContentPackage` إلى `1.2`:
   - إضافة `expectedOrder`, `expectedPairs`, `rubric` إلى `AnswerKeyExport`.
   - إضافة `visibility` إلى `QuestionExport` إن أردنا نقل teacher scoped questions.
   - إضافة `flashcards` collection.
   - إضافة `textbookPages/contentChunks` اختيارية.
2. بناء converter من Excel إلى Authoring Template JSON.
3. بناء converter من Authoring Template إلى `ContentPackage` + flashcard/page/chunk commands.
4. تعديل import service ليشتق prerequisites وchoice misconception refs من slug paths لا keys يكتبها الإنسان.
5. إضافة dry-run report يعرض generated keys.
6. إضافة UI modal:
   - upload Excel/JSON.
   - validate.
   - preview.
   - generated keys.
   - problems by sheet/row.
   - apply.
7. توحيد seed ليستعمل نفس importer بدل direct bespoke seeding عندما يكون المحتوى كبيرًا.

---

## 12. ما لا يدخل القالب الآن

لا نضيف الآن:

- `QuestionSourceDocument` قبل قرار Model صريح.
- `ImportBatch` قبل تصميم Imports domain.
- `ClassSection` أو `TeachingAssignment` داخل قالب المحتوى.
- حالة mastery أو evidence أو attempts أو XP.
- حالة طالب على flashcard.
- حقول AI provider داخل المحتوى المنشور.
- أي UUID داخلي.

---

## 13. الخلاصة

القالب النهائي يجب أن يكون **قالب تأليف لا قالب قاعدة بيانات**:

```text
Excel/JSON human template
  uses: slugs + business keys + sourceRef
  no: UUID/key/status/mastery/evidence
    ↓
Import modal derives keys with canonical code
    ↓
Dry-run validates all relations and answer keys
    ↓
Apply through existing services
    ↓
Review/publish/adoption remain separate workflows
```

بهذا نحصل على طريقة موحدة للـseed والاستيراد وتوليد AI، ونترك مستخرج Python المستقبلي ينتج نفس القالب بدل أن يفرض عقدًا جديدًا على النظام.
