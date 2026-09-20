# Edu7 — المعمارية الموحدة للاستيراد والتصدير وخطة التحول للإنتاجية العالمية
## Unified Content Interchange Standard & World-Class EdTech Execution Roadmap

**التاريخ:** 2026-09-18  
**الحالة:** وثيقة معمارية وتنفيذية معتمدة ملزمة للتطوير  
**المطابقة المعمارية:** DDD Bounded Contexts + Single Write Path + `check-architecture.ts` (28/28) + `check-frontend-architecture.ts` (13/13)  
**الأنظمة المرجعية العالمية:** Khan Academy (مسارات الإتقان والعلاج) · ALEKS (فضاء المعرفة والتشخيص التكيفي) · Canvas LMS (إدارة التكليفات ومصفوفات التقييم) · Duolingo (تحفيز الهاتف والحلقات اليومية) · Brilliant (التعلم التفاعلي القائم على الممارسة).

---

## 1. جوهر المشكلة المعمارية والحل المعتمد

### 1.1 الفجوة التاريخية في المشروع
1. **ازدواجية مسارات الإدخال (Dual Write Paths):** كان مسار التهيئة الأولية (`prisma/seed/load-textbook.ts`) يقرأ مواصفة JSON خاصة به ويكتب مباشرة عبر 15 استدعاء Prisma منفصل، بينما مسار الاستيراد الإنتاجي (`content-import.service.ts`) يقرأ مواصفة `ContentPackage` ويمر عبر `ContentAuthoringService` و `ItemBankService`. هذا خرق لمبدأ **Single Definition of Valid Content**.
2. **فصل التصدير عن الاستيراد:** كان التصدير يغفل مجموعات حيوية (مثل `misconceptions` و `flashcards` و `rubric` و `expectedOrder`).
3. **غياب خط أنابيب الذكاء الاصطناعي في التأليف:** عدم وجود محول مهيكل يستقبل مخرجات النماذج اللغوية (LLM) ليحولها إلى حزم محتوى منضبطة تخضع للتحقق القبلي (Dry-Run) والاعتماد البشري.

### 1.2 المبادئ الحاكمة الخمسة (The 5 Governing Invariants)
1. **المسار الأوحد للكتابة (Canonical Single Write Path):** لا يكتب أي استيراد أو بذر (Seed) أو توليد AI في قاعدة البيانات مباشرة؛ كل البيانات تعبر حصرياً عبر `ContentAuthoringService` و `ItemBankService`.
2. **عقد محتوى موحد (Single Content Interchange Schema v1.2):** نفس العقد يُستخدم للتصدير، الاستيراد، التهيئة الأولية (Seed)، والذكاء الاصطناعي.
3. **الهوية المشتقة لا تُملى من الملفات (Deterministic Identity):** لا يحوي الملف المستورد أي UUID أو `key`. الإنسان أو الذكاء الاصطناعي يكتب `slug` و `sourceRef`، والنظام يشتق المفاتيح حتمياً عبر `src/shared/kernel/identifiers.ts`.
4. **الذكاء الاصطناعي مساعد مسودات لا ناشر (AI as Draft Assistant):** أي محتوى يولده AI يستقر فوراً بحالة `DRAFT` ووسم `origin = 'AI'`، ولا يُنشر إلا باعتماد بشري صريح.
5. **الفصل التام بين المحتوى وحالة المتعلم:** الحزمة تتبادل الهيكل المعرفي فقط؛ لا وجود لحسابات الإتقان أو الدرجات أو تقدم الطلاب داخل حزم المحتوى.

---

## 2. معيار استيراد وتصدير المحتوى المعتمد (Edu7 Content Package v1.2)

### 2.1 هيكل الحزمة القياسي (JSON Schema Standard)

