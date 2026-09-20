# تدقيق دورة الحياة — 2026-09-14

تدقيق مبني على **تشغيل حيّ**، لا على قراءة ملفات. كل ادعاء هنا له دليل من
طلب HTTP فعلي أو استعلام قاعدة بيانات، وكلاهما مذكور.

القاعدة الحاكمة: **وجود ملف ليس دليلاً على وجود قدرة.**

---

## 0. تصحيح ثلاثة افتراضات في الطلب

قبل التنفيذ، ثلاثة أمور في الطلب لا تطابق الشيفرة. تصحيحها أولاً يمنع "إصلاحاً"
يكسر ما يعمل.

### أ. لا يوجد "مُصادِق تجريبي" لنحذفه

الطلب يفترض أن الحسابات التجريبية تُعامَل معاملة خاصة. **لا يوجد هذا المسار.**
الدليل:

- `demo-credentials.dev.ts` قائمة نصوص فقط. الزر ينفّذ
  `setIdentifier(...)` و`setPassword(...)` — يملأ الحقلين ويتوقف.
- `grep -rni "demo" src/contexts/identity/` يعطي **3 نتائج، كلها تعليقات**.

وأثبتُّه تجريبياً: أنشأتُ مستخدماً جديداً `zahra` عبر
`POST /provisioning/users` (201)، ثم سجّل الدخول عبر **نفس** النقطة
`POST /auth/login` (200). ومقارنة الصفّين في قاعدة البيانات:

| username | status | locale | bcrypt | len |
|---|---|---|---|---|
| student (تجريبي) | ACTIVE | ar | true | 60 |
| zahra (مُنشأ حديثاً) | ACTIVE | ar | true | 60 |

**لا فرق.** نفس الجدول، نفس التجزئة، نفس النقطة، نفس الجلسة. حذف الملف كان
سيزيل ملء الحقول فقط — وهي راحة تطوير بلا أي سلطة — دون أن يغيّر المصادقة
بشيء. (حُذف `zahra` بعد الإثبات.)

### ب. `ordinal` موجود في النموذج الجديد

الطلب يقول إنه غير موجود. `prisma/schema.prisma`:

- `Grade.ordinal Int @unique` (سطر 428)
- `Term.ordinal Int` مع `@@unique([academicYearId, ordinal])` (413، 421)

وهو ضروري: `G10` يسبق `G2` أبجدياً، والترتيب التربوي لا يُشتقّ من النص.
والقيد المركّب يمنع فصلين بالرقم نفسه في السنة ذاتها.

### ج. حقول التنشيط — اثنان موجودان، واحد كان ناقصاً فعلاً، واثنان لا ينبغي وجودهما

| النموذج | isActive | الحالة |
|---|---|---|
| School | ✅ | موجود ويُزرع |
| Subject | ✅ | موجود ويُزرع |
| **Grade** | ✅ في المخطط | **كان غائباً عن ملف البذرة — أُصلح** |
| Term | ❌ | **لا ينبغي** |
| AcademicYear | ❌ | **لا ينبغي** |

`Grade.isActive` كان عموداً حقيقياً أضافته دفعة `grade-subjects`، لكن
`academic-structure.json` لم يذكره — فتوقّف الملف عن وصف النموذج. أُصلح:
الصفوف الاثنا عشر تصرّح به والبذرة تكتبه.

أما **Term وAcademicYear فلهما دورة حياة زمنية لا حالة تنشيط**: الفصل يُعرَّف
بـ `startsOn/endsOn` والسنة بـ `isCurrent`. إضافة `isActive` تخلق **مصدري
حقيقة متناقضين**: ماذا يعني فصل `isActive: false` وتاريخه جارٍ؟ الحالة
تُشتقّ من التاريخ، ولا تُعلَن.

---

## 1. تقييم معماري تنفيذي

Edu7 اليوم **نظام تعلّم مغلق الحلقة في مساره الأساسي** — أثبتُّه تشغيلياً،
لا استنتاجاً. وهذا أهم نتيجة في التدقيق.

**11 سياقاً محدوداً**، 12 موجّهاً، 24 صفحة. **لا خدمات مكرّرة**: فحص
`src/contexts/*/application/` يعطي ملفاً واحداً لكل مسؤولية (المتكرّر الوحيد
`ports.ts`، وهو واجهة لكل سياق بالتصميم).

---

## 2. إثبات الحلقة المغلقة — الدليل الحيّ

هذا ما طلبتَه بالضبط: لا "خدمة الإتقان موجودة"، بل تتبّع البيانات خطوة بخطوة.

بدأتُ من `next-step` للطالب `student`:

```
1. GET /learning/next-step  →  activity: REVIEW | rule: spaced_review_due
2. POST /assessment/attempts {kind:PRACTICE, lessonKey:...}  →  201
3. GET  /assessment/attempts/:key/next-item?conceptKeys=...  →  200
      theta: 0 | standardError: 1  ← حالة IRT حقيقية
4. POST /assessment/answers {answer:{choiceIds:[...]}}  →  201
      verdict: INCORRECT
      evidence: [{conceptKey, isCorrect:false, misconceptionKey: ...-MIS01}]
```

