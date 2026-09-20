# Edu7 — أوامر وتعليمات خطة التطوير والإنتاجية النهائية المحدثة
## Comprehensive Technical Directives & Execution Blueprint

**التاريخ:** 2026-09-18  
**الإصدار:** 2.0 — تدقيق أعمق للمودالات والباك إند والواجهات + صياغة الأوامر التنفيذية المرتبة بحسب الأولوية  
**المطابقة المعمارية:** DDD Bounded Contexts + Single Write Path + `check-architecture.ts` (28/28) + `check-frontend-architecture.ts` (13/13)  
**الأنظمة المرجعية العالمية:** Khan Academy (مسارات الإتقان والعلاج) · ALEKS (فضاء المعرفة والتشخيص) · Canvas LMS (إدارة التكليفات والتصحيح) · Duolingo (تحفيز الهاتف والحلقات اليومية) · Brilliant (التعلم التفاعلي الثلاثي).

---

## 1. التدقيق المعماري والتحليل التفصيلي للثغرات الحالية (Deep Codebase Audit)

### 1.1 تدقيق النوافذ المنبثقة والمودالات (Modal Architecture Audit)
بعد فحص الـ 14 نافذة ومودال الموجودة في `web/src`:
1. **تفاوت وغياب معايير إغلاق النافذة (Escape & Focus Trap):**
   - مودال `ActionModal` يحتوي على مستمع للزر `Escape` وقفل تمرير الخلفية، بينما مودال `ContentNodeCreateModal` ومودال `TextbookCreateModal` مبنية بـ `div` و `form` مباشرة وتفتقر لـ `Escape listener` ولـ `Focus Trap`، مما يسمح بخروج التركيز (Tab Focus) إلى عناصر الصفحة الخلفية مسبباً مشاكل وصولية (a11y).
2. **غياب حماية العمل غير المحفوظ (Dirty State Protection):**
   - النقر على الخلفية المعتمة (`Backdrop Click`) يغلق المودال فوراً دون التحقق مما إذا كان المستخدم قد ملأ حقولاً نصية طويلة، مما يسبب فقداناً صامتاً للبيانات المُدخلة.
3. **غياب حماية الإرسال المزدوج (Double Submission Prevention):**
   - أزرار الحفظ في أغلب المودالات لا تتعطل أثناء تنفيذ الطفرة (`isPending / isSubmitting`)، مما يسمح بالنقر المتكرر وإرسال طلبات متزامنة قد تفشل أو تحدث تكراراً في السجلات.
4. **تكدس وتكرار المودالات المستقلة (Modal Proliferation):**
   - وجود مودالات فائضة يمكن دمجها أو الاستغناء عنها كلياً؛ مثل `TextbookCreateModal` الذي يعطل تجربة المستخدم بطلب بيانات كان ينبغي إنشاؤها تلقائياً بمجرد إعداد الصف والمواد.

### 1.2 تدقيق العمليات الخلفية وقاعدة البيانات (Backend & Transaction Audit)
1. **الإنشاء المنفصل للكتب مقابل توزيع المواد:**
   - عملية توزيع المواد في المصفوفة (`GradeSubjectMatrix`) تحفظ علاقة `GradeSubject` فقط، دون أن تولد الكتب المقابلة لكل مادة في الفصول الدراسية تلقائياً.
2. **تعارض الإحصائيات (89 مقابل 18):**
   - دالة `listTextbooks` في الباك إند تقيد الجلب بحد أقصى `limit: 100`، بينما واجهة الإدارة تقوم بفلترة غير متوافقة مع الـ `DRAFT` و `termKey` عبر فحص نصي هش (`includes('1')`)، مما يؤدي لاختفاء 71 كتاباً بحالة مسودة من اللوحة الإدارية.
3. **جفاف بنك الأسئلة في الاختبار التكيفي (`Empty Pool Guard`):**
   - محرك الـ CAT يرمي خطأ مجال `assessment.empty_item_pool` دون وجود نقطة نهاية لفحص الجاهزية المسبقة في الواجهة، فيتعطل اختبار الطالب بصفحة خطأ بدلاً من توجيهه لبديل تربوي.