```json
{
  "meta": {
    "profile": "edu7.textbook-content",
    "profileVersion": "1.2",
    "scope": "FULL",
    "exportedAt": "2026-09-18T19:00:00.000Z",
    "schemaStandard": "ISO/IEC-19757-QTI-ALIGNED"
  },
  "textbook": {
    "subjectKey": "MATH",
    "gradeKey": "G07",
    "termKey": "T01",
    "title": "كتاب الرياضيات للصف السابع الفصل 1",
    "edition": "2026",
    "description": "منهج الرياضيات المعتمد للتعليم الأساسي",
    "issuer": "وزارة التربية والتعليم",
    "isbn": "978-9999-00-123-4",
    "publishYear": 2026,
    "totalPages": 240
  },
  "units": [
    {
      "slug": "ALGEBRA",
      "parentUnitSlug": null,
      "name": "الوحدة الأولى: الجبر والمعادلات",
      "orderIndex": 1,
      "startPage": 10,
      "endPage": 65,
      "sourceRef": "MATH-G07-U01"
    }
  ],
  "lessons": [
    {
      "unitSlug": "ALGEBRA",
      "slug": "LINEAR-EQUATIONS",
      "name": "المعادلات الخطية من الدرجة الأولى",
      "description": "حل المعادلات ذات المتغير الواحد وطرق التحقق",
      "orderIndex": 1,
      "estimatedMins": 45,
      "startPage": 12,
      "endPage": 25,
      "sourceRef": "MATH-G07-U01-L01"
    }
  ],
  "concepts": [
    {
      "unitSlug": "ALGEBRA",
      "lessonSlug": "LINEAR-EQUATIONS",
      "slug": "EQUATION-BALANCE",
      "name": "مفهوم اتزان المعادلة",
      "description": "إضافة أو طرح قيمة متساوية من طرفي المعادلة",
      "orderIndex": 1,
      "difficulty": 0.45,
      "importance": 0.85,
      "masteryThreshold": 0.75,
      "isCore": true,
      "pageNumber": 14,
      "bloomsLevel": "APPLY",
      "sourceRef": "MATH-G07-U01-L01-C01"
    }
  ],
  "prerequisites": [
    {
      "targetConceptSlugPath": "ALGEBRA/LINEAR-EQUATIONS/EQUATION-BALANCE",
      "requiredConceptSlugPath": "ALGEBRA/BASIC-OPERATIONS/INVERSE-OPERATIONS"
    }
  ],
  "misconceptions": [
    {
      "conceptSlugPath": "ALGEBRA/LINEAR-EQUATIONS/EQUATION-BALANCE",
      "slug": "SIGN-FLIP-CONFUSION",
      "name": "الخلط في تغيير الإشارة عند نقل الحد",
      "description": "اعتقاد أن نقل الحد لطرف آخر لا يغير إشارته الجبرية",
      "correction": "تطبيق العملية العكسية على كلا الطرفين بالتساوي"
    }
  ],
  "learningResources": [
    {
      "scope": "CONCEPT",
      "targetSlugPath": "ALGEBRA/LINEAR-EQUATIONS/EQUATION-BALANCE",
      "slug": "BALANCE-SIMULATION-EXP",
      "kind": "REMEDIAL",
      "title": "فيديو توضيحي: تجربة كفتي الميزان للمعادلات",
      "body": "شرح تفصيلي بالرسوم المتحركة لمفهوم حفظ توازن المعادلة الجبرية",
      "url": "https://media.edu7.app/math/balance-sim.mp4",
      "startPage": 15,
      "endPage": 16,
      "estimatedMins": 8
    }
  ],
  "flashcards": [
    {
      "conceptSlugPath": "ALGEBRA/LINEAR-EQUATIONS/EQUATION-BALANCE",
      "front": "ما هي القاعدة الذهبية عند نقل حد جبري من طرف لطرف آخر؟",
      "back": "تغيير إشارة الحد إلى العملية المعاكسة (من جمع لطرح، أو من طرح لجمع)",
      "hint": "تذكر توازن كفتي الميزان",
      "reviewPriority": 1,
      "difficulty": 0.40
    }
  ],
  "questions": [
    {
      "lessonSlugPath": "ALGEBRA/LINEAR-EQUATIONS",
      "type": "MCQ_SINGLE",
      "text": "حل المعادلة التالية: س + ٥ = ١٢",
      "hint": "اطرح ٥ من كلا الطرفين",
      "explanation": "س = ١٢ - ٥ = ٧",
      "points": 1,
      "difficulty01": 0.35,
      "origin": "TEXTBOOK",
      "textbookRole": "EXERCISE",
      "sourceRef": "MATH-G07-P18-Q03",
      "choices": [
        { "id": "c1", "text": "س = ٧", "misconceptionSlug": null },
        { "id": "c2", "text": "س = ١٧", "misconceptionSlug": "SIGN-FLIP-CONFUSION" },
        { "id": "c3", "text": "س = -٧", "misconceptionSlug": null }
      ],
      "answerKey": {
        "correctChoiceIds": ["c1"]
      },
      "concepts": [
        {
          "conceptSlugPath": "ALGEBRA/LINEAR-EQUATIONS/EQUATION-BALANCE",
          "isPrimary": true
        }
      ]
    }
  ],
  "groundingChunks": [
    {
      "lessonSlugPath": "ALGEBRA/LINEAR-EQUATIONS",
      "conceptSlugPath": "ALGEBRA/LINEAR-EQUATIONS/EQUATION-BALANCE",
      "pageNumber": 14,
      "ordinal": 1,
      "text": "تعريف: المعادلة هي جملة رياضية تتضمن علامة التساوي (=)، وتدل على تكافؤ المقدارين في طرفيها..."
    }
  ]
}
```

