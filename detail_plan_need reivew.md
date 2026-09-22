نعم، **الصور والملفات لا ينبغي تخزينها داخل JSON كـ Base64**. التصميم الصحيح هو:

```text
Workspace/
  ملفات PDF والصور والنصوص الفعلية
  JSON يحتوي metadata وروابط نسبية فقط
```

ويكون `index.json` الموجود في جذر المادة هو **Manifest رئيسي قابل للاستيراد والتحديث**، وليس مجرد فهرس للعرض.

بعد تدقيق الوضع الحالي للكود، هذه هي الخطة النهائية المتوافقة مع المعمارية الموجودة.

---

# أولاً: نتيجة التدقيق النهائي

## الموجود حالياً

المشروع يحتوي فعلياً على:

- عقد تبادل المحتوى في `src/contexts/content/domain/export-profile.ts`.
- خدمة الاستيراد الرسمية في `src/contexts/content/application/content-import.service.ts`.
- مسار HTTP للاستيراد في `src/interface/http/content.routes.ts`.
- نماذج المحتوى الأساسية في `prisma/schema.prisma`.
- محرك Python لمعالجة PDF في `edu7-content-engine`.
- دعم `TextbookPage.imageUrl`.
- دعم `LearningResource.url`.
- دعم `TextbookPage` و`ContentChunk`.
- دعم `Flashcard`.
- دعم الموارد على مستوى الكتاب والدرس والمفهوم.

## الفجوات الحالية

لكن توجد فجوات يجب حلها قبل تنفيذ Workspace Import:

1. `ContentPackage` الحالي لا يحتوي على مجموعة مستقلة للأصول `assets`.
2. `LearningResource.url` لا يكفي لإدارة:
   - checksum
   - الحجم
   - نوع الملف
   - الإصدار
   - التخزين المؤقت
   - النسخ الجديدة
3. `TextbookPage.imageUrl` يخزن رابطاً فقط ولا يملك metadata للملف.
4. `ResourceKind` الحالي لا يحتوي على أنواع مثل:
   - `IMAGE_SUMMARY`
   - `PDF`
   - `AUDIO`
   - `IMAGE`
5. محرك Python الحالي يخرج JSON خاصاً به، وليس Manifest مطابقاً بالكامل لعقد Edu7 الحالي.
6. `ContentImportService` يستقبل حزمة parsed، وليس مجلد Workspace.
7. لا يوجد حالياً مسار واضح لتحديث محتوى مستورد سابقاً مع الحفاظ على البيانات القديمة.
8. لا يوجد مسار مكتمل لتحميل الأصول عند الطلب وتخزينها في cache للويب وأندرويد.

---

# القرار المعماري النهائي

يجب فصل أربعة أنواع من البيانات:

## 1. Manifest

ملفات JSON تصف المحتوى والروابط:

```text
index.json
unit_01.json
lesson_01.json
concepts.json
questions.json
resources.json
```

## 2. Content Assets

الملفات الفعلية:

```text
PDF
PNG
JPG
TXT
MP3
MP4
```

## 3. Canonical ContentPackage

الصيغة التي يفهمها Backend ويقبلها `ContentImportService`.

## 4. Database Records

بيانات PostgreSQL:

```text
Textbook
Unit
Lesson
Concept
Question
LearningResource
TextbookPage
ContentChunk
ContentAsset
```

تدفق البيانات يكون:

```text
Workspace
  ↓
Workspace Manifest Parser
  ↓
Canonical ContentPackage
  ↓
ContentImportService
  ↓
ContentAuthoringService / ItemBankService
  ↓
PostgreSQL
```

أما الملفات:

```text
Workspace assets
  ↓
Storage Adapter
  ↓
ContentAsset records
  ↓
URLs returned to Web / Android
```

---

# ثانياً: هيكل Workspace النهائي

يجب أن يكون جذر المادة هو نقطة الدخول إلى الاستيراد:

```text
Workspace/
  T01/
    G07/
      MATH/
        index.json
        textbook/
          textbook.pdf
          pages/
            page_001.png
            page_001.txt
            page_002.png
            page_002.txt

        unit_01_algebra/
          unit_01.json
          U_01_algebra.pdf

          lessons/
            lesson_01_linear_equations/
              lesson_01.json
              L_01_linear_equations.pdf

              pages/
                page_012.png
                page_012.txt
                page_013.png
                page_013.txt

              resources/
                reading/
                  explanation.pdf
                  explanation.txt

                images/
                  equation_steps.png
                  equation_steps.json

                videos/
                  explanation.mp4

                summaries/
                  linear-equations-summary.png
                  linear-equations-summary.json

              concepts.json
              questions.json
              flashcards.json
              resources.json
              image_summaries.json

            lesson_02_equations/
              lesson_02.json
              L_02_equations.pdf
              pages/
              resources/
              concepts.json
              questions.json
              flashcards.json
              resources.json
              image_summaries.json

        unit_02_geometry/
          unit_02.json
          U_02_geometry.pdf
          lessons/
```

## ملاحظات مهمة

- `index.json` هو نقطة الاستيراد.
- المسارات داخله تكون relative paths فقط.
- لا تستخدم مسارات مثل:

```text
C:\Users\...
/home/user/...
```