4. **ازدواجية مسار التهيئة (Seed) والاستيراد:**
   - ملف `prisma/seed/load-textbook.ts` يستخدم استعلامات Prisma مباشرة بدلاً من المرور عبر خدمات المجال الرسمية (`ContentImportService`)، مما يهدد بتباين قواعد التحقق.

### 1.3 تدقيق واجهات المستخدم وتجربة الهاتف (UI/UX & Mobile Audit)
1. **طوبوغرافيا الواجهة العربية:**
   - تباين في استخدام الخطوط يضعف وضوح النصوص التعليمية المشكولة؛ الاعتماد على **Tajawal** كخط نظام أساسي ضرورة لتوفير مقروئية عالمية.
2. **استجابة الجداول على الهاتف:**
   - الجداول العريضة في شاشات الإدارة والمعلم تتجاوز حدود شاشات الهواتف المحمولة؛ يلزم تحويلها تلقائياً لبطاقات متراصة (`Stacked Cards`) على شاشات `< 768px`.
3. **أزرار ما بعد اختبار الدرس:**
   - غياب توجيهات ما بعد انتهاء الاختبار، مما يترك الطالب في صفحة فارغة بلا أزرار "العودة للرئيسية" أو "الانتقال للدرس التالي".

---

## 2. الأوامر والتعليمات التنفيذية المباشرة (Actionable Directives by Priority)

```
┌────────────────────────────────────────────────────────────────────────┐
│                   ترتيب الأولويات التنفيذية الصارمة                    │
├────────────────────────────────────────────────────────────────────────┤
│ Directive 0: إصلاحات السلامة الفورية والقواعد الصارمة (P0 Preconditions)│
│ Directive 1: توحيد المودالات وإلغاء النوافذ الفائضة (Modal Overhaul)   │
│ Directive 2: الإنشاء الآلي للكتب وتحديث جدول الإدارة (Auto-Provisioning)│
│ Directive 3: معيار الاستيراد والتصدير v1.2 وتوحيد الـ Seed              │
│ Directive 4: بنك الأسئلة المتقدم ومحرك الذكاء الاصطناعي (Item Bank & AI)│
│ Directive 5: رحلة الطالب التفاعلية والدرس الثلاثي (Learner Experience)  │
│ Directive 6: حلقة المعلم، التكليفات، والتصحيح اليدوي (Teacher Loop)     │
│ Directive 7: تجربة الهاتف والتحول لـ Mobile-First وإصدار Android (TWA)  │
└────────────────────────────────────────────────────────────────────────┘
```

---

### Directive 0: إصلاحات السلامة الفورية والقواعد الصارمة (P0 Preconditions)
*الهدف: منع الانهيارات الأمنية والبيانات المكسورة قبل كتابة أي كود ميزة جديد.*

- **Order 0.1 [Backend/Security]:**  
  في `src/shared/config/env.ts`، فرض الفشل الفوري للإقلاع (Fail-fast) إذا كانت البيئة `production` وقيمة `CORS_ORIGINS = '*'`.
- **Order 0.2 [Database/Integrity]:**  
  إنشاء هجرة Prisma جديدة تضيف الفهرس الجزئي الفريد لمنع تعدد التسجيلات الحالية لنفس المتعلم:
  ```sql
  CREATE UNIQUE INDEX "enrollments_one_current_per_learner"
    ON "enrollments" ("learnerId")
    WHERE "isCurrent" = true;
  ```
- **Order 0.3 [Backend/API & Frontend/Session]:**  
  تعديل `toAuthenticatedUser` وجلسة `session.tsx` لتضمين `schoolName` و `schoolKey`، ومنع تسريب أي معرّف `UUID` خام في قوائم شاشات المعلم الثلاث (`assignments.tsx`, `interventions.tsx`, `results.tsx`).
- **Order 0.4 [CI/CD]:**  
  إضافة `.github/workflows/ci.yml` لتنفيذ `npm run verify` على الباك إند والفرونت إند على كل PR و Push.
- **Order 0.5 [Permissions]:**  
  تحويل صلاحية `GET /content/textbooks` في `content.routes.ts` إلى `staff-read` لتمكين المعلمين من مطالعة رفوف كتب مدرستهم دون خطأ 403.

---

