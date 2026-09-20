# Edu7 — الخطة النهائية للإنتاج وAndroid بعد مراجعة قوالب الاستيراد

**التاريخ:** 2026-09-15
**الأولوية الحالية:** تثبيت معيار استيراد المحتوى أولًا، لأن جودة الوحدات/الدروس/المفاهيم/الأسئلة هي ما سيحدد نجاح المراحل التالية كلها.
**القاعدة الحاكمة:** لا إعادة بناء للنواة. نكمل حلقات التشغيل فوق البنية الحالية: Engine → Product → Operations → Production.

---

## 0. الحكم التنفيذي

بعد مراجعة الكود الحالي والـschema وخدمات المحتوى، القرار العملي هو:

1. **نبدأ بقالب استيراد موحد Excel/JSON** قبل توسيع التنفيذ العام؛ لأن أي استيراد متكرر للأسئلة أو المنهج بدون عقد ثابت سيخلق مفاتيح مكررة وروابط علاجية ضعيفة.
2. **القالب لا يحتوي UUID ولا يعتمد على keys كمدخلات.** الإنسان/AI يكتب `slug`, `sourceRef`, وأسماء بشرية، والمستورد يولد keys بطريقة موحدة.
3. **نستخدم حقول قاعدة البيانات الحالية فقط.** إذا احتجنا حقولًا تشغيلية مثل batch/audit/source document لاحقًا، نطرحها كقرار مستقل ولا نخلطها بالقالب الآن.
4. **الوحدات والدروس Seed/Staged content** لأنها غالبًا ثابتة خلال الفصل؛ تعدّل قبل النشر أو عبر طبعة جديدة.
5. **المفاهيم قابلة للإضافة تدريجيًا** في Draft/edition جديد، لكن لا نفتح تعديلًا صامتًا على كتاب منشور لأنه يغيّر معنى mastery.
6. **الأسئلة تدخل كثيرًا ومتكررًا** لذلك تحتاج import mode مستقل مع dedupe، provenance، روابط مفاهيم، misconceptions، remedial resources، flashcards، وتصحيح يدوي للمقال.
7. **Android/mobile ليس مجرد تصغير للويب.** نحدد تبويبات، خط، عرض مختصر، بطاقات، bottom navigation، وإخفاء الجداول/المفاتيح/الحقول الإدارية عن الطالب.

المخرجات المعيارية الجديدة موجودة في:

- `docs/CONTENT-IMPORT-TEMPLATES-AND-PROMPTS.md`
- `docs/templates/edu7-content-authoring-template.v1.json`
- `docs/templates/yemen-content-generation.prompt.md`

---

## 1. نتيجة مراجعة importer/export الحالي

### 1.1 ما هو جيد حاليًا

- يوجد عقد محتوى عام في `src/contexts/content/domain/export-profile.ts` باسم `edu7.textbook-content` وإصدار `1.1`.
- العقد الحالي يحتوي: textbook, units, lessons, concepts, prerequisites, misconceptions, learningResources, questions.
- التعليقات داخل العقد تؤكد أن `key` و`status` ليست حقول import عادية، بل output-only/معلوماتية.
- `content-import.service.ts` ينفذ dry-run، يولد مفاتيح، ويمر عبر `ContentAuthoringService` و`ItemBankService` بدل الكتابة المباشرة لقاعدة البيانات.
- قاعدة البيانات الحالية تحتوي Models مهمة للاستيراد الكامل: `Flashcard`, `TextbookPage`, `ContentChunk`, وحقول answer key المتقدمة.

### 1.2 الفجوات التي يجب سدها قبل التوسع في الاستيراد