### 2.2 تنسيق Excel متعدد الأوراق (Multi-Sheet Workbook)
عند الاستيراد من مصادر بشرية، يتم قبول ملف Excel يحتوي الأوراق التالية بنفس الحقول تماماً:
1. `01_Textbook`: ورقة رأس الكتاب (بيانات الكتاب الأساسية).
2. `02_Units`: الوحدات الدراسية وهيكلها الهرمي.
3. `03_Lessons`: الدروس وتوقيتاتها وصفحاتها.
4. `04_Concepts`: المفاهيم وعتبات إتقانها ومستويات بلوم.
5. `05_Prerequisites`: شبكة المتطلبات السابقة ومساراتها.
6. `06_Misconceptions`: الأخطاء الشائعة وطرق تصويبها.
7. `07_Resources`: الموارد التعليمية والإثرائية والعلاجية.
8. `08_Flashcards`: البطاقات الذكية ذات الوجه والظهر والتلميح.
9. `09_Questions`: بنك الأسئلة بكافة أنواعه التسعة ومفاتيح الإجابة.
10. `10_Grounding`: مقاطع النصوص لخدمة المساعد الذكي.

---

## 3. خط أنابيب الاستيراد الذكي (AI-Powered Content Ingestion Pipeline)

```
                       ┌───────────────────────────────┐
                       │   Raw Content / PDF / Text    │
                       └──────────────┬────────────────┘
                                      │
                                      ▼
                       ┌───────────────────────────────┐
                       │  Structural Parsing & Chunker │
                       │ (Extract Units/Lessons/Pages) │
                       └──────────────┬────────────────┘
                                      │
                                      ▼
                       ┌───────────────────────────────┐
                       │   AI Generation & Tagging     │
                       │   (Concepts, Questions, Mis-  │
                       │    conceptions, Flashcards)   │
                       └──────────────┬────────────────┘
                                      │
                                      ▼
                       ┌───────────────────────────────┐
                       │ Output: Edu7 Package v1.2 JSON │
                       └──────────────┬────────────────┘
                                      │
                                      ▼
                       ┌───────────────────────────────┐
                       │ Dry-Run & Structural Validator│
                       │  - Deterministic Key Deriver  │
                       │  - Duplicate & Conflict Check │
                       │  - Graph Cycle Detector       │
                       └──────────────┬────────────────┘
                                      │
                                      ▼
                       ┌───────────────────────────────┐
                       │ Human-in-the-Loop Review UI   │
                       │  (Inspect, Edit, Approve)     │
                       └──────────────┬────────────────┘
                                      │
                                      ▼
                       ┌───────────────────────────────┐
                       │  Single Write Path Ingestion  │
                       │  (ContentAuthoringService +   │
                       │       ItemBankService)        │
                       └──────────────┬────────────────┘
                                      │
                                      ▼
                       ┌───────────────────────────────┐
                       │ Database (Postgres / Prisma)  │
                       │ Status: DRAFT, Origin: AI     │
                       └───────────────────────────────┘
```

### 3.1 برومبت النواة لتوليد المحتوى المطابق للمعيار
تستخدم المنظومة برومبت توليد محكم يضمن إخراج JSON متطابق 100% مع الـ Schema دون انحراف:

```markdown
You are the Lead Curriculum Engineering Specialist for Edu7.
Given the textbook excerpt provided, generate a strictly compliant Edu7 Content Package v1.2.
Rules:
1. Do not generate UUIDs or system keys. Use clean human slugs (e.g., FRACTION-ADDITION).
2. For every question, link it to exactly one primary concept slug path.
3. For multiple-choice distractors, attach a relevant misconception slug from the misconceptions array if applicable.
4. Provide a clear pedagogical explanation and hint for every question.
5. All flashcards must be bite-sized, testable facts or definitions.
6. Output raw JSON ONLY matching the Edu7 Content Package v1.2 schema.
```

### 3.2 سياسة فحص ومطابقة الاستيراد (Dry-Run Engine)
يقوم محرك الفحص القبلي بالتأكد من:
- سلامة اشتقاق المفاتيح (`identifiers.ts`) لجميع العناصر وعدم وجود تصادمات.
- خلو شبكة المتطلبات السابقة من الحلقات المغلقة (Cycle-free topological sort).
- تطابق خيارات الأسئلة مع مفتاح الإجابة (`AnswerKeyValidator`).
- كفاية بنك الأسئلة المبدئي (وجود حد أدنى 3 أسئلة منشورة لكل مفهوم لضمان عدم تعطل التقييم التكيفي).

---

## 4. توحيد دوال التهيئة (Seed) مع دوال الاستيراد

### 4.1 التعديل الجذري على مسار الـ Seed
- **إلغاء التوليد المباشر عبر Prisma في `prisma/seed/load-textbook.ts`**.
- تحويل كتب المنهج (مثل `science-g07.json` و `math-g07.json`) إلى صيغة `Edu7 Content Package v1.2`.
- استدعاء نفس خدمة الاستيراد الرسمية `ContentImportService` أثناء التهيئة:
  ```ts
  // داخل prisma/seed/seed.ts
  const importService = new ContentImportService(authoringService, itemBankService, repo);
  const packageData = JSON.parse(readFileSync('prisma/seed/data/science-g07.v1.2.json', 'utf8'));
  const result = await importService.applyPackage(systemAdminContext, packageData);
  ```
- **الفائدة المعمارية:** أي تحسين، تحقق، أو قاعدة بيانات تطبق على الاستيراد تصبح تلقائياً سارية ومختبرة في الـ Seed دون كتابة كود مكرر.

---

## 5. مصفوفة المقارنة وسد الفجوات مع المنصات العالمية

| المحور | المنصة العالمية المرجعية | الوضع الحالي في Edu7 | الفجوة المعمارية والمنتجية | خطة التطوير في Edu7 |
|---|---|---|---|---|
| **مسارات التعلم والإتقان** | **Khan Academy** | BKT و IRT ومحرك توصية موجود خلفياً | الواجهة لم تكن تنفذ التوصية بل تعيد التوجيه للمسار العام | تفعيل `NextStepCard` لتنفيذ الإجراء مباشرة (فتح الدرس، المراجعة، العلاج) |
| **التشخيص وفضاء المعرفة** | **ALEKS** | `AttemptKind.DIAGNOSTIC` موجود خلفياً | لا توجد شاشة لتشخيص مستوى الطالب قبل بدء المنهج | شاشة تشخيص قبلي عند تسجيل الطالب تحدد موقعه في شجرة المفاهيم وتفتح المسار المناسب |
| **إدارة التكليفات ومصفوفات التقييم** | **Canvas LMS** | `InstructionalPlan` و `Obligation` مكتملة | لا واجهة للمعلم لإنشاء التكليف، ولا طابور لتصحيح المقال | واجهة تكليفات للمعلم بـ 3 نقرات + طابور تصحيح يدوي لأسئلة `ESSAY` مع Rubrics |
| **التحفيز وتجربة الهاتف** | **Duolingo** | محرك XP والسلاسل (Streak) مكتمل | الواجهة غير مهيأة بالكامل كتطبيق هاتف ذكي، وجداول عريضة | شريط سفلي ثابت (Bottom Nav)، خط Tajawal عربي، وبطاقات تفاعلية محكمة اللمس (44px) |
| **التعلم التفاعلي الاستيعابي** | **Brilliant** | الدرس فقرة واحدة ثم روابط | لا يشعر الطالب برحلة التعلم التفاعلية | تقسيم الدرس إلى: **استيعاب (Absorb) ➜ تعزيز (Reinforce) ➜ تحقق وتقييم (Verify)** |
| **الصمود التكنولوجي** | **Moodle Mobile** | انقطاع النت يفقد محاولة الاختبار | خطر تسرب مفاتيح الإجابة أو فقد إجابات الطالب | `Local Attempt Recovery` عبر `IndexedDB` دون حفظ مفاتيح الإجابات |

