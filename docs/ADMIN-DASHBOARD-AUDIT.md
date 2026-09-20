# Admin Dashboard Audit — الحالة الفعلية للفرع قبل أي تعديل

**تاريخ التدقيق:** 2026-09-13 · **الفرع:** `arena/01a09c62-edu7` (منبثق من `arena/01a09166-edu7` عند `1759f05`)
**المنهج:** فحص فعلي لـ `prisma/schema.prisma` + migrations + الخدمات + المسارات + واجهات الويب + الاختبارات. لا افتراضات من محادثات سابقة.

مصدر الحقيقة: **`schema.prisma` لنموذج البيانات، والكود ومستهلكوه الفعليون لسلوك النظام.**

---

## 0. خلاصة تنفيذية

النظام مبني بطبقات نظيفة (domain → application → infrastructure → interface/http) مع قواعد معمارية مفروضة آليًّا (`scripts/check-architecture.ts` — 28 قاعدة، و`web/scripts/check-frontend-architecture.ts` — 13 قاعدة). **المحركات موجودة والقدرات الخلفية شبه مكتملة، لكن طبقة الإدارة في الواجهة تغطي جزءًا صغيرًا فقط منها.** لا توجد واجهات وهمية فوق بيانات غير موجودة — الفجوات في الواجهة تظهر كصفحات placeholder صريحة.

خط الأساس قبل التعديل: typecheck ✅ · arch:check ✅ (28/28) · 966 اختبار ✅ · web typecheck ✅ · web 41 اختبار ✅ · web arch:check ✅ (13/13).

---

## 1. المصادقة — لا توجد Demo Authentication (الفئة A)

**النتيجة: النظام مطابق للشرط بالفعل. لا حاجة لأي حذف.**

- مسار دخول واحد: `POST /auth/login` → `LoginUseCase` → `Session` (جدول جلسات حقيقي بتدوير وإبطال). لا يوجد demo authenticator ولا demo session ولا demo token ولا demo authorization ولا bypass.
- حسابات الديمو (بذرة `prisma/seed/data/demo-users.json`) هي **`User` عادية بـ `passwordHash`** تُزرع بالبذرة وتدخل عبر نفس مسار الدخول العادي بنفس الأدوار.
- `web/src/features/auth/demo-credentials.dev.ts` و`demo-accounts.tsx`: زر يعبّئ النموذج فقط (form prefill) ولا يستدعي signIn، ويُستورد خلف علم `import.meta.env.DEV` ثابت فتسقطه حزمة الإنتاج كليًّا. هذا هو الاستخدام المسموح تحديدًا في المهمة (seed/form-prefill tooling).

**الفئة: A (موجود وصحيح — يُحافَظ عليه).**

## 2. جرد `ordinal` (الفئة A)

| الحقل | موقعه | الحكم |
|---|---|---|
| `Term.ordinal` | `@@unique([academicYearId, ordinal])`، جزء من اشتقاق المفتاح `2026-2027-T01` وعنصر هوية الفصل | **حقيقي — يبقى.** ليس ترتيب عرض بل هوية. |
| `Grade.ordinal` | `@@unique`، يُرمَّز في المفتاح `G07` ويُتحقق منه في `validateGrade` | **حقيقي — يبقى.** هوية المرحلة، لا `i + 1`. |
| `ContentChunk.ordinal` | ترتيب مستقر لمستقبل pgvector | حقيقي بحسب تعليق النموذج — يبقى. |

لا `ordinal` على أي كيان آخر، ولا استخدام لـ `i + 1` أو row index كهوية في أي مسار أعمال. **لا يُضاف `ordinal` لأي model جديد في هذه الجولة.**

## 3. الخريطة الإلزامية: Model → Service → API → UI → الفجوة