- لا تخزن Base64 داخل JSON.
- مجلد `resources/` داخل كل درس هو المكان القياسي للملفات الإضافية.
- ملف JSON لا يحتوي الملف نفسه، بل يحتوي:

```text
relativePath
mimeType
sizeBytes
sha256
version
```

---

# ثالثاً: `index.json` هو Manifest رئيسي للمادة

يجب أن يحتوي `index.json` على ملخص قابل للاستيراد للمادة كاملة، وليس فقط قائمة أسماء.

مثال:

````json name=index.json
{
  "manifestVersion": "1.0",
  "type": "workspace_subject",
  "workspaceId": "T01-G07-MATH",
  "term": "T01",
  "grade": "G07",
  "subject": "MATH",
  "edition": "2026",
  "title": "كتاب الرياضيات للصف السابع",
  "status": "READY_FOR_IMPORT",
  "generatedAt": "2026-09-20T12:00:00Z",
  "updatedAt": "2026-09-20T12:00:00Z",
  "source": {
    "engine": "edu7-content-engine",
    "engineVersion": "1.2.0",
    "sourcePdf": {
      "relativePath": "textbook/textbook.pdf",
      "mimeType": "application/pdf",
      "sizeBytes": 123456789,
      "sha256": "..."
    }
  },
  "counts": {
    "units": 2,
    "lessons": 4,
    "concepts": 18,
    "questions": 72,
    "flashcards": 36,
    "resources": 14,
    "assets": 28
  },
  "units": [
    {
      "unitNumber": 1,
      "slug": "algebra",
      "name": "الجبر",
      "relativePath": "unit_01_algebra",
      "manifest": "unit_01_algebra/unit_01.json",
      "pdf": "unit_01_algebra/U_01_algebra.pdf",
      "lessons": [
        {
          "lessonNumber": 1,
          "slug": "linear-equations",
          "name": "المعادلات الخطية",
          "relativePath": "unit_01_algebra/lessons/lesson_01_linear_equations",
          "manifest": "unit_01_algebra/lessons/lesson_01_linear_equations/lesson_01.json",
          "pdf": "unit_01_algebra/lessons/lesson_01_linear_equations/L_01_linear_equations.pdf"
        }
      ]
    }
  ],
  "package": {
    "relativePath": "edu7-content-package.json",
    "profile": "edu7.textbook-content",
    "profileVersion": "1.1"
  }
}
````

## قاعدة مهمة

`index.json` هو **Manifest المصدر**.

أما `edu7-content-package.json` فهو **الحزمة canonical الناتجة منه**.

لا تجعل Backend يفسر كل ملفات Workspace مباشرة عند أول تنفيذ. المسار الأفضل هو:

```text
index.json
  ↓
Workspace parser
  ↓
canonical ContentPackage
  ↓
ContentImportService
```

ويمكن لاحقاً جعل `index.json` نفسه يحمل أو يشير إلى الحزمة canonical، لكن يجب ألا يصبح هناك تعريفان متناقضان للمحتوى.

---

# رابعاً: ملفات الوحدة والدرس

## ملف الوحدة

يجب أن يكون اسمه مطابقاً لرقم الوحدة:

```text
unit_01_algebra/unit_01.json
```

مثال:

````json name=unit_01.json
{
  "manifestVersion": "1.0",
  "type": "unit",
  "unitNumber": 1,
  "slug": "algebra",
  "name": "الجبر",
  "orderIndex": 1,
  "startPage": 1,
  "endPage": 40,
  "relativePath": "unit_01_algebra",
  "pdf": {
    "relativePath": "unit_01_algebra/U_01_algebra.pdf",
    "mimeType": "application/pdf",
    "sha256": "...",
    "sizeBytes": 4567890
  },
  "lessons": [
    {
      "lessonNumber": 1,
      "slug": "linear-equations",
      "name": "المعادلات الخطية",
      "relativePath": "unit_01_algebra/lessons/lesson_01_linear_equations",
      "manifest": "unit_01_algebra/lessons/lesson_01_linear_equations/lesson_01.json"
    }
  ]
}
````

## ملف الدرس

يجب أن يكون اسمه مطابقاً لرقم الدرس:

```text
lesson_01_linear_equations/lesson_01.json
```

مثال:

````json name=lesson_01.json
{
  "manifestVersion": "1.0",
  "type": "lesson",
  "unitNumber": 1,
  "lessonNumber": 1,
  "unitSlug": "algebra",
  "slug": "linear-equations",
  "name": "المعادلات الخطية",
  "orderIndex": 1,
  "startPage": 12,
  "endPage": 18,
  "relativePath": "unit_01_algebra/lessons/lesson_01_linear_equations",
  "pdf": {
    "relativePath": "unit_01_algebra/lessons/lesson_01_linear_equations/L_01_linear_equations.pdf",
    "mimeType": "application/pdf",
    "sha256": "...",
    "sizeBytes": 987654
  },
  "directories": {
    "pages": "pages",
    "resources": "resources",
    "summaries": "resources/summaries"
  },
  "files": {
    "concepts": "concepts.json",
    "questions": "questions.json",
    "flashcards": "flashcards.json",
    "resources": "resources.json",
    "imageSummaries": "image_summaries.json"
  }
}
````