---

## 6. الخطة التنفيذية المفصلة حسب الأولويات (Prioritized Sprints)

```
┌────────────────────────────────────────────────────────────────────────┐
│                        خريطة التنفيذ الزمنية                           │
├────────────────────────────────────────────────────────────────────────┤
│ Sprint 0: عوائق السلامة الحرجة (P0) وتوحيد دوال النواة                 │
│ Sprint 1: خط أنابيب الاستيراد والتصدير v1.2 وتوحيد الـ Seed            │
│ Sprint 2: الإنشاء الديناميكي للكتاب (Grade Setup) وبنك الأسئلة المصنف  │
│ Sprint 3: محرك استيراد الذكاء الاصطناعي (AI Ingestion & Generation)    │
│ Sprint 4: تجربة الطالب المتطورة (Dashboard, Lesson Flow, Diagnostic)   │
│ Sprint 5: حلقة المعلم (التكليفات، التصحيح اليدوي، التدخلات العلاجية)   │
│ Sprint 6: الصمود أمام انقطاع الاتصال والأمان والمراقبة                 │
│ Sprint 7: إطلاق نسخة الهاتف والإنتاج (PWA & Android TWA Packaging)    │
└────────────────────────────────────────────────────────────────────────┘
```

### 6.1 Sprint 0 — عوائق السلامة الحرجة (P0 Critical Safety)
- [x] **P0.1 CORS:** منع `CORS_ORIGINS = '*'` مع `credentials` في بيئة الإنتاج.
- [x] **P0.2 DB Constraint:** إضافة الفهرس الجزئي لمنع تعدد التسجيلات الحالية لنفس المتعلم:
  ```sql
  CREATE UNIQUE INDEX "enrollments_one_current_per_learner" ON "enrollments" ("learnerId") WHERE "isCurrent" = true;
  ```
- [x] **P0.3 CI/CD:** إنشاء ملف `.github/workflows/ci.yml` لتشغيل `npm run verify` على الخلفية والواجهة.
- [x] **P0.4 إخفاء الـ UUID:** تعديل الجلسة لترجع `schoolName` ومنع ظهور الـ UUID في قوائم المعلم.
- [x] **P0.5 فتح رف المعلم:** تعديل صلاحية `GET /content/textbooks` لتكون `staff-read`.

---

### 6.2 Sprint 1 — معيار الاستيراد والتصدير v1.2 وتوحيد الـ Seed
- **تحديث العقد المعماري:**
  - تعديل `src/contexts/content/domain/export-profile.ts` لرفع الإصدار إلى `1.2`.
  - إضافة مصفوفات `flashcards`, `groundingChunks`, `rubric`, `expectedOrder`, `expectedPairs`.
- **بناء المحول والمدقق (Parser & Validator):**
  - بناء قارئ حزم JSON و Excel متعدد الأوراق.
  - بناء محول الـ Slugs الحتمي الذي يشتق المفاتيح عبر `src/shared/kernel/identifiers.ts`.
  - بناء محرك الفحص القبلي (Dry-Run) لإرجاع تقرير شامل بالأخطاء والمفاتيح والنزاعات.
- **توحيد الـ Seed:**
  - إعادة كتابة `prisma/seed/load-textbook.ts` ليستخدم `ContentImportService` كمسار كتابة وحيد.
  - اختبار الذهاب والعودة (Round-trip test): `export(import(package)) === package`.

---