ثم قِست الأثر في قاعدة البيانات:

| القياس | قبل | بعد |
|---|---|---|
| `concept_mastery.mastery` | 0.9779 | **0.8745** |
| `attemptsCount` | 6 | **7** |
| `learner_misconceptions` | (فارغ) | **occurrences 1, confidence 0.5, isResolved false** |
| `remediation_episodes` | (فارغ) | **status OPEN, trigger MISCONCEPTION** |

ثم أعدتُ سؤال المحرّك:

```
5. GET /learning/next-step
   →  activity: REMEDIATE | rule: open_misconception_first
   rationale: "An unresolved misconception is recorded on this concept.
               It is addressed before any new practice so the error is
               not reinforced."
```

**الحلقة أُغلقت**: إجابة واحدة خاطئة غيّرت الإتقان، وولّدت تشخيصاً للبس،
وفتحت حلقة علاج **تلقائياً**، وغيّرت التوصية التالية من `REVIEW` إلى
`REMEDIATE`. لا استدعاء يدوي في أي خطوة.

هذا يستوفي المستوى 5: `Create → Use → Observe → Evaluate → Persist Evidence
→ Update State → Affect Next Action → Repeat`.

---

## 3. مصفوفة القدرات — بالقياس الحيّ

| القدرة | DB | Domain | Engine | Service | API | UI | Lifecycle | الحالة |
|---|---|---|---|---|---|---|---|---|
| Identity + الأدوار | ✅ | ✅ | — | ✅ | ✅ | ✅ | 5 | **COMPLETE** |
| Mastery (BKT) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 5 | **COMPLETE** |
| Misconceptions | ✅ | ✅ | ✅ | ✅ | ✅ | 🟡 | 5 | **COMPLETE** (تنقص لوحة المعلّم) |
| Remediation | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 5 | **COMPLETE** |
| Recommendations | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 4 | **PARTIAL** — تُشتقّ عند القراءة ولا تُخزَّن |
| Assessment / CAT | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 5 | **COMPLETE** |
| Content authoring | ✅ | ✅ | — | ✅ | ✅ | ✅ | 5 | **COMPLETE** |
| Catalogue (admin) | ✅ | ✅ | — | ✅ | ✅ | ✅ | 5 | **COMPLETE** |
| Enrollments | ✅ | ✅ | — | ✅ | ✅ | ✅ | 4 | **PARTIAL** — لا نقل بين السياقات |
| Assignments | ✅ | ✅ | — | ✅ | ✅ | 🟡 | 4 | **PARTIAL** |
| Engagement (XP) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 5 | **COMPLETE** |
| Analytics | ✅ | ✅ | ✅ | ✅ | ✅ | 🟡 | 4 | **PARTIAL** — لا اتجاه زمني |
| **Imports (Excel/PDF)** | — | — | — | — | — | — | 0 | **MISSING** |

---

## 4. الفجوات الحقيقية (مرتّبة)

**P1 — التوصيات لا تُخزَّن.** تُحسب عند كل قراءة. فلا يمكن قياس
"هل قُبلت التوصية؟ هل أُنجزت؟" — أي لا تقييم لجودة المحرّك نفسه.

**P1 — Imports غائبة كلياً.** أكبر فجوة مقابل القديم (~14k سطر). وهي
الطريق الوحيد لإدخال منهج حقيقي دون تأليف يدوي.

**P2 — لوحة اللبس الشائع للمعلّم.** البيانات موجودة ومحسوبة؛ لا واجهة
تعرضها. `Engine → No Teacher-facing UI`.

**P2 — الاتجاه الزمني.** كل الأرقام لحظية. "هل تحسّن الطالب؟" غير قابل
للإجابة.

**P3 — نقل الطالب بين الفصول/السياقات.**

---

## 5. المرجع الذي بُني عليه النظام

لم يُستنسخ نظام بعينه. المرجع مركّب ومصرّح به في الشيفرة:

- **Bayesian Knowledge Tracing** (Corbett & Anderson) — `pL0/pT/pS/pG`.
- **IRT 3PL + CAT** (`D=1.702`, EAP على 41 نقطة) — معيار الاختبار التكيّفي.
- **Mastery Learning** (Bloom) — عتبة 0.85 وبوابات المتطلّبات.
- **Spaced Retrieval** — `retention.ts`.
- **Open edX** — فصل التأليف عن التسليم (مذكور حرفياً في الجرد).
- **النظام القديم** — مصدر البيداغوجيا (LD-4، LD-6) لا المعمارية.

---

## 6. ما نُفِّذ في هذه الجولة

1. **`Grade.isActive`** أُضيف إلى ملف البذرة والمُحمِّل (12 صفاً).
2. **اختبار قديم صُحِّح** — كان يؤكّد أن TEACHER لا يحتاج ملفاً، والنطاق
   صار يربطه بـ `educator`. أثبتُّ أن الفشل **سابق لتغييراتي** بتخزين
   تغييراتي مؤقتاً وإعادة التشغيل، ثم صحّحت التوقّع لا الشيفرة.

**النتيجة:** 1008 اختبارات خضراء، الفحصان النوعيان، `arch:check` نظيف.