### Directive 1: توحيد المودالات وإلغاء النوافذ الفائضة (Modal Overhaul & Redundancy Removal)
*الهدف: معمارية مودالات موحدة فائقة الأمان، واستبعاد النوافذ الفائضة لصالح الأثر الجانبي التلقائي.*

- **Order 1.1 [Frontend/Design System]:**  
  ترقية المكون الأساسي `web/src/design-system/patterns/action-modal.tsx` ليصبح المرجع الحصري لجميع النوافذ المنبثقة المتوسطة والكبيرة، مع فرض المزايا التالية داخلياً:
  1. **Escape Listener:** إغلاق النافذة عند الضغط على مفتاح `Escape` مع تنظيف المستمع عند التفكيك.
  2. **Body Scroll Lock:** منع تمرير خلفية الصفحة أثناء فتح المودال (`document.body.style.overflow = 'hidden'`).
  3. **Focus Trap:** حصر التنقل بزر `Tab` داخل المودال فقط، وإعادة التركيز للعنصر الذي فتح النافذة عند الإغلاق.
  4. **Dirty State Protection:** إذا احتوى المودال على حقول معدلة (`isDirty === true`)، والنقر حدث على الـ Backdrop، إظهار نافذة `ConfirmDialog` لتأكيد الإلغاء بدلاً من الإغلاق الفجائي.
  5. **Double-Submission Lock:** تعطيل زر الحفظ وإظهار مؤشر التحميل (`Spinner`) طوال فترة `isPending`.
  6. **Inline API Error Display:** إظهار أي خطأ ناتج عن الـ API في شريط أحمر مدمج داخل المودال دون إغلاقه لتمكين المستخدم من تصحيح المدخلات.
- **Order 1.2 [Frontend/Cleanup]:**  
  **حذف `TextbookCreateModal` تماماً** من `web/src/features/content/` وإزالته من شاشات الإدارة؛ لا يتم إنشاء الكتاب يدوياً بعد اليوم بل تلقائياً من شاشة تجهيز الصف.
- **Order 1.3 [Frontend/Refactor]:**  
  إعادة بناء `ContentNodeCreateModal` و `QuestionLinkModal` لتبني `ActionModal` الجديد والتخلص من عناصر الـ `div` العشوائية.

---

### Directive 2: الإنشاء الآلي للكتب وتحديث جدول الإدارة (Auto-Provisioning & Catalogue Sync)
*الهدف: توليد الكتب آلياً كأثر جانبي لحظي لحفظ توزيع المواد، وحل تعارض الإحصائيات (89 مقابل 18).*

- **Order 2.1 [Backend/Catalogue]:**  
  في `src/contexts/catalogue/application/catalogue.service.ts` عند استدعاء `applyGradeSubjectCells`:
  - عند تفعيل أي مادة لصف معين (`isActive: true`)، يتم كأثر جانبي مؤكد (Side Effect) استدعاء `ensureTextbooksForGrade` لإنشاء الكتب المدرسية لكافة الفصول الدراسية النشطة في ذلك الصف (Term 1, Term 2).
  - استخدام دوال النواة في `src/shared/kernel/identifiers.ts`:
    ```ts
    const textbookKey = `${grade.key}-${subject.key}-T0${termOrdinal}`;
    const textbookTitle = `كتاب ${subject.name} للصف ${grade.name} الفصل ${termOrdinal}`;
    ```
  - إنشاء الكتاب بحالة `DRAFT` تلقائياً دون انتظار أي تدخل يدوي.
- **Order 2.2 [Backend/API & Query]:**  
  في `src/contexts/content/application/textbook-administration.service.ts` ودالة `listTextbooks`:
  - رفع سقف الـ `limit` المسموح به إلى 250 كتاباً لخدمة شاشات الإدارة بالكامل.
  - إزالة أي تصفية تستبعد كتب الـ `DRAFT` افتراضياً؛ إرجاع كافة الكتب بكافة حالاتها (`DRAFT`, `IN_REVIEW`, `PUBLISHED`, `ARCHIVED`).