### 6.3 Sprint 2 — الإنشاء الديناميكي للكتاب وبنك الأسئلة المصنف
- **الإنشاء الآلي للكتاب المدرسي (Grade Setup Side Effect):**
  - إلغاء مودال إنشاء الكتاب المنفصل `TextbookCreateModal`.
  - ربط إنشاء الكتاب آلياً بحفظ توزيع المواد في شاشة تجهيز الصف (`Grade Setup`) باستدعاء `ensureTextbooksForGrade`.
  - توليد المفتاح والعنوان آلياً:
    ```ts
    const textbookKey = `${grade.key}-${subject.key}-T0${termOrdinal}`;
    const textbookTitle = `كتاب ${subject.name} للصف ${grade.name} الفصل ${termOrdinal}`;
    ```
- **حل تعارض الإحصائيات (89 مقابل 18):**
  - تعديل `listTextbooks / getAdminTextbooks` لجلب جميع الكتب بكافة حالاتها (`DRAFT` و `PUBLISHED`).
  - تحديث جدول إدارة الكتب بأعمدة (الصف/الفصل) وشارات الحالة.
- **بنك الأسئلة المصنف:**
  - إلغاء جدول `QuestionSourceDocument` واستخدام `sourceRef` لتوثيق المصدر الوزاري.
  - تفعيل محرر الأسئلة لجميع الأنواع التسعة مع ربط المفاهيم الخاطئة.
  - تفعيل حارس جفاف البنك (`assessment.empty_item_pool`) لمنع انهيار اختبارات الطلاب.

---

### 6.4 Sprint 3 — محرك استيراد وتوليد المحتوى بالذكاء الاصطناعي
- **خدمة توليد الأسئلة والمحتوى:**
  - بناء `AiQuestionGenerationService` و `AiContentReviewService` داخل `contexts/content`.
  - توليد الأسئلة وتمريرها مباشرة لـ `itemBankService.createQuestion` مع `origin: 'AI'`.
  - إجبار حالة أسئلة الذكاء الاصطناعي على `status: 'DRAFT'`.
- **واجهة مراجعة واعتماد مسودات AI:**
  - فلتر سريع في بنك الأسئلة: "مسودات AI بانتظار الاعتماد".
  - مراجعة وتعديل ونشر بنقرة واحدة من المشرف أو المؤلف البشري.
- **تغذية نصوص الدروس (Grounding Chunks):**
  - استيراد نصوص الدروس المرجعية لتمكين المساعد الذكي من الإجابة الموثقة مع الاستشهاد برقم الصفحة.

---

### 6.5 Sprint 4 — مسار الطالب المتقدم والتجربة التفاعلية
- **لوحة الطالب الذكية:**
  - بطاقة "تابع من آخر نقطة" للعودة الفورية لآخر نشاط حقيقي غير مكتمل.
  - تفعيل أزرار `NextStepCard` لتنفيذ الإجراء التعليمي فوراً.
  - فصل مهام ولي الأمر الاستشارية عن التكليفات الأكاديمية.
- **التشخيص القبلي (Diagnostic Loop على غرار ALEKS):**
  - اختبار تشخيصي قبلي قصير عند بدء مادة أو سنة جديدة.
  - تحديد موقع الطالب في شبكة المفاهيم وتخطي ما أتقنه مسبقاً.
- **تصميم الدرس التفاعلي (Absorb ➜ Reinforce ➜ Verify على غرار Brilliant):**
  - مرحلة القراءة والمشاهدة، ثم البطاقات والأمثلة، ثم التحقق السريع والتقييم.
  - درج المساعد الذكي داخل الدرس (`TutorDrawer`) مع الرفض الصارم للأسئلة خارج المنهج.
  - خيارات واضحة بعد اختبار الدرس (العودة للرئيسية / الانتقال للدرس التالي).

---

### 6.6 Sprint 5 — حلقة المعلم والعمليات التشغيلية (على غرار Canvas LMS)
- **تخصصات المعلم المتعددة:**
  - تفعيل `EducatorSubjectSpecialty` وربط المعلم بأكثر من مادة رسمية بأسمائها.
- **إدارة التكليفات (`/teacher/assignments`):**
  - إنشاء ونشر التكليفات لصف أو مدرسة مع تاريخ استحقاق واضح.
  - اشتقاق حالة الإنجاز من أدلة تعلم الطالب دون أزرار وهمية.
