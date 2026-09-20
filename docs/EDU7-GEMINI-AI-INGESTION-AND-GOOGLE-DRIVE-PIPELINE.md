# Edu7 — تكامل محرك Gemini API ومكتبة Google Drive لتغذية المحتوى آلياً
## Native Google Gemini Ingestion & Google Drive Textbook Library Pipeline

**التاريخ:** 2026-09-18  
**الهدف:** دمج مفتاح Google Gemini API برمجياً داخل كود المشروع لتشغيل مهام الاستخراج والتغذية الذكية للمحتوى (مفاهيم، أسئلة، بطاقات، مشتتات، شروحات علاجية) مع إخراج JSON مطابق 100% لمعيار `Edu7 Content Package v1.2`، بالإضافة إلى تخزين صفحات ومقاطع الكتاب في قاعدة البيانات، وجلب الكتب ومعالجتها مباشرة من مكتبة Google Drive.

---

## 1. الرؤية المعمارية وتدفق البيانات (Architectural Flow)

```
       ┌──────────────────────────────┐       ┌──────────────────────────────┐
       │   Google Drive Textbook      │       │     نص الدرس المباشر         │
       │   (PDF Shared Link / File)   │       │   (Raw Lesson Content Text)  │
       └──────────────┬───────────────┘       └──────────────┬───────────────┘
                      │                                      │
                      ▼                                      ▼
       ┌─────────────────────────────────────────────────────────────────────┐
       │             GoogleDriveIngestionAdapter (PDF Stream)                │
       └──────────────────────────────┬──────────────────────────────────────┘
                                      │
                                      ▼
       ┌─────────────────────────────────────────────────────────────────────┐
       │                ContentAiEnrichmentService (Backend)                 │
       │               • Gemini 2.5 Flash (@google/genai)                    │
       │               • Native Multimodal PDF Processing                    │
       │               • Strict JSON Schema Response Formatting              │
       └──────────────────────────────┬──────────────────────────────────────┘
                                      │
                                      ▼
       ┌─────────────────────────────────────────────────────────────────────┐
       │      المخرجات: حزمة محتوى قياسية مهيكلة (Edu7 ContentPackage v1.2)  │
       │   • مفاهيم ذرية (Concepts)      • أسئلة ومشتتات (Questions)         │
       │   • بطاقات ذكية (Flashcards)    • نصوص وموارد علاجية (Remedial)     │
       │   • صفحات ومقاطع (Pages & Chunks لخدمة الـ Grounding)              │
       └──────────────────────────────┬──────────────────────────────────────┘
                                      │
                                      ▼
       ┌─────────────────────────────────────────────────────────────────────┐
       │      محرك الفحص والاعتماد (Dry-Run & Human Verification)            │
       └──────────────────────────────┬──────────────────────────────────────┘
                                      │
                                      ▼
       ┌─────────────────────────────────────────────────────────────────────┐
       │       المسار الأوحد للكتابة: ContentImportService                   │
       │       ➜ TextbookPage + ContentChunk + Hierarchy (Status: DRAFT)     │
       └─────────────────────────────────────────────────────────────────────┘
```

---

## 2. خدمة تغذية المحتوى بالذكاء الاصطناعي (`ContentAiEnrichmentService`)

### 2.1 المهام المدعومة في المحرك (Supported Enrichment Tasks)
تستقبل الخدمة نص الدرس أو مقاطع صفحات الكتاب وتستدعي Gemini لتوليد:
1. **المفاهيم الذرية (`Concepts`):** استخراج المفاهيم المستهدفة مع نواتج التعلم ومستوى الصعوبة وعتبة الإتقان.
2. **الأسئلة المتوافقة مع المنهج (`Questions`):** توليد أسئلة اختيار من متعدد، صح وخطأ، أو أسئلة مقالية مع Rubric وشرح وتلميح.
3. **الأخطاء الشائعة والمشتتات (`Misconceptions & Distractors`):** ربط كل خيار خاطئ بسبب فهم خاطئ محدد وموثق.
4. **البطاقات الذكية (`Flashcards`):** وجه وظهر وتلميح موجز لكل مفهوم لترسيخ الذاكرة.
5. **الموارد العلاجية (`Remedial Resources`):** نصوص تصويبية وخطوات معالجة لكل خطأ شائع.
6. **مقاطع التأصيل المعرفي (`Grounding Chunks`):** تفريغ نصوص الشرح وحفظها في `ContentChunk` لدعم المساعد الذكي.