- **Order 2.3 [Frontend/UI]:**  
  في `web/src/pages/admin/textbooks-admin.tsx` و `grades-active-view.tsx`:
  - استبدال الربط الهش للفصل الدراسي (`bTerm.includes('1')`) بمقارنة دقيقة مبنية على `term.ordinal`.
  - تحديث الجدول ليظهر: (المادة، الصف الدراسي، الفصل الدراسي، شارة الحالة الملونة).
  - توفير زر نشر مباشر (`Publish`) بضغطة واحدة لتحويل الكتاب من `DRAFT` إلى `PUBLISHED` بعد اكتمال جاهزيته.

---

### Directive 3: معيار الاستيراد والتصدير v1.2 وتوحيد الـ Seed
*الهدف: حزمة محتوى قياسية ومسار كتابة أوحد (Single Write Path) يدعم Excel و JSON.*

- **Order 3.1 [Domain/Contract]:**  
  ترقية `src/contexts/content/domain/export-profile.ts` إلى الإصدار `1.2`:
  - إضافة مصفوفات: `flashcards[]`, `groundingChunks[]`, `expectedOrder[]`, `expectedPairs[]`, و `rubric`.
- **Order 3.2 [Infrastructure/Seed]:**  
  إعادة كتابة `prisma/seed/load-textbook.ts` بالكامل:
  - إزالة الـ 15 استدعاء Prisma المباشر.
  - تحويل ملفات البذرة (`science-g07.json`, `math-g07.json`) لصيغة `ContentPackage v1.2`.
  - تمرير البيانات عبر `ContentImportService` لتسري عليها نفس شروط التحقق والاشتقاق التي تسري على الاستيراد الحي.
- **Order 3.3 [Application/Import Engine]:**  
  بناء محرك الفحص القبلي (Dry-Run Engine):
  - استقبال ملفات Excel متعددة الأوراق (10 أوراق) أو JSON.
  - اشتقاق المفاتيح حتمياً دون الاعتماد على أي مفتاح داخل الملف.
  - إرجاع تقرير الفحص: المفاتيح المشتقة، التعارضات، نقص الأسئلة، وخلو المتطلبات السابقة من الحلقات الدائرية.
- **Order 3.4 [Cleanup]:**  
  استبعاد وإلغاء أي اعتماد على ملفات الفهرسة الثابتة مثل `yemen-moe-textbook-sources.json`.
- **Order 3.5 [Smart Ingestion & NotebookLM Spec]:**  
  تفعيل مواصفة الاستيراد فائق السهولة (`docs/EDU7-SMART-INGESTION-AND-NOTEBOOKLM-EXCEL-SPEC.md`):
  1. إلغاء الاعتماد على الـ `slug` الإنجليزي والاعتماد على الترقيم الطبيعي (رقم الوحدة، رقم الدرس) والاسم العربي.
  2. تطبيق خوارزمية حل النزاعات التفاعلي على مستوى السجل الفردي: عند عدم تطابق اسم الدرس في قاعدة البيانات مع الملف، يتم عرض الاسمين للمستخدم للاختيار بين (اعتماد اسم الملف / الاحتفاظ باسم النظام / تخطي هذا السجل فقط دون كسر باقي الملف).
  3. تفعيل صندوق الاستيراد السريع لدروس وحدة معينة كنص حر مباشر، وصندوق النسخ واللصق السريع للأسئلة (Text/Markdown/JSON) بمطابقة مفتاح الكتاب.
  4. اعتماد قالب الإكسل الخالي من المفاتيح (Zero-Key Excel Standard) والبرومبت المعتمد لـ Google NotebookLM لاستخراج أي كتاب مدرسي وحقنه بنقرة واحدة.

---

### Directive 4: بنك الأسئلة المتقدم ومحرك الذكاء الاصطناعي (Item Bank & AI Engine)
*الهدف: بنك أسئلة مصنف بأبعاد مستقلة، وحماية جفاف البنك، وتوليد مسودات الأسئلة بالـ AI.*

- **Order 4.1 [Domain & Schema]:**  
  - **إلغاء جدول `QuestionSourceDocument` نهائياً**؛ الكتاب المدرسي هو المرجع الحصري.
  - توثيق بيانات الامتحان الوزاري عبر حقل `sourceRef` المنظم على مستوى السؤال مع وسم `origin: MINISTERIAL`.
  - ضمان استقلالية: نوع السؤال (`QuestionType`) عن مصدره (`QuestionOrigin`) عن ارتباطه بالمفاهيم (`QuestionConcept`).