- **طابور التصحيح اليدوي للمقالي (`/teacher/manual-grading`):**
  - استعراض إجابات `REQUIRES_MANUAL_REVIEW`.
  - وضع الدرجة والملاحظات وفق الـ Rubric، مما يطلق تلقائياً إعادة احتساب الإتقان (`Mastery Recompute`).
- **رادار التدخلات العلاجية:**
  - كشف الطلاب المتعثرين والمفاهيم الخاطئة النشطة وإسناد خطط علاجية بضغطة واحدة.

---

### 6.7 Sprint 6 — الصمود التكنولوجي والأمان والجاهزية
- **التعافي من انقطاع الاتصال (`Local Attempt Recovery`):**
  - حفظ إجابات الاختبارات محلياً في `IndexedDB` دون حفظ مفاتيح الإجابة.
  - نافذة استعادة المحاولة عند عودة الاتصال والإرسال المتماثل (`Idempotent`).
- **الأمان والتحكم:**
  - فرض قيود معدل الاستخدام (`Rate Limiting`) على مسارات الذكاء الاصطناعي والاستيراد.
  - اختبارات تكامل للتحقق من عزل بيانات المدارس المختلفة (Multi-tenant security).
- **المراقبة والسجلات الهيكلية:**
  - تسجيل أحداث الاستيراد، جفاف البنك، واستهلاك حصص الـ AI في سجلات مهيكلة.

---

### 6.8 Sprint 7 — تطبيق الهاتف وإصدار الإنتاج (Mobile & Android Release)
- **واجهة الهاتف (Mobile-First Arabic Design):**
  - تطبيق خط **Tajawal** العربي للأزرار والعناوين والبطاقات لراحة العين.
  - شريط سفلي ثابت (الرئيسية، المسار، المهام، مراجعة، حسابي).
  - إخفاء كافة المعرفات والجداول المعقدة واستبدالها ببطاقات لمس مريحة (Min 44px).
- **حزم Android الرسمية:**
  - تدقيق واكتمال معايير PWA (أيقونات PNG كاملة المقاسات وService Worker خفيف).
  - إنشاء حزمة Android عبر **Trusted Web Activity (TWA)** لنشر التطبيق في متجر Google Play.
  - إعداد واختبار ملف التحقق الرقمي `.well-known/assetlinks.json`.

---

## 7. معايير القبول والإنجاز النهائي (Global Definition of Done)

لا يُعتبر المشروع مكتملاً وجاهزاً للإنتاج إلا بتحقق الشروط التالية نصاً وحكماً:

1. **معيارية الاستيراد:** ملف JSON أو Excel واحد يمكن استيراده بالكامل بدون مفاتيح UUID ويولد نفس الشجرة المعرفية بدقة.
2. **توحيد الـ Seed:** يعمل أمر `npm run db:seed` من خلال استدعاء `ContentImportService` وليس عبر استعلامات Prisma منفصلة.
3. **الإنشاء الآلي للكتاب:** بمجرد تحديد مادة لصف في `Grade Setup`، ينشأ الكتاب المدرسي آلياً دون الحاجة لنافذة إنشاء مستقلة.
4. **دقة الإحصائيات:** لوحة الإدارة تعرض كافة الكتب (89 كتاباً) مع شارات حالتها بوضوح وبدون تعارض مع كتب الـ DRAFT.
5. **سلامة المرجع الأوحد:** الكتاب المدرسي هو المرجع الحصري، ولا وجود لجدول `QuestionSourceDocument` في قاعدة البيانات.
6. **جفاف بنك الأسئلة:** لا يواجه أي طالب خطأ مكسوراً في حال نقص الأسئلة، بل يظهر بديل تربوي واضح.
7. **إغلاق دورة المقال:** إجابات الأسئلة المقالية تُصحح يدوياً عبر المعلم وتحدث الإتقان فور اعتمادها.
8. **استجابة الهاتف:** التطبيق يعمل بسلاسة على شاشات الهواتف مع شريط سفلي ثابت وخط عربي متناسق وصمود أمام ضعف الشبكة.
9. **بوابات البناء:** اجتياز كامل لـ `npm run verify` على الباك إند (28/28 قاعدة) والفرونت إند (13/13 قاعدة) بنسبة نجاح 100%.