| الفجوة | الأثر | القرار |
|---|---|---|
| `flashcards` غير موجودة في `ContentPackage` الحالي رغم وجود Model/API | لا يمكن استيراد البطاقات ضمن حزمة منهج كاملة | رفع import profile إلى `1.2` أو تنفيذ adapter يستدعي flashcard service بعد import. |
| `AnswerKeyExport` لا يحمل كل حقول الأنواع المتقدمة | MATCHING/ORDERING/ESSAY لا تستورد كاملة | إضافة `expectedOrder`, `expectedPairs`, `rubric` للعقد. |
| prerequisites وchoice misconceptions تعتمد على keys في العقد الحالي | يصعب ملء Excel/AI بدون معرفة keys المولدة | القالب البشري يستخدم slug paths، والمودال يحولها إلى keys داخليًا. |
| تكرار الأسئلة يحتاج سياسة واضحة | risk: overwrite أو duplicate غير متوقع | dedupe حسب lesson + normalized text، وsourceRef conflict للمراجعة. |
| seed واستيراد UI قد يتفرعان | صيانة صعبة وتناقضات | seed/import/AI prompt كلها تستخدم نفس authoring template/converter. |

---

## 2. معيار الاستيراد المعتمد

### 2.1 القالب المعتمد

القالب يصبح **Authoring Template** لا DB dump:

```text
Excel أو JSON
  يحتوي business fields + slugs + sourceRef
  لا يحتوي UUID/key/status
    ↓
Import Modal / CLI
  validates + derives keys + previews generated keys
    ↓
Services
  ContentAuthoringService + ItemBankService + specialized commands
    ↓
Review/Publish workflow منفصل
```

### 2.2 الحقول الأساسية

- كتاب: `subjectKey`, `gradeKey`, `termKey`, `title`, `edition`, `issuer`, `isbn`, `publishYear`, `totalPages`.
- وحدات: `slug`, `parentUnitSlug`, `name`, `orderIndex`, `startPage`, `endPage`, `sourceRef`.
- دروس: `unitSlug`, `slug`, `name`, `description`, `orderIndex`, `estimatedMins`, `startPage`, `endPage`, `sourceRef`.
- مفاهيم: `unitSlug`, `lessonSlug`, `slug`, `name`, `description`, `difficulty`, `importance`, `masteryThreshold`, `isCore`, `pageNumber`, `sourceRef`, `nameEn`, `bloomsLevel`.
- أخطاء شائعة: concept slug path + `slug`, `name`, `description`, `correction`.
- موارد تعلم/علاج: target scope + `kind`, `title`, `body`, `url`, `pageStart`, `pageEnd`, `estimatedMins`.
- فلاش كارد: concept slug path + `front`, `back`, `reviewPriority`, `difficulty`.
- أسئلة: lesson path + `type`, `text`, `hint`, `explanation`, `points`, `difficulty01`, `origin`, `textbookRole`, `sourceRef`, `visibility`, choices, answerKey, concept links.
- صفحات/مقاطع: `pageNumber`, `text`, `imageUrl`, `tokenCount`, `ordinal` عند توفر استخراج موثوق.

### 2.3 سياسة `key`

- لا يظهر `key` في القالب كحقل تعبئة.
- أي key في ملف مستورد يرفض أو يتجاهل حسب وضع الاستيراد.
- dry-run يعرض generated keys للشفافية فقط.
- `slug` هو قرار المؤلف، و`key` هو قرار النظام.
- أسماء العرض لا تستخدم key/UUID؛ تعرض `title/name/sourceRef` وربما `generatedKeyPreview` فقط للمؤلفين/المشرفين.

### 2.4 سياسة الاستيراد المتكرر

| النوع | الهوية البشرية | السلوك عند التكرار |
|---|---|---|
| Unit/Lesson | slug داخل الأب | unchanged إذا موجود، conflict إذا تغيّر الاسم/الصفحات في كتاب منشور، patch فقط في Draft. |
| Concept | slug داخل lesson | add-if-missing، conflict إذا تغيّر جذريًا، لا إضافة صامتة في Published. |
| Misconception | slug داخل concept | upsert في Draft، create-only في Published حسب lock policy. |
| Resource | scope + slug | upsert/add في Draft، retire بدل delete عند الإزالة. |
| Flashcard | concept + normalized front | add-if-missing، update فقط في Draft/review. |
| Question | lesson + normalized text | unchanged إذا مطابق، conflict إذا same sourceRef ونص مختلف، create new إذا نص جديد. |