### 2.2 عقد الـ JSON Schema الإلزامي لـ Gemini
نستخدم ميزة `responseMimeType: 'application/json'` مع `responseSchema` في SDK `@google/genai` لفرض إخراج JSON مهيكل دون أي أخطاء صياغة:

```ts
// src/contexts/content/application/ai-content-schema.ts

export const EDU7_CONTENT_ENRICHMENT_JSON_SCHEMA = {
  type: 'OBJECT',
  properties: {
    concepts: {
      type: 'ARRAY',
      description: 'المفاهيم الذرية المستخرجة من محتوى الدرس',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING', description: 'اسم المفهوم باللغة العربية' },
          description: { type: 'STRING', description: 'شرح المفهوم وناتج التعلم' },
          difficulty: { type: 'NUMBER', description: 'درجة الصعوبة من 0.1 إلى 1.0' },
          masteryThreshold: { type: 'NUMBER', description: 'عتبة الإتقان (افتراضي 0.8)' },
          isCore: { type: 'BOOLEAN', description: 'هل المفهوم أساسي أم إثرائي' },
        },
        required: ['name', 'description', 'difficulty', 'masteryThreshold', 'isCore'],
      },
    },
    misconceptions: {
      type: 'ARRAY',
      description: 'الأخطاء الشائعة وسوء الفهم المرتبط بالمفاهيم',
      items: {
        type: 'OBJECT',
        properties: {
          conceptName: { type: 'STRING', description: 'اسم المفهوم المرتبط به الخطأ' },
          name: { type: 'STRING', description: 'اسم الخطأ الشائع' },
          description: { type: 'STRING', description: 'وصف الفهم الخاطئ' },
          correction: { type: 'STRING', description: 'طريقة التصويب التربوية والشرح السليم' },
        },
        required: ['conceptName', 'name', 'description', 'correction'],
      },
    },
    questions: {
      type: 'ARRAY',
      description: 'الأسئلة والتمارين المقترحة',
      items: {
        type: 'OBJECT',
        properties: {
          conceptName: { type: 'STRING', description: 'اسم المفهوم الذي يقيسه السؤال' },
          type: { type: 'STRING', enum: ['MCQ_SINGLE', 'TRUE_FALSE', 'SHORT_TEXT', 'ESSAY'] },
          text: { type: 'STRING', description: 'نص السؤال' },
          hint: { type: 'STRING', description: 'تلميح لمساعدة الطالب' },
          explanation: { type: 'STRING', description: 'شرح وتفسير الإجابة الصحيحة' },
          difficulty01: { type: 'NUMBER', description: 'صعوبة السؤال من 0.1 إلى 1.0' },
          choices: {
            type: 'ARRAY',
            description: 'خيارات الإجابة',
            items: {
              type: 'OBJECT',
              properties: {
                id: { type: 'STRING', description: 'معرف الخيار مثلا c1, c2' },
                text: { type: 'STRING', description: 'نص الخيار' },
                misconceptionName: { type: 'STRING', description: 'اسم الخطأ الشائع إن وجد للمشتت' },
              },
              required: ['id', 'text'],
            },
          },
          correctChoiceId: { type: 'STRING', description: 'معرف الخيار الصحيح المطابق لأحد الخيارات' },
          rubric: { type: 'STRING', description: 'معيار التصحيح إذا كان السؤال مقالياً' },
        },
        required: ['conceptName', 'type', 'text', 'explanation', 'difficulty01'],
      },
    },
    flashcards: {
      type: 'ARRAY',
      description: 'البطاقات الذكية للمراجعة السريعة',
      items: {
        type: 'OBJECT',
        properties: {
          conceptName: { type: 'STRING', description: 'اسم المفهوم' },
          front: { type: 'STRING', description: 'وجه البطاقة (سؤال أو مصطلح)' },
          back: { type: 'STRING', description: 'ظهر البطاقة (إجابة أو تعريف موجز)' },
          hint: { type: 'STRING', description: 'تلميح للمساعدة' },
        },
        required: ['conceptName', 'front', 'back'],
      },
    },
    remedialResources: {
      type: 'ARRAY',
      description: 'الموارد والشروحات العلاجية الموجهة',
      items: {
        type: 'OBJECT',
        properties: {
          conceptName: { type: 'STRING', description: 'اسم المفهوم' },
          title: { type: 'STRING', description: 'عنوان المورد العلاجي' },
          body: { type: 'STRING', description: 'نص الشرح العلاجي المكثف' },
        },
        required: ['conceptName', 'title', 'body'],
      },
    },
  },
  required: ['concepts', 'questions', 'flashcards', 'misconceptions'],
};
```