---

# خامساً: هل الصور تكون داخل JSON؟

## الإجابة

لا.

الصورة تكون ملفاً فعلياً داخل:

```text
lesson_01_linear_equations/resources/images/
```

والـ JSON يحتوي فقط على:

```json
{
  "assetType": "IMAGE_SUMMARY",
  "relativePath": "resources/images/equation_steps.png",
  "mimeType": "image/png",
  "sha256": "...",
  "sizeBytes": 234567,
  "altText": "خطوات حل المعادلة الخطية",
  "caption": "مخطط توضيحي",
  "sourcePages": [12, 13]
}
```

## لماذا؟

لأن وضع Base64 داخل JSON يسبب:

- تضخم حجم الحزمة.
- بطء parsing.
- صعوبة التخزين المؤقت.
- صعوبة استخدام Range Requests.
- تكرار الملف عند كل تحديث.
- صعوبة استخدامه في Android.
- صعوبة استخدام CDN أو Object Storage.

---

# سادساً: إضافة `ContentAsset` إلى قاعدة البيانات

النماذج الحالية مثل `LearningResource.url` و`TextbookPage.imageUrl` لا تكفي وحدها لإدارة الملفات بشكل احترافي.

يجب إضافة نموذج جديد في:

```text
prisma/schema.prisma
```

مثلاً:

```prisma name=prisma/schema.prisma
enum ContentAssetType {
  TEXTBOOK_PDF
  UNIT_PDF
  LESSON_PDF
  PAGE_IMAGE
  PAGE_TEXT
  RESOURCE_FILE
  IMAGE_SUMMARY
  AUDIO
  VIDEO
}

model ContentAsset {
  id           String           @id @default(uuid()) @db.Uuid
  key          String           @unique
  assetType    ContentAssetType

  originalName String
  relativePath String
  storageKey   String
  publicUrl    String?
  mimeType     String
  sizeBytes    Int
  sha256       String
  version      Int              @default(1)
  isActive     Boolean          @default(true)

  textbookId   String?          @db.Uuid
  unitId       String?          @db.Uuid
  lessonId     String?          @db.Uuid
  conceptId    String?          @db.Uuid

  pageStart    Int?
  pageEnd      Int?

  textbook     Textbook?        @relation(fields: [textbookId], references: [id], onDelete: Cascade)
  lesson       Lesson?          @relation(fields: [lessonId], references: [id], onDelete: Cascade)
  concept      Concept?         @relation(fields: [conceptId], references: [id], onDelete: Cascade)

  createdAt    DateTime         @default(now())
  updatedAt    DateTime         @updatedAt

  @@index([textbookId])
  @@index([lessonId])
  @@index([conceptId])
  @@index([sha256])
  @@map("content_assets")
}
```

## لماذا ملف جديد وليس تعديل `LearningResource` فقط؟

لأن:

- `LearningResource` يمثل ما يراه المتعلم كمادة تعليمية.
- `ContentAsset` يمثل الملف الفعلي في التخزين.
- يمكن لمورد واحد استخدام PDF أو صورة أو فيديو.
- يمكن للملف أن يكون مرتبطاً مباشرة بالكتاب أو الوحدة أو الدرس أو المفهوم.
- يمكن استخدام نفس الملف في Web وAndroid وAI grounding.

يتم تعديل `LearningResource` لإضافة:

```prisma
assetId String? @db.Uuid
asset   ContentAsset? @relation(fields: [assetId], references: [id])
```

ولا يتم حذف `url` فوراً؛ يبقى للتوافق مع الموارد الخارجية التي لا توجد في Workspace.

---

# سابعاً: لا تضف منطق الملفات إلى Domain

هذه نقطة معمارية حاسمة.

## Domain

يسمح له بمعرفة:

- نوع الأصل كقيمة business value.
- scope الأصل.
- قواعد الاسم.
- قواعد التحديث.
- قواعد عدم التكرار.
- صحة المسار المنطقي.

لا يسمح له بمعرفة:

- `fs`
- `path`
- `Buffer`
- `Express Request`
- Prisma
- S3 SDK
- Workspace الحقيقي.

## Infrastructure

يضاف:

```text
src/infrastructure/content-assets/
  content-asset.repository.ts
  local-content-storage.ts
  object-storage.ts
  content-asset-scanner.ts
```

وهنا فقط يتم التعامل مع:

- filesystem
- streams
- MIME detection
- file size
- SHA-256
- storage provider

## Application

يضاف:

```text
src/contexts/content/application/content-asset.service.ts
src/contexts/content/application/workspace-import.service.ts
```

وهنا يتم:

- ترتيب العمل.
- ربط الأصل بالدرس أو المفهوم.
- استدعاء authoring services.
- استدعاء asset repository عبر port.
- تنفيذ الدمج والتحديث.
- تسجيل نتائج الاستيراد.

## Interface

يضاف في:

```text
src/interface/http/content-assets.routes.ts
src/interface/http/workspace.routes.ts
```

وهي مسؤولة فقط عن:

- auth
- validation
- استدعاء application service
- تحويل النتيجة إلى HTTP

---

# ثامناً: ملف Manifest لا يكتب قاعدة البيانات مباشرة

