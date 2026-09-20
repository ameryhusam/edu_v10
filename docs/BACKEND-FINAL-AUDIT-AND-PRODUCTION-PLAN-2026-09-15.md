# Edu7 — تدقيق الخلفية النهائي وخطة الإنتاج الموحّدة (ملف واحد)

**تاريخ:** 2026-09-15 · **النطاق:** الخلفية (`src/`, `prisma/`) + الواجهة كمستهلك للعقد (`web/`) · **الاستبعاد:** `legacy/` (مرجع سلوكي فقط، لا يُقاس عليه).

هذا الملف **الوحيد** يجمع: (أ) التدقيق الفعلي المُتحقَّق منه بقراءة الكود وتشغيل الأدوات، (ب) نقد الخطة السابقة المقترحة، (ج) الخطة النهائية القابلة للتنفيذ ببنودها P0/P1/P2، (د) تصميم طبقة AI الجديدة، (هـ) قائمة صريحة بما **يُمنع** إعادة بناؤه. لا توجد ملفات تدقيق أخرى موازية — أي ملف `PRODUCTION-READINESS-AUDIT-*` أو `AUDIT-OF-PRODUCTION-MASTER-PLAN-*` سابق أُلغي ودُمج هنا.

**منهجية التحقق:** كل ادّعاء أدناه إما (1) شُغِّل فعليًا (`npm ci` نظيف، `npm run verify` على الخلفية والواجهة، فحص hex/grep دقيق على الكود)، أو (2) عُلِّم صراحة بأنه **غير مُتحقَّق منه حيًّا بعد** ويحتاج تنفيذًا ليُقاس. لا ادّعاء هنا مبني على اسم ملف أو على وجود سطر توثيقي فقط.

---

## 0. خط الأساس المُتحقَّق منه (لا يُعاد قياسه لاحقًا بلا سبب)

```
npm ci (نظيف، من الصفر) → postinstall: schema-engine + prisma generate + web deps → نجح
npm run typecheck            → نجح (خلفية)
npm run verify (خلفية)       → typecheck ✅ · arch:check 28/28 قاعدة ✅ · 1025 اختبارًا نجح (1 متخطى) ✅
cd web && npm run verify     → typecheck ✅ · arch:check 13/13 قاعدة ✅ · 84 اختبارًا نجح ✅

45 Prisma models · 20 enums · 13 route files · 66 ملف اختبار خلفية (tests/unit) + 17 ملف اختبار واجهة = 83 إجمالًا
```

**تصحيح لخطأ متكرر في تقارير سابقة:** "83" هو **المجموع** (خلفية + واجهة)، وليس عدد ملفات اختبار الخلفية وحدها (66). فرّق بين الرقمين عند القراءة.

**لا يوجد `.github/workflows/` في المستودع الجديد إطلاقًا** (فقط في `legacy/scripts/ci/`، غير مُفعَّل). كل التحقق أعلاه تم يدويًا في هذه الجلسة، لا عبر بوابة آلية. **هذه هي الفجوة الحقيقية**، لا عطل في الاختبارات نفسها — نتيجة `npm ci` النظيف تُثبت أن الكود سليم وقابل لإعادة الإنتاج.

---

## 1. P0 — عوائق إنتاجية حرجة (كل بند مُتحقَّق منه بقراءة السطر الفعلي)

### P0.1 — CORS يسمح بأي origin افتراضيًا مع credentials

**الدليل الحرفي:**
```ts
// src/shared/config/env.ts
CORS_ORIGINS: z.string().default('*'),

// src/interface/http/app.ts
cors({
  origin: env.CORS_ORIGINS === '*' ? true : env.CORS_ORIGINS.split(',').map((s) => s.trim()),
  credentials: true,
})
```
`origin: true` مع `credentials: true` = انعكاس أي طالب origin وقبول الكوكيز معه. غير آمن كإعداد افتراضي للإنتاج.

**نمط الحل موجود فعلًا في نفس الملف** لسر آخر (`JWT_SECRET`):
```ts
if (env.NODE_ENV === 'production' && env.JWT_SECRET.startsWith('dev-only')) {
  throw new Error('JWT_SECRET must be set to a real secret in production.');
}
```
**الإصلاح المطلوب:** إضافة نفس نمط "الفشل الصريح عند الإقلاع" لـ`CORS_ORIGINS`:
```ts
if (env.NODE_ENV === 'production' && env.CORS_ORIGINS === '*') {
  throw new Error('CORS_ORIGINS must be an explicit allow-list in production.');
}
```
**حجم العمل:** ساعات، لا أيام — السقالة جاهزة.

**بوابة القبول:** اختبار integration يرسل طلبًا بـ`Origin` غير مصرَّح به مع `credentials`، يتحقق من الرفض في `NODE_ENV=production`؛ واختبار توليد بيئة يتحقق من رفض `loadEnv()` عند `CORS_ORIGINS=*` وProduction.

---

### P0.2 — قيد "تسجيل حالي واحد فقط لكل متعلّم" غير موجود في قاعدة البيانات

**الدليل بالفحص المباشر لكل ملفات الهجرة:**
```
grep -rln "enrollments_one_current_per_learner" prisma/migrations/*/migration.sql
→ لا نتيجة إطلاقًا
```
لكن `prisma/schema.prisma:551-557` يحتوي تعليقًا يزعم أن هذا الفهرس **موجود**:
> "Exactly one current enrollment per learner is enforced by the partial unique index 'enrollments_one_current_per_learner', added at the end of the baseline migration"

**هذا تناقض توثيقي-تنفيذي فعلي**: الفهرس **غير موجود في أي هجرة قابلة للتنفيذ**، فقط في تعليق. الحماية الوحيدة الفعلية اليوم هي على مستوى التطبيق: `identity.repository.ts` (`createEnrollment`, `makeEnrollmentCurrent`) يستخدم `$transaction` مع `updateMany({isCurrent:false})` ثم الكتابة — **بلا أي قيد قاعدة بيانات يمنع سباقًا (race condition) أو كتابة مباشرة من مسار آخر (سكربت/استيراد/اتصال يدوي)**.

**لا يوجد اختبار واحد في المستودع يتحقق من هذا الثابت ضد قاعدة بيانات حقيقية** — `tests/unit/provisioning-enrollment.test.ts` يستخدم `FakeRepo` بالكامل (مذيّف، بلا اتصال DB).

**الإصلاح المطلوب:**
```sql
-- migration جديدة، بنفس أسلوب remediation_one_open_per_gap الموجود فعلًا في baseline
CREATE UNIQUE INDEX "enrollments_one_current_per_learner"
  ON "enrollments" ("learnerId")
  WHERE "isCurrent" = true;
```
مع اختبار integration حقيقي ضد قاعدة بيانات فعلية (PGlite الموجودة أصلًا في المشروع للتطوير) يحاول إدراج تسجيلين حاليّين لنفس المتعلّم متزامنين، ويتحقق من رفض الثاني بخطأ قيد لا بخطأ تطبيقي.

**بوابة القبول:** الهجرة تُطبَّق بنجاح على بيانات البذرة الحالية بلا تعارض؛ اختبار يثبت أن إدراجًا مباشرًا (bypassing الخدمة) يُرفض من القاعدة نفسها.

---

### P0.3 — Enrollment لا يدعم نقل مدرسة داخل نفس (السنة، الفصل)

**الدليل:**
```prisma
@@unique([learnerId, academicYearId, termId])
```
هذا يمنع بنيويًا إنشاء `Enrollment` ثانٍ لنفس المتعلّم في نفس (سنة، فصل) حتى لو كانت مدرسة مختلفة. `enrolLearner` في `provisioning.service.ts` يرفض بـ `identity.enrollment_exists`. **لا يوجد مسار HTTP مخصص لـ"نقل مدرسة"** — العملية الوحيدة المتاحة (`endEnrollment` ثم `enrolLearner` جديد) ستصطدم بنفس القيد إن كانت السنة/الفصل نفسيهما.

**القرار المطلوب (تصميم لا تنفيذ أعمى):** فصل هوية سجل التسجيل التاريخي عن شرط "الحالي":
```prisma
@@unique([learnerId, schoolId, academicYearId, termId])  // هوية تاريخية، تسمح بمدرسة مختلفة لنفس (سنة، فصل)
// + الفهرس الجزئي من P0.2 يبقى هو الضامن الوحيد لـ"حالي واحد"
```
**تحذير معماري:** هذا Schema Change حقيقي يمس `@@unique` قائمًا — **يُنفَّذ فقط بعد إثبات حاجة منتج فعلية** (حالة نقل مدرسة داخل نفس الفصل الدراسي مطلوبة فعلًا من العميل)، ومعه migration تهجير للبيانات القائمة واختبار توافق رجعي (backward compatibility) كما يشترط قسم "قواعد التنفيذ" أدناه.

---

### P0.4 — لا يوجد CI آلي (لا "الاختبارات معطوبة")

**تصحيح لادّعاء سابق:** أُعيد الفحص بتثبيت نظيف كامل (حذف `node_modules` و`web/node_modules` ثم `npm ci`) والنتيجة: **كل الاختبارات تعمل بلا استثناء** (§0). أي تقرير سابق ادّعى "typecheck يفشل بسبب type definitions مفقودة" كان نتيجة بيئة محلية تالفة لا عطلًا في المستودع.

**المشكلة الحقيقية القابلة للقياس:** غياب تام لأي workflow في `.github/workflows/`. **هذا P0 فعلي** لأن أي دمج كود اليوم لا تمنعه بوابة آلية.

**الإصلاح المطلوب:** إنشاء `.github/workflows/ci.yml` يشغّل بالضبط:
```yaml
jobs:
  backend:
    steps:
      - npm ci
      - npm run typecheck
      - npm run arch:check
      - npm test
      - npm run build
  frontend:
    steps:
      - npm ci  (في web/)
      - npm run typecheck
      - npm run arch:check
      - npm test
      - npm run build
```
على كل push وPR إلى الفرع الرئيسي، بلا استثناء، بلا `continue-on-error`.

---

### P0.5 — PWA الحالي "Shell/Recovery" فقط، ليس "Offline Learning"

**الدليل الكامل (33 سطرًا، `web/public/sw.js`):**
```js
const SHELL = ['/', '/offline.html', '/manifest.webmanifest', '/icons/icon.svg'];
// ...
if (url.pathname.startsWith('/api/')) return;   // لا تخزين لأي استجابة API
if (request.mode === 'navigate') {
  event.respondWith(fetch(request).catch(() => caches.match('/offline.html')));
  // طالب يفتح /lesson?lesson=X أوفلاين → يُعاد لصفحة أوفلاين عامة، لا لحالة الدرس
}
```
`offlineAttemptStore` (`web/src/education/assessment/offline-attempt-store.ts`, 80 سطرًا) يخزّن **إجابة واحدة معلّقة لكل سؤال داخل محاولة نشطة فقط** — لا طابور مزامنة عام، لا تنزيل دروس/كتب.