- **Order 4.2 [Backend/Assessment]:**  
  إضافة نقطة نهاية لفحص الجاهزية وحماية الجفاف:
  `GET /assessment/availability?conceptKey=&kind=ADAPTIVE`
  - إرجاع عدد الأسئلة المنشورة وعدد الأسئلة المصححة آلياً (`catReady: boolean`).
  - إذا كان `catReady === false`: تقوم الواجهة بحجب زر الاختبار التكيفي وعرض بديل تربوي لائق (مراجعة البطاقات الذكية) بدلاً من خطأ مكسور.
- **Order 4.3 [Application/AI Engine]:**  
  بناء `AiQuestionGenerationService`:
  - استقبال سياق الدرس ومقاطع الشرح (`Grounding Chunks`).
  - توليد الأسئلة وخياراتها وربط المشتتات بالأخطاء الشائعة (`Misconceptions`).
  - إرسال السؤال إلى `itemBankService.createQuestion` مع `origin: 'AI'`.
  - فرض حالة `status: 'DRAFT'` تلقائياً، وتوفير فلتر سريع في بنك الأسئلة للمراجعة والاعتماد البشري.
- **Order 4.4 [Application/Native Gemini Ingestion]:**  
  تفعيل خدمة `ContentAiEnrichmentService` المباشرة داخل الكود (`docs/EDU7-GEMINI-AI-INGESTION-AND-GOOGLE-DRIVE-PIPELINE.md`):
  - إرسال نصوص الدرس ومقاطع الشرح إلى Gemini 2.5 Flash مع مخطط JSON Schema إلزامي.
  - استخراج وتوليد: المفاهيم الذرية، الأسئلة المتوافقة مع المنهج، البطاقات الذكية، ونصوص العلاج، بصيغة JSON مطابقة لمعيار الاستيراد v1.2 لحقنها مباشرة في النظام.
  - تخزين صفحات الكتاب ومقاطع النصوص في جدولي `TextbookPage` و `ContentChunk` لدعم التأصيل المعرفي (`Grounding`) للمساعد الذكي.
- **Order 4.5 [Infrastructure/Google Drive Textbook Library]:**  
  تفعيل محول `GoogleDriveIngestionAdapter`:
  - استخراج ومعالجة ملفات كتب الـ PDF من روابط ومجلدات Google Drive المشتركة.
  - تمرير الـ PDF مباشرة لـ Gemini Multimodal لمعالجة الصفحات والرسومات والمعادلات دون الحاجة لمحركات OCR خارجية.

---

### Directive 5: رحلة الطالب التفاعلية والدرس الثلاثي (Learner Experience)
*الهدف: تجربة تعلم تكيفية متطورة على خطى Khan Academy و Brilliant.*

- **Order 5.1 [Frontend/Student Dashboard]:**  
  - تفعيل بطاقة "تابع من آخر نقطة" في `dashboard.tsx` للوصول الفوري لآخر نشاط حقيقي مسجل في سجل الأدلة.
  - تفعيل زر `NextStepCard.onStart` لتنفيذ الإجراء مباشرة:
    - `LEARN` ➜ فتح الدرس.
    - `REVIEW` ➜ فتح جلسة البطاقات الذكية.
    - `PRACTISE / ASSESS` ➜ بدء التقييم التكيفي بعد فحص الجاهزية.
    - `REMEDIATE` ➜ فتح المورد العلاجي وتمرين التثبيت.
  - فصل مهام ولي الأمر الاستشارية (`Parent Advisory`) عن الواجبات الأكاديمية الرسمية.
- **Order 5.2 [Frontend/Lesson Flow]:**  
  في `web/src/pages/student/lesson.tsx`:
  - تنظيم الدرس في مسار ثلاثي المراحل: **استيعاب (Absorb) ➜ تعزيز (Reinforce) ➜ تحقق وتقييم (Verify)**.
  - حصر استعلامات الموارد والاختبارات بـ `lessonKey` الحالي لمنع تداخل محتويات الدروس.
  - إضافة درج المساعد الذكي الموثق (`TutorDrawer`) مع سياسة الرفض الصارم للأسئلة الخارجة عن المنهج.