لا يجوز أن تقوم دالة قراءة `index.json` باستدعاء Prisma.

التدفق الإلزامي:

```text
index.json
  ↓
WorkspaceManifestReader
  ↓
WorkspacePackageConverter
  ↓
ContentPackage
  ↓
ContentImportService
  ↓
ContentAuthoringService
  ↓
ItemBankService
  ↓
AssetService
  ↓
Repositories
```

## مكان قارئ Workspace

لأنه يتعامل مع ملفات خارجية وJSON وpaths، يوضع في Infrastructure:

```text
src/infrastructure/content-import/workspace-manifest-reader.ts
```

ويطبق Port معرفاً في Application:

```text
src/contexts/content/application/ports.ts
```

مثلاً:

```typescript name=src/contexts/content/application/ports.ts
export interface WorkspaceManifestReader {
  read(root: string): Promise<WorkspaceManifest>;
}
```

لكن `WorkspaceManifest` نفسه يجب أن يكون type/business structure في Domain أو Application contract، وليس type خاصاً بـ Node filesystem.

---

# تاسعاً: تعديل `ContentPackage`

الملف الحالي:

```text
src/contexts/content/domain/export-profile.ts
```

يحتاج إضافة assets، لكن لا تضف قاعدة بيانات داخل العقد.

أضف عقداً عاماً مثل:

```typescript name=src/contexts/content/domain/export-profile.ts
export type ContentAssetScope = 'TEXTBOOK' | 'UNIT' | 'LESSON' | 'CONCEPT';

export interface ContentAssetExport {
  readonly scope: ContentAssetScope;
  readonly unitSlug?: string | null;
  readonly lessonSlug?: string | null;
  readonly conceptSlug?: string | null;
  readonly assetType: string;
  readonly originalName: string;
  readonly relativePath: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly version: number;
  readonly pageStart?: number | null;
  readonly pageEnd?: number | null;
  readonly title?: string | null;
  readonly altText?: string | null;
  readonly caption?: string | null;
}
```

ثم يضاف إلى:

```typescript
export interface ContentPackage {
  ...
  readonly assets?: readonly ContentAssetExport[];
}
```

## لا تضف في package

لا تضف:

```text
id
textbookId
lessonId
conceptId
databaseUrl
Prisma model names
```

الحزمة تستخدم business paths، وBackend يحولها إلى keys داخلية.

---

# عاشراً: تعديل `ContentImportService`

الملف موجود حالياً:

```text
src/contexts/content/application/content-import.service.ts
```

لا تعِد كتابة الخدمة، ولا تجعلها تقرأ Workspace.

يجب تعديلها فقط لإضافة مرحلة أصول بعد حل مفاتيح الكتب والوحدات والدروس والمفاهيم.

الترتيب المقترح:

```text
textbook
units
lessons
concepts
assets
misconceptions
learningResources
prerequisites
questions
flashcards
```

لكن يجب الاحتفاظ بالقاعدة الحالية:

> `ContentImportService` لا يكتب مباشرة إلى Prisma.

يستدعي:

- `ContentAuthoringService`
- `ItemBankService`
- `ContentAssetService`

ويجب أن يكون لكل مجموعة:

```text
created
unchanged
conflicts
problems
```

## تعديل واجهة النتيجة

إضافة:

```typescript
assets: number;
flashcards: number;
conflicts: number;
```

إلى `ImportOutcome`.

---

# الحادي عشر: عدم الخلط بين Manifest وContentPackage

يجب أن يكون هناك مستويان:

## Manifest

يعرف:

```text
أين توجد الملفات؟
ما الوحدات؟
ما الدروس؟
ما ملفات JSON؟
ما checksum؟
```

## Canonical Package

يعرف:

```text
ما المحتوى التعليمي؟
ما المفاهيم؟
ما الأسئلة؟
ما الموارد؟
ما العلاقات؟
```

التدفق:

```text
index.json
  ↓
قراءة ملفات الوحدة والدرس
  ↓
قراءة concepts.json
قراءة questions.json
قراءة flashcards.json
قراءة resources.json
قراءة image_summaries.json
  ↓
إنتاج ContentPackage
  ↓
الإرسال إلى ContentImportService
```

لا تجعل `ContentImportService` يبحث بنفسه عن:

```text
unit_01_algebra
lesson_01_linear_equations
```

لأن ذلك يجعل Application layer مرتبطة بالfilesystem، ويخالف فصل الطبقات.

---

# الثاني عشر: خدمة تخزين الأصول

إضافة Port في:

```text
src/contexts/content/application/ports.ts
```

مثلاً:

```typescript name=src/contexts/content/application/ports.ts
export interface ContentStorage {
  put(input: {
    storageKey: string;
    sourcePath: string;
    mimeType: string;
    sha256: string;
  }): Promise<{ storageKey: string }>;

  getStream(storageKey: string): Promise<ReadableStream>;
  exists(storageKey: string): Promise<boolean>;
  signedUrl(storageKey: string): Promise<string | null>;
}
```

لكن النوع الخاص بـ `ReadableStream` يجب أن يتوافق مع Runtime المشروع. لا تجعل Domain يعرف نوعاً خاصاً بمزود تخزين معين.

