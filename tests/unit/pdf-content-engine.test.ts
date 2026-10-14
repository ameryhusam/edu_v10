import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import {
  extractCoverPage,
  extractTocPages,
  extractCoverAndTocPages,
  extractPagesRange,
  getPdfMetadata,
  sliceLessonPdf,
} from '../../src/infrastructure/content/pdf-slicer.js';
import {
  GeminiContentEngine,
  normalizeSubjectKey,
  normalizeGradeKey,
} from '../../src/infrastructure/content/gemini-content-engine.js';
import { validateIndexDocument } from '../../src/contexts/content/domain/content-engine/index-contract.js';

async function createTestPdf(pageCount: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    const page = doc.addPage([200, 300]);
    // write page index
    page.drawText(`Page ${i + 1}`);
  }
  const bytes = await doc.save();
  return Buffer.from(bytes);
}

describe('TypeScript PDF Processing & Slicing', () => {
  it('extracts metadata and sha256 from PDF', async () => {
    const pdf = await createTestPdf(20);
    const meta = await getPdfMetadata(pdf);
    expect(meta.pageCount).toBe(20);
    expect(meta.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('extracts cover page (page 1) as a single page PDF', async () => {
    const pdf = await createTestPdf(20);
    const cover = await extractCoverPage(pdf);
    const coverDoc = await PDFDocument.load(cover);
    expect(coverDoc.getPageCount()).toBe(1);
  });

  it('extracts TOC pages (pages 4 to 12)', async () => {
    const pdf = await createTestPdf(20);
    const toc = await extractTocPages(pdf, 4, 12);
    expect(toc.startPage).toBe(4);
    expect(toc.endPage).toBe(12);
    expect(toc.pageCount).toBe(9);

    const tocDoc = await PDFDocument.load(toc.buffer);
    expect(tocDoc.getPageCount()).toBe(9);
  });

  it('clamps TOC extraction if document has fewer pages', async () => {
    const pdf = await createTestPdf(6);
    const toc = await extractTocPages(pdf, 4, 12);
    expect(toc.startPage).toBe(4);
    expect(toc.endPage).toBe(6);
    expect(toc.pageCount).toBe(3);
  });

  it('slices a lesson PDF and calculates sha256', async () => {
    const pdf = await createTestPdf(20);
    const lessonSlice = await sliceLessonPdf(pdf, 5, 8);
    expect(lessonSlice.startPage).toBe(5);
    expect(lessonSlice.endPage).toBe(8);
    expect(lessonSlice.pageCount).toBe(4);
    expect(lessonSlice.sha256).toMatch(/^[a-f0-9]{64}$/);

    const sliceDoc = await PDFDocument.load(lessonSlice.buffer);
    expect(sliceDoc.getPageCount()).toBe(4);
  });

  it('extracts pages 1 to 12 in ONE single slice for unified Cover + TOC analysis', async () => {
    const pdf = await createTestPdf(30);
    const sample = await extractCoverAndTocPages(pdf, 12);
    expect(sample.startPage).toBe(1);
    expect(sample.endPage).toBe(12);
    expect(sample.pageCount).toBe(12);

    const sampleDoc = await PDFDocument.load(sample.buffer);
    expect(sampleDoc.getPageCount()).toBe(12);
  });
});

describe('Page Offset Reconciliation & Gemini Content Engine', () => {
  it('defaults model to gemini-3.5-flash with override capability', () => {
    const defaultEngine = new GeminiContentEngine({});
    expect(defaultEngine.getModelName()).toBe('gemini-3.5-flash');

    const customEngine = new GeminiContentEngine({ model: 'gemini-1.5-pro' });
    expect(customEngine.getModelName()).toBe('gemini-1.5-pro');

    const legacyEngine = new GeminiContentEngine({ model: 'gemini-2.5-flash' });
    expect(legacyEngine.getModelName()).toBe('gemini-3.5-flash');
  });

  it('normalizes Arabic and English subject keys into canonical set', () => {
    expect(normalizeSubjectKey('الرياضيات')).toBe('MATH');
    expect(normalizeSubjectKey('علوم الصف السابع')).toBe('SCI');
    expect(normalizeSubjectKey('لغتي العربية')).toBe('ARAB');
    expect(normalizeSubjectKey('English Language')).toBe('ENG');
    expect(normalizeSubjectKey('القرآن الكريم وتجويده')).toBe('QURAN');
    expect(normalizeSubjectKey('التربية الوطنية')).toBe('CIV');
  });

  it('normalizes grade keys into canonical G01-G12 format', () => {
    expect(normalizeGradeKey('الصف السابع')).toBe('G07');
    expect(normalizeGradeKey('الصف الرابع')).toBe('G04');
    expect(normalizeGradeKey('grade 9')).toBe('G09');
    expect(normalizeGradeKey('G7')).toBe('G07');
  });

  it('reconciles printed page numbers with physical PDF pages using detected offset', () => {
    const engine = new GeminiContentEngine({});
    const rawToc = {
      detectedPageOffset: 8, // printed 1 is physical 9
      firstLessonPhysicalPage: 9,
      firstLessonPrintedPage: 1,
      units: [
        {
          number: 1,
          title: 'الوحدة الأولى: الطبيعة والبيئة',
          slug: 'unit-1',
          orderIndex: 1,
          lessons: [
            {
              number: 1,
              title: 'الدرس الأول: الكائنات الحية',
              slug: 'lesson-1',
              orderIndex: 1,
              printedStartPage: 1,
              printedEndPage: 8,
            },
            {
              number: 2,
              title: 'الدرس الثاني: السلسلة الغذائية',
              slug: 'lesson-2',
              orderIndex: 2,
              printedStartPage: 9,
              printedEndPage: 16,
            },
          ],
        },
      ],
    };

    const cover = {
      subjectKey: 'SCI',
      gradeKey: 'G07',
      part: 'PART_1' as const,
      edition: '2026',
      title: 'العلوم — الصف السابع',
    };

    const indexDoc = engine.reconcilePageNumbersAndOffset(rawToc, cover, 100, 8);

    expect(indexDoc.textbook.subjectKey).toBe('SCI');
    expect(indexDoc.textbook.gradeKey).toBe('G07');
    expect(indexDoc.textbook.part).toBe('P01');

    const unit = indexDoc.units[0]!;
    const l1 = unit.lessons[0]!;
    const l2 = unit.lessons[1]!;

    // Physical start = printed 1 + offset 8 = 9
    expect(l1.pages.printedStartPage).toBe(1);
    expect(l1.pages.physicalStartPage).toBe(9);
    // Adjusted so it does not overlap l2
    expect(l1.pages.physicalEndPage).toBeLessThanOrEqual(l2.pages.physicalStartPage - 1);

    // Physical start of l2 = printed 9 + offset 8 = 17
    expect(l2.pages.printedStartPage).toBe(9);
    expect(l2.pages.physicalStartPage).toBe(17);

    // Document validates against canonical contract
    const validation = validateIndexDocument(indexDoc);
    expect(validation.ok).toBe(true);
  });

  it('runs the unified single-call processBookWithCoverAndToc flow with deterministic fallback', async () => {
    const engine = new GeminiContentEngine({});
    const pdf = await createTestPdf(40);
    const indexDoc = await engine.processBookWithCoverAndToc(pdf, 40, 'science-g07.pdf', {
      subjectKey: 'SCI',
      gradeKey: 'G07',
      part: 'PART_1',
      edition: '2026',
      title: 'كتاب العلوم للصف السابع',
    });

    expect(indexDoc.textbook.subjectKey).toBe('SCI');
    expect(indexDoc.textbook.gradeKey).toBe('G07');
    expect(indexDoc.textbook.part).toBe('P01');
    expect(indexDoc.units.length).toBeGreaterThan(0);
    expect(indexDoc.source.physicalPageCount).toBe(40);

    const validation = validateIndexDocument(indexDoc);
    expect(validation.ok).toBe(true);
  });

  it('performs retries on temporary 503 errors before failing over', async () => {
    const engine = new GeminiContentEngine({ apiKey: 'fake-test-key' });
    let attempts = 0;

    const mockClient: any = {
      models: {
        generateContent: async ({ model }: any) => {
          attempts++;
          if (attempts < 3) {
            const err: any = new Error('This model is currently experiencing high demand.');
            err.status = 'UNAVAILABLE';
            err.code = 503;
            throw err;
          }
          return { text: JSON.stringify({ success: true, modelUsed: model }) };
        },
      },
    };

    // Override internal generateWithFallback call with minimal retry delays for test speed
    const result: any = await (engine as any).generateWithFallback(
      mockClient,
      { contents: [{ role: 'user', parts: [{ text: 'test' }] }] },
      { maxRetries: 3, retryDelaysMs: [5, 5, 5] },
    );

    expect(attempts).toBe(3);
    const parsed = JSON.parse(result.text);
    expect(parsed.success).toBe(true);
  });
});