**القرار:** إعادة تسمية هذه الطبقة صراحة "Connectivity Recovery Shell" في التوثيق والواجهة (لا يُوعَد المستخدم بتعلّم أوفلاين). بناء "Offline Learning" الحقيقي (تنزيل حزمة درس، طابور مزامنة، حل تعارضات) **مرحلة منتج منفصلة لاحقة**، وليست إصلاح Bug.

---

### P0.6 — جاهزية Android أقل بكثير من حزمة إنتاجية

**الدليل:** `manifest.webmanifest` يحتوي أيقونة SVG واحدة فقط بلا مجموعة أحجام PNG:
```json
"icons": [{ "src": "/icons/icon.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "any maskable" }]
```
لا كود لـdeep links، push، تخزين آمن، أو دورة حياة native. **هذا أساس PWA أولي، لا حزمة Android**. التسلسل الصحيح: Responsive Web → PWA مكتمل → Android TWA → Capacitor عند الحاجة الفعلية فقط لقدرة native.

---

### P0.7 — مصادر PDF ليست Content Factory

**الدليل من تعليق `prisma/seed/source-catalog.ts` نفسه:**
> "This deliberately imports source PDFs as textbook-level resources only. A PDF link is useful learning content, but it is not automatically a vetted concept map or item bank"

91 مصدر PDF مُفهرَس، **صفر خط أنابيب استخراج آلي** (لا OCR، لا تحويل PDF→بنية Unit/Lesson/Concept). المحتوى الكامل الوحيد المُدقَّق يدويًا اليوم: كتاب العلوم للصف السابع (`science-g07.json`، مُثبَت بالكامل عبر `content-package` وتحقق ذهاب-وعودة موثَّق). **بناء Content Factory (استخراج آلي) مشروع مستقل بحجمه الحقيقي، ليس امتدادًا لهذا التدقيق.**

---

## 2. أخطاء واجهة إنتاجية مؤكَّدة تمس ثقة المستخدم مباشرة

هذه الفئة أُضيفت بناءً على طلب صريح: **لا افتراض اكتمال، وتحقق فعلي من كل زر/مودال/تسمية**. النتائج أدناه من قراءة مباشرة للكود، لا استنتاج.

### 2.1 — تسريب معرّفات خام (UUID) في واجهة المعلّم — ✅ مؤكَّد، ثغرة حقيقية

**الدليل الدقيق للسلسلة الكاملة:**

1. `identity.repository.ts:29,42,56`: `RoleGrant.schoolId` يُقرأ **كما هو من Prisma** (UUID خام على عمود `schools.id`، لا `schools.key`):
   ```ts
   roles: { select: { role: true, schoolId: true } },
   roles: row.roles.map((r) => ({ role: r.role as RoleName, schoolId: r.schoolId })),
   ```
2. هذا الـUUID يدخل مباشرة إلى `AccessTokenClaims.roles[].schoolId` (`login.use-case.ts`)، ثم إلى `session.schoolIds` في الواجهة (`web/src/shared/auth/session.tsx:229-235`) **بلا أي تحويل أو تحليل لاسم مدرسة موازٍ**.
3. ثلاث صفحات معلّم تعرض هذا الخام مباشرة في القائمة المنسدلة (`<option>`) **كنص مرئي للمستخدم**:
   ```tsx
   // web/src/pages/teacher/assignments.tsx:189
   {schoolIds.map((id) => (<option key={id} value={id}>{id}</option>))}
   // web/src/pages/teacher/interventions.tsx:65
   {schoolIds.map((id) => (<option key={id} value={id}>{id}</option>))}
   // web/src/pages/teacher/results.tsx:54
   {schoolIds.map((id) => <option key={id} value={id}>{id}</option>)}
   ```
   **معلّم بمدرستين أو أكثر يرى فعليًا نصوصًا مثل `a1b2c3d4-...` بدل اسم المدرسة** عند اختيار النطاق في ثلاث شاشات مختلفة.
4. كذلك `pages/admin/enrollments.tsx:127` يعرض `row.learnerKey` (مفتاح عمل قابل للقراءة، وليس UUID خام — هذا مقبول ومتّسق مع بقية الواجهة، **ليس عيبًا**، ذُكر هنا للتمييز).

**السبب الجذري:** لا يوجد استعلام في مسار تسجيل الدخول/الجلسة يُعيد اسم المدرسة المقابل لكل `schoolId` في أدوار المستخدم — الجلسة تحمل معرّفات فقط.

**الإصلاح المطلوب:**
- إضافة `schoolName` (وربما `schoolKey`) إلى كل عنصر في `roles[]` عند بناء الجلسة (`toAuthenticatedUser` أو استجابة `/auth/me`)، بضم بسيط على `schools` عند القراءة — **لا Schema Change**، تعديل استعلام فقط.
- تحديث `session.tsx` ليعيد `schools: readonly {key: string; id: string; name: string}[]` بدل `schoolIds: string[]` الخام.
- تحديث الشاشات الثلاث لعرض `school.name` بدل `id`.

**بوابة القبول:** اختبار مكوّن يتحقق أن القائمة المنسدلة لا تعرض أي نص مطابق لنمط UUID (`/^[0-9a-f-]{36}$/`)، لأي دور بمدرستين أو أكثر.

**فحص إضافي مطلوب قبل الإغلاق:** تدقيق شامل لكل مكان في `web/src` يعرض `.id` أو أي حقل ينتهي بـ`Id` (لا `Key`) مباشرة في JSX — الفحص الحالي وجد هذه الحالة الثلاثية فقط، لكنه **عيّنة لا شمولية**؛ يلزم `grep` منهجي في CI (قاعدة معمارية جديدة مقترحة، انظر §7).

---

### 2.2 — تكرار اسم الكتاب في العرض ("كتاب الرياضيات الصف السابع الفصل الأول الصف السابع الفصل الأول") — ✅ السبب الجذري محدَّد بدقة

**التشخيص الدقيق بعد الفحص:** لم أجد نصًا مخزَّنًا مباشرة يطابق المثال المذكور حرفيًا في بيانات البذرة الحالية (`title` المخزَّن دائمًا نظيف: "كتاب الرياضيات"، "كتاب العلوم" — بلا صف أو فصل مُضمَّن). **لكن السبب البنيوي للتكرار الذي يصفه المستخدم موجود وقابل للحدوث فعليًا**، في نمط متكرر عبر **ثمانية مواضع مستقلة** في الواجهة:

```tsx
// النمط المتكرر حرفيًا في 8 ملفات مختلفة:
{book.title} · {book.subjectName} · {book.gradeName} · {book.termName}
```

**المشكلة:** `book.title` هو نص حر (free text) يُدخله المسؤول عند إنشاء الكتاب عبر `TextbookCreatePanel` — الحقل `title` في النموذج **لا قيد عليه يمنع تضمين اسم الصف/الفصل يدويًا**، بينما `defaultTitle` (الاقتراح الافتراضي المعروض كـ`placeholder`) يُبنى فقط من اسم المادة (`textbookTitleForSubject` في كل من `textbook-create-panel.tsx:208` و`textbook-administration.service.ts:317` — **نفس الدالة مكرّرة حرفيًا في مكانين**، انظر أدناه). **إن كتب المسؤول عنوانًا يدويًا يتضمن "الصف السابع الفصل الأول" (وهذا سيناريو واقعي جدًا لأن الحقل بلا توجيه أو تحذير)، فكل واجهة من الثمانية أعلاه ستعرض هذا النص المُدخَل يدويًا متبوعًا بـ`gradeName`/`termName` المُشتقّين آليًا من نفس البيانات — وينتج التكرار الحرفي الذي وصفه المستخدم.**

**دليل إضافي على هشاشة الحل الحالي:** الدالة `textbookTitleForSubject` نفسها **مكرّرة حرفيًا كنسخة طبق الأصل في ملفين مختلفين** (`web/src/education/admin/textbook-create-panel.tsx:208-213` و`src/contexts/content/application/textbook-administration.service.ts:317-322`) — انتهاك مباشر لمبدأ "لا تكرار منطق أعمال في أكثر من خدمة" (قسم "قواعد التنفيذ")، ومصدر خطر إضافي: أي تعديل مستقبلي على قاعدة التسمية سيُنسى في أحد الموضعين.

**الإصلاح المطلوب (لا Schema Change):**
1. **توحيد `textbookTitleForSubject` في مكان واحد** يُستورَد من الطرفين (نقلها إلى الخلفية فقط، وكشفها كقيمة `defaultTitle` عبر استجابة API بدل حسابها مرتين في الواجهة والخلفية بمنطق منفصل).
2. **منع تضمين اسم صف/فصل داخل `title` عند الإنشاء**، بالتحقق (validation) في `authoring.service.ts`/`textbook-administration.service.ts`: رفض عنوان يحتوي نص مطابق لاسم أي `Grade.name` أو `Term.name` موجود في النظام (رسالة توضيحية: "الصف والفصل يُعرضان تلقائيًا، لا تكررهما في العنوان").
3. **بديل أبسط وأكثر أمانًا (مفضَّل)**: فصل "عنوان الكتاب" (حقل وصفي حر، مثل "كتاب الرياضيات" أو حتى اسم مخصص) عن "التسمية المعروضة الكاملة" (composite label تُبنى دائمًا من `title + subjectName + gradeName + termName` بمسافة فاصلة موحّدة في **مكوّن عرض واحد مشترك** `TextbookLabel`)، بحيث لا تُكتب أي شاشة `{book.title} · {book.gradeName} · {book.termName}` يدويًا بعد الآن — استبدال الثمانية مواضع بمكوّن واحد يمنع الانحراف المستقبلي ويحل المشكلة جذريًا بغض النظر عمّا يكتبه المسؤول في `title`.

**بوابة القبول:** اختبار وحدة على الخلفية يرفض إنشاء كتاب بعنوان يحتوي حرفيًا اسم صف/فصل قائم؛ اختبار مكوّن على الواجهة يتحقق أن `TextbookLabel` لا يكرّر أي جزء نصي بين `title` والأجزاء المُشتقّة (`gradeName`, `termName`) حتى لو أُدخل عنوان يتضمنها فعليًا (دفاع مزدوج: منع عند الكتابة + تنظيف عند العرض).

---

### 2.3 — تسميات وأزرار أخرى تحتاج تحققًا فعليًا لا افتراضًا (بنود مفتوحة، لم تُحسم بعد)

هذه فئة **لم تُغلَق بدليل كافٍ بعد** — يجب تنفيذ الفحص التالي فعليًا (لا افتراض) ضمن مرحلة G-UI أدناه قبل أي إعلان جاهزية:

- **كل مودال قائم** (`ContentNodeCreateModal`, `QuestionLinkModal`, `ConfirmDialog`) يحتاج مصفوفة تحقق يدوية: نقطة الفتح، الصلاحيات، حالة التحميل/الفراغ، منع الإرسال المكرر، الإغلاق بعد النجاح فقط، الاحتفاظ بالمدخلات عند الفشل، Escape/focus trap. **تحقَّق فعليًا حتى الآن**: `ContentNodeCreateModal` **لا يعالج Escape** (بعكس `ConfirmDialog` الذي يعالجه) — تفاوت مؤكَّد بقراءة الكود، يجب توحيده عبر مكوّن `Modal` أساسي مشترك.
- **كل زر إجراء** (Publish/Archive/Approve/Reject/Waive/Cancel) يحتاج تتبعًا من الزر حتى الـendpoint والتحقق من معالجة 401/403/404/409/422/500 — البنية العامة لمعالجة الأخطاء موجودة ومركزية (`shared/api/errors.ts` يعيّن كل حالة HTTP بدقة)، **لكن لم يُتحقَّق من كل زر على حدة عبر تشغيل حي**.
- **لا توجد اختبارات E2E عبر متصفح حقيقي** في المستودع (فقط اختبارات وحدة/مكوّن بـvitest) — هذه أكبر فجوة تحقق متبقية، ويجب أن تُغلَق **قبل** إعلان أي جاهزية، لا بعدها.

---

## 3. مراجعة سلامة الـDomain (Domain Integrity)

هذا القسم يجيب: "هل كل قرار تعليمي يصدر من الخلفية لا من الواجهة؟" — تحقَّقتُ من هذا عبر قراءة قواعد `check-frontend-architecture.ts` المُفعَّلة فعليًا (تفشل البناء عند مخالفة، لا مجرد توصية):

| القاعدة الآلية | ماذا تمنع | الحالة |
|---|---|---|
| `FE8` | لا حساب تعليمي (BKT، IRT، إلخ) في الواجهة | ✅ يمر ضمن 13/13 |
| `FE9` | لا قرار تعليمي (mastery/completion/next-step) في الواجهة | ✅ يمر |
| `NS1` (خلفية) | `decideNextActivity` لا يقرأ التكليفات/الالتزامات | ✅ يمر ضمن 28/28 |
| `PUB1` | قراءات المتعلّم تمر عبر `published-content.ts` فقط (لا تسرّب مسودة) | ✅ يمر |
| `RW1/RW2` | لا إغلاق حلقة معالجة (remediation) بالإعلان — يجب دليل | ✅ يمر |
| `L1` | كل مسار يحل هوية المتعلّم عبر `learner-access.ts` فقط | ✅ يمر |

**الحكم:** فصل الـDomain عن العرض **مُطبَّق فعليًا وليس ادّعاءً** — القواعد أعلاه آلية وتفشل البناء، وقد جُرِّب كل منها بمخالفة مزروعة ثم إزالتها حسب توثيق `CAPABILITY-LEDGER.md` (لم أُعِد تجربة الزرع بنفسي، لكن نجاح `verify` الحالي يثبت أنها فعّالة الآن).

**النطاقات العشرة المطلوب مراجعتها في الطلب — الحالة الفعلية المُتحقَّقة:**

| النطاق | الحالة | الدليل |
|---|---|---|
| Identity/School/Enrollment | 🟡 سليم منطقيًا، **قيد DB ناقص** | §P0.2, P0.3 |
| Academic Year/Term/Grade/Subject | ✅ نموذج بيانات مستقر، بلا تعقيد زائد (لا Curriculum Edition) | `schema.prisma`, 45 نموذج |
| Textbook→Unit→Lesson→Concept | ✅ الهرم كامل، دورة نشر موثّقة (`publication.ts`) | `CONTENT-LIFECYCLE-GATE.md` |
| Question Bank | ✅ تأليف مكتمل، تجميد بعد أول إجابة، ربط مفهوم إلزامي | `question-authoring.ts` |
| Assessment/Assignment | ✅ CAT كامل، `evaluateCompletion` مشتق من الدليل لا مُصرَّح به | `NS1`, `M2` |
| Learning Path | ✅ `JourneyService.path()` مع `AbsentValue` (لا صفر كاذب) | Rev 31 موثَّق |
| Mastery/Remediation/Recommendations | ✅ حلقة مغلقة بدليل (`RemediationEpisode`)؛ 🟡 التوصيات تُشتق حية لا تُخزَّن | `REMEDIATION-GATE.md` |
| Flashcards | ✅ بلا مُجدوِل ثانٍ (قرار مقصود) | §5 |
| Parent/Teacher/Student boundaries | 🟡 حدود موجودة منطقيًا، **نطاق المعلّم غير مؤسسي بالكامل** | §4 |

---

## 4. نطاق المعلّم (Teacher Scope) — تصميم Domain-First قبل أي Schema Change

**الحالة الفعلية المُتحقَّق منها:** `teacher-home.tsx` (تعليق افتتاحي صريح في الكود): *"Edu7 has no class or section model by decision: a class is a query over current enrollments... this roster is school-and-grade scoped rather than teacher-and-subject scoped, because no teaching-assignment model exists yet. Every teacher at a school sees the same grade roster."*

`educator_subject_specialties` **موجود في المخطط ومقروء** (`identity.repository.ts:758,1002`) لكن **غير مُستهلَك في أي منطق تحديد نطاق فعلي** — بحث مباشر في `contexts/analytics` و`contexts/instruction` عن `subjectSpecialt` أعاد **صفر نتيجة**. الجدول يربط (معلّم ↔ مادة) فقط، **بلا بُعد صف/فصل/شعبة**.

**القرار (متوافق مع رفض "Class" التقليدي الموثَّق):**

**لا نبني `Class`/`Section`.** نبني **`TeachingAssignment`** كنموذج استعلام إضافي فوق الأدوار والتسجيلات القائمة، **بأقل Schema Change ممكن**، وفقط بعد إثبات أن Pilot فعليًا يحتوي أكثر من معلّم لنفس (مدرسة، صف، مادة) — إن لم يوجد هذا التعارض فعليًا في أول Pilot، **لا حاجة للبناء الآن** (اليقين مطلوب من العميل قبل الشروع، لا افتراض).

```prisma
// اقتراح الحد الأدنى — يُبنى فوق EducatorSubjectSpecialty الموجود، لا يستبدله:
model TeachingAssignment {
  id            String @id @default(uuid()) @db.Uuid
  key           String @unique
  educatorId    String @db.Uuid
  subjectId     String @db.Uuid
  gradeId       String @db.Uuid
  schoolId      String @db.Uuid
  academicYearId String @db.Uuid
  termId        String @db.Uuid
  // بلا isCurrent منفصل — الفصل نفسه هو حدود الصلاحية الزمنية

  @@unique([educatorId, subjectId, gradeId, schoolId, academicYearId, termId])
}
```
هذا **ليس** "Class" (لا اسم شعبة، لا سعة مقاعد، لا معلّم مسؤول ثابت) — هو **حقيقة تكليف** يُستهلك في استعلامات `roster`/`analytics`/`assignments` لتضييق النطاق من (مدرسة+صف) إلى (مدرسة+صف+مادة+معلّم). **يُبنى فقط عند تأكيد الحاجة**.

---

## 5. دورة حياة المحتوى (Content Lifecycle)

**التحقق من دورة `Draft → Review → Published/Active → Archived`:** موثَّقة ومُطبَّقة عبر `publication.ts` وقاعدتين آليتين مُختبرتين: قفل الكتابة على المحتوى المنشور (يسمح فقط بتعديلات عرضية)، وفصل التقديم عن الاعتماد (المؤلّف لا يعتمد عمله). **34 فحصًا حيًّا عبر HTTP موثَّقة** (لم أُعِد تشغيلها بنفسي، لكن نجاح `verify` الحالي متسق معها).

**ما يجب توحيده في Canonical Services (وُجد تكرار فعلي واحد مؤكَّد):** `textbookTitleForSubject` مكرّرة حرفيًا في ملفين (§2.2) — **مثال ملموس على بالضبط الخطر الذي يطلبه هذا القسم**، ويجب إصلاحه أولًا كحالة اختبار لعملية التوحيد قبل البحث عن تكرارات أخرى محتملة.

**منع مطلوب تحقيقه (لم يُتحقَّق شموليًا بعد، عيّنة فقط):**
- نشر محتوى غير صالح → موجود أصلًا عبر `structural-validation.ts` (اختبارات موجودة).
- أسئلة بلا Lesson/Concept صالح → مفروض عند التأليف (`question-authoring.ts`، ربط مفهوم رئيس إلزامي).
- duplicate content غير مقصود → **غير مغطى بفحص عام**؛ التكرار الوحيد المؤكَّد اليوم هو تكرار **نصي في العرض** (§2.2) لا تكرار **بيانات** في القاعدة.

---

## 6. طبقة AI Content Engine — تصميم جديد كامل

**المبدأ الحاكم (يُطبَّق حرفيًا، لا استثناء):** AI **مساعد إنشاء ومراجعة محتوى**، لا مصدر حقيقة ولا صاحب قرار نشر. كل مخرج AI يمر: `Generate → Validate → Preview → Human Review → Approve/Reject/Edit → Question Bank`. لا حفظ مباشر بدون موافقة بشرية صريحة.

### 6.1 البنية القائمة التي يُبنى عليها (لا تُعاد كتابتها)

الطبقة موجودة جزئيًا وسليمة التصميم فعلًا:

```ts
// src/contexts/tutoring/application/ports.ts — الـabstraction موجود أصلًا
export interface AiProvider {
  readonly id: string;
  isAvailable(): boolean;
  complete(request: CompletionRequest): Promise<CompletionResponse>;
}
export type TutoringTask =
  | 'EXPLAIN_CONCEPT' | 'ANSWER_QUESTION' | 'GENERATE_HINT'
  | 'GENERATE_QUESTIONS'   // ← موجود في النوع، لكن غير مُستهلَك بأي use-case فعليًا (بحث مباشر: صفر نتيجة)
  | 'GRADE_ESSAY' | 'SUMMARISE_PROGRESS';
```
- `GeminiProvider`, `OpenAiProvider`, `DeterministicProvider` (ثلاثتها موجودة، تُبنى في `container.ts` عبر `AI_PROVIDER_ORDER` قابل للتهيئة — **لا اعتماد صريح على مزوّد واحد، الـfailover موجود بنيويًا**).
- `AskTutorUseCase`: يطبّق فعليًا الترتيب الآمن `quota → retrieve → assess grounding → REFUSE أو استدعاء المزوّد → تحقق الاستشهادات → تسجيل`. **الرفض القسري (hard refusal) قاعدة نطاق نقية مختبرة** (`grounding.test.ts`)، بعتبة صلة دنيا `minTopRelevance: 0.35` — **هذا أقوى من "prompt etiquette"، هو قاعدة domain فعلية**.
- `AiInteractionLog` + `LogBackedAiQuota`: تسجيل كل تفاعل AI + حصة يومية لكل متعلّم، بلا جدول عدّاد منفصل (السجل هو الحقيقة).