التنفيذ يكون في:

```text
src/infrastructure/content-assets/local-content-storage.ts
src/infrastructure/content-assets/object-content-storage.ts
```

والربط يتم فقط في:

```text
src/composition/container.ts
```

لأن هذا هو composition root الحالي.

---

# الثالث عشر: API للملفات

## قائمة الأصول

يضاف إلى `content.routes.ts` أو Router مستقل حسب الحجم:

```http
GET /api/v1/content/textbooks/:textbookKey/assets
GET /api/v1/content/lessons/:lessonKey/assets
GET /api/v1/content/concepts/:conceptKey/assets
```

## تنزيل الأصل

```http
GET /api/v1/content/assets/:assetKey
```

هذه endpoints لا تستخدم `learner-access.ts` عند قراءة محتوى staff، لكنها تحتاج صلاحية entitlement عندما يكون الوصول learner-facing.

يجب التمييز بين:

```text
Staff content read
Learner content read
```

ولا تسمح route واحدة بتجاوز صلاحيات الكتاب المنشور أو entitlement.

## Response للعميل

```json
{
  "key": "lesson-pdf-abc123",
  "assetType": "LESSON_PDF",
  "name": "L_01_linear_equations.pdf",
  "url": "/api/v1/content/assets/lesson-pdf-abc123",
  "mimeType": "application/pdf",
  "sizeBytes": 987654,
  "sha256": "...",
  "version": 1
}
```

---

# الرابع عشر: Cache في Web وAndroid

## Backend

يجب دعم:

- `ETag`
- `If-None-Match`
- `Last-Modified`
- `Range`
- streaming
- روابط signed عند الإنتاج
- عدم كشف المسار الحقيقي

## Web

أضف في:

```text
web/src/features/content/assets.api.ts
web/src/shared/cache/content-cache.ts
```

ولا تجعل صفحات React تتعامل مع filesystem.

التدفق:

```text
LessonPage
  ↓
lesson API
  ↓
asset metadata API
  ↓
cache lookup by key/version/hash
  ↓
download if missing
  ↓
render
```

## Android

يستخدم نفس HTTP contract:

```text
asset key
version
sha256
url
mimeType
```

ولا يعتمد على شكل مجلد Workspace؛ Workspace مصدر ingestion وليس contract للعميل.

---

# الخامس عشر: الموارد داخل كل درس

نعم، يجب إنشاء مجلد خاص داخل كل درس:

```text
resources/
```

مثال:

```text
lesson_01_linear_equations/
  lesson_01.json
  L_01_linear_equations.pdf
  concepts.json
  questions.json
  flashcards.json
  resources.json

  resources/
    readings/
    images/
    summaries/
    videos/
    audio/
```

## `resources.json`

يحتوي على وصف الموارد وروابطها:

````json name=resources.json
{
  "schemaVersion": "1.0",
  "resources": [
    {
      "slug": "linear-equations-reading",
      "scope": "LESSON",
      "kind": "READING",
      "title": "شرح المعادلات الخطية",
      "asset": {
        "relativePath": "resources/readings/linear-equations.pdf",
        "mimeType": "application/pdf",
        "sizeBytes": 345678,
        "sha256": "..."
      },
      "orderIndex": 1,
      "pageStart": 12,
      "pageEnd": 18
    },
    {
      "slug": "linear-equations-summary",
      "scope": "CONCEPT",
      "conceptSlug": "linear-equations",
      "kind": "IMAGE_SUMMARY",
      "title": "ملخص بصري",
      "asset": {
        "relativePath": "resources/summaries/linear-equations.png",
        "mimeType": "image/png",
        "sizeBytes": 123456,
        "sha256": "..."
      },
      "orderIndex": 2
    }
  ]
}
````

---

# السادس عشر: تحديث `index.json`

`index.json` يجب أن يعاد توليده عند كل تغيير.

لكن يجب ألا ينتج عشوائياً أو يعتمد على وقت التوليد فقط.

يجب أن يحتوي على:

```text
manifestVersion
contentVersion
generatedAt
updatedAt
source engine version
package checksum
counts
asset checksums
unit paths
lesson paths
```

## التحديث

عند إضافة سؤال:

```text
questions.json يتغير
lesson manifest يتغير
index.json يتغير
package checksum يتغير
```

عند إضافة صورة:

```text
resources.json يتغير
lesson manifest يتغير
index.json يتغير
```

## لا تعتبر `updatedAt` وحده هوية للتغيير

التغيير الحقيقي يعتمد على:

```text
canonical content hash
asset sha256
```

---

# السابع عشر: سياسة عدم حذف البيانات

الاستيراد والتحديث يجب أن يكونا append-safe.

## قاعدة المفاهيم

المطابقة:

```text
textbook key
+ unit slug
+ lesson slug
+ concept slug
```

إذا وجد نفس المفهوم:

```text
unchanged أو update مسموح
```

لا ينشأ مفهوم جديد بسبب اختلاف ترتيب القائمة.

## قاعدة الأسئلة

هوية السؤال الحالية في المشروع مشتقة من نص السؤال داخل الدرس، كما يظهر في `export-profile.ts` و`ContentImportService`.

لذلك:

```text
نفس الدرس + نفس النص → unchanged
نفس النص + answer key مختلف → conflict
نص مختلف → سؤال جديد
```

لا تعدل نص سؤال قديم تلقائياً؛ لأن السؤال قد يكون مرتبطاً بإجابات طلاب.

## قاعدة الموارد والأصول

المطابقة:

```text
scope
+ target path
+ slug
+ sha256
```

النتائج:

```text
same hash → unchanged
same slug + new hash → new version / conflict
new slug → create
missing from updated manifest → preserve
```

اختفاء المورد من Workspace لا يعني حذفه من قاعدة البيانات.

الحذف يجب أن يكون عملية صريحة مثل:

```text
retire resource
archive asset
```

وبمراعاة قفل الكتاب المنشور.

---

# الثامن عشر: إضافة الأسئلة من قاعدة البيانات

هذه الميزة لا تستخدم Workspace بعد استيراد الكتاب.

الخدمة الجديدة توضع في:

```text
src/contexts/content/application/question-generation.service.ts
```

أو إذا كانت مرتبطة مباشرة ببنك الأسئلة، يمكن وضعها ضمن:

```text
src/contexts/content/application/item-bank.service.ts
```

لكن لا تضع منطق Gemini أو OpenAI داخل `ItemBankService`. الأفضل:

```text
QuestionGenerationService
  → ContentReader / ContentChunkReader
  → AiProvider port
  → Question validator
  → ItemBankService
```

التدفق:

```text
Lesson / Concept key
  ↓
read Lesson
  ↓
read TextbookPage and ContentChunk
  ↓
AI prompt
  ↓
strict JSON
  ↓
evidence validation
  ↓
deduplication
  ↓
ItemBankService.createQuestion
  ↓
DRAFT
```

لا يتم حذف الأسئلة السابقة ولا إعادة توليد الأسئلة الموجودة بنفس البصمة.

---

# التاسع عشر: ملخصات الصور

يضاف إلى محرك Python أمر مستقل:

```bash
edu7-content summarize-image \
  --lesson Workspace/P1/G07/MATH/unit_01_algebra/lessons/lesson_01_linear_equations \
  --concept linear-equations \
  --model gemini
```

الناتج:

```text
resources/summaries/linear-equations-v1.png
resources/summaries/linear-equations-v1.json
```

ثم يضاف إلى:

```text
resources.json
image_summaries.json
lesson_01.json
index.json
```

وفي Backend يتحول إلى:

```text
ContentAsset
LearningResource
```

ولا يكتب مباشرة إلى database من Python.

---

# العشرون: مراحل التنفيذ حسب الملفات والطبقات

## المرحلة 1: تثبيت Workspace contract

### ملفات جديدة

في Python:

```text
edu7-content-engine/src/edu7_content/workspace/schema.py
edu7-content-engine/src/edu7_content/workspace/validator.py
```

### تعديلات

```text
edu7-content-engine/src/edu7_content/cli/main.py
```

إضافة أوامر:

```text
validate-workspace
build-manifest
build-package
```

### ممنوع

- عدم وضع منطق Prisma.
- عدم وضع HTTP backend داخل Python في هذه المرحلة.
- عدم جعل Python يقرر publication status.

---

## المرحلة 2: إنشاء Workspace generator

### ملفات جديدة

```text
edu7-content-engine/src/edu7_content/workspace/generator.py
edu7-content-engine/src/edu7_content/workspace/asset_registry.py
edu7-content-engine/src/edu7_content/workspace/path_rules.py
```

### التعديل

```text
edu7-content-engine/src/edu7_content/pdf/segmentation.py
```

التعديل فقط لجعل الناتج:

- `unit_01.json`
- `lesson_01.json`
- paths صحيحة
- resources directories
- checksums
- page files

لا تنقل قرار إنشاء المفاتيح canonical إلى Python.

---

## المرحلة 3: إضافة prompts والتحليل

### ملفات جديدة

```text
edu7-content-engine/prompts/extract_concepts.md
edu7-content-engine/prompts/generate_questions.md
edu7-content-engine/prompts/generate_flashcards.md
edu7-content-engine/prompts/generate_image_summary.md
```

```text
edu7-content-engine/src/edu7_content/ai/prompt_runner.py
edu7-content-engine/src/edu7_content/ai/output_validator.py
```

### تعديلات

```text
edu7-content-engine/src/edu7_content/content/models.py
edu7-content-engine/src/edu7_content/validation/evidence_validator.py
```

يجب تقوية validator ليتحقق من وجود الدليل داخل نص الصفحة، وليس فقط أن evidence غير فارغ.

---

## المرحلة 4: إنشاء package builder في Python

### ملفات جديدة

```text
edu7-content-engine/src/edu7_content/export/package_builder.py
edu7-content-engine/src/edu7_content/export/manifest_exporter.py
edu7-content-engine/src/edu7_content/export/asset_exporter.py
```

### تعديل

```text
edu7-content-engine/src/edu7_content/export/json_exporter.py
```

لا تحذف exporter القديم قبل وجود fixtures واختبارات توافق.

الـ package builder يجب أن ينتج:

```text
meta
textbook
units
lessons
concepts
prerequisites
misconceptions
learningResources
questions
assets
```