| Model (schema) | Service | API | UI الحالية | الفجوة |
|---|---|---|---|---|
| `User` | `ProvisioningService` (إنشاء/تحديث/حالة/دليل) + `LoginUseCase` | `POST/PATCH /provisioning/users`، `GET /users` (بحث وترقيم خدمي)، `GET /users/:key`، `POST /users/status` | `UserDirectoryPage`: بحث/تصفية/ترقيم + تغيير حالة | **UI:** إنشاء مستخدم، تحرير، عرض تفصيلي، إدارة أدوار. **API/Read:** عمود `phone` في سطر الدليل؛ حقول المعلّم في `ProvisionedUser` |
| `UserRole` (بنطاق مدرسة) | `grantRole`/`revokeRole` مع `validateRoleGrant` | `POST /roles`، `POST /roles/revoke` | لا شيء | **UI بالكامل** (منح/سحب داخل تفاصيل المستخدم) |
| `LearnerProfile` | يُنشأ ضمن `provisionUser` | ضمن `GET /users/:key` (`learnerKey`) | لا شيء مستقل | عرض الطالب = تفاصيل مستخدم + تسجيلاته (موجودة API-wise) |
| `EducatorProfile` | يُنشأ ضمن `provisionUser` | ضمن `GET /users/:key` — **لكن `ProvisionedUser` لا يحمل `employeeCode`/`specialty`** | لا شيء | **Read model ناقص + UI كامل** لشاشة المعلّمين |
| `GuardianProfile`/`GuardianLink` | `linkGuardian`/`verify`/`unlink`/قوائم | 5 نقاط نهاية كاملة | لا شيء | **UI بالكامل** |
| `School` (`isActive` ✓) | `CatalogueService` كامل | GET/POST/PATCH/DELETE `/catalogue/schools` (PATCH يدعم `isActive`) | تبويب في `AcademicStructurePage` | **UI:** تفعيل/تعطيل، صفحة تفاصيل مدرسة بتبويبات (Users/Teachers/Students/Enrollments/Curriculum) |
| `AcademicYear` (`isCurrent` ✓) | `CatalogueService` + `setCurrentAcademicYear` (معاملة واحدة) | GET/POST + `POST /:key/current` + DELETE | تبويب | **UI:** زر «تعيين كعام حالي»، عرض الفصول تحت كل عام |
| `Term` (لا حالة دورة حياة) | `CatalogueService` | GET(مع فلتر عام)/POST/PATCH/DELETE | تبويب مسطّح | **UI:** تجميع حسب العام. **قرار:** دورة حياة الفصل مشتقة من عامه — **لا يُضاف `isActive`** |
| `Grade` (لا `isActive`) | `CatalogueService` (حذف محمي بالمرجعيات) | GET/POST/PATCH/DELETE | تبويب | **Domain gap مُبرَّر:** إضافة `isActive` (انظر §4) + UI |
| `Subject` (`isActive` ✓) | `CatalogueService` | PATCH يدعم `isActive` | تبويب | **UI فقط:** تفعيل/تعطيل |
| `GradeSubject` + `Subject.standardGradeLevels` | `CatalogueService`: `gradeSubjectMatrix` · `applyGradeSubjectCells` (دفعة واحدة) · `fillGradeSubjectsFromPolicy` (معاينة إلزامية ثم تطبيق) | `GET/POST /catalogue/grade-subjects`، `POST /catalogue/grade-subjects/fill` | تبويب «توزيع الموادّ على الصفوف» في `AcademicStructurePage` (`grade-subject-matrix.tsx`) | **أُنجز (2026-09-14).** خوارزمية النظام القديم (`SubjectDistributionStudio`) منقولة بلمسات البنية الجديدة: المصفوفة كتالوجية بلا أبعاد عام/فصل، و`[]` = بلا سياسة فلا تُمسّ بالتعبئة، والغياب = غير مُقرَّر، والسياسة تُصحِّح المخالفات عند التطبيق |
| `Enrollment` (`isCurrent` ✓ + فهرس فريد جزئي) | `enrolLearner` (يرفض تكرار/عدم تطابق فصل-عام) + `makeCurrent`/`end`/قائمة لكل متعلّم | POST `/enrollments`، GET `/learners/:key/enrollments`، POST `/enrollments/make-current`، `/end` | **لا شيء** | **API:** قائمة تسجيلات عامة بمرشِّحات (مدرسة/عام/فصل/صف) + ترقيم. **UI:** شاشة كاملة. **حارس:** منع التسجيل في مدرسة/صف غير نشط |
| `Textbook` (دورة نشر DRAFT→IN_REVIEW→PUBLISHED→ARCHIVED) | `ContentAuthoringService` (إنشاء بمفتاح مشتق) + `PublishingService` (انتقالات + جاهزية) | POST `/content/textbooks`، `/transitions`، `/readiness`، import/export | لا شيء (صفحات author هي placeholder) | **API:** قائمة كتب بمرشِّحات للإدارة. **UI:** شاشة منهاج (حالة/نشر/تبنّي) |
| `TextbookAdoption` | **لا شيء — البذرة هي الكاتب الوحيد** (`seed.ts:91`) | **لا شيء** | لا شيء | **الأخطر وظيفيًّا:** استحقاق المتعلّم للكتب مشتق من التبنّي (`learning.repository`)، ولا يمكن إدارته إلا بتعديل البذرة. يحتاج Service + API + UI |
| `Class` | **قرار موثّق: الصف استعلام لا كيان** (`docs/CLASS-ROSTER-INVESTIGATION.md`, DR-5) | `GET /analytics/roster` (نطاق مدرسة+صف+فصل) | صفحة roster للمعلّم موجودة | **ليست فجوة.** لا يُنشأ كيان ولا `classId`؛ «الشُعب» في واجهة الإدارة = استعلام تجميعي فوق Enrollment |
| `TeachingAssignment` | **غير موجود** | **غير موجود** | لا شيء | **Domain gap موثّق — لا UI فوق بيانات غير موجودة.** الموجود فعليًّا: نطاق المعلّم عبر `UserRole.schoolId` |
| `SystemSetting` | **غير موجود (جدول بلا مستهلك واحد)** | لا شيء | لا شيء | **E — لا تُبنى واجهة إعدادات وهمية فوقه.** يوثَّق كفجوة |
| `AuditEntry` | `AuditWriter` يكتب من provisioning والمحتوى | **لا قارئ** | لا شيء | **Read API** للنشاط الأخير (حقيقي ومخزَّن فعلًا) |
| (نظرة عامة) | `AdministrationService` | `GET /administration/overview` | `AdminOverviewPage` (بيانات حقيقية) | إثراء: معلّمون، مواد نشطة، تسجيلات حالية، عناصر غير نشطة، متعلّمون بلا تسجيل حالي، معلّمون بلا نطاق مدرسة، سجل نشاط أخير |

## 4. قرارات الـ domain المتخذة (قبل التنفيذ)

1. **`Grade.isActive` — يُضاف.** نفس نمط `Subject.isActive`/`School.isActive` المعتمد: صف مرجعي منصّي يُحال إلى التقاعد فتُمنع التسجيلات الجديدة وتبقى المرجعيات التاريخية صحيحة (الحذف محمي أصلًا بالمرجعيات). حقل مستقر يمثل مفهومًا حقيقيًّا، وليس حاجة UI.
2. **`Term` بلا `isActive`.** دورة حياة الفصل مشتقة (تابع لعامه). لواحق الحذف محمية بـ Restrict.
3. **`AcademicYear` دورتها `isCurrent`** — تُدار عبر نقطة النهاية المخصصة (معاملة واحدة). لا `isActive` إضافي.
4. **`Enrollment` يحرس الكيانات غير النشطة:** يُرفض التسجيل في مدرسة غير نشطة أو صف غير نشط (رسالة خطأ مسماة). العام غير الحالي مسموح (تسجيل تاريخي/مسبق).
5. **`TextbookAdoption` — قدرة قائمة في النموذج تُستكمل خدمةً وAPI وUI** (بناءً على النموذج، لا اختراعًا). القواعد: الكتاب والمدرسة والعام يجب أن توجد؛ الثلاثية فريدة (قيد DB)؛ التبنّي مسموح لأي حالة كتاب (تخطيط مسبق) لكن استحقاق المتعلّم يظل يصفّي المنشور فقط.
6. **لا كيان Class ولا `TeachingAssignment` ولا SystemSetting UI** — تُوثَّق كفجوات/قرارات ولا تُخترع.

## 5. تصنيف الفئات المطلوبة (A–G)

| الفئة | العناصر |
|---|---|
| **A — موجود وصحيح (يُعاد استخدامه)** | المصادقة/الجلسات (لا ديمو) · `CatalogueService` + مساراته · `ProvisioningService` + 16 نقطة نهاية · `AdministrationService.overview` · نشر المحتوى (`PublishingService`) · `AppShell` + navigation + tokens · `RecordTable`/`RecordEditor`/`collections.ts` (نمط موحّد قائم) · `UserDirectoryPage` (بحث/ترقيم خدمي) · `AdminOverviewPage` · `Badge`/`Card`/`Button`/`Input`/`data-states`/`action-feedback` · seed idempotent |
| **B — موجود ويحتاج إصلاح/إكمال** | `collections.ts`: لا يعرض `isActive` للمواد/المدارس ولا «تعيين عامًا حاليًا» · `admin.api.ts`: `user()` بلا نوع ولا مستهلك · دليل المستخدمين: لا إنشاء/تحرير/أدوار/تفاصيل |
| **C — في الـ schema ولا يستخدمه UI/API** | `TextbookAdoption` (بذرة فقط) · `SystemSetting` (لا مستهلك) · `AuditEntry` (كتابة بلا قراءة) |
| **D — في UI بلا دعم خلفي** | **لا شيء** (الـ placeholders صريحة بأنها تنتظر قدرات) |
| **E — غير موجود ويحتاج قرار domain** | `TeachingAssignment` (فجوة حقيقية — تؤجَّل وتوثَّق) · قراءة `SystemSetting` (مؤجَّلة) · قائمة تسجيلات بمرشِّحات (تُنفَّذ — استقراء فوق نموذج قائم) · قائمة كتب للإدارة (تُنفَّذ) |
| **F — مكرر/قديم ويُزال** | **لا تكرارات وُجدت** في مسارات API أو خدمات أو مصادقة. (مجلد `legacy/` مرجعي غير مُصرَّف — يبقى) |
| **G — يُحافَظ عليه للتوافق** | كل المسارات الحالية دون كسر: `/admin`، `/admin/users`، `/admin/structure` تبقى وتُثرى؛ يُضاف إليها ولا تُستبدل |

## 6. خطة التنفيذ المعتمدة على هذا التدقيق

**Backend (طبقة canonical، بلا مسارات موازية):**
1. `Grade.isActive` في الـ schema + إعادة توليد الـ baseline الوحيد + `db:generate`.
2. `CatalogueService`: `GradeRecord.isActive` + دمجه في `gradePatch` (مع إعادة التحقق من الصف المدمج).
3. `ProvisioningService`: رفض التسجيل في مدرسة/صف غير نشط · `listEnrollmentsPage` (مرشِّحات مدرسة/عام/فصل/صف/حالي + ترقيم + حقول عرض) · `listEducators` (هوية المعلّم + نطاق مدرسته + employeeCode/specialty) · إضافة `phone` لسطر الدليل وحقول المعلّم لـ `ProvisionedUser`.
4. `AdministrationService`: عدّادات إضافية (معلّمون/مواد نشطة/تسجيلات حالية) + عناصر انتباه (مدارس/مواد/صفوف غير نشطة، متعلّمون بلا تسجيل حالي، منح معلّم بلا نطاق مدرسة) + **قارئ سجل النشاط** `GET /administration/activity`.
5. سياق المحتوى: `TextbookAdministrationService` — قائمة كتب بمرشِّحات + تبنّي (تبنّي/إلغاء/قائمة) عبر `/content/textbooks` و`/content/adoptions`.

**Frontend (إعادة استخدام + نمط واحد):**
- مكونات قابلة لإعادة الاستخدام: `DataTable`، `ConfirmDialog`، `EntityDrawer`، توسيع `RecordEditor` (multiselect/password) — بلا Modals عملاقة وبلا نمط منفصل لكل مورد.
- صفحات: Dashboard مُثرى (نشاط حقيقي + عدّادات + انتباه) · Users (إنشاء/تحرير/أدوار/تفاصيل Drawer) · Schools + تفاصيل المدرسة (Overview/Users/Teachers/Students/Cohorts/Enrollments/Curriculum) · Enrollments (مرشِّحات خدمية + إنشاء + حالي/إنهاء) · Teachers · Curriculum (كتب + نشر + تبنّي) · Settings (مركز يربط الأسطح الإدارية الحقيقية) · Structure (دورة حياة + عام حالي + فصول مجمّعة).
- كل النصوص عبر i18n (عربي/إنجليزي)، وكل الاستعلامات عبر `shared/api/client.ts` مع مفاتيح cache مركزية.

**التحقق:** typecheck + arch:check + unit tests (الجذران) + build + فحص حيّ عبر HTTP على قاعدة مزروعة.

---

## 7. سجل الإنجاز على هذا الفرع

- **2026-09-14 (ب) — استكمال داشبورد المدير:**
  - **جدول الصفوف × التوزيع:** عمود «الموادّ المرتبطة» في تبويب الصفوف يعرض مواد كل صف من المصفوفة نفسها، مع إجراء صفّي «إضافة موادّ التوزيع القياسيّ (N)» يضيف مواد السياسة الناقصة لهذا الصف مباشرة (`fill` بمدى `gradeKey`).
  - **استعادة الافتراضيّات:** زر في المصفوفة يعيد التوزيع لحالة التثبيت — معاينة إلزامية أولًا، والفرق عن التعبئة موثّق: المادة بلا سياسة تعود «غير معروضة» لأن هذا افتراضها.
  - **ربط المعلم بالمدرسة:** `POST/PATCH /provisioning/educators` — التعيين فعل واحد (مستخدم + منح TEACHER + ملف الطاقم الذي صار يتبع الدور كما يتبع الملفات learner/guardian أدوارها)، والربط «نقل» لا «تكرار»: منح واحد بمدرسة واحدة. الواجهة: «إضافة معلّم» + «ربط بمدرسة» في صفحة المعلّمين.
  - **تجهيز المحتوى:** `GET /content/textbooks/:key/outline` + `GET /content/lessons/:key/materials` ببوابة قراءة طاقمية (مدير النظام + مدير المدرسة + مؤلف المحتوى + المعلم) — صفحة `/admin/content` لجداول الوحدات/الدروس/المواد، و`/teacher/content` «الموادّ التعليمية والإثرائية» من مهام المعلم، بمكوّن تصفّح واحد لأن المنهج واحد.
  - **التنقّل المجمّع:** مجموعات الشريط الجانبي الإداري (نظرة عامة/البنية الأكاديميّة/الأشخاص/المحتوى/الإعدادات) كخاصية يعلنها الوجهة — أسطح المتعلم/المعلم/ولي الأمر تبقى مسطّحة كما كانت.
  - **الإعدادات:** أعيد تجميع الفهرس إلى «الإعدادات الأساسية الخاصة بالتعليم» ثم «الأشخاص والأدوار» ثم «المحتوى والمناهج».
  - تحقق: typecheck + arch:check في الجذرين + الاختبارات القائمة المتأثرة مباشرة (40+7) + فحص حيّ للنقاط الجديدة — بلا ملفات اختبار جديدة وبلا فحص كامل، بطلب المالك.
- **2026-09-14 — توزيع الموادّ على الصفوف (منقول من النظام القديم):** `GradeSubject` (كتالوجي: بلا أبعاد عام/فصل — التباين السنوي يعيش في `TextbookAdoption`، و`termNumbers` القديمة كانت دومًا `[1,2]` فسقطت) + `Subject.standardGradeLevels Int[] @default([])` (سياسة `provisioningPolicy.gradeLevels` القديمة عمودًا حقيقيًّا بمستهلك فعلي: المصفوفة والتعبئة). البذرة توسّع السياسة مرة واحدة **create-only** فلا تُلغِ قرارات المدير عند إعادة الزرع. الخوارزمية المنقولة: معاينة إلزامية قبل أي كتابة (`apply:false` لا يكتب شيئًا) · التجاوزات اليدوية معلّقة محليًّا حتى «حفظ التوزيع» (الدفعة وحدة الكتابة) · التعبئة تطبيقٌ للعرض الوطني فتصحّح المخالفات · المادة بلا سياسة (`[]` — التربية الفنية) تُترك للمدير كليًّا (أكدَمَ من «لا سياسة = مفعّلة في كل مكان» في القديم). جدول `subject_grade_distributions` القديم (draft بلا مستهلك) **لم يُنقل** — نُقلت الخوارزمية والسياسة فقط. تحقق: 1008 اختبار جذري + 84 واجهة + فحص حيّ (معاينة بلا كتابة، تطبيق يصحّح، ART لا تُمسّ، غير المدير مرفوض).