---

## 3. التنفيذ البرمجي لخدمة `ContentAiEnrichmentService`

```ts
// src/contexts/content/application/content-ai-enrichment.service.ts

import { GoogleGenAI } from '@google/genai';
import { Errors } from '../../../shared/kernel/errors.js';
import { Err, Ok, type Result } from '../../../shared/kernel/result.js';
import { EDU7_CONTENT_ENRICHMENT_JSON_SCHEMA } from './ai-content-schema.js';
import type { ContentPackage } from '../domain/export-profile.js';

export interface EnrichmentRequest {
  readonly lessonName: string;
  readonly lessonText: string;
  readonly gradeName?: string;
  readonly subjectName?: string;
  readonly targetQuestionCount?: number;
}

export class ContentAiEnrichmentService {
  private client: GoogleGenAI | null = null;
  private readonly modelName: string;

  constructor(private readonly apiKey: string | undefined, model?: string) {
    this.modelName = model ?? 'gemini-2.5-flash';
  }

  private getClient(): GoogleGenAI {
    if (!this.apiKey || !this.apiKey.trim() || this.apiKey.startsWith('YOUR_')) {
      throw new Error('GEMINI_API_KEY is missing or invalid.');
    }
    if (!this.client) {
      this.client = new GoogleGenAI({ apiKey: this.apiKey });
    }
    return this.client;
  }

  /**
   * تغذية درس مدرسي واستخراج كافة المفاهيم والأسئلة والبطاقات والأخطاء الشائعة كحزمة مهيكلة
   */
  async enrichLessonContent(request: EnrichmentRequest): Promise<Result<any>> {
    try {
      const client = this.getClient();

      const systemInstruction = `
أنت كبير خبراء هندسة المناهج والقياس التربوي في منصة Edu7.
مهمتك تحليل نص الدرس المرفق وتوليد محتوى تعليمي ذكي متكامل مطابق للمعايير التربوية العالمية.
القواعد الصارمة:
1. استخرج المفاهيم التعليمية الذرية الدقيقة الموجودة فعلاً في الدرس.
2. ولد أسئلة تقيس الفهم والتطبيق مع صياغة خيارات ممتازة.
3. اربط الخيارات الخاطئة بأخطاء شائعة واقعية يقع فيها الطلاب مع توفير التصويب.
4. صغ بطاقات مراجعة ذكية (Flashcards) مركزة وواضحة.
5. وفر نصوصاً علاجية مكثفة للمفاهيم الصعبة.
6. التزم باللغة العربية الفصحى السليمة وأخرج النتيجة حصرياً ككائن JSON مطابق للمخطط المحدد.
`;

      const userPrompt = `
المادة: ${request.subjectName ?? 'عام'}
الصف: ${request.gradeName ?? 'عام'}
عنوان الدرس: ${request.lessonName}
العدد المستهدف للأسئلة: ${request.targetQuestionCount ?? 5}

محتوى ونصوص الدرس:
-------------------
${request.lessonText}
`;

      const response = await client.models.generateContent({
        model: this.modelName,
        contents: userPrompt,
        config: {
          systemInstruction,
          temperature: 0.2, // دقة تربوية دون انحراف
          maxOutputTokens: 4000,
          responseMimeType: 'application/json',
          responseSchema: EDU7_CONTENT_ENRICHMENT_JSON_SCHEMA as any,
        },
      });

      const rawJson = response.text?.();
      if (!rawJson) {
        return Err(Errors.technical('ai.empty_response', 'لم يتم استلام رد من محرك الذكاء الاصطناعي.'));
      }

      const parsed = JSON.parse(rawJson);
      return Ok(parsed);
    } catch (error: any) {
      return Err(Errors.technical('ai.enrichment_failed', `فشلت عملية التغذية بالذكاء الاصطناعي: ${error.message}`));
    }
  }
}
```

---

## 4. تكامل مكتبة كتب Google Drive والمعالجة المباشرة للـ PDF

### 4.1 التحدي والحل المعماري
- **التحدي:** استخراج نصوص الكتب المدرسية من ملفات الـ PDF المخزنة على Google Drive غالباً ما يتطلب أدوات OCR معقدة ومكلفة وتفشل مع النصوص العربية والرياضيات.
- **الحل:** استغلال قدرات **Gemini 2.5 Flash المتعددة الوسائط (Multimodal PDF Processing)** حيث يستطيع قراءة وتفسير ملف PDF العربي كاملاً بصفحاته ومعادلاته ورسوماته مباشرة عبر الـ Stream أو `inlineData`!

### 4.2 محول مكتبة Google Drive (`GoogleDriveIngestionAdapter`)

```ts
// src/infrastructure/content/google-drive-ingestion.adapter.ts

import { GoogleGenAI } from '@google/genai';
import { Errors } from '../../shared/kernel/errors.js';
import { Err, Ok, type Result } from '../../shared/kernel/result.js';
import { EDU7_CONTENT_ENRICHMENT_JSON_SCHEMA } from '../../contexts/content/application/ai-content-schema.js';

export class GoogleDriveIngestionAdapter {
  private client: GoogleGenAI;

  constructor(apiKey: string) {
    this.client = new GoogleGenAI({ apiKey });
  }

  /**
   * استخراج معرف الملف من رابط Google Drive المشترك
   */
  extractFileId(driveUrlOrId: string): string | null {
    if (/^[a-zA-Z0-9_-]{25,}$/.test(driveUrlOrId)) {
      return driveUrlOrId;
    }
    const match = driveUrlOrId.match(/\/d\/([a-zA-Z0-9_-]+)/) || driveUrlOrId.match(/id=([a-zA-Z0-9_-]+)/);
    return match ? match[1] : null;
  }

  /**
   * تحميل ملف PDF من Google Drive وتحويله لـ Buffer
   */
  async downloadPdfBuffer(fileId: string): Promise<Buffer> {
    const downloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
    const response = await fetch(downloadUrl);
    if (!response.ok) {
      throw new Error(`تعذر تنزيل الملف من Google Drive (HTTP ${response.status})`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /**
   * معالجة صفحات الكتاب مباشرة من Google Drive واستخراج المحتوى التعليمي عبر Gemini
   */
  async processDriveTextbookPdf(
    driveUrlOrId: string,
    options: {
      textbookTitle: string;
      startPage?: number;
      endPage?: number;
    }
  ): Promise<Result<any>> {
    try {
      const fileId = this.extractFileId(driveUrlOrId);
      if (!fileId) {
        return Err(Errors.validation('drive.invalid_url', 'رابط Google Drive غير صالح.'));
      }

      // تنزيل ملف الـ PDF من Google Drive
      const pdfBuffer = await this.downloadPdfBuffer(fileId);
      const base64Pdf = pdfBuffer.toString('base64');

      const prompt = `
أنت المحلل المعتمد لمناهج Edu7.
أمامك ملف PDF لكتاب مدرسي من مكتبة Google Drive: "${options.textbookTitle}".
قم بتحليل الصفحات واستخراج الهيكل التعليمي للدروس المتضمنة:
- استخرج المفاهيم التعليمية الأساسية.
- استخرج بنك الأسئلة والتمارين مع تحديد الإجابات الصحيحة.
- استخرج الأخطاء الشائعة والمشتتات.
- صغ بطاقات ذكية لكل مفهوم.
أخرج النتيجة كـ JSON مطابق للمخطط المحدد بدقة تامة.
`;

      const response = await this.client.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [
          {
            inlineData: {
              mimeType: 'application/pdf',
              data: base64Pdf,
            },
          },
          prompt,
        ],
        config: {
          temperature: 0.1,
          responseMimeType: 'application/json',
          responseSchema: EDU7_CONTENT_ENRICHMENT_JSON_SCHEMA as any,
        },
      });

      const resultText = response.text?.();
      if (!resultText) {
        return Err(Errors.technical('ai.empty_drive_response', 'لم يتم استخراج محتوى من ملف الكتاب.'));
      }

      return Ok(JSON.parse(resultText));
    } catch (err: any) {
      return Err(Errors.technical('drive.processing_failed', `فشلت معالجة كتاب Google Drive: ${err.message}`));
    }
  }
}
```

---

## 5. تخزين صفحات ومقاطع الكتاب (`TextbookPage` & `ContentChunk`) لخدمة الـ Grounding

لتمكين المساعد الذكي (`TutorDrawer`) من الإجابة الموثقة مع ذكر رقم الصفحة واقتباس النصوص الأصلية، يتم تفريغ وتخزين محتوى الكتاب في الجداول المخصصة في قاعدة البيانات:

```ts
// src/contexts/content/application/textbook-grounding-ingestion.ts

import type { PrismaClient } from '@prisma/client';
import { stableKeyFingerprint } from '../../../shared/kernel/identifiers.js';

export async function storeTextbookPagesAndChunks(
  prisma: PrismaClient,
  textbookId: string,
  pages: Array<{
    pageNumber: number;
    text: string;
    chunks: Array<{
      lessonKey?: string;
      conceptKey?: string;
      text: string;
      ordinal: number;
    }>;
  }>
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    for (const p of pages) {
      // 1. حفظ أو تحديث صفحة الكتاب
      const pageRecord = await tx.textbookPage.upsert({
        where: {
          textbookId_pageNumber: {
            textbookId,
            pageNumber: p.pageNumber,
          },
        },
        update: { text: p.text },
        create: {
          textbookId,
          pageNumber: p.pageNumber,
          text: p.text,
        },
      });

      // 2. حفظ مقاطع التأصيل المعرفي المرتبطة بالدرس والمفهوم
      for (const c of p.chunks) {
        const chunkKey = `CHK-${pageRecord.id.slice(0, 8)}-${stableKeyFingerprint(c.text)}`;
        await tx.contentChunk.upsert({
          where: { key: chunkKey },
          update: {
            text: c.text,
            lessonKey: c.lessonKey,
            conceptKey: c.conceptKey,
            ordinal: c.ordinal,
          },
          create: {
            key: chunkKey,
            pageId: pageRecord.id,
            lessonKey: c.lessonKey,
            conceptKey: c.conceptKey,
            text: c.text,
            ordinal: c.ordinal,
          },
        });
      }
    }
  });
}
```

---

## 6. نقاط النهاية المتاحة في الـ API (`HTTP Routes`)

تم ربط هذه الخدمات بنقاط نهاية آمنة مخصصة للمشرفين والمؤلفين:

| الطريقة | المسار (Route) | الوظيفة | المدخلات |
|---|---|---|---|
| `POST` | `/api/v1/content/ai/enrich-lesson` | استخراج وتوليد محتوى متكامل لدرس عبر Gemini | `{ lessonName, lessonText, subjectName, gradeName }` |
| `POST` | `/api/v1/content/ai/ingest-drive-book` | سحب ومعالجة كتاب PDF كامل من Google Drive | `{ driveUrl, textbookTitle, targetTextbookKey }` |
| `POST` | `/api/v1/content/ai/generate-questions` | توليد أسئلة موجهة لمفهوم معين مع مشتتات | `{ conceptKey, lessonKey, count, difficulty }` |
| `POST` | `/api/v1/content/textbooks/:key/pages` | حقن وتخزين صفحات ومقاطع التأصيل المعرفي للكتاب | `{ pages: [{ pageNumber, text, chunks }] }` |

---

## 7. واجهة المستخدم التفاعلية (Frontend Integration)

### 7.1 زر "التغذية الذكية عبر الذكاء الاصطناعي" في صفحة الدرس
داخل محرر الدرس في شاشة إدارة المحتوى (`web/src/pages/admin/content-setup.tsx`):
- يظهر زر أنيق: **[⚡ توليد وتغذية المحتوى بالذكاء الاصطناعي]**.
- عند النقر، يفتح مودال `ActionModal` يسمح للمعلم بلصق نص الدرس أو صفحات الشرح والضغط على "توليد".
- يظهر شريط تقدم تفاعلي: *"استخراج المفاهيم... توليد الأسئلة... بناء البطاقات الذكية..."*.
- تُعرض مسودة المخرجات للمراجعة الفورية بنقرة واحدة لاعتمادها وحقنها كـ `DRAFT`.

### 7.2 نافذة استيراد كتب Google Drive بنقرة واحدة
داخل شاشة إدارة الكتب (`web/src/pages/admin/textbooks-admin.tsx`):
- زر: **[📁 استيراد من مكتبة Google Drive]**.
- يدخل المشرف رابط المجلد أو رابط ملف الـ PDF.
- يتولى الباك إند تنزيل الكتاب وتمريره لـ Gemini 2.5 Flash، وحفظ الصفحات والمقاطع وهيكل الدروس آلياً في النظام.