---

## المرحلة 5: توسيع Backend contract

### تعديل

```text
src/contexts/content/domain/export-profile.ts
```

إضافة:

```text
ContentAssetExport
assets[]
```

رفع version فقط بعد اختبار backward compatibility.

### تعديل

```text
src/contexts/content/application/content-import.service.ts
```

إضافة:

- asset validation
- path validation
- checksum validation
- asset result counts
- unchanged/conflict handling

لا تجعلها تقرأ مجلدات.

---

## المرحلة 6: إضافة قاعدة بيانات الأصول

### تعديل

```text
prisma/schema.prisma
```

إضافة:

- `ContentAssetType`
- `ContentAsset`
- relation إلى Textbook/Lesson/Concept
- relation اختيارية إلى LearningResource

### ملفات جديدة

```text
src/contexts/content/domain/assets.ts
src/contexts/content/application/content-asset.service.ts
src/infrastructure/database/content-asset.repository.ts
```

### Migration

```bash
npm run db:migrate
npm run db:generate
npm run typecheck
```

---

## المرحلة 7: إضافة Storage infrastructure

### ملفات جديدة

```text
src/contexts/content/application/ports.ts
src/infrastructure/storage/content-storage.ts
src/infrastructure/storage/local-content-storage.ts
src/infrastructure/storage/object-content-storage.ts
```

### تعديل

```text
src/composition/container.ts
```

لربط:

```text
ContentStorage implementation
ContentAssetService
ContentImportService
```

لا تنشئ storage adapter داخل route أو داخل domain.

---

## المرحلة 8: إضافة Workspace reader في Backend

### ملفات جديدة

```text
src/contexts/content/application/workspace-import.service.ts
src/infrastructure/content-import/workspace-manifest-reader.ts
src/infrastructure/content-import/workspace-package-converter.ts
```

### وظيفة الخدمة

```text
read manifest
validate manifest
resolve relative paths
build ContentPackage
call ContentImportService
```

لكن إذا كان Workspace على جهاز خارجي، لا يستطيع Backend قراءة مسار محلي مباشرة. يجب استخدام أحد المسارات:

```text
ZIP upload
storage URI
shared mounted folder
```

الأفضل كبداية:

```text
POST /api/v1/content/workspaces/import
```

مع ZIP يحتوي على Workspace.

---

## المرحلة 9: API

### تعديل أو إضافة

```text
src/interface/http/content.routes.ts
```

للاستمرار مع route الحالي.

أو ملف جديد إذا كبرت routes:

```text
src/interface/http/content-assets.routes.ts
src/interface/http/workspace.routes.ts
```

### Endpoints

```text
POST /api/v1/content/workspaces/validate
POST /api/v1/content/workspaces/import
GET  /api/v1/content/lessons/:lessonKey/assets
GET  /api/v1/content/assets/:assetKey
POST /api/v1/content/lessons/:lessonKey/generate-questions
POST /api/v1/content/lessons/:lessonKey/generate-flashcards
POST /api/v1/content/concepts/:conceptKey/generate-image-summary
```

كل route يجب أن:

- يتحقق من الدور.
- يستدعي Application service.
- لا يحتوي business rules.
- لا يستدعي Prisma.
- لا يقرأ filesystem مباشرة.

---

## المرحلة 10: Frontend

### ملفات جديدة

```text
web/src/features/content/assets.api.ts
web/src/features/content/workspace-import.api.ts
web/src/features/content/content-cache.ts
web/src/features/content/components/WorkspaceImportDialog.tsx
web/src/features/content/components/ImportPreview.tsx
```

### تعديل

```text
web/src/features/content/content.api.ts
```

لتضاف types وcalls، مع الإبقاء على `importPackage`.

### لا تفعل

- لا تجعل frontend يقرأ Workspace path.
- لا تجعل frontend يفسر JSON التعليمي.
- لا تجعل frontend يحسب keys.
- لا تجعل frontend يقرر publication state.
- لا تجعل frontend يطبق duplicate policy.

---

# الحادي والعشرون: ترتيب الاستيراد النهائي

يجب أن يكون الترتيب:

```text
1. textbook
2. units
3. lessons
4. concepts
5. content assets
6. misconceptions
7. learning resources
8. flashcards
9. prerequisites
10. questions
11. textbook pages
12. content chunks
```

لكن عملياً، إذا كانت `questions` تشير إلى misconceptions، يجب إنشاء misconceptions قبل questions.

والـ `TextbookPage` و`ContentChunk` يجب إنشاؤهما بعد وجود textbook والدرس والمفهوم، لأنهما يحتاجان مفاتيحاً resolved.

---

# الثاني والعشرون: ضوابط عدم مخالفة المعمارية

يجب إضافة هذه التعليمات إلى أي coding task لاحق:

## ممنوع

