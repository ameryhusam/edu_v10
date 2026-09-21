# Edu7 G1 — Content Asset + Workspace + Gemini Foundation

**Branch:** `feature/content-ai-foundation-g1`
**Base:** `main`

## هدف المرحلة

تثبيت الأساس الذي ستبنى فوقه مراحل AI Content التالية، بدون إنشاء مسار كتابة ثانٍ إلى PostgreSQL.

### المسار المعتمد

```text
Textbook PDF
   ↓
Python Content Engine — segmentation + printed/PDF page mapping + page renders
   ↓
Workspace
   ↓
Evidence / ContentChunk
   ↓
Canonical Gemini provider contract
   ↓
AI Content Draft
   ↓
Validation + Dedup
   ↓
Preview
   ↓
User Apply
   ↓
ContentAuthoringService / ItemBankService / Resource services
   ↓
PostgreSQL
```

## ما تم إصلاحه في G1

### 1. ContentAsset أصبح persistence حقيقيًا

- أضيف `ContentAssetType` و`ContentAsset` إلى Prisma.
- أضيف `LearningResource.assetId` لربط المورد الدلالي بالملف الفيزيائي عند وجوده.
- العلاقات الاختيارية إلى Textbook/Unit/Lesson/Concept موجودة في asset.
- الملف الفيزيائي لا يدخل PostgreSQL؛ PostgreSQL يحفظ metadata + checksum + storage key.
- أزيل الاعتماد على `Map` داخل `PrismaContentAssetRepository`.
- إعادة تشغيل API لم تعد تجعل asset metadata تختفي.

### 2. ترتيب import أصبح صحيحًا

الـ workspace importer ينفذ:

1. import canonical content structure.
2. ثم تسجيل ContentAsset مع foreign keys حقيقية.

وبذلك لا يحاول asset repository إنشاء FK إلى Textbook/Unit/Lesson/Concept قبل وجودها.

### 3. Node لم يعد يختلق ملفات PDF

كان `WorkspaceManager.segmentWorkspace` ينشئ manifests ويستخدم حجم/checksum المصدر نفسه للـ unit/lesson PDFs دون تقطيع فعلي.

تم تغيير المسؤولية:

- **Python Content Engine:** المسؤول الوحيد عن تقطيع PDF، mapping للصفحات، إنشاء lesson/unit PDFs، page images، وevidence artifacts.
- **Node WorkspaceManager:** مسؤول عن reconciliation/verification للـ workspace الناتج والتحقق من وجود الملفات وSHA-256.

هذا يمنع وجود خوارزميتي segmentation متناقضتين.

### 4. Gemini أصبح structured-output capable

عقد `AiProvider` يدعم الآن `jsonSchema` بشكل provider-neutral.

Gemini adapter:

- يستخدم `responseMimeType=application/json` عند الحاجة.
- يمرر JSON Schema إلى Gemini عندما يطلب use-case ذلك.
- يطبق timeout وbounded retry.
- لا يسرّب Google SDK إلى application/domain.

### 5. Python Gemini transport موحّد داخليًا

تم إنشاء `edu7_content.ai.client.GeminiClient` ليكون transport واحدًا لكل مهام Python Gemini، وتستخدمه `GeminiFreeProvider` بدل وجود HTTP/retry implementation منفصل داخل provider.

كما تم توحيد هوية provider/model في registry باستخدام `GEMINI_MODEL`.

## ما لم يدخل G1 بعد

- Gemini Analyze Lesson use-case في Node.
- AI draft domain schemas للمفاهيم والمفاهيم الخاطئة والأسئلة والمشتتات والفلاش كارد والموارد.
- Preview/Apply API.
- append-only AI refresh + semantic dedup.
- AI provenance/source fingerprint.
- ربط Python output مباشرة بـ canonical AI gateway؛ G1 فقط يوحد transport والعقود ولا ينشئ DB writer جديدًا.
- UI لأزرار Add with AI / Refresh with AI.

هذه العناصر تبدأ في G2/G3 بعد التحقق من الأساس.

## قاعدة مهمة

لا يوجد أي مسار:

```Gemini → Prisma
Python → Prisma
UI → Prisma
```

المسار الوحيد للحفظ هو الخدمات الكنسية الحالية.