---

## 3. Template Pipeline للمنهج اليمني

### 3.1 مصادر المحتوى

1. **Telegram `Books_Yemen_new`** كمصدر مطلوب من المستخدم، لكن يحتاج export/session أو ملفات مرفوعة لأن public web preview لا يعطي PDF مباشرًا في البيئة الحالية.
2. **`e-learning-moe.edu.ye`** كبديل رسمي قابل للفهرسة، لكن بعض روابط PDF تفشل في التحميل من sandbox؛ نعتمدها كـprovenance/resource URL إلى أن تتوفر الملفات.
3. **ملفات يرفعها المستخدم** هي أسرع مسار عملي لاستخراج النص الكامل الآن.

### 3.2 Naming للمنهج اليمني

```text
YE-MOE-{gradeKey}-{subjectKey}-T{termOrdinal}-{edition}.xlsx
YE-MOE-{gradeKey}-{subjectKey}-T{termOrdinal}-{edition}.json
```

أمثلة:

```text
YE-MOE-G01-ISL-T1-2026.xlsx
YE-MOE-G07-SCI-T2-2026.json
```

### 3.3 `sourceRef`

```text
MOE-YE-{edition}-{gradeKey}-{subjectKey}-T{term}-{U/L/C/Q}{number}
MOE-YE-MIN-{academicYear}-{gradeKey}-{subjectKey}-{session}-Q{number}
AI-DRAFT-YE-{edition}-{gradeKey}-{subjectKey}-T{term}-Q{number}
```

### 3.4 قواعد provenance

- سؤال الكتاب: `origin=TEXTBOOK`, و`textbookRole` غير فارغ.
- السؤال الوزاري: `origin=MINISTERIAL`, و`textbookRole=null`.
- سؤال AI: `origin=AI`, و`visibility=SUBMITTED_FOR_REVIEW`.
- `MINISTERIAL` ليس QuestionType.
- المصدر لا يتحكم في اختيار CAT أو mastery؛ هذا قرار assessment/learning policy.

---

## 4. خطة التنفيذ المرحلية

## Phase A — Import Contract First

**الهدف:** لا ننتقل لتغذية محتوى كبير قبل تثبيت قالب موحد.

1. تعديل `export-profile.ts` إلى إصدار `1.2`:
   - إضافة `flashcards`.
   - إضافة `textbookPages` و`contentChunks` اختياريًا.
   - إضافة `expectedOrder`, `expectedPairs`, `rubric` إلى answer key.
   - إضافة `visibility` للأسئلة إذا أردنا teacher/school imports.
2. بناء Authoring Template parser:
   - JSON مباشر.
   - Excel sheets حسب `docs/CONTENT-IMPORT-TEMPLATES-AND-PROMPTS.md`.
3. بناء resolver:
   - يحول `unitSlug/lessonSlug/conceptSlug/misconceptionSlug` إلى مفاتيح مشتقة.
   - لا يثق بأي key قادم من الملف.
4. بناء dry-run report:
   - generated keys.
   - مشاكل sheet/row.
   - conflicts.
   - missing references.
   - publish readiness.
5. توحيد seed/import:
   - seed يقرأ نفس القالب بدل تنسيقات خاصة كلما أمكن.
   - الاستيراد اليدوي في admin يستخدم نفس service.

**معايير القبول:**

- استيراد JSON sample يمر dry-run بلا كتابة.
- نفس sample يطبق في قاعدة اختبار ويعيد التشغيل بدون duplicate.
- ملف Excel sample ينتج نفس normalized JSON.
- لا `key` مطلوب في أي ملف إدخال.
- flashcards/resources/remedial/misconceptions/questions تدخل من مسار واحد.