- **Order 5.3 [Frontend/Post-Quiz UX]:**  
  بعد إنهاء اختبار الدرس، عرض شاشة مكتملة توفر:
  - زر العودة للصفحة الرئيسية.
  - زر الانتقال المباشر للدرس التالي في المسار.
  - إذا كان الدرس الأخير في الكتاب، إظهار رسالة إتمام المقرر الدراسي وتيسير العودة للرئيسية.
- **Order 5.4 [Frontend/Resilience]:**  
  تفعيل `Local Attempt Recovery` عبر `IndexedDB`:
  - حفظ مسودة إجابات الطالب محلياً أثناء الاختبار مع كل نقرة.
  - حظر حفظ مفاتيح الإجابة نهائياً لضمان الأمان.
  - عند عودة الاتصال، إظهار نافذة استعادة المحاولة والإرسال المتماثل (`Idempotent Submit`).

---

### Directive 6: حلقة المعلم، التكليفات، والتصحيح اليدوي (Teacher Loop)
*الهدف: إغلاق حلقة التدريس، الواجبات، وتصحيح المقال على غرار Canvas LMS.*

- **Order 6.1 [Identity & Administration]:**  
  تفعيل علاقة `EducatorSubjectSpecialty` لربط المعلم بمواد صريحة متعددة، وحصر صلاحيات التأليف والتكليف بها.
- **Order 6.2 [Instruction/Assignments]:**  
  إطلاق واجهة التكليفات `/teacher/assignments`:
  - إنشاء خطة تكليف (`InstructionalPlan`) لصف دراسي وتحديد موعد الاستحقاق ونوع النشاط.
  - اشتقاق حالة إنجاز الطلاب تلقائياً من أدلة التعلم عبر `DueWorkService`.
- **Order 6.3 [Assessment & Mastery/Grading]:**  
  إطلاق طابور التصحيح اليدوي للأسئلة المقالية `/teacher/manual-grading`:
  - استعراض إجابات `REQUIRES_MANUAL_REVIEW`.
  - رصد الدرجة والملاحظات وفق معايير الـ Rubric.
  - فور اعتماد التصحيح، يقوم النظام آلياً بتحديث المحاولة وتشغيل `RecomputeMasteryUseCase` لتحديث إتقان الطالب فوراً.
- **Order 6.4 [Remediation/Interventions]:**  
  في شاشة `/teacher/interventions`، قراءة الحلقات المفتوحة من `GET /remediation/tracker` وإسناد خطة علاجية جماعية للمتعثرين بضغطة واحدة.

---

### Directive 7: تجربة الهاتف والتحول لـ Mobile-First وإصدار Android (TWA)
*الهدف: تطبيق هاتف عربي أنيق وسلس على غرار Duolingo، جاهز للنشر على Google Play.*

- **Order 7.1 [Design System/Typography & Spacing]:**  
  - اعتماد خط **Tajawal** العربي في كافة أرجاء المنصة مع ضبط أحجام النصوص (العناوين 22-24px، العناوين الفرعية 16-18px، النصوص 15-17px بارتفاع سطر 1.7).
  - ضبط أبعاد كافة عناصر النقر والأزرار بحد أدنى لا يقل عن 44px لملاءمة أصابع اليد على شاشات اللمس.
- **Order 7.2 [Frontend/Mobile Layout]:**  
  - تثبيت شريط التنقل السفلي (`StudentBottomNav`) للطلاب على شاشات الهواتف المحمولة:
    1. 🏠 الرئيسية (الاستمرار السريع والمهام)
    2. 📚 المسار (المواد والوحدات والدروس)
    3. 📋 المهام (الواجبات والاختبارات المستحقة)
    4. 🔄 مراجعة (البطاقات الذكية والعلاج)
    5. 👤 حسابي (الملف والإعدادات)
  - تحويل الجداول المعقدة إلى بطاقات مدمجة (`Stacked Cards`) تظهر شارات الحالة بوضوح.
- **Order 7.3 [Packaging/Android TWA]:**  
  - تدقيق ملف `manifest.webmanifest` وتوفير أيقونات PNG لجميع المقاسات القياسية (192, 512, maskable).
  - إعداد ملف الربط الرقمي `.well-known/assetlinks.json`.
  - تجهيز حزمة Android الرسمية عبر **Trusted Web Activity (TWA)** لتكون جاهزة للرفع إلى Google Play Console.