1. استيراد Prisma من `domain/`.
2. استيراد Prisma من `application/`.
3. استخدام `fs` في `domain/`.
4. استخدام `fs` داخل route.
5. وضع Gemini أو OpenAI مباشرة داخل route.
6. جعل Python يكتب قاعدة البيانات مباشرة.
7. إنشاء مفاتيح canonical يدوياً في Python.
8. استخدام `orderIndex` كهوية.
9. حذف الأسئلة أو المفاهيم عند غيابها من تحديث جديد.
10. تغيير السؤال القديم إذا كان مرتبطاً بأدلة طلاب.
11. نشر محتوى مستورد تلقائياً.
12. إضافة مسار كتابة بديل بجانب `ContentImportService`.
13. جعل `ContentImportService` parser للـ PDF أو Workspace.
14. جعل frontend يقرر صلاحية المحتوى التعليمية.
15. استخدام absolute paths داخل manifests.

## إلزامي

1. كل ملف له checksum.
2. كل path relative.
3. كل lesson JSON يحمل رقم الدرس.
4. كل unit JSON يحمل رقم الوحدة.
5. `index.json` هو entry point.
6. كل استيراد يبدأ بـ dry-run.
7. كل write يمر عبر canonical services.
8. كل AI output يبدأ `DRAFT`.
9. كل update يحافظ على البيانات القديمة.
10. كل duplicate يظهر كـ unchanged أو conflict.
11. كل asset يقدم metadata قابلة للكاش.
12. كل key يشتق من domain identifiers.
13. كل adapter يربط في `src/composition/container.ts`.
14. كل قاعدة business توضع في domain/application، لا route.
15. كل تغيير يضيف tests في نفس الطبقة.

---

# الثالث والعشرون: اختبارات القبول النهائية

## Workspace

- `index.json` موجود في جذر المادة.
- كل وحدة لها `unit_XX.json`.
- كل درس له `lesson_XX.json`.
- أسماء JSON متطابقة مع الأرقام.
- كل المسارات relative.
- كل الملفات لها checksum.
- الملفات المفقودة تظهر كأخطاء blocking.
- تغييرات Workspace تعيد بناء manifest.

## Import

- `dryRun` يقرأ `index.json`.
- الحزمة canonical تمر عبر `ContentImportService`.
- الاستيراد يعيد generated keys.
- إعادة الاستيراد لا تنشئ duplicates.
- الملفات الجديدة تنشئ `ContentAsset`.
- الملفات ذات checksum نفسه تكون `unchanged`.
- الملف ذو نفس slug وchecksum مختلف يظهر conflict أو version جديد.
- اختفاء الملف لا يحذفه من قاعدة البيانات.

## Database

- الكتاب والوحدة والدرس والمفهوم تحفظ في الجداول الحالية.
- PDF لا يحفظ داخل PostgreSQL كـ binary.
- الرابط والchecksum والنسخة تحفظ في `ContentAsset`.
- الموارد تشير إلى الأصول.
- الصفحات والمقاطع تحفظ للـ grounding.
- لا تتأثر mastery/evidence/attempts بالاستيراد.

## Client

- Web يجلب metadata.
- Web ينزل الأصل عند الحاجة.
- Web يستخدم cache.
- Android يستطيع استخدام نفس endpoint.
- `ETag` و`Range` يعملان.
- تغير checksum يؤدي لتنزيل نسخة جديدة.
- learner لا يصل لمحتوى غير منشور أو غير entitled.

## AI

- توليد أسئلة من Workspace يعمل قبل الاستيراد.
- توليد أسئلة من DB يعمل بعد الاستيراد.
- توليد flashcards يعمل.
- توليد image summaries يعمل.
- كل output مرتبط بدرس أو مفهوم.
- evidence يتم التحقق منه فعلياً.
- لا يتم تكرار السؤال.
- لا يتم حذف السؤال القديم.
- الأسئلة الجديدة تكون `DRAFT`.

---

# الخلاصة

التصميم الصحيح ليس:

```text
JSON يحتوي الصور Base64
```

بل:

```text
Lesson/
  lesson_01.json
  resources/
    images/
    summaries/
    readings/
    videos/
  questions.json
  concepts.json
```

و`index.json` في جذر المادة يكون:

```text
المدخل الرئيسي
+ خريطة الملفات
+ ملخص المحتوى
+ checksums
+ الإصدارات
+ روابط الوحدات والدروس
+ رابط الحزمة canonical
```

والتدفق النهائي:

```text
Edu7 Content Engine
  ↓
Workspace كامل بالملفات والموارد
  ↓
index.json
  ↓
Workspace parser
  ↓
ContentPackage
  ↓
dryRun
  ↓
ContentImportService
  ↓
ContentAuthoringService / ItemBankService / ContentAssetService
  ↓
PostgreSQL metadata
  +
Storage files
  ↓
API assets
  ↓
Web / Android cache
```

والتحديث:

```text
Workspace change
  ↓
rebuild index.json
  ↓
compare hashes/fingerprints
  ↓
unchanged / new / conflict
  ↓
preserve old content
  ↓
import only new or explicitly updated content
```

أما التوليد بعد التخزين:

```text
Database lesson content
  ↓
AI enrichment service
  ↓
new DRAFT questions / flashcards / image summaries
  ↓
deduplication
  ↓
review
  ↓
publish
```

بهذا لا يحدث تداخل بين:

- محرك Python.
- Workspace.
- عقد الاستيراد.
- خدمات التطبيق.
- قاعدة البيانات.
- تخزين الملفات.
- واجهة الويب.
- تطبيق Android.
- نظام التعلم التكيفي.