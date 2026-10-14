import { GoogleGenAI } from '@google/genai';
import type {
  TextbookIndexDocument,
  TextbookIndexUnit,
  TextbookIndexLesson,
} from '../../contexts/content/domain/content-engine/index-contract.js';
import { extractCoverPage, extractTocPages, extractCoverAndTocPages } from './pdf-slicer.js';

export interface GeminiContentEngineConfig {
  readonly apiKey?: string;
  readonly model?: string;
}

export interface CoverMetadata {
  readonly subjectKey: string;
  readonly gradeKey: string;
  readonly part: 'PART_1' | 'PART_2' | 'BOTH' | 'unknown';
  readonly edition: string;
  readonly title: string;
  readonly issuer?: string | null;
  readonly printingYear?: number | null;
}

export interface UnifiedBookAnalysisResult {
  readonly book: CoverMetadata;
  readonly detectedPageOffset?: number | null;
  readonly firstLessonPhysicalPage?: number | null;
  readonly firstLessonPrintedPage?: number | null;
  readonly units: ReadonlyArray<RawTocUnit>;
}

export interface RawTocLesson {
  readonly number: number;
  readonly title: string;
  readonly slug: string;
  readonly orderIndex: number;
  readonly printedStartPage: number;
  readonly printedEndPage?: number | null;
}

export interface RawTocUnit {
  readonly number: number;
  readonly title: string;
  readonly slug: string;
  readonly orderIndex: number;
  readonly lessons: ReadonlyArray<RawTocLesson>;
}

export interface RawTocDocument {
  readonly units: ReadonlyArray<RawTocUnit>;
  readonly detectedPageOffset?: number | null;
  readonly firstLessonPhysicalPage?: number | null;
  readonly firstLessonPrintedPage?: number | null;
}

export interface ExtractedConcept {
  readonly name: string;
  readonly slug: string;
  readonly description?: string;
  readonly difficulty: number;
  readonly threshold: number;
  readonly misconceptions: ReadonlyArray<{
    readonly name: string;
    readonly slug: string;
    readonly description: string;
    readonly remediation: string;
  }>;
}

export interface ExtractedQuestion {
  readonly text: string;
  readonly type: 'MCQ_SINGLE' | 'TRUE_FALSE' | 'SHORT_ANSWER';
  readonly difficulty01: number;
  readonly points: number;
  readonly explanation?: string;
  readonly hint?: string;
  readonly choices: ReadonlyArray<{
    readonly id: string;
    readonly text: string;
    readonly correct: boolean;
    readonly misconceptionSlug?: string;
  }>;
}

const CANONICAL_SUBJECT_KEYS = [
  'MATH',
  'ARAB',
  'ENG',
  'SCI',
  'ISL',
  'QURAN',
  'CIV',
  'PHYS',
  'CHEM',
  'BIO',
  'HIST',
  'GEO',
  'ART',
] as const;

export function normalizeSubjectKey(raw?: string | null): string {
  if (!raw) return 'SCI';
  const clean = raw.trim().toUpperCase();
  if ((CANONICAL_SUBJECT_KEYS as readonly string[]).includes(clean)) return clean;

  const text = raw.toLowerCase();
  if (text.includes('رياضيات') || text.includes('math')) return 'MATH';
  if (text.includes('عربي') || text.includes('لغة عربية') || text.includes('arab')) return 'ARAB';
  if (text.includes('إنجليز') || text.includes('انجليز') || text.includes('english') || text.includes('eng')) return 'ENG';
  if (text.includes('علوم') || text.includes('علمي') || text.includes('science') || text.includes('sci')) return 'SCI';
  if (text.includes('إسلام') || text.includes('اسلام') || text.includes('دين') || text.includes('isl')) return 'ISL';
  if (text.includes('قرآن') || text.includes('قران') || text.includes('تلاوة') || text.includes('quran')) return 'QURAN';
  if (text.includes('وطنية') || text.includes('اجتماع') || text.includes('civ')) return 'CIV';
  if (text.includes('فيزياء') || text.includes('phys')) return 'PHYS';
  if (text.includes('كيمياء') || text.includes('chem')) return 'CHEM';
  if (text.includes('أحياء') || text.includes('احياء') || text.includes('bio')) return 'BIO';
  if (text.includes('تاريخ') || text.includes('hist')) return 'HIST';
  if (text.includes('جغرافيا') || text.includes('geo')) return 'GEO';
  if (text.includes('فنون') || text.includes('رسم') || text.includes('art')) return 'ART';

  return 'SCI';
}

export function normalizeGradeKey(raw?: string | null): string {
  if (!raw) return 'G07';
  const clean = raw.trim().toUpperCase();
  if (/^G0?[1-9]$|^G1[0-2]$/.test(clean)) {
    const num = parseInt(clean.replace('G', ''), 10);
    return `G${String(num).padStart(2, '0')}`;
  }
  const match = raw.match(/\d+/);
  if (match) {
    const num = parseInt(match[0], 10);
    if (num >= 1 && num <= 12) return `G${String(num).padStart(2, '0')}`;
  }
  if (raw.includes('أول') || raw.includes('اول')) return 'G01';
  if (raw.includes('ثان')) return 'G02';
  if (raw.includes('ثالث')) return 'G03';
  if (raw.includes('رابع')) return 'G04';
  if (raw.includes('خامس')) return 'G05';
  if (raw.includes('سادس')) return 'G06';
  if (raw.includes('سابع')) return 'G07';
  if (raw.includes('ثامن')) return 'G08';
  if (raw.includes('تاسع')) return 'G09';
  if (raw.includes('عاشر')) return 'G10';
  if (raw.includes('حادي')) return 'G11';
  if (raw.includes('ثاني عشر')) return 'G12';
  return 'G07';
}

export class GeminiContentEngine {
  private client: GoogleGenAI | null = null;
  private readonly model: string;

  constructor(private readonly config: GeminiContentEngineConfig) {
    const raw = config.model ?? 'gemini-3.5-flash';
    // Defaults to gemini-3.5-flash for rapid, lightweight multimodal inference
    this.model = raw.includes('2.5') ? 'gemini-3.5-flash' : raw;
  }

  getModelName(): string {
    return this.model;
  }

  isAvailable(): boolean {
    const key = this.config.apiKey;
    return Boolean(key && key.trim() && !key.startsWith('YOUR_'));
  }

  private getClient(): GoogleGenAI {
    if (!this.client) {
      if (!this.isAvailable()) {
        throw new Error('Gemini API key is not configured for Content Engine.');
      }
      this.client = new GoogleGenAI({ apiKey: this.config.apiKey! });
    }
    return this.client;
  }

  private async generateWithFallback(
    client: GoogleGenAI,
    params: {
      contents: Array<any>;
      config?: Record<string, unknown>;
    },
  ) {
    const primaryModel = this.model;
    const secondaryModel = primaryModel === 'gemini-3.5-flash' ? 'gemini-3.8-flash' : 'gemini-3.5-flash';

    try {
      return await client.models.generateContent({
        model: primaryModel,
        ...params,
      });
    } catch (err: any) {
      const isTemporary =
        err?.status === 'UNAVAILABLE' ||
        err?.code === 503 ||
        err?.status === 503 ||
        String(err?.message || '').includes('503') ||
        String(err?.message || '').includes('high demand');

      if (isTemporary) {
        console.warn(
          `[GeminiContentEngine] Model ${primaryModel} is experiencing temporary high demand (503). Retrying with alternative model ${secondaryModel}...`,
        );
        return await client.models.generateContent({
          model: secondaryModel,
          ...params,
        });
      }
      throw err;
    }
  }

  /**
   * Step 1: Extracts cover page metadata (Subject, Grade, Part/Semester, Edition, Title).
   */
  async extractCoverMetadata(
    coverPdfBuffer: Buffer,
    declared?: { subjectKey?: string; gradeKey?: string; part?: string; edition?: string; title?: string },
  ): Promise<CoverMetadata> {
    if (!this.isAvailable()) {
      return this.fallbackCoverMetadata(declared);
    }

    const client = this.getClient();
    const prompt = `
أنت خبير في التعرف على أغلفة الكتب المدرسية والمناهج التعليمية (خاصة المنهج اليمني والعربي).
المهمة: تحليل صفحة الغلاف الأولى فقط واستخراج البيانات التعريفية للكتاب بدقة.

قائمة المواد المعتمدة في النظام حصراً:
- MATH (الرياضيات)
- SCI (العلوم)
- ARAB (اللغة العربية / لغتي العربية / القراءة والنصوص)
- ENG (اللغة الإنجليزية / English)
- ISL (التربية الإسلامية / الفقه / التوحيد / الحديث)
- QURAN (القرآن الكريم وتجويده)
- CIV (التربية الوطنية والاجتماعية)
- PHYS (الفيزياء)
- CHEM (الكيمياء)
- BIO (الأحياء)
- HIST (التاريخ)
- GEO (الجغرافيا)
- ART (التربية الفنية)

الصفوف: G01 إلى G12 (مثال: G04 للصف الرابع، G07 للصف السابع، G09 للتاسع).
الفصل / الجزء الدراسي:
- PART_1 (الجزء الأول أو الفصل الدراسي الأول)
- PART_2 (الجزء الثاني أو الفصل الدراسي الثاني)
- BOTH (كتاب موحد أو يحتوي الجزئين معاً)

المطلوب إرجاعه بدقة ككائن JSON فقط:
{
  "subjectKey": "SCI", // كود المادة المعتمد من القائمة أعلاه
  "gradeKey": "G07", // كود الصف
  "part": "PART_1" | "PART_2" | "BOTH" | "unknown",
  "edition": "2024", // سنة أو رقم الطبعة
  "title": "عنوان الكتاب كما يظهر على الغلاف",
  "issuer": "وزارة التربية والتعليم",
  "printingYear": 2024
}
`;

    try {
      const response = await this.generateWithFallback(client, {
        contents: [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  mimeType: 'application/pdf',
                  data: coverPdfBuffer.toString('base64'),
                },
              },
              { text: prompt },
            ],
          },
        ],
        config: {
          responseMimeType: 'application/json',
          temperature: 0.1,
        },
      });

      const parsed = JSON.parse(response.text?.trim() || '{}');
      return {
        subjectKey: normalizeSubjectKey(declared?.subjectKey || parsed.subjectKey),
        gradeKey: normalizeGradeKey(declared?.gradeKey || parsed.gradeKey),
        part: (declared?.part === 'PART_2' || declared?.part === 'P02')
          ? 'PART_2'
          : (declared?.part === 'BOTH' || declared?.part === 'PB')
            ? 'BOTH'
            : (parsed.part === 'PART_2' || parsed.part === 'BOTH')
              ? parsed.part
              : 'PART_1',
        edition: declared?.edition || parsed.edition || '2026',
        title: declared?.title || parsed.title || 'الكتاب المدرسي',
        issuer: parsed.issuer || 'وزارة التربية والتعليم',
        printingYear: Number(parsed.printingYear) || 2026,
      };
    } catch (err) {
      console.warn('[GeminiContentEngine] extractCoverMetadata failed, using fallback:', err);
      return this.fallbackCoverMetadata(declared);
    }
  }

  /**
   * Step 2: Extracts the Table of Contents from pages 4 to 12.
   * Prompts Gemini to extract printed page numbers and estimate the page offset between printed and physical pages.
   */
  async extractTableOfContents(
    tocPdfBuffer: Buffer,
    options: {
      cover: CoverMetadata;
      totalPhysicalPages: number;
      tocPhysicalStart: number;
      tocPhysicalEnd: number;
    },
  ): Promise<RawTocDocument> {
    if (!this.isAvailable()) {
      return this.fallbackRawToc(options.totalPhysicalPages, options.tocPhysicalEnd);
    }

    const client = this.getClient();
    const prompt = `
أنت محلل مناهج متخصص في قراءة فهارس الكتب المدرسية.
أمامك صفحات الفهرس (المقتطعة من الصفحات الفيزيائية ${options.tocPhysicalStart} إلى ${options.tocPhysicalEnd} من ملف الـ PDF الأصلي).
بيانات الكتاب:
- المادة: ${options.cover.subjectKey}
- الصف: ${options.cover.gradeKey}
- إجمالي عدد صفحات ملف الـ PDF الأصلي: ${options.totalPhysicalPages}

المطلوب استخراج هيكل الوحدات والدروس من الفهرس مع تحديد أرقام الصفحات المطبوعة (Printed Page Numbers) كما هي مسجلة في الفهرس:
ملاحظة هامة جداً حول فارق الترقيم (Page Offset):
- رقم الصفحة المكتوب في الفهرس هو "رقم الصفحة المطبوعة بالكتاب".
- عادة ما تبدأ الصفحة المطبوعة رقم 1 بعد صفحات الغلاف والمقدمة والفهرس (مثلاً عند الصفحة الفيزيائية ${options.tocPhysicalEnd + 1} تقريباً).
- حدد التقدير التقريبي لفارق الترقيم (pageOffset = physicalPage - printedPage) إن تمكنت من ملاحظة بداية أول درس.

المطلوب إرجاعه كـ JSON حصراً مطابق للمخطط:
{
  "detectedPageOffset": 8, // فارق الترقيم التقديري (الصفحة الفيزيائية ناقص الصفحة المطبوعة)
  "firstLessonPhysicalPage": 13, // الصفحة الفيزيائية التقريبية لبداية أول درس إن أمكن
  "firstLessonPrintedPage": 5, // الصفحة المطبوعة المكتوبة لأول درس
  "units": [
    {
      "number": 1,
      "title": "عنوان الوحدة الأولى",
      "slug": "unit-1",
      "orderIndex": 1,
      "lessons": [
        {
          "number": 1,
          "title": "عنوان الدرس الأول",
          "slug": "lesson-1",
          "orderIndex": 1,
          "printedStartPage": 5, // رقم الصفحة المطبوعة في الفهرس
          "printedEndPage": 14   // رقم صفحة نهاية الدرس أو الصفحة التي قبل الدرس التالي
        }
      ]
    }
  ]
}
قواعد صارمة:
- ارجع JSON فقط بدون أي علامات markdown.
- التزم بترتيب الدروس كما وردت في الفهرس.
`;

    try {
      const response = await this.generateWithFallback(client, {
        contents: [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  mimeType: 'application/pdf',
                  data: tocPdfBuffer.toString('base64'),
                },
              },
              { text: prompt },
            ],
          },
        ],
        config: {
          responseMimeType: 'application/json',
          temperature: 0.1,
        },
      });

      const parsed = JSON.parse(response.text?.trim() || '{}') as RawTocDocument;
      if (parsed.units && parsed.units.length > 0) {
        return parsed;
      }
      return this.fallbackRawToc(options.totalPhysicalPages, options.tocPhysicalEnd);
    } catch (err) {
      console.warn('[GeminiContentEngine] extractTableOfContents failed, using fallback:', err);
      return this.fallbackRawToc(options.totalPhysicalPages, options.tocPhysicalEnd);
    }
  }

  /**
   * Step 3: Reconciles page numbers by calculating the offset between printed and physical PDF pages.
   * Produces the canonical TextbookIndexDocument with validated physicalStartPage and physicalEndPage for every lesson.
   */
  reconcilePageNumbersAndOffset(
    rawToc: RawTocDocument,
    cover: CoverMetadata,
    totalPhysicalPages: number,
    tocPhysicalEnd = 12,
  ): TextbookIndexDocument {
    // 1. Calculate the page offset (فارق الترقيم)
    let pageOffset = 0;

    const firstUnit = rawToc.units[0];
    const firstLesson = firstUnit?.lessons[0];
    const firstPrinted = firstLesson?.printedStartPage || rawToc.firstLessonPrintedPage || 1;

    if (
      typeof rawToc.detectedPageOffset === 'number' &&
      rawToc.detectedPageOffset >= 0 &&
      firstPrinted + rawToc.detectedPageOffset <= totalPhysicalPages
    ) {
      pageOffset = rawToc.detectedPageOffset;
    } else if (
      typeof rawToc.firstLessonPhysicalPage === 'number' &&
      rawToc.firstLessonPhysicalPage > firstPrinted
    ) {
      pageOffset = rawToc.firstLessonPhysicalPage - firstPrinted;
    } else {
      // Heuristic fallback: lessons begin immediately after the preliminary & TOC section
      const estimatedFirstPhysical = Math.min(totalPhysicalPages, tocPhysicalEnd + 1);
      pageOffset = Math.max(0, estimatedFirstPhysical - firstPrinted);
    }

    // Safety bounds check for pageOffset
    if (firstPrinted + pageOffset > totalPhysicalPages) {
      pageOffset = Math.max(0, totalPhysicalPages - 30);
    }

    // 2. Map units and lessons with reconciled physical bounds
    const units: TextbookIndexUnit[] = [];
    let lastPhysicalEnd = 0;

    for (const [uIdx, u] of rawToc.units.entries()) {
      const uNum = u.number || uIdx + 1;
      const uSlug = u.slug || `unit-${uNum}`;
      const lessons: TextbookIndexLesson[] = [];

      for (const [lIdx, l] of u.lessons.entries()) {
        const lNum = l.number || lIdx + 1;
        const lSlug = l.slug || `lesson-${lNum}`;

        const printedStart = Math.max(1, l.printedStartPage || 1);
        let physicalStart = Math.max(1, Math.min(totalPhysicalPages, printedStart + pageOffset));

        // Ensure non-overlapping monotonicity with previous lesson
        if (physicalStart <= lastPhysicalEnd) {
          physicalStart = Math.min(totalPhysicalPages, lastPhysicalEnd + 1);
        }

        let physicalEnd: number;
        if (l.printedEndPage && l.printedEndPage >= printedStart) {
          physicalEnd = Math.max(physicalStart, Math.min(totalPhysicalPages, l.printedEndPage + pageOffset));
        } else {
          // Default lesson length 6 pages
          physicalEnd = Math.min(totalPhysicalPages, physicalStart + 6);
        }

        lessons.push({
          number: lNum,
          title: l.title || `الدرس ${lNum}`,
          slug: lSlug,
          orderIndex: l.orderIndex || lNum,
          pages: {
            physicalStartPage: physicalStart,
            physicalEndPage: physicalEnd,
            printedStartPage: printedStart,
            printedEndPage: l.printedEndPage ?? (printedStart + (physicalEnd - physicalStart)),
          },
        });

        lastPhysicalEnd = physicalEnd;
      }

      units.push({
        number: uNum,
        title: u.title || `الوحدة ${uNum}`,
        slug: uSlug,
        orderIndex: u.orderIndex || uNum,
        lessons,
      });
    }

    // 3. Post-pass: adjust consecutive lesson ends within each unit
    for (const unit of units) {
      for (let i = 0; i < unit.lessons.length - 1; i++) {
        const curr = unit.lessons[i]!;
        const next = unit.lessons[i + 1]!;
        if (curr.pages.physicalEndPage >= next.pages.physicalStartPage) {
          const adjustedEnd = Math.max(curr.pages.physicalStartPage, next.pages.physicalStartPage - 1);
          (curr.pages as { physicalEndPage: number }).physicalEndPage = adjustedEnd;
        }
      }
    }

    return {
      schemaVersion: '1.0',
      stage: 'STRUCTURE_ONLY',
      textbook: {
        gradeKey: cover.gradeKey,
        subjectKey: cover.subjectKey,
        part: cover.part === 'PART_2' ? 'P02' : cover.part === 'BOTH' ? 'BOTH' : 'P01',
        title: cover.title,
        edition: cover.edition,
      },
      source: {
        fileName: 'source-textbook.pdf',
        sha256: '',
        physicalPageCount: totalPhysicalPages,
      },
      units,
      importScope: {
        units: true,
        lessons: true,
        concepts: false,
        questions: false,
        resources: false,
      },
    };
  }

  /**
   * Unified single-call analysis:
   * Slices pages 1 through 12 (Cover, Preliminaries, and Table of Contents) all in ONE go,
   * sends them in a single prompt to Gemini, and extracts book identity, edition, grade,
   * subject, semester/part, units/lessons TOC, and calculates pageOffset.
   */
  async analyzeCoverAndTocUnified(
    coverAndTocPdfBuffer: Buffer,
    options: {
      totalPhysicalPages: number;
      sampleStartPage: number;
      sampleEndPage: number;
      declared?: { subjectKey?: string; gradeKey?: string; part?: string; edition?: string; title?: string };
    },
  ): Promise<UnifiedBookAnalysisResult> {
    if (!this.isAvailable()) {
      const cover = this.fallbackCoverMetadata(options.declared);
      const rawToc = this.fallbackRawToc(options.totalPhysicalPages, options.sampleEndPage);
      return {
        book: cover,
        detectedPageOffset: rawToc.detectedPageOffset,
        firstLessonPhysicalPage: rawToc.firstLessonPhysicalPage,
        firstLessonPrintedPage: rawToc.firstLessonPrintedPage,
        units: rawToc.units,
      };
    }

    const client = this.getClient();
    const prompt = `
أنت خبير ومحلل مناهج متخصص في المناهج والكتب المدرسية العربية (خاصة المنهج اليمني والعربي).
أمامك ملف PDF يحتوي على الصفحات من ${options.sampleStartPage} إلى ${options.sampleEndPage} من الكتاب المدرسي (تشمل صفحة الغلاف الأولى، صفحات التمهيد والمقدمة، وصفحات فهرس المحتويات).
المطلوب في **استدعاء واحد شامل** استخراج كافة البيانات التالية بدقة متناهية بصيغة JSON فقط:

1. بيانات الغلاف والكتاب (من الصفحة الأولى ص 1):
   - اسم المادة وكودها المعتمد (subjectKey) حصراً من القائمة المعتمدة أدناه.
   - الصف الدراسي (gradeKey) كود الصف حصراً من G01 إلى G12.
   - الجزء أو الفصل الدراسي (part): "PART_1" (الجزء الأول)، "PART_2" (الجزء الثاني)، أو "BOTH" (كتاب موحد يحتوي الجزئين معاً).
   - رقم وسنة الطبعة (edition): مثلاً "2024" أو "2026" أو رقم الطبعة.
   - عنوان الكتاب الكامل (title) كما هو مكتوب على الغلاف.
   - الجهة المصدرة (issuer): مثلاً "وزارة التربية والتعليم".

2. فهرس الكتاب وشجرة المحتوى (من صفحات الفهرس):
   - قائمة الوحدات (Units) والدروس (Lessons).
   - رقم الصفحة المطبوعة في الكتاب لبداية كل درس (printedStartPage) ونهايته (printedEndPage) كما وردت نصاً في الفهرس.

3. فارق الترقيم (Page Offset):
   - أرقام الصفحات الواردة في الفهرس هي "أرقام الصفحات المطبوعة في متن الكتاب".
   - أرقام صفحات ملف الـ PDF هي "أرقام الصفحات الفيزيائية".
   - الصفحة المطبوعة رقم 1 تبدأ عادة بعد صفحات الغلاف والمقدمة والفهرس (مثلاً عند الصفحة الفيزيائية 9 أو 13).
   - حدد فارق الترقيم التقديري: detectedPageOffset = physicalPage - printedPage.
   - حدد الصفحة الفيزيائية التقديرية لبداية أول درس (firstLessonPhysicalPage) والصفحة المطبوعة له (firstLessonPrintedPage).

قائمة المواد المعتمدة حصراً:
- MATH (الرياضيات)
- SCI (العلوم)
- ARAB (اللغة العربية / لغتي العربية / القراءة والنصوص)
- ENG (اللغة الإنجليزية / English)
- ISL (التربية الإسلامية / الفقه / التوحيد / الحديث)
- QURAN (القرآن الكريم وتجويده)
- CIV (التربية الوطنية والاجتماعية)
- PHYS (الفيزياء)
- CHEM (الكيمياء)
- BIO (الأحياء)
- HIST (التاريخ)
- GEO (الجغرافيا)
- ART (التربية الفنية)

الصفوف: G01 إلى G12 (مثال: G04 للصف الرابع، G07 للصف السابع، G09 للتاسع).

المطلوب إرجاعه بدقة ككائن JSON فقط بدون أي علامات markdown:
{
  "book": {
    "subjectKey": "SCI",
    "gradeKey": "G07",
    "part": "PART_1" | "PART_2" | "BOTH" | "unknown",
    "edition": "2024",
    "title": "عنوان الكتاب كما يظهر على الغلاف",
    "issuer": "وزارة التربية والتعليم",
    "printingYear": 2024
  },
  "detectedPageOffset": 8,
  "firstLessonPhysicalPage": 13,
  "firstLessonPrintedPage": 5,
  "units": [
    {
      "number": 1,
      "title": "عنوان الوحدة الأولى",
      "slug": "unit-1",
      "orderIndex": 1,
      "lessons": [
        {
          "number": 1,
          "title": "عنوان الدرس الأول",
          "slug": "lesson-1",
          "orderIndex": 1,
          "printedStartPage": 5,
          "printedEndPage": 14
        }
      ]
    }
  ]
}
`;

    try {
      const response = await this.generateWithFallback(client, {
        contents: [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  mimeType: 'application/pdf',
                  data: coverAndTocPdfBuffer.toString('base64'),
                },
              },
              { text: prompt },
            ],
          },
        ],
        config: {
          responseMimeType: 'application/json',
          temperature: 0.1,
        },
      });

      const parsed = JSON.parse(response.text?.trim() || '{}') as Partial<UnifiedBookAnalysisResult>;
      const rawBook = parsed.book || (parsed as any);
      const subjectKey = normalizeSubjectKey(options.declared?.subjectKey || rawBook?.subjectKey);
      const gradeKey = normalizeGradeKey(options.declared?.gradeKey || rawBook?.gradeKey);
      const part = (options.declared?.part === 'PART_2' || options.declared?.part === 'P02')
        ? 'PART_2'
        : (options.declared?.part === 'BOTH' || options.declared?.part === 'PB')
          ? 'BOTH'
          : (rawBook?.part === 'PART_2' || rawBook?.part === 'BOTH')
            ? rawBook.part
            : 'PART_1';
      const edition = options.declared?.edition || rawBook?.edition || '2026';
      const title = options.declared?.title || rawBook?.title || 'كتاب مدرسي';

      const units = Array.isArray(parsed.units) && parsed.units.length > 0
        ? parsed.units
        : this.fallbackRawToc(options.totalPhysicalPages, options.sampleEndPage).units;

      return {
        book: {
          subjectKey,
          gradeKey,
          part,
          edition,
          title,
          issuer: rawBook?.issuer || 'وزارة التربية والتعليم',
          printingYear: Number(rawBook?.printingYear) || 2026,
        },
        detectedPageOffset: typeof parsed.detectedPageOffset === 'number' ? parsed.detectedPageOffset : null,
        firstLessonPhysicalPage: typeof parsed.firstLessonPhysicalPage === 'number' ? parsed.firstLessonPhysicalPage : null,
        firstLessonPrintedPage: typeof parsed.firstLessonPrintedPage === 'number' ? parsed.firstLessonPrintedPage : null,
        units,
      };
    } catch (err) {
      console.warn('[GeminiContentEngine] analyzeCoverAndTocUnified failed, using fallback:', err);
      const cover = this.fallbackCoverMetadata(options.declared);
      const rawToc = this.fallbackRawToc(options.totalPhysicalPages, options.sampleEndPage);
      return {
        book: cover,
        detectedPageOffset: rawToc.detectedPageOffset,
        firstLessonPhysicalPage: rawToc.firstLessonPhysicalPage,
        firstLessonPrintedPage: rawToc.firstLessonPrintedPage,
        units: rawToc.units,
      };
    }
  }

  /**
   * Unified single-call pipeline:
   * 1. Extracts pages 1 through 12 in ONE slice (Cover, Preliminaries, and TOC)
   * 2. Sends ONE single prompt to Gemini (default: gemini-3.5-flash with automatic failover)
   * 3. Receives complete Cover metadata, TOC tree, and detected pageOffset in a single response
   * 4. Reconciles page numbers and offset to output the validated TextbookIndexDocument
   */
  async processBookWithCoverAndToc(
    fullPdfBuffer: Buffer,
    totalPhysicalPages: number,
    fileName: string,
    declared?: { subjectKey?: string; gradeKey?: string; part?: string; edition?: string; title?: string },
  ): Promise<TextbookIndexDocument> {
    try {
      // 1. Extract pages 1 through 12 in a single slice
      const sample = await extractCoverAndTocPages(fullPdfBuffer, 12);

      // 2. Single unified Gemini API call for Cover + TOC + Page Offset
      const unified = await this.analyzeCoverAndTocUnified(sample.buffer, {
        totalPhysicalPages,
        sampleStartPage: sample.startPage,
        sampleEndPage: sample.endPage,
        declared,
      });

      // 3. Reconcile page offset and lesson physical page bounds
      const rawToc: RawTocDocument = {
        units: unified.units,
        detectedPageOffset: unified.detectedPageOffset,
        firstLessonPhysicalPage: unified.firstLessonPhysicalPage,
        firstLessonPrintedPage: unified.firstLessonPrintedPage,
      };

      const indexDoc = this.reconcilePageNumbersAndOffset(
        rawToc,
        unified.book,
        totalPhysicalPages,
        sample.endPage,
      );

      return {
        ...indexDoc,
        source: {
          ...indexDoc.source,
          fileName,
        },
      };
    } catch (err) {
      console.warn('[GeminiContentEngine] processBookWithCoverAndToc encountered error, using fallback:', err);
      return this.fallbackDeterministicStructure(totalPhysicalPages, fileName, declared);
    }
  }

  /**
   * Legacy interface retained for compatibility. Delegates to processBookWithCoverAndToc when full buffer is provided.
   */
  async identifyBookStructure(
    pdfSampleBuffer: Buffer,
    totalPhysicalPages: number,
    fileName: string,
    declared?: { subjectKey?: string; gradeKey?: string; part?: string; edition?: string; title?: string },
  ): Promise<TextbookIndexDocument> {
    return this.processBookWithCoverAndToc(pdfSampleBuffer, totalPhysicalPages, fileName, declared);
  }

  /**
   * Phase 2: Generates concepts for a specific lesson based on its context.
   */
  async enrichLessonConcepts(
    lessonTitle: string,
    unitTitle: string,
    subject: string,
    grade: string,
  ): Promise<ReadonlyArray<ExtractedConcept>> {
    if (!this.isAvailable()) {
      return this.fallbackDeterministicConcepts(lessonTitle);
    }

    const client = this.getClient();
    const prompt = `
أنت خبير مناهج تعليمية لمشروع Edu7.
قم باستخراج وصياغة المفاهيم التعليمية الأساسية (Concepts) لدرس:
- المادة: ${subject}
- الصف: ${grade}
- الوحدة: ${unitTitle}
- الدرس: ${lessonTitle}

المطلوب إخراج 2 إلى 5 مفاهيم محددة بصيغة JSON كمصفوفة:
[
  {
    "name": "اسم المفهوم بدقة",
    "slug": "concept-slug-in-latin",
    "description": "شرح تعليمي مبسط وموجز للمفهوم",
    "difficulty": 0.3, // من 0.1 إلى 0.9
    "threshold": 0.7, // نسبة الإتقان المطلوبة
    "misconceptions": [
      {
        "name": "المفهوم الخاطئ الشائع لدى الطلاب",
        "slug": "misconception-slug",
        "description": "وصف كيف يفهم التلميذ الفكرة بشكل خاطئ",
        "remediation": "الشرح التصحيحي لإزالة الفهم الخاطئ"
      }
    ]
  }
]
`;

    try {
      const response = await this.generateWithFallback(client, {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: { responseMimeType: 'application/json', temperature: 0.2 },
      });
      const parsed = JSON.parse(response.text?.trim() || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      console.warn('[GeminiContentEngine] enrichLessonConcepts failed:', err);
      return this.fallbackDeterministicConcepts(lessonTitle);
    }
  }

  /**
   * Phase 2: Generates assessment questions for a specific lesson and concepts.
   */
  async enrichLessonQuestions(
    lessonTitle: string,
    unitTitle: string,
    concepts: ReadonlyArray<{ name: string; slug: string }>,
    count = 4,
  ): Promise<ReadonlyArray<ExtractedQuestion>> {
    if (!this.isAvailable()) {
      return this.fallbackDeterministicQuestions(lessonTitle, concepts);
    }

    const client = this.getClient();
    const conceptNames = concepts.map((c) => c.name).join('، ');
    const prompt = `
أنت خبير قياس وتقويم تربوي لمشروع Edu7.
قم بتوليد ${count} أسئلة تقييمية تكيّفية لدرس: "${lessonTitle}" ضمن وحدة "${unitTitle}".
المفاهيم المستهدفة: ${conceptNames || lessonTitle}.

أنواع الأسئلة المطلوبة: اختيار من متعدد (MCQ_SINGLE) وصح وخطأ (TRUE_FALSE).
صيغة الإخراج المطلوبة JSON كمصفوفة:
[
  {
    "text": "نص السؤال الواضح والدقيق؟",
    "type": "MCQ_SINGLE",
    "difficulty01": 0.3, // بين 0.1 و 0.9
    "points": 1,
    "hint": "تلميح مبسط للحل عند التعثر",
    "explanation": "شرح تفصيلي لسبب صحة الإجابة",
    "choices": [
      { "id": "c1", "text": "الخيار الأول", "correct": true },
      { "id": "c2", "text": "الخيار الثاني (مشتت)", "correct": false, "misconceptionSlug": "optional-slug" },
      { "id": "c3", "text": "الخيار الثالث", "correct": false },
      { "id": "c4", "text": "الخيار الرابع", "correct": false }
    ]
  }
]
`;

    try {
      const response = await this.generateWithFallback(client, {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: { responseMimeType: 'application/json', temperature: 0.2 },
      });
      const parsed = JSON.parse(response.text?.trim() || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      console.warn('[GeminiContentEngine] enrichLessonQuestions failed:', err);
      return this.fallbackDeterministicQuestions(lessonTitle, concepts);
    }
  }

  private fallbackCoverMetadata(
    declared?: { subjectKey?: string; gradeKey?: string; part?: string; edition?: string; title?: string },
  ): CoverMetadata {
    return {
      subjectKey: normalizeSubjectKey(declared?.subjectKey),
      gradeKey: normalizeGradeKey(declared?.gradeKey),
      part: (declared?.part === 'BOTH' || declared?.part === 'PB')
        ? 'BOTH'
        : (declared?.part === 'PART_2' || declared?.part === 'P02')
          ? 'PART_2'
          : 'PART_1',
      edition: declared?.edition || '2026',
      title: declared?.title || 'كتاب مدرسي',
      issuer: 'وزارة التربية والتعليم',
      printingYear: 2026,
    };
  }

  private fallbackRawToc(totalPages: number, tocEnd: number): RawTocDocument {
    const pageSize = Math.max(5, Math.floor(totalPages / 3));
    return {
      detectedPageOffset: Math.max(0, tocEnd + 1 - 1),
      firstLessonPhysicalPage: tocEnd + 1,
      firstLessonPrintedPage: 1,
      units: [
        {
          number: 1,
          title: 'الوحدة الأولى',
          slug: 'unit-1',
          orderIndex: 1,
          lessons: [
            {
              number: 1,
              title: 'الدرس الأول: مقدمة وتمهيد',
              slug: 'lesson-1',
              orderIndex: 1,
              printedStartPage: 1,
              printedEndPage: pageSize,
            },
            {
              number: 2,
              title: 'الدرس الثاني: المفاهيم والتطبيقات',
              slug: 'lesson-2',
              orderIndex: 2,
              printedStartPage: pageSize + 1,
              printedEndPage: pageSize * 2,
            },
          ],
        },
      ],
    };
  }

  private fallbackDeterministicStructure(
    totalPages: number,
    fileName: string,
    declared?: { subjectKey?: string; gradeKey?: string; part?: string; edition?: string; title?: string },
  ): TextbookIndexDocument {
    const cover = this.fallbackCoverMetadata({
      ...declared,
      title: declared?.title || fileName.replace(/\.pdf$/i, '').replace(/[-_]/g, ' '),
    });
    const rawToc = this.fallbackRawToc(totalPages, 12);
    return this.reconcilePageNumbersAndOffset(rawToc, cover, totalPages, 12);
  }

  private fallbackDeterministicConcepts(lessonTitle: string): ReadonlyArray<ExtractedConcept> {
    return [
      {
        name: `مفهوم ${lessonTitle}`,
        slug: 'core-concept',
        description: `الأساس المعرفي والمهاري لدرس ${lessonTitle}`,
        difficulty: 0.3,
        threshold: 0.7,
        misconceptions: [
          {
            name: 'الخلط في التطبيق المباشر',
            slug: 'mis-basic-application',
            description: 'اعتقاد أن القاعدة تنطبق دون استثناءات',
            remediation: 'مراجعة شروط القاعدة والأمثلة التوضيحية',
          },
        ],
      },
    ];
  }

  private fallbackDeterministicQuestions(
    lessonTitle: string,
    _concepts: ReadonlyArray<{ name: string; slug: string }>,
  ): ReadonlyArray<ExtractedQuestion> {
    return [
      {
        text: `ما هي الفكرة الأساسية المستفادة من درس: ${lessonTitle}؟`,
        type: 'MCQ_SINGLE',
        difficulty01: 0.2,
        points: 1,
        hint: 'تذكر المعنى العام للدرس وأهدافه الرئيسية.',
        explanation: 'الإجابة تمثل التطبيق المباشر للمفهوم الأساسي.',
        choices: [
          { id: 'c1', text: 'فهم وتطبيق المفاهيم بصورة صحيحة', correct: true },
          { id: 'c2', text: 'تجاهل الشروط الأساسية', correct: false, misconceptionSlug: 'mis-basic-application' },
          { id: 'c3', text: 'حفظ النص دون استيعاب', correct: false },
          { id: 'c4', text: 'الاعتماد على التخمين العشوائي', correct: false },
        ],
      },
    ];
  }
}