---

## Phase B — بنك الأسئلة والاستيراد المتكرر

**الهدف:** جعل إدخال الأسئلة المتكرر آمنًا ومفيدًا للتكيف والعلاج.

1. Question Batch Import UI:
   - upload JSON/XLSX.
   - تفريغ الأسئلة إلى draft queue.
   - عرض التكرارات/conflicts.
   - ربط السؤال بالمفهوم والمصدر.
2. دعم كل أنواع answer keys:
   - MCQ/TF: `correctChoiceIds`.
   - Numeric: `numericMin/numericMax`.
   - Short/Fill: `acceptedTexts`.
   - Ordering: `expectedOrder`.
   - Matching: `expectedPairs`.
   - Essay: `rubric` + manual grading.
3. Misconception-aware choices:
   - distractor → misconception.
   - remediation resource يخرج تلقائيًا كاقتراح بعد الخطأ.
4. CAT pool health:
   - لكل concept: minimum published auto-gradable questions.
   - لا ESSAY في CAT.
   - إذا pool ناقص: حجب CTA أو fixed practice fallback موسوم بوضوح.
5. Ministerial import:
   - origin `MINISTERIAL`.
   - sourceRef وزاري منظم.
   - لا type جديد.
   - يمر بالمراجعة قبل النشر.

**معايير القبول:**

- لا ينهار اختبار الطالب عند نقص pool.
- السؤال غير المرتبط بمفهوم لا ينشر.
- السؤال المقالي يذهب manual grading ولا يحدث mastery قبل التصحيح.
- السؤال الوزاري يظهر في bank filter كمصدر، لا كنوع.

---

## Phase C — مسار الطالب والدروس

**الهدف:** تجربة طالب يومية واضحة لا تخلط الدروس وتناسب الهاتف.

1. Dashboard:
   - بطاقة “تابع من آخر درس”.
   - مهام اليوم والمستحق.
   - مؤشرات بسيطة: التقدم، الإتقان، streak/نشاط.
2. Learning Path:
   - عرض المواد/الكتب حسب العام والفصل النشط.
   - كل مادة تعرض كتابها باسم بشري غير مكرر مع الصف/المادة.
   - الوحدات قابلة للطي.
   - الدروس مرتبة ولا تختلط بين كتب/فصول.
3. Lesson Workflow:
   - قراءة/فيديو/مثال.
   - أسئلة تحقق قصيرة.
   - flashcards/review.
   - tutor drawer داخل الدرس.
   - اختبار الدرس.
4. Post-lesson CTAs:
   - بعد الاختبار: “العودة للرئيسية” أو “متابعة الدرس التالي”.
   - عند آخر درس: “أنهيت الكتاب/الوحدة — العودة للرئيسية”.
5. Offline/local attempt recovery:
   - حفظ draft الإجابات محليًا بشكل محدود.
   - لا تخزين answer keys.
   - sync واضح عند عودة الاتصال.

---

## Phase D — المعلم وولي الأمر والإدارة

### المعلم

- إنشاء تكليف من كتاب/درس/بنك أسئلة.
- إنشاء امتحان ثابت أو تكيفي من البنك وفق معايير.
- رؤية نتائج الصف والتدخلات.
- تصحيح manual grading للمقال.
- تخصص المعلم يرتبط بمواد متعددة، لا نص حر فقط.

### ولي الأمر

- متابعة تقدم الأبناء بصياغة غير تقنية.
- إنشاء مهام استشارية منزلية.
- المهام advisory ولا تدخل mastery/completion الرسمي.
- الواجبات الإدارية قناة مستقلة عن `next-step`.

### الإدارة/المؤلف

- إدارة الكتب والمحتوى وصور/PDF.
- import project panel للقوالب.
- content coverage dashboard.
- question bank studio.
- نشر/مراجعة AI drafts قبل اعتمادها.

---

## Phase E — AI Tutor وGrounding

1. OpenAI بجانب Gemini، لا بديلًا عنه.
2. tutor داخل الدرس يعتمد على:
   - lesson resources.
   - textbook pages/chunks إن توفرت.
   - concept summaries.
3. refusal policy:
   - لا يجيب خارج المنهج/العمر.
   - يصرح عندما لا توجد مصادر كافية.
4. citations/sourceRef في إجابات المؤلف/المعلم عند الحاجة.
5. quota/rate limit وسجلات استخدام.
6. لا يولد محتوى منشور مباشرة؛ ينتج Draft يراجعه الإنسان.

---

## Phase F — جاهزية الإنتاج

1. CI:
   - typecheck backend/frontend.
   - unit tests.
   - Prisma validation/migrations.
   - lint إن وجد.
2. بيئات:
   - staging/prod.
   - متغيرات OpenAI/Gemini منفصلة.
   - secrets في platform وليس repo.
3. قاعدة البيانات:
   - backup/restore runbook.
   - migration rollback strategy.
   - seed idempotency.
4. Observability:
   - logs structured.
   - import job outcomes.
   - assessment failures.
   - AI errors/quota.
5. Security:
   - RBAC tests.
   - learner-safe question payloads.
   - no answer keys to frontend.
   - rate limits للـAI/import.
6. Storage:
   - PDF/images/object storage.
   - signed URLs عند الحاجة.
   - thumbnails/previews.

---

## 5. Android/mobile UI Plan

### 5.1 الخطوط

- **واجهة عربية:** `Tajawal` للبطاقات، الأزرار، العناوين، والقوائم.
- **نصوص طويلة/قرآنية/دينية أو كتابية:** `Noto Naskh Arabic` عند الحاجة لقراءة أفضل مع التشكيل.
- **لاتيني/أرقام:** system fallback أو `Inter` إذا موجود.
- أحجام الهاتف:
  - العنوان الرئيسي: 22–24px.
  - عنوان البطاقة: 16–18px.
  - النص التعليمي: 15–17px مع line-height 1.7.
  - أزرار اللمس: min-height 44px.

### 5.2 نمط التصميم المقترح

نمذجته ليست نسخًا من تطبيق واحد، بل مزج:

- **Khan Academy:** وضوح المسار والإتقان.
- **Duolingo:** متابعة يومية، حلقات تقدم، micro goals.
- **Brilliant:** بطاقات درس تفاعلية مختصرة.
- **Google Classroom:** بساطة المهام والمواعيد.
- **Moodle Mobile:** فصل الطالب/المعلم/الإدارة وصلاحيات واضحة.

### 5.3 تبويبات الطالب على الهاتف

Bottom navigation ثابت:

1. **الرئيسية** — ملخص اليوم.
2. **المسار** — المواد/الكتب/الدروس.
3. **المهام** — واجبات واختبارات مستحقة.
4. **مراجعة** — flashcards/remediation/review.
5. **حسابي** — الملف والإعدادات.

على الشاشة الكبيرة يمكن تحويلها إلى side navigation، لكن نفس ترتيب الأولويات يبقى.

### 5.4 ما يظهر للطالب في الهاتف

- اسم المادة والكتاب البشري.
- الدرس الحالي وآخر نقطة توقف.
- نسبة تقدم بسيطة.
- حالة الدرس: لم يبدأ / جاري / يحتاج مراجعة / مكتمل.
- زر أساسي واحد في كل بطاقة: “تابع”، “ابدأ”، “راجع”.
- تنبيه نقص الأسئلة بلغة لطيفة: “هذا الدرس يحتاج أسئلة إضافية، يمكنك مراجعة الشرح الآن.”
- نتائج الاختبار: درجة، نقاط القوة، ما يحتاج مراجعة، زر علاج.

### 5.5 ما يُخفى أو يُختصر من web لتوفير المساحة

- UUID/keys بالكامل.
- الجداول الكبيرة؛ تتحول إلى cards/filter chips.
- كل الأعمدة الإدارية غير الضرورية.
- تحليلات تفصيلية طويلة؛ تظهر في bottom sheet أو صفحة “تفاصيل”.
- أدوات المؤلف المتقدمة ليست في واجهة الطالب.
- نصوص طويلة جدًا تقطع إلى sections collapsible.
- chart legends المعقدة تستبدل بنصوص مباشرة.

### 5.6 صفحات الطالب المطلوبة Mobile-first

#### الرئيسية

- Hero صغير: “مرحبًا، أكمل درس …”.
- بطاقة اليوم.
- 3 مؤشرات فقط.
- قائمة مهام مختصرة.

#### المسار

- Tabs للمواد.
- Accordion للوحدات.
- Lesson cards عمودية.
- حالة كل درس بأيقونة ولون.
- لا خلط بين دروس كتب مختلفة.

#### الدرس

- Progress stepper أعلى الصفحة.
- محتوى مقروء + media/resources.
- زر tutor عائم صغير.
- Quiz block.
- نهاية واضحة مع CTA.

#### الاختبار

- سؤال واحد في الشاشة.
- خيارات كبيرة.
- مؤشر تقدم.
- autosave/offline banner.
- no answer key exposure.

#### المراجعة

- Flashcard stack.
- أخطاء شائعة مكتشفة.
- موارد علاجية قصيرة.

### 5.7 المعلم على الهاتف

- Dashboard مختصر: صفوفي، ما يحتاج تصحيح، تدخلات عاجلة.
- إنشاء تكليف سريع من قالب.
- تفاصيل متقدمة والجداول الكبيرة تبقى أفضل على tablet/desktop، لكن القراءة والمتابعة تعمل على phone.

### 5.8 ولي الأمر على الهاتف

- بطاقة لكل ابن.
- تقدم أسبوعي مختصر.
- مهام منزلية مقترحة.
- لا مصطلحات mastery تقنية؛ تستخدم “ممتاز/يحتاج مراجعة/متأخر”.

### 5.9 Android packaging

1. **PWA Production-ready أولًا**:
   - manifest كامل.
   - offline shell.
   - icons صحيحة.
   - service worker محدود وآمن.
2. **Trusted Web Activity** للنشر السريع على Play Store.
3. **Capacitor لاحقًا** عند الحاجة إلى:
   - push notifications native.
   - file sharing/upload أفضل.
   - local encrypted storage.
4. لا نبدأ Native Android منفصل لأن ذلك يضاعف الصيانة قبل نضج المنتج.

---

## 6. مقارنة الفجوات مع أنظمة تعليمية جاهزة

| نمط النظام | ما نأخذه | كيف يلائم Edu7 |
|---|---|---|
| Moodle/Canvas | صلاحيات، content lifecycle، audit، assignments | نطبق workflow على content/import/publish بدون تعقيد زائد للمدارس الصغيرة. |
| Khan Academy | mastery path، skill gaps، hints | نربط المفاهيم والأسئلة والعلاج بـ mastery الحالي. |
| ALEKS | diagnostic placement وknowledge state | نستخدمه في diagnostic بدون إدخال essay أو items غير كافية. |
| Duolingo | mobile habit، streak، short sessions | نحفز الطالب دون تحويل النظام للعبة سطحية. |
| Brilliant | lesson-by-doing | الدرس يعرض مفهومًا ثم تحققًا سريعًا وشرحًا. |
| Google Classroom | بساطة التكليف | واجهة المعلم تركز على create/assign/review بدل جداول كثيرة. |
| Moodle Mobile | role-based mobile | الطالب mobile-first، المعلم/الإدارة responsive لكن تفاصيلها أعمق على desktop. |

---

## 7. ترتيب الأولويات النهائي

### Sprint 1 — Import Standard