---

### Directive 8: تكامل مكتبة Google Drive وتصنيف الموارد التعليمية (Google Drive Library & Direct DB Mapping)
*الهدف: هيكل مجلدات قياسي لمكتبة Google Drive ينعكس مباشرة على قاعدة البيانات الحالية دون جداول جديدة.*

- **Order 8.1 [Infrastructure/Drive Taxonomy]:**  
  اعتماد الهيكل المعياري لمكتبة Google Drive (`docs/EDU7-GOOGLE-DRIVE-LIBRARY-TAXONOMY-AND-DB-MAPPING.md`):
  `الصف ➜ المادة ➜ الفصل ➜ 00_الكتاب_المدرسي_الرسمي + الوحدات ➜ الدروس ➜ تصنيفات الموارد (نصوص، فيديو، صور، علاج)`.
- **Order 8.2 [Database/Zero-Schema Mapping]:**  
  ربط ملفات الدرايف مباشرة بالجداول القائمة:
  - رابط كتاب الـ PDF ينعكس في حقل `Textbook.sourceUrl` وسجل `LearningResource` برتبة كتاب (`textbookId`).
  - الموارد التعليمية (فيديو، صوتيات، صور، نصوص) تنعكس في جدول `LearningResource` الحالي مع تحديد `ResourceKind` المناسب (`VIDEO`, `READING`, `WORKED_EXAMPLE`, `REMEDIAL`).
- **Order 8.3 [Application/Sync Engine]:**  
  بناء خوارزمية الاستكشاف والمزامنة الآلية (Drive-to-DB Sync) لقراءة مجلدات الدرايف وتحديث الروابط في قاعدة البيانات لحظياً بناءً على ترقيم الوحدات والدروس.
- **Order 8.4 [AI & Grounding Readiness]:**  
  استغلال قدرات Gemini Multimodal لقراءة كتب الـ PDF من مجلدات Google Drive مباشرة وتفريغها في جدولي `TextbookPage` و `ContentChunk` لخدمة التأصيل المعرفي للمساعد الذكي.

---

## 3. مصفوفة بوابات التحقق ومعايير القبول الصارمة (Definition of Done)

لا يتم اعتماد أي مرحلة أو إغلاق مهمة إلا باجتياز الفحوصات التالية:

| المحور | معيار التحقق البرمجي | بوابة القبول (Gate) |
|---|---|---|
| **السلامة والأمان** | فحص `CORS_ORIGINS` وقيود قاعدة البيانات | فشل الإقلاع في Production عند `*`، ورفض تكرار التسجيل النشط في DB |
| **المودالات والنوافذ** | فحص `Escape` و `Focus Trap` و `Double-submit` | عدم تسرب التركيز، إغلاق بـ Escape، وتعطيل زر الحفظ أثناء المعالجة |
| **الكتاب المدرسي** | التحقق من الإنشاء الآلي عند تجهيز الصف | ربط مادة بصف في المصفوفة ينشئ الكتاب كـ DRAFT تلقائياً بمفتاح مشتق |
| **دقة الإحصائيات** | فحص استرجاع الكتب في لوحة الإدارة | ظهور الـ 89 كتاباً بوضوح مع شارات حالتها دون تصفية قسرية |
| **المسار الأوحد للـ Seed** | فحص تشغيل `npm run db:seed` | استخدام `ContentImportService` دون استعلامات Prisma مباشرة |
| **حماية بنك الأسئلة** | فحص `assessment.empty_item_pool` | عدم انهيار اختبار الطالب عند نقص الأسئلة، وظهور بديل تربوي سليم |
| **دورة المقال** | تصحيح سؤال `ESSAY` ورصد درجته | تحديث نتيجة المحاولة وإعادة احتساب الإتقان تلقائياً وإشعار الطالب |
| **تجربة الهاتف** | فحص المتصفح على قياس 375px | عمل الشريط السفلي بسلاسة، وضوح خط Tajawal، وحفظ الإجابات أوفلاين |
| **معايير المعمارية** | تشغيل `npm run verify` كاملاً | اجتياز 28/28 قاعدة في الباك إند و 13/13 قاعدة في الفرونت إند بنسبة 100% |