**الفجوة الفعلية:** `GENERATE_QUESTIONS` موجود كنوع مهمة **لكن بلا use-case يستهلكه** — لا مسار HTTP، لا خدمة توليد أسئلة فعلية اليوم. هذا القسم يصمم إغلاق هذه الفجوة **بنفس الأنماط القائمة**، لا بأنماط جديدة.

### 6.2 التصميم — AI Content Service جديد داخل `contexts/content` (مُعدَّل — **بلا نموذج بيانات جديد**، تصحيح مالك 2026-09-15)

**تصحيح صريح من المالك على التصميم الأصلي في هذا القسم:** لا يُبنى جدول `AiQuestionDraft` منفصل. **يُعاد استخدام نموذج `Question` القائم حرفيًا** — الحقل `Question.origin: QuestionOrigin` **يحتوي بالفعل على القيمة `'AI'`** ضمن الـenum القائم (`QUESTION_ORIGINS = ['TEXTBOOK', 'TEACHER', 'MINISTERIAL', 'AI', 'UNKNOWN']`، معرَّف في `question-authoring.ts:504`)، وقاعدة الدومين **موجودة ومختبرة من قبل هذا التغيير أصلًا**: أي سؤال بـ`origin: 'AI'` يُجبَر إلى `status: 'DRAFT'` عند الإنشاء (مختبر حرفيًا في `tests/unit/item-bank.service.test.ts:452-461`، بعنوان *"lands an AI-drafted question as DRAFT"*، وتعليق الكود يقول صراحة: *"An AI cannot be accountable for what a learner is assessed on"*). **التبسيط المطلوب**: عند إنشاء سؤال عبر خدمة توليد الذكاء الاصطناعي الجديدة، فقط نمرّر `origin: 'AI'` إلى `itemBankService.createQuestion()` **الموجودة فعلًا بلا أي تعديل عليها** — تسجيل "هذا السؤال أضافه AI" يتم بهذا الحقل الوحيد الموجود مسبقًا، لا بجدول مسودة منفصل ولا بحالة `AiDraftStatus` جديدة ولا بربط `publishedQuestionId`.

**لماذا هذا صحيح معماريًا لا مجرد اختصار:** `Question.status = DRAFT` **يعني بالضبط** ما كان `AiDraftStatus.PENDING_REVIEW` سيعنيه — سؤال غير منشور لا يصل لأي متعلّم حتى تمر عليه دورة `SUBMIT → APPROVE` نفسها (`publication.ts`، القسم §5). لا حاجة لتعريف "جاهزية للمراجعة" ثانية بجدول موازٍ بينما `PublicationState` القائم يؤدي نفس الدور تمامًا مع نفس الحراس (`requireApprover`, فصل submit/approve). بناء `AiQuestionDraft` كان سيُنتج **بالضبط الخطر الذي يحظره قسم "قواعد التنفيذ"**: تعريفين لـ"سؤال ينتظر المراجعة".

```
src/contexts/content/
  application/
    ai-question-generation.service.ts  ← جديد: يستدعي AiProvider ثم itemBankService.createQuestion({..., origin: 'AI'}) — لا مسار كتابة موازٍ
    ai-content-review.service.ts       ← جديد: مراجعة محتوى قائم، ينتج تقرير فقط (بلا تغيير، انظر §6.4)
    ports.ts                           ← إضافة AiContentProvider (يُعاد استخدام AiProvider الموجود، لا تكراره)
  domain/
    content-review-report.ts           ← جديد: بنية تقرير المراجعة فقط (Issue, Severity, SuggestedCorrection) — لا `question-draft.ts` بعد الآن
```

**بلا نموذج Prisma جديد لهذا الجزء بالكامل.** الحقل الوحيد الذي يُستهلَك هو `Question.origin` القائم. `promptVersion` (تتبّع نسخة القالب) — الحاجة إليه للتدقيق **لا تزال قائمة**، لكن دون جدول مخصص: يُسجَّل في `AiInteraction.chunkKeys`/سجل الحصة القائم بامتداد بسيط (حقل `promptVersion` نصي اختياري على `AiInteraction` نفسها، لا جدول جديد) — **قرار مؤجَّل لما بعد G3، لا يُنفَّذ في هذه الجولة**، لأن المطلوب الآن حصرًا هو التبسيط، لا إضافة تتبّع لم يُطلب بعد.

**تدفق التوليد (مُبسَّط، يعيد استخدام كل ما هو قائم بلا أي جدول جديد):**

```
POST /content/ai/questions/generate
  input: { lessonKey, conceptKey, count, type, difficulty?, language }
  ↓
AiQuestionGenerationService.generate()
  1. quota check (LogBackedAiQuota — نفس الموجود لـTutoring)
  2. retrieve grounding chunks لنفس conceptKey (PostgresContextRetriever — نفس المستخدم في Tutoring)
  3. assessGrounding — إن كانت الشواهد غير كافية: رفض قبل استدعاء أي مزوّد (نفس منطق grounding.ts)
  4. AiProvider.complete({task: 'GENERATE_QUESTIONS', jsonSchemaName: 'question-draft-v1', ...})
  5. لكل سؤال مُقترَح: استدعاء itemBankService.createQuestion(ctx, { ...input, origin: 'AI', lessonKey, concepts }) — **نفس مسار الكتابة الوحيد** الذي يستخدمه سؤال بشري، بلا تمييز
     → الخدمة تُجبر origin='AI' إلى status='DRAFT' تلقائيًا (سلوك موجود فعلًا، لا تعديل مطلوب)
  6. تسجيل AiInteractionLog (نفس الموجود، task: 'GENERATE_QUESTIONS')
  ↓
GET /content/questions?origin=AI&status=DRAFT&lessonKey=...   ← نفس نقطة نهاية بنك الأسئلة القائمة (item-bank.routes.ts)، بفلتر origin/status الموجودَين أصلًا في الـquery schema — لا نقطة نهاية جديدة لسرد "المسودات"
  ↓
POST /questions/:questionKey/transitions { action: 'SUBMIT' }   ← نفس نقطة النهاية القائمة لأي سؤال
POST /questions/:questionKey/transitions { action: 'APPROVE' }  ← نفس نقطة النهاية القائمة، AUTHORING_ROLES/APPROVAL_ROLES كما هي
```

**الفرق الوحيد الفعلي عن سؤال بشري:** قيمة حقل `origin`. كل شيء آخر — دورة النشر، الصلاحيات، التحقق البنيوي، شاشة بنك الأسئلة، فلترة "أصل السؤال" (موجودة فعلًا في `question-bank.tsx:124` عبر `SelectFilter` على `QUESTION_ORIGINS`، وشارة "ذكاء اصطناعي" في i18n موجودة فعلًا `question.origin.AI`) — **كل هذا مبني ومختبر مسبقًا ولا يحتاج أي تعديل**. العمل الفعلي الجديد يقتصر على: (أ) خدمة استدعاء AI لتوليد نص السؤال، (ب) نقطة نهاية `POST /content/ai/questions/generate` تربطها بـ`createQuestion` القائمة.

**واجهة المراجعة:** **لا حاجة لشاشة "مراجعة مسودات" منفصلة** — شاشة بنك الأسئلة الحالية (`web/src/pages/author/question-bank.tsx`) تعرض بالفعل عمود `origin` وأزرار `SUBMIT/APPROVE/REJECT` (`actionsFor(row.status)`، مُختبرة). **الإضافة الوحيدة المطلوبة في الواجهة**: فلتر مختصر "AI فقط" (يمرّر `origin=AI` لنفس الاستعلام القائم) لتسهيل إيجاد أسئلة AI بانتظار المراجعة وسط بقية البنك — لا مكوّن جديد، توسعة صف فلاتر موجود.

### 6.3 AI Distractor & Misconception Engine (مُعدَّل — بلا جدول `AiMisconceptionSuggestion` جديد أيضًا)

**نفس منطق التبسيط في §6.2 يُطبَّق هنا:** لا يُبنى جدول `AiMisconceptionSuggestion` منفصل. خلافًا لـ`Question`، نموذج `Misconception` **لا يملك** أصلًا حقل `status`/`origin` يمكن الاستفادة منه لتمييز "مقترَح من AI بانتظار المراجعة" (تحقَّق من `schema.prisma`: `Misconception` بلا أي حقل حالة نشر) — لذا فإن إعادة استخدام نفس حيلة §6.2 (كتابة مباشرة + وسم origin) **غير متاحة تقنيًا هنا** دون تعديل الـschema، وهذا تعديل لم يطلبه المالك.

**الحل الأبسط دون جدول جديد:** اقتراحات AI لمشتّتات/مفاهيم خاطئة **لا تُكتب في `Misconception` مباشرة إطلاقًا** — تُطرح فقط كعنصر ضمن نفس بنية `ContentReviewReport` الموجودة في §6.4 (نوع `issue.kind = 'WEAK_DISTRACTOR' | 'MISSING_CONCEPT'`، مع `suggestedCorrection` يحمل نص الاقتراح الكامل). إنسان مؤلّف يقرأ التقرير، وإذا اقتنع، **يستدعي `authoring.service.createMisconception()` القائمة فعلًا يدويًا بنفس الاسم/الوصف المقترَح** — تمامًا كما لو كان قد كتبها هو ابتداءً. هذا يزيل الحاجة لجدول ومسار حالة كاملَين لصالح إعادة استخدام قناة "تقرير + فعل بشري" المبنية أصلًا في §6.4، فتصبح خدمتا §6.3 و§6.4 **خدمة واحدة عمليًا لا خدمتين**: مولّد أسئلة (§6.2) يكتب مباشرة (origin=AI)، ومراجع/مقترح محتوى (§6.3+6.4 مدمجتان) ينتج تقارير فقط ولا يكتب أبدًا.

### 6.4 AI Content Reviewer

خدمة قراءة فقط (`AiContentReviewService`)، **لا صلاحية تعديل**: تأخذ نطاقًا (كتاب/وحدة/درس/سؤال)، تسترجع المحتوى + مقاطعه، تستدعي `AiProvider` بمهمة جديدة `REVIEW_CONTENT` (تُضاف إلى `TutoringTask` القائم)، وتنتج:

```ts
interface ContentReviewReport {
  readonly scope: { textbookKey?: string; lessonKey?: string; questionKey?: string };
  readonly issues: readonly {
    readonly kind: 'FACTUAL' | 'LANGUAGE' | 'DIFFICULTY_MISMATCH' | 'UNCLEAR_OBJECTIVE'
      | 'WEAK_DISTRACTOR' | 'CONCEPT_LINK' | 'DUPLICATE' | 'MISSING_CONCEPT' | 'OUT_OF_SCOPE';
    readonly severity: 'LOW' | 'MEDIUM' | 'HIGH';
    readonly description: string;
    readonly suggestedCorrection: string | null;
    readonly targetKey: string;  // السؤال/الدرس/المفهوم المحدد المتأثر
  }[];
  readonly generatedAt: string;
  readonly providerId: string;
}
```
يُخزَّن التقرير (`ContentReviewReport` جدول جديد بسيط، `status: OPEN/ACKNOWLEDGED/DISMISSED`) **ولا يُعدَّل أي محتوى منشور تلقائيًا أبدًا** — التقرير يظهر في "قائمة الانتباه" الإدارية (Attention Queue) ليتخذ إنسان القرار.

### 6.5 AI Governance — طبقة واحدة، لا تكرار لكل ميزة

**يُبنى مرة واحدة، تستهلكه كل الخدمات الثلاث أعلاه (Question Generator, Distractor Engine, Content Reviewer):**

| المتطلب | الحل | الحالة القائمة التي يُبنى عليها |
|---|---|---|
| Provider abstraction | `AiProvider` interface | ✅ موجود، يُعاد استخدامه حرفيًا |
| API key من env/secrets | `env.GEMINI_API_KEY`/`OPENAI_API_KEY` | ✅ موجود |
| Model configuration | `GEMINI_MODEL`/`OPENAI_MODEL` env vars | ✅ موجود |
| **Prompt/version tracking** | حقل `promptVersion` نصي اختياري على `AiInteraction` القائمة (§6.2) — بلا جدول مسودة جديد | 🔴 جديد، مؤجَّل لما بعد G3 (انظر §6.2) |
| Token/cost limits | `AI_DAILY_QUOTA` + `LogBackedAiQuota` | ✅ موجود، يُوسَّع بغرض (purpose) منفصل عن حصة Tutoring كي لا يستهلك مسؤول التأليف حصة تعلّم الطالب |
| Timeout/retry | 🔴 **غير موجود اليوم في أي Provider** — `gemini.provider.ts` يذكر "retry" في التعليق فقط، بلا تنفيذ فعلي | يُضاف: `AbortController` بمهلة صريحة + إعادة محاولة واحدة عند فشل شبكي (لا عند رفض منطقي) |
| Rate limiting | 🔴 غير موجود على مستوى Provider (فقط حصة يومية لكل متعلّم، لا لكل مسؤول تأليف) | يُضاف حد لكل مستخدم مؤلّف بنفس نمط `LogBackedAiQuota` |
| Structured AI logs | `AiInteractionLog` | ✅ موجود، يُوسَّع بحقل `purpose: 'TUTORING' \| 'CONTENT_GENERATION' \| 'CONTENT_REVIEW'` |
| Failure/fallback | `AI_PROVIDER_ORDER` + `DeterministicProvider` | ✅ موجود بنيويًا |
| AI evaluation tests | 🔴 غير موجود | يُضاف: مزوّد وهمي (`FakeAiProvider`) لاختبارات CI، **بلا أي استدعاء شبكي حقيقي في الاختبارات**، يغطي: توليد ناجح، رفض لعدم كفاية الشواهد، فشل مزوّد أول ونجاح fallback |

**قاعدة أمان صريحة يجب تفعيلها كقاعدة معمارية آلية جديدة (تُضاف إلى `check-architecture.ts`):** *"لا استيراد لـ`@google/genai` أو أي SDK مزوّد AI خارج `src/infrastructure/ai/`"* — يمنع تسرّب تفاصيل مزوّد إلى الـDomain، بنفس فلسفة القواعد القائمة (`I1`, `FE7`).

### 6.6 AI Security — تحقق من كل بند صراحة

| المطلب | الحكم | التفصيل |
|---|---|---|
| لا إرسال أسرار للـAI | ✅ يُحافَظ عليه بالتصميم | `renderContext` يبني السياق من `GroundingChunk[]` المسترجعة من `contentChunk` فقط — لا مسار يمرّر متغيرات بيئة أو بيانات مستخدم خام للـprompt |
| لا يمكن للمستخدم إجبار تجاوز الصلاحيات عبر الـprompt | 🔴 يحتاج تحقيقًا فعليًا | التوليد يُقيَّد بـ`AUTHORING_ROLES` **قبل** الوصول للخدمة (نفس حارس `item-bank.routes.ts` القائم)، لكن **لا يوجد اختبار "AI red-team" فعلي اليوم يحاول حقن تعليمات في `userPrompt` لتغيير سلوك النظام** — يُضاف كاختبار AI evaluation إلزامي (§6.5) |
| AI ليس مصدر الحقيقة | ✅ مُطبَّق بالتصميم (مُبسَّط 2026-09-15) | كتابة الأسئلة تمر عبر `itemBankService.createQuestion()` القائمة مباشرة بـ`origin: 'AI'` (لا جدول مسودة وسيط)، والتي **تُجبر** `status: 'DRAFT'` لكل سؤال بهذا الأصل (مُختبر، `item-bank.service.test.ts:452`) — لا مسار كتابة آخر. اقتراحات المفاهيم الخاطئة لا تُكتب في `Misconception` إطلاقًا؛ تظهر كتقرير فقط (§6.3) بانتظار فعل بشري صريح عبر `authoring.service.createMisconception()` القائمة |
| المحتوى المرسَل محدود بالنطاق المصرَّح | ✅ بالتصميم | `retriever.retrieve({conceptKey, lessonKey, textbookKey})` يُقيَّد بنفس نطاق طلب المستخدم، لا استرجاع عام |
| صلاحيات الإضافة/النشر تبقى داخل طبقة تفويض Edu7 | ✅ بالتصميم | الكتابة تمر عبر `itemBankService.createQuestion()` بنفس حراس الأدوار القائمة (`AUTHORING_ROLES`)، ثم النشر عبر `POST /questions/:questionKey/transitions` القائمة (`requireApprover`) — AI لا يملك أي طريق مختصر لتجاوز أي منهما |
| AI output غير موثوق حتى المراجعة | ✅ مُطبَّق بالكامل عبر `status: 'DRAFT'` الإلزامي على كل سؤال بـ`origin: 'AI'`، ثم دورة `SUBMIT → APPROVE` القائمة نفسها لأي سؤال بشري — **لا حالة مراجعة موازية جديدة** |

---

## 7. Observability & Operations — الحد الأدنى المطلوب فعليًا

**الحالة المؤكَّدة اليوم:** لا يوجد أي بنية تسجيل مهيكل (structured logging) أو مقاييس (metrics) في `src/infrastructure/` — بحث مباشر (`find infrastructure -iname "*log*" -o -iname "*metric*"`) لم يُعد شيئًا متعلقًا. الموجود فعليًا فقط: `AiInteractionLog` (قاعدة بيانات، AI فقط) و`audit_entries` (أفعال المستخدم). **لا notification infrastructure إطلاقًا** (`find . -iname "*notification*"` → صفر نتيجة).

**الحد الأدنى المطلوب للإنتاج (بلا تضخيم):**
- Request correlation ID: **موجود جزئيًا فعلًا** (`requestId` في كل استجابة عبر `requestContext()` middleware) — يحتاج فقط تمريره إلى كل سطر log مستقبلي، لا بناء من الصفر.
- Structured logging: استبدال أي `console.log` متفرق (إن وُجد) بمكتبة واحدة (مثل pino) تُخرج JSON مع `requestId`، `NODE_ENV`، `LOG_LEVEL` (الموجود فعلًا في `env.ts`).
- Error tracking hook: نقطة تكامل واحدة (Sentry أو مكافئ) على `app.ts` error handler القائم — لا إعادة كتابة معالجة الأخطاء.
- Metrics أساسية: عدد الطلبات/زمن الاستجابة/معدل 5xx لكل route، AI usage/cost من `AiInteractionLog` نفسه (استعلام لا بنية جديدة).
- **لا نضيف Notification platform كاملة الآن** — القسم القادم يوضح لماذا.

---

## 8. Notifications / Recommendations — لا تُبنى قبل تأكيد الحاجة

**الحالة المؤكَّدة:** لا توجد أي بنية إشعارات. التوصيات (`Recommendations`) تُشتق حية عند القراءة (`decideNextActivity`)، **بقرار معماري موثَّق وصحيح** (`CAPABILITY-LEDGER.md` بند 10) — لا تُخزَّن، لا حالة `dismissed/snoozed`.

**القرار:** **لا نبني منصة إشعارات كاملة الآن.** إن ظهرت حاجة فعلية (مثلًا: تنبيه معلّم عند تراكم عمل متأخر — وهذا **موجود جزئيًا فعلًا** عبر `DueWorkService.alerts`)، **نفصل بوضوح** ثلاث طبقات مستقلة كما يشترط الطلب:
1. **القرار التعليمي** (يبقى في `Learning`/`Instruction`، لا علاقة له بالإشعار).
2. **التوصية** (طبقة جديدة محتملة لاحقًا في `engagement`، منفصلة عن القرار).
3. **آلية التوصيل** (in-app أولاً، push لاحقًا) — **بنية تقنية بحتة، لا منطق تعليمي فيها إطلاقًا**.

لا تُبنى أي من هذه الثلاث الآن بلا طلب Pilot فعلي يثبت الحاجة.

---

## 9. ما يُمنع إعادة بناؤه — قائمة نهائية مُثبَّتة بأدلة الكود

كل بند هنا **قرار معماري موثَّق ومُفعَّل بقاعدة آلية تفشل البناء أو بتوثيق `*-GATE.md` صريح** في هذا المستودع تحديدًا — ليس تفضيلًا، بل رفض نهائي محقَّق:

| المفهوم المرفوض | الدليل المؤكِّد | الحالة |
|---|---|---|
| **`CurriculumEdition` / `CurriculumVersion`** | `README.md`: *"the curriculum root is a Textbook — 'curriculum' is legacy language"*؛ قاعدة آلية `V1` تفشل البناء عند أي مفهوم "Curriculum" مستقل. الطبعة جزء من `Textbook.key` نفسه (`EDU-MATH-G07-T1-ED2026`)، لا جدول منفصل | ⛔ رفض نهائي مُفعَّل بقاعدة، **لم يُقترَح في هذه الخطة** |
| **`Class`/`Section` تقليدية** | تعليق `teacher-home.tsx`: *"Edu7 has no class or section model by decision: a class is a query over current enrollments"* | ⛔ رفض نهائي — البديل `TeachingAssignment` (§4) استعلام إضافي لا كيان "صف" |
| **`SchoolAcademicYear` ككيان منفصل** | لا دليل على وجود حاجة؛ `Enrollment` يربط مباشرة بـ`schoolId`+`academicYearId` بلا وسيط | ⛔ لم يُقترَح، ولا سبب schema/domain لإضافته |
| **مُجدوِل ثانٍ للـFlashcards (SM-2)** | `CAPABILITY-LEDGER.md`: *"الجدول لا يحمل حالة جدولة (SM-2 كان سيكرّر mastery/domain/retention.ts)"* | ⛔ رفض نهائي — `retention.ts` القائم يبقى المالك الوحيد للجدولة |
| **`masteryAchieved` داخل Assignment** | `REMEDIATION-GATE.md §0`: النظام القديم كان يسمح بـ`PATCH {masteryAchieved}` فيصبح الإنجاز ادّعاءً لا قياسًا؛ قاعدة آلية `NS1` تفشل البناء إن قرأ `next-step` من التكليفات | ⛔ رفض نهائي — `evaluateCompletion` المشتق من الدليل يبقى المصدر الوحيد |
| **جدول `Permission` دقيق لكل دور/فعل** | `PERMISSION-TABLE-ANALYSIS.md`: تأجيل مشروط بمحفّز موثَّق (أول حاجة فعلية لدقة أدنى من مستوى الدور)، لا رفض نهائي، ولا بناء افتراضي | 🟡 مؤجَّل بمحفّز — **لا يُبنى إلا عند تحقق المحفّز فعليًا**، مقاسًا لا مفترضًا |
| **AI كمصدر حقيقة أو صاحب قرار نشر** | §6 و§9 من هذا الملف نفسه | ⛔ رفض تصميمي في هذه الخطة ذاتها — كل مخرج AI يمر مراجعة بشرية إلزامية |

**قاعدة عامة للتنفيذ:** أي مهمة مستقبلية تقترح نموذج بيانات جديدًا يجب أن تُطابَق أولًا ضد هذا الجدول **قبل** أي تنفيذ — لا إعادة تقييم من الصفر لكل مهمة.

---

## 10. الخطة النهائية — بوابات قابلة للتنفيذ (Gates)

الترتيب إلزامي؛ لا انتقال لبوابة قبل نجاح سابقتها فعليًا (اختبارات + تحقق حي، لا افتراض).

### G0 — CI حقيقي (P0.4) — ✅ منجَزة (2026-09-15)
`npm ci → typecheck → arch:check → test → build` لكل من الخلفية والواجهة، في `.github/workflows/ci.yml`، يعمل على كل PR. **بلا هذا، كل ما يلي غير قابل للثقة بمرور الوقت.**

### G1 — سلامة البيانات والأمان (P0.1, P0.2, P0.3, §2.1) — ✅ منجَزة (2026-09-15)
1. `CORS_ORIGINS` يفشل الإقلاع في production إن كان `*`. ✅
2. فهرس جزئي حقيقي `enrollments_one_current_per_learner` في migration جديدة + اختبار integration ضد PGlite حقيقي. ✅
3. قرار موثَّق (لا تنفيذ أعمى) حول فصل هوية Enrollment التاريخية عن "الحالي" — **فقط بعد تأكيد حاجة نقل مدرسة فعلية من العميل**. (مؤجَّل بالتصميم — لا حاجة مؤكَّدة من العميل بعد؛ ليس عيبًا تنفيذيًا)
4. إصلاح تسريب `schoolId` الخام في ثلاث شاشات معلّم (§2.1) — إضافة `schoolName` لعنصر الدور في الجلسة. ✅
5. اختبار IDOR شامل: معلّم مدرسة A لا يقرأ بيانات مدرسة B عبر أي مسار (`roster`, `analytics`, `assignments`) — **يُبنى كاختبار integration جديد، لا يوجد اليوم**. ✅ (`tests/unit/idor-teacher-school-isolation.test.ts`)

### G2 — تنظيف تسمية المحتوى (§2.2، §5) — ✅ منجَزة (2026-09-15)
1. توحيد `textbookTitleForSubject` في مكان واحد (يُحذف من الواجهة، يُستهلك من الخلفية عبر API). ✅
2. رفض عنوان كتاب يحتوي اسم صف/فصل قائم عند الإنشاء (validation جديد في `authoring.service.ts`). ✅
3. مكوّن `TextbookLabel` مشترك يستبدل الأنماط الثمانية المكرّرة `{title} · {subjectName} · {gradeName} · {termName}`. ✅
4. تدقيق منهجي (لا عيّنة) لكل عرض `.id`/`*Id` خام في `web/src` + قاعدة معمارية جديدة تمنعه مستقبلًا (`FE14`: "لا حقل ينتهي بـId قد يكون UUID يُعرض كنص مرئي بلا تحويل اسم"). ✅

### G2.5 — توصيل واجهة إدارة المحتوى الناقصة (§14.1، §15) — **جديدة هذه الجولة**
ستّة بنود توصيل واجهة لخلفية مكتملة ومُختبرة (دورة نشر الكتاب، مفاهيم خاطئة، متطلبات سابقة، تعديل/إعادة ترتيب العقد، تعديل/تقاعد مورد، تصدير كتاب) — تفصيلها الكامل في §15. **بلا Schema Change، بلا منطق أعمال جديد** — أولوية عالية لأنها تسدّ فجوة استخدام فعلية اليوم (لا مسار إداري لنشر كتاب عبر الواجهة إطلاقًا).

### G3 — طبقة AI Content Engine (§6)
بالترتيب: Governance أولًا (§6.5، بلا هذا لا شيء آمن) → Question Generator (§6.2) → Distractor/Misconception Engine (§6.3، يعيد استخدام §6.2) → Content Reviewer (§6.4، قراءة فقط، أخطر جزء لو عُكس الترتيب). كل خطوة بمزوّد وهمي (`FakeAiProvider`) في الاختبارات، **بلا استدعاء شبكي حقيقي في CI**.

### G4 — نطاق المعلّم (§4)
**مشروط**: لا يبدأ إلا بعد تأكيد صريح من العميل أن Pilot يحتوي فعليًا أكثر من معلّم لنفس (مدرسة+صف+مادة). إن لم يتأكد، تُؤجَّل البوابة كاملة.

### G5 — Observability الأساسي (§7)
Correlation ID (تمديد الموجود) → structured logging → error tracking hook → مقاييس أساسية. لا يُبنى قبل G0–G3 لأن قيمته تقل بلا CI يحميه ولا ميزات AI تحتاج رصدًا.

### G6 — تدقيق واجهة شامل (§2.3)
تشغيل خادم حي + تصفح كل رحلة (طالب/معلّم/ولي أمر/إدارة) يدويًا، مع تسجيل كل مودال/زر بمصفوفة الفحص الكاملة (§2.3). هذه البوابة **لا تُغلَق بقراءة كود فقط** — تحتاج تشغيلًا فعليًا.

### G7 — Android/PWA حقيقي (P0.5, P0.6)
فقط بعد G0–G6. Responsive Web مكتمل → PWA (أيقونات كاملة، manifest صحيح) → Android TWA → Capacitor عند حاجة native مؤكَّدة فقط.

### G8 — Content Factory (P0.7)
مشروع مستقل بحجمه، يبدأ فقط بعد ثبات G0–G3 (لأن استخراج آلي بلا AI Governance ثابت خطر مضاعف).

---

## 11. بوابة اختبار إلزامية لكل بند أعلاه

لكل مهمة في G0–G8: Unit + Integration + (HTTP عند وجود route) + Authorization/scope + Regression، وللـAI تحديدًا: اختبارات بـ`FakeAiProvider` فقط (توليد ناجح، رفض لعدم كفاية شواهد، فشل مزوّد أول→نجاح fallback، محاولة حقن تعليمات في prompt). **ممنوع استدعاء أي AI API حقيقي داخل CI** — `AI_PROVIDER_ORDER=deterministic` أو مزوّد وهمي مُسجَّل في بيئة الاختبار حصرًا.

---

## 12. تحديث التوثيق (بعد التنفيذ لا قبله)

- `CAPABILITY-LEDGER.md`: إضافة بند AI Content Engine بحالته الحقيقية بعد كل مرحلة من G3 (لا ✅ إلا بكود+اختبار+تحقق HTTP، بنفس منهجية الملف القائمة).
- تصحيح تعليق `router.tsx` القديم (يصف "المرحلة 1" التاريخية بينما 27+ صفحة مبنية فعليًا اليوم) — إصلاح توثيقي فوري منفصل عن أي G أعلاه.
- تعليم أي وثيقة `docs/*-GATE.md` سابقة بتاريخ "قرار نهائي، راجع §9 من هذا الملف قبل أي تعديل" لمنع إعادة فتح نقاش معماري محسوم.
- **إضافة من §13 أدناه:** تصحيح بند 13 ("Content management") في `CAPABILITY-LEDGER.md` — الحالة ✅ الحالية موثَّقة على أساس تحقق HTTP (34 فحصًا) لا على أساس إمكانية الوصول عبر واجهة الإدارة؛ يلزم تمييز الحالتين صراحة (انظر §14.4) لأن الفجوة اكتُشفت في هذه الجولة وهي فجوة **واجهة** لا فجوة **خلفية**.
- **تصحيح مالك 2026-09-15 (§6.2/§6.3 أعلاه):** حُذفت خطة `AiQuestionDraft`/`AiDraftStatus`/`AiMisconceptionSuggestion` (نماذج Prisma جديدة) من التصميم؛ استُبدلت بإعادة استخدام حرفية لـ`Question.origin = 'AI'` القائمة فعلًا (مختبرة في `item-bank.service.test.ts:452`) + دورة النشر `SUBMIT/APPROVE` القائمة (`publication.ts`, `/questions/:questionKey/transitions`). لا حاجة لتحديث `CAPABILITY-LEDGER.md` بهذا الخصوص لأن سطره 39 كان يصف هذا السلوك بالضبط مسبقًا ("الأسئلة المولَّدة بالذكاء الاصطناعي تبدأ DRAFT دائمًا") — التصحيح هنا كان في تصميم هذا الملف فقط، لا في الكود أو الـledger.

---

## 13. مراجعة وتوفيق (Review & Reconciliation) — هل أُنجز ما وُثِّق فعليًا؟

هذا القسم يجيب عن طلب صريح: التحقق من أن الفجوات المُوثَّقة أعلاه لم تتغيّر، وأن لا شيء أُعلن منجَزًا زورًا.