- تنفيذ/تثبيت authoring template.
- Excel parser.
- JSON validator.
- key generation preview.
- flashcards/answerKey v1.2 في profile.
- dry-run UI/CLI.

### Sprint 2 — Yemen Pilot Content

- اختيار كتاب واحد: صف أول/تربية إسلامية أو صف سابع/علوم.
- تعبئة وحدتين كاملتين عبر القالب.
- مراجعة بشرية.
- استيراد dry-run ثم apply.
- dashboard coverage.

### Sprint 3 — Question Bank Studio

- إدخال batch للأسئلة.
- ministerial import panel.
- conflict resolution.
- publish gate.
- CAT pool health.

### Sprint 4 — Student Mobile Path

- إعادة ترتيب dashboard/path/lesson/review للهاتف.
- bottom tabs.
- lesson workflow.
- post-test CTAs.
- offline attempt recovery polish.

### Sprint 5 — Teacher/Parent loops

- assignments/results/interventions/manual grading E2E.
- parent advisory tasks.
- teacher subject specialties polish.

### Sprint 6 — AI Tutor/Grounding

- content chunks/pages ingestion.
- tutor drawer citations/refusal/quota.
- OpenAI+Gemini provider routing.

### Sprint 7 — Production Hardening

- CI/CD.
- observability.
- backups.
- rate limits.
- security/RBAC regression.

### Sprint 8 — Android Release

- PWA audit.
- TWA packaging.
- Play Store assets.
- QA matrix for low-end Android phones.
- Capacitor decision if native capabilities required.

---

## 8. Definition of Done العام

لا تعتبر الخطة مكتملة إلا إذا تحقق الآتي:

1. يمكن رفع Excel أو JSON للمنهج اليمني واستيراده dry-run/apply بدون keys/UUID.
2. نفس القالب يستخدم في seed وAI prompt وadmin import.
3. الأسئلة المتكررة لا تكرر rows ولا تمسح منشورًا دون مراجعة.
4. misconceptions/remedial resources/flashcards ترتبط بالمفهوم والسؤال.
5. CAT لا يبدأ إذا pool غير كافٍ، أو يعلن fallback واضحًا.
6. المقال يدخل manual grading ولا يؤثر في mastery قبل التصحيح.
7. الطالب يرى مسارًا مرتبًا حسب الكتاب/الفصل ولا تختلط الدروس.
8. الهاتف يعمل بتجربة أصلية: تبويبات، بطاقات، خط عربي، CTAs واضحة.
9. ولي الأمر advisory فقط.
10. الإنتاج لديه CI، backup، logs، secrets، وrunbooks.

---

## 9. ملاحظات تنفيذية فورية

- التحقق المحلي كان متوقفًا سابقًا بسبب غياب `node_modules` وظهور `tsc: not found`. يجب تشغيل `npm ci` ثم typecheck/tests قبل PR.
- قبل أي commit يجب مراجعة `git status` لأن workspace يحتوي تغييرات كثيرة من مراحل متعددة.
- فتح Pull Request يجب أن يتم من branch الجلسة فقط: `arena/01a0a0c9-edu7`.
- لا نغيّر branch ولا نعيد كتابة history.

---

## 10. الخلاصة

أفضل مسار ليس بناء مستخرج PDF ضخم فورًا، ولا استمرار إدخال محتوى بأشكال متفرقة. المسار الصحيح هو:

```text
تثبيت قالب استيراد موحد
  ↓
تشغيل Yemen pilot content
  ↓
إغلاق بنك الأسئلة والتكرار والوزاري
  ↓
تحويل تجربة الطالب إلى Android-first
  ↓
إكمال teacher/parent loops
  ↓
AI grounding + production hardening
  ↓
PWA/TWA Android release
```

بهذا تصبح Edu7 قابلة للتوسع من G0 إلى G12 دون كسر النواة الحالية أو ابتكار نماذج غير محسوبة.