**الطريقة (تحديث 2026-09-15، جولة تنفيذ G0–G2):** الجدول التالي وُثِّق أصلًا في جولة مراجعة بلا تنفيذ (كل الأسطر "لم يُصلَح بعد"). في هذه الجولة **نُفِّذت** G0، G1 وG2 فعليًا بكود+اختبار+تشغيل حقيقي لـ`npm run verify`/`npm run build` (خلفية وواجهة، كلاهما أخضر)، فتغيّرت حالة كل سطر. لا إعلان "إنجاز" هنا بلا الدليل المذكور أمامه.

| الادّعاء الأصلي | الحالة بعد التنفيذ | الدليل |
|---|---|---|
| `CORS_ORIGINS: z.string().default('*')` بلا فشل إقلاع في production | ✅ **أُصلح** | `src/shared/config/env.ts`: الإقلاع يفشل الآن إن كان `NODE_ENV=production` و`CORS_ORIGINS` تساوي `'*'` (رسالة صريحة تطلب قائمة سماح مفصولة بفواصل) |
| لا فهرس `enrollments_one_current_per_learner` في أي migration | ✅ **أُصلح** | `prisma/migrations/20260915000000_enrollments_one_current_per_learner/migration.sql` (فهرس جزئي فريد) + `tests/unit/enrollments-one-current-per-learner.test.ts` (اختبار integration ضد PGlite حقيقي) |
| لا `.github/workflows/` | ✅ **أُصلح** | `.github/workflows/ci.yml`: مهمتان (`backend`, `web`) تُشغِّلان `typecheck → arch:check → test → build` على كل PR وعلى `main` |
| تسريب `schoolIds` الخام في ثلاث شاشات معلّم | ✅ **أُصلح** | `web/src/pages/teacher/{assignments,interventions,results}.tsx` تعرض الآن `schoolName.get(id) ?? id` بدل `id` وحده؛ + قاعدة معمارية جديدة `FE14` (`web/scripts/check-frontend-architecture.ts`) تمنع أي حقل `*Id` خام من الظهور كنص مرئي مستقبلًا — مُتحقَّق منها بزرع مخالفة فعلية والتأكد أن `arch:check` يرصدها، ثم إزالتها |
| `textbookTitleForSubject` مكرّرة في ملفين | ✅ **أُصلح** | نُقلت إلى نسخة وحيدة في `src/contexts/content/domain/authoring.ts`؛ الواجهة تستهلكها عبر حقل `defaultTextbookTitle` الجديد في استجابة `GET /catalogue/subjects` (`catalogue.service.ts`'s `withDefaultTitle`) بدل حساب مكرّر محليًا |

**بنود G2 الإضافية المنفَّذة في نفس الجولة (§10):**
- رفض عنوان كتاب يكرّر اسم الصف/الفصل القائم عند الإنشاء: `checkTitleDoesNotRepeatPlacement` في `src/contexts/content/domain/authoring.ts`، مُستدعاة من `authoring.service.ts`'s `createTextbook`، برمز خطأ `content.title_repeats_placement` — مختبرة في `tests/unit/content-authoring.service.test.ts` (حالتا الصف والفصل).
- مكوّن `TextbookLabel`/`textbookLabelParts`/`textbookSubtitleParts` مشترك في `web/src/design-system/patterns/textbook-label.tsx` يستبدل الأنماط الثمانية المكرّرة، بإزالة أي جزء (subject/grade/term) يتكرر نصيًا داخل العنوان — مختبر في `textbook-label.test.tsx` بحالة العنوان العدائي (يحتوي اسم الصف والفصل معًا).
- تدقيق منهجي لكل تعبير JSX من الصيغة `{x}` عبر كامل `web/src` (لا عيّنة) لم يجد أي عرض نصي فعلي لحقل `*Id` خام غير مُصلَح بالفعل — كل تطابق متبقٍّ كان إما مفتاح React (`key=`)، أو خاصية DOM (`id=`, `value=`)، وليس نصًا مرئيًا؛ قاعدة `FE14` أعلاه تحمي من انحراف هذا مستقبلًا.

**الحكم المحدَّث:** G0، G1 وG2 **مُنجَزة فعليًا** بمعيار الملف (كود + اختبار + `npm run verify`/`build` أخضر في كلا المشروعين، مُتحقَّق منه حيًا في هذه الجولة لا افتراضًا). G2.5 وG3 (طبقة AI ونطاق المعلّم) **لم تُنفَّذ بعد** — تبقيان كما وُثِّقتا في §6/§15، بانتظار جولة تنفيذ منفصلة بموافقة صريحة.

---

## 14. لماذا لم تُعتمد بعض مزايا Curriculum/Textbook القديمة؟ — إعادة تقييم كاملة

**السياق الذي يطرحه السؤال:** النظام القديم (`legacy/`) مرّ فعليًا بمرحلتَي هجرة داخليتين موثَّقتين في تاريخه هو نفسه قبل وصولنا إلى هذا المستودع:
1. **دمج `LearningMaterial(type=TEXTBOOK)` في `Curriculum`** (`changelog/10_TEXTBOOK_ABOLITION_AND_DOMAIN_UNIFICATION_2026-09-08.md`): "الكتاب المدرسي ليس مادة — هو المنهج نفسه".
2. **إعادة تسمية `Curriculum` إلى `Textbook`** في هذا المستودع الجديد (`MIGRATION-FROM-LEGACY.md` §2 "Naming"): *"The legacy project agonised over `Curriculum` vs `Textbook`... Resolved: the model is `Textbook`... No mapping layer, no ambiguity."*

**النتيجة المهمة:** تسمية النموذج **محسومة وصحيحة بالفعل** — لا حاجة لإعادة فتح نقاش `Curriculum` مقابل `Textbook`. لكن هذا التتابع من عمليتي دمج/إعادة تسمية **ترك فجوات وظيفية حقيقية**: الخدمة القديمة `CurriculumService` (`textbook-catalog.service.ts`، 78 دالة، 1661 سطرًا) كانت **god object** يجمع كل شيء — التأليف، والعلاقات، والمفاهيم الخاطئة، والمحتوى العلاجي، والاستيراد، والتقارير — في ملف واحد. عند إعادة البناء في هذا المستودع، **الانقسام المعماري كان صحيحًا** (`authoring.service.ts` + `item-bank.service.ts` + `publishing.service.ts` + `content-import.service.ts` منفصلة بحدود واضحة، بلا god object)، **لكن بعض وظائف الـCRUD الأقل استخدامًا لم تُوصَل بواجهة إدارة فعلية بعد** رغم اكتمالها في الخلفية والعقود واختبارات HTTP.

**منهجية إعادة التقييم:** لكل ميزة في `legacy/src/services/textbook/*` و`legacy/src/components/curriculum/*` و`legacy/src/components/textbooks/*`، فحصتُ: (أ) هل المكافئ موجود في المخطط/الخلفية الحالية؟ (ب) إن كان موجودًا في الخلفية، هل له نقطة نهاية HTTP؟ (ج) إن كانت نقطة النهاية موجودة، هل تستهلكها أي شاشة إدارة فعلية (`grep` مباشر، لا افتراض)؟

### 14.1 مزايا يجب **إضافتها** — الخلفية جاهزة، الفجوة في الواجهة فقط (بلا Schema Change)

هذه الفئة هي الاكتشاف الأهم في هذه الجولة: **البنية التحتية الكاملة موجودة ومُختبرة عبر HTTP**، لكن **لا شاشة إدارة واحدة تستدعيها** — فجوة توصيل (wiring)، لا فجوة تصميم.

| الميزة (من legacy) | حالة الخلفية اليوم | حالة الواجهة اليوم | الدليل |
|---|---|---|---|
| **دورة نشر الكتاب من الواجهة** (إرسال للمراجعة/اعتماد/رفض/أرشفة/استرجاع) | ✅ كاملة: `POST /content/transitions` يستدعي `publishing.apply()`، بفصل submit/approve (`requireApprover`) | 🔴 **صفر استدعاء**: `textbookAdministrationApi.transition()` مُعرَّفة في العميل، ومفاتيح i18n موجودة (`textbookAdmin.submit/approve/reject/archive/restore`)، **لكن لا مكوّن واحد في كل `web/src` يستدعيها** (تأكيد بـ`grep` شامل: صفر نتيجة خارج تعريف الدالة نفسها). **أثر عملي:** لا توجد طريقة لأي مسؤول اليوم لنقل كتاب من `DRAFT` إلى `PUBLISHED` عبر الواجهة إطلاقًا — فقط عبر استدعاء API مباشر يدويًا. هذا **أخطر فجوة اكتُشفت في هذه الجولة** لأنها تجعل ميزة "Content management ✅" في `CAPABILITY-LEDGER.md` بند 13 مضلِّلة إن قُرئت كـ"جاهزة للاستخدام من الإدارة" | `textbook-administration.api.ts:270`، تدقيق شامل بـ`grep -rn "textbookAdministrationApi.transition" web/src` |
| **إنشاء/تعديل مفهوم خاطئ (Misconception) من واجهة إدارة مباشرة** | 🟡 جزئي: `createMisconception` موجودة في `authoring.service.ts` و`ports.ts`، **لكن بلا نقطة نهاية HTTP خاصة بها** — الطريقة الوحيدة للوصول إليها اليوم هي عبر `POST /content/textbooks/import` (حزمة استيراد كاملة) | 🔴 صفر واجهة: لا مكوّن يعرض نموذج "أضف مفهومًا خاطئًا لهذا المفهوم" | `grep -rn "createMisconception" src/interface/http/*.ts` → صفر؛ `ConceptDetailModal` القديم (تبويب كامل لهذا) لا مكافئ له |
| **ربط/فك ربط المتطلبات السابقة (Prerequisites) من واجهة** | ✅ كاملة: `POST/DELETE /content/prerequisites` مع رفض الدورات (`content.prerequisite_cycle`) ونطاق الكتاب الواحد | 🔴 صفر واجهة: لا شاشة تعرض قائمة مفاهيم لاختيار متطلب سابق لها | `grep -rln "Prerequisite" web/src` لا يُعيد أي مستهلك API |
| **تعديل/إعادة ترتيب وحدة أو درس أو مفهوم بعد الإنشاء** | ✅ كاملة: `PATCH /content/nodes` + `POST /content/reorder` | 🔴 صفر واجهة: `ContentNodeCreateModal` **ينشئ فقط**، لا تعديل اسم/وصف ولا سحب-وإفلات لإعادة الترتيب بعد الإنشاء | `grep -n "updateNode|reorder" web/src` لا يُعيد أي استدعاء |
| **تعديل/تقاعد مورد تعلّم (Learning Resource) بعد إنشائه** | ✅ كاملة: `PATCH /resources/:key` + `DELETE /resources/:key` (تقاعد لا حذف صلب) | 🔴 صفر واجهة: `MaterialsList` يعرض القائمة وينشئ فقط، **لا زر تعديل ولا زر تقاعد على أي مورد قائم** | `item-bank.routes.ts:568-590`، `grep -n "updateResource|retireResource" web/src` صفر |
| **تصدير حزمة كتاب (نسخة احتياطية/تدقيق خارجي)** | ✅ كاملة: `GET /textbooks/:key/export` (يُنتج `ContentPackage` وفق `export-profile.ts`) | 🔴 صفر واجهة: لا زر "تنزيل" في `TextbookDetailDrawer` ولا في `textbooks-admin.tsx` | `grep -rln "download\|Download" web/src/education/admin` صفر |

**القرار:** هذه الستّة بنود **يجب إضافتها للخطة كبوابة صريحة جديدة (G2.5 أدناه)** — كلها **توصيل واجهة لخلفية مكتملة ومُختبرة فعلًا**، بلا أي تعديل Schema أو منطق أعمال جديد، وبالتالي **منخفضة المخاطر وعالية القيمة**، ويجب أن تُنفَّذ **قبل** أي إعلان مستقبلي بأن "إدارة المحتوى مكتملة".

### 14.2 مزايا يجب **رفضها/عدم إعادة بنائها** — تتعارض مع تصميم النظام الجديد

| الميزة القديمة | لماذا تُرفض | الحكم |
|---|---|---|
| **`CurriculumEdition`/`CurriculumVersion`** (جدول إصدار منفصل، `EditionsPanel`, `EditionCurriculumDrilldown`) | الطبعة جزء من هوية `Textbook.key` نفسه (`EDU-MATH-G07-T1-ED2026`) — جدول منفصل يعيد بالضبط المشكلة التي حلّها هذا القرار. **هذا تأكيد صريح لتعليمات المستخدم الصريحة بعدم إعادة إضافته**، وهو متوافق أيضًا مع نص الخطة الملصقة نفسها في §4 منها ("لا أوصي حاليًا بإضافة ❌ CurriculumEdition أو CurriculumVersion دون حاجة حقيقية") | ⛔ رفض نهائي — **لم يُقترَح وسيُرفض أي اقتراح مستقبلي به** |
| **استيراد Excel شامل** (`CurriculumExcelImportService`، 1364 سطرًا، 14 دالة، تحليل أوراق متعددة) | القدرة **مفقودة فعلًا اليوم** (`CAPABILITY-LEDGER.md`: بند "Imports" 🔴)، لكن **الحل ليس نسخ الخدمة القديمة**: هي god-service بمنطق أعمال مكرَّر عن `authoring.service.ts`/`content-import.service.ts` القائمَين. المسار الصحيح: بناء **محوّل تحليل XLSX→`ContentPackage` JSON فقط** (لا منطق أعمال) يمرّ عبر `ContentImportService` القانوني القائم — وهذا **جزء من مشروع Content Factory (P0.7/G8)، لا إعادة بناء ميزة legacy** | 🟡 الحاجة حقيقية، **لكن التنفيذ يجب أن يكون محوّل تنسيق رقيق فوق البنية القائمة**، ضمن G8، لا استنساخ الخدمة القديمة |
| **`CurriculumHealthService`** (`curriculum-health.service.ts`، تقرير صحة منفصل: فهرسة الصفحات، اكتمال الشجرة) | **مُستبدَلة فعليًا** بـ`structural-validation.ts` + نقطة `GET /content/readiness` **الأحدث والأدق** (تتحقق من طبقات فارغة، أسئلة غير مرتبطة، ترتيب متسلسل) — بناء نسخة موازية يُنتج تعريفَين لـ"جاهزية المحتوى"، بالضبط الخطر الذي يحظره قسم "قواعد التنفيذ" | ⛔ لا حاجة — القدرة الأحدث موجودة فعلًا بتصميم أفضل |
| **`GlobalSearchModal`, `AIQuestionPromptStudioModal`, `CurriculumAskAIModal`** (بحث شامل + مودالات AI متفرقة داخل نطاق المنهج) | مغطاة بالكامل بتصميم **AI Content Engine الموحَّد** في §6 من هذا الملف — إعادة بناء مودالات AI متفرقة داخل نطاق المحتوى تُنتج بالضبط تعدد التطبيقات الذي يحظره §6.5 (Governance طبقة واحدة) | ⛔ لا تُبنى كميزات منفصلة — أي حاجة AI متعلقة بالمحتوى تمر عبر §6 حصرًا |
| **مستورد Google Drive / جسر NotebookLM** (`google-drive-scanner.service.ts`, `ai-drive-importer.service.ts`, `NotebookLmBridgeTab.tsx`) | مُسقَطة صراحة أصلًا في `MIGRATION-FROM-LEGACY.md` §3: *"Google Drive / Excel / PDF import — valuable, but not foundational — re-add against the new ports"* | ⛔ قرار سابق موثَّق، يُعاد تأكيده هنا فقط، لا يُعاد فتحه |
| **`CurriculumPacingReport`** (تقرير توزيع زمني قابل للطباعة) | ميزة تجميلية/تقريرية بلا دليل طلب فعلي من العميل اليوم، ولا تعتمد عليها أي حلقة تعليمية (لا Mastery ولا Remediation تحتاجها) | 🟡 لا رفض نهائي، لكن **لا تُبنى الآن** — تُعاد زيارتها فقط إذا طلبها Pilot فعليًا، ضمن G6 (تدقيق واجهة) لا كبند مستقل |

### 14.3 مزايا أُعيد فحصها ووُجد أنها **موجودة فعلًا وكافية** (لا فجوة، رغم التشابه مع أسماء legacy)

- **علاقات المفاهيم (Concept relationships)**: الرسم البياني وكشف الدورات ومنطق الحارس **موجودان فعليًا في الخلفية** (`ConceptPrerequisite`, `detectCycles`) — الفجوة الوحيدة موثقة في §14.1 (لا واجهة استهلاك)، لا فجوة تصميم أو خلفية.
- **المحتوى العلاجي (Remedial content)**: النظام القديم أفرد جدول `RemedialContent` مستقلاً؛ النظام الجديد طوى هذا في `LearningResource.kind = REMEDIAL` بنفس دورة الحياة والترتيب — **قرار توحيد صحيح، ليس نقصًا**، لأن `RemedialContent` القديم لم يكن يحمل شيئًا لا يحمله `LearningResource` (العنوان، النوع، المحتوى، الترتيب، الحالة).
- **Flashcards من منظور المنهج**: الفهرسة الكنسية القديمة (`Curriculum → Unit → Lesson → Concept → Flashcard`) محفوظة تمامًا في النموذج الجديد (`Flashcard.conceptId`) — لا فجوة.

### 14.4 تصحيح توثيقي مطلوب في `CAPABILITY-LEDGER.md`

اكتُشف في هذه الجولة أن بند 13 ("Content management") في `CAPABILITY-LEDGER.md` يصف "دورة النشر الكاملة" و"34 فحصًا حيًّا عبر HTTP" كدليل ✅ — وهذا **صحيح حرفيًا** (الفحوصات فعلية وتمر عبر HTTP)، **لكنه غير كافٍ ليُفهَم كـ"جاهز من منظور الإدارة"**، لأن كل تلك الفحوصات تستدعي الـAPI مباشرة لا عبر أي شاشة. **هذا هو نفس نمط الفجوة الموثَّقة أصلاً في P0.2** (تعليق Schema يزعم وجود فهرس غير موجود فعليًا) — إعلان ✅ مبني على مستوى تحقق واحد (HTTP) بينما مستوى آخر (واجهة إدارة) فارغ تمامًا. **الإصلاح المطلوب في التوثيق (لا في السلوك):** تقسيم عمود "الحالة" مستقبلًا في `CAPABILITY-LEDGER.md` إلى عمودين — "الخلفية/العقد" و"الوصول من الواجهة" — بدل عمود حالة واحد يخلط المستويين، تحديدًا لأن هذه الجولة أثبتت أن الفرق بينهما يمكن أن يكون **كاملًا** (100% خلفية، 0% واجهة) لا مجرد نسبة.

---

## 15. بوابة إضافية — G2.5: توصيل واجهة إدارة المحتوى الناقصة (جديدة، من §14.1)

تُدرَج بين G2 وG3 في تسلسل §10 لأنها **بلا مخاطر تصميمية** (توصيل فقط، عقود مُختبرة أصلًا) ولها **أثر مستخدم مباشر وفوري** أكبر من عدة بنود لاحقة:

1. **زر دورة النشر في `TextbookDetailDrawer`**: أزرار "إرسال للمراجعة/اعتماد ونشر/إرجاع للمسودة/أرشفة/استرجاع" حسب `status` الحالي والصلاحية (`requireApprover` نفس فصل submit/approve القائم في الخلفية)، تستدعي `textbookAdministrationApi.transition()` الموجودة فعلًا. **الأعلى أولوية في هذه البوابة** — بدونها لا مسار إداري لنشر أي كتاب جديد.
2. **نموذج مفهوم خاطئ (Misconception) بسيط**: إضافة `POST /content/misconceptions` (نقطة نهاية جديدة صغيرة تستدعي `authoring.createMisconception` الموجودة، بنفس نمط أدوار `requireAuthor`) + لوحة مصغّرة داخل تفاصيل المفهوم لإدراج/عرض المفاهيم الخاطئة المرتبطة.
3. **واجهة ربط المتطلبات السابقة**: قائمة اختيار مفهوم من نفس الكتاب + زر ربط/فك ربط، تستدعي `POST/DELETE /content/prerequisites` القائمتين.
4. **تعديل وإعادة ترتيب العقد**: زر "تعديل" على كل وحدة/درس/مفهوم في `ContentOutlineBrowser` يفتح نفس `ContentNodeCreateModal` في وضع تعديل (يستدعي `PATCH /content/nodes`)، وسحب-وإفلات أو أزرار ↑/↓ تستدعي `POST /content/reorder`.
5. **تعديل/تقاعد مورد تعلّم**: زر "تعديل" و"تقاعد" على كل عنصر في `MaterialsList` يستدعيان `updateResource`/`retireResource` القائمتين.
6. **زر تصدير كتاب**: زر "تنزيل نسخة JSON" في `TextbookDetailDrawer` يستدعي `GET /textbooks/:key/export` القائمة.

**بوابة القبول:** لكل بند أعلاه — اختبار مكوّن يتحقق من ظهور الزر/النموذج بالصلاحية الصحيحة، ونجاح الاستدعاء الفعلي (لا mock) ضد الخادم المحلي مرة واحدة يدويًا كدليل تشغيل حي (يُسجَّل هنا بعد التنفيذ، غير مؤكَّد الآن).
