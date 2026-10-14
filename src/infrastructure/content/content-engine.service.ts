import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type {
  ContentEnginePort,
  ContentEnginePrepareInput,
  ContentEnginePrepareResult,
  ContentEngineIdentityInput,
  ContentEngineIdentityResult,
} from '../../contexts/content/application/content-engine.port.js';
import {
  validateIndexDocument,
  normalizePart,
  type TextbookIndexDocument,
  type TextbookIndexUnit,
} from '../../contexts/content/domain/content-engine/index-contract.js';
import { getPdfMetadata, samplePdfPages, sliceLessonPdf } from './pdf-slicer.js';
import { GeminiContentEngine } from './gemini-content-engine.js';
import { CONTENT_PROFILE, CONTENT_PROFILE_VERSION } from '../../contexts/content/domain/export-profile.js';
import { textbookKey as buildTextbookKey } from '../../shared/kernel/identifiers.js';

interface WritePartWorkspaceOptions {
  targetDir: string;
  part: 'PART_1' | 'PART_2';
  partCode: 'P01' | 'P02';
  subject: string;
  grade: string;
  edition: string;
  title?: string;
  pdfBuffer: Buffer;
  pdfSha256: string;
  units: ReadonlyArray<TextbookIndexUnit>;
  indexDoc: TextbookIndexDocument;
}

async function writePartWorkspace(options: WritePartWorkspaceOptions): Promise<{
  unitCount: number;
  lessonCount: number;
  assetCount: number;
}> {
  await fs.mkdir(options.targetDir, { recursive: true });

  const gradeNum = Number(String(options.grade).replace(/^G/i, '')) || 7;
  const canonicalTbKeyResult = buildTextbookKey({
    subject: options.subject,
    grade: gradeNum,
    part: options.part,
    edition: options.edition,
  });
  const tbKey = canonicalTbKeyResult.ok
    ? canonicalTbKeyResult.value
    : `EDU-${options.subject}-${options.grade}-${options.partCode}-ED${options.edition}`;

  const assetsList: any[] = [];
  const flatUnits: any[] = [];
  const flatLessons: any[] = [];

  for (const [uIdx, unit] of options.units.entries()) {
    const uNum = unit.number || uIdx + 1;
    const uSlug = unit.slug || `UNIT-${uNum}`;
    const unitKey = `${tbKey}-U-${uSlug}`;
    const unitRelDir = `${options.partCode}/units/U${String(uNum).padStart(2, '0')}_${uSlug}`;

    flatUnits.push({
      key: unitKey,
      slug: uSlug,
      name: unit.title,
      orderIndex: unit.orderIndex || uNum,
      startPage: unit.lessons[0]?.pages.physicalStartPage ?? null,
      endPage: unit.lessons[unit.lessons.length - 1]?.pages.physicalEndPage ?? null,
      isActive: true,
    });

    for (const [lIdx, lesson] of unit.lessons.entries()) {
      const lNum = lesson.number || lIdx + 1;
      const lSlug = lesson.slug || `LESSON-${lNum}`;
      const lessonKey = `${unitKey}-L-${lSlug}`;
      const lessonRelDir = `${unitRelDir}/L${String(lNum).padStart(2, '0')}_${lSlug}`;
      const lessonFsDir = path.join(options.targetDir, lessonRelDir);
      await fs.mkdir(lessonFsDir, { recursive: true });

      // Slice lesson PDF
      const startPage = lesson.pages.physicalStartPage;
      const endPage = lesson.pages.physicalEndPage;
      const slice = await sliceLessonPdf(options.pdfBuffer, startPage, endPage);

      const lessonPdfRelPath = `${lessonRelDir}/lesson.pdf`;
      const lessonPdfFullPath = path.join(options.targetDir, lessonPdfRelPath);
      await fs.writeFile(lessonPdfFullPath, slice.buffer);

      assetsList.push({
        textbookKey: tbKey,
        relativePath: lessonPdfRelPath,
        assetType: 'LESSON_PDF',
        scope: 'LESSON',
        lessonKey,
        unitKey,
        mimeType: 'application/pdf',
        originalName: 'lesson.pdf',
        pageStart: startPage,
        pageEnd: endPage,
        sha256: slice.sha256,
        sizeBytes: slice.buffer.length,
        title: lesson.title,
      });

      flatLessons.push({
        key: lessonKey,
        unitSlug: uSlug,
        slug: lSlug,
        name: lesson.title,
        orderIndex: lesson.orderIndex || lNum,
        startPage,
        endPage,
        isActive: true,
      });
    }
  }

  // 1. Write index.json adhering to canonical contract
  const partIndexDoc: TextbookIndexDocument = {
    ...options.indexDoc,
    textbook: {
      ...options.indexDoc.textbook,
      part: options.partCode,
    },
    units: options.units,
  };
  const indexJsonPath = path.join(options.targetDir, 'index.json');
  await fs.writeFile(indexJsonPath, JSON.stringify(partIndexDoc, null, 2), 'utf8');

  // 2. Write edu7-content-package.json for immediate ingestion
  const pkg = {
    meta: {
      profile: CONTENT_PROFILE,
      profileVersion: CONTENT_PROFILE_VERSION,
      scope: 'FULL',
      exportedAt: new Date().toISOString(),
    },
    textbook: {
      key: tbKey,
      subjectKey: options.subject,
      gradeKey: options.grade,
      part: options.part,
      title: options.title || options.indexDoc.textbook.title,
      edition: options.edition,
      status: 'DRAFT',
    },
    units: flatUnits,
    lessons: flatLessons,
    concepts: [],
    prerequisites: [],
    misconceptions: [],
    learningResources: [],
    questions: [],
    assets: assetsList,
  };

  const pkgPath = path.join(options.targetDir, 'edu7-content-package.json');
  await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2), 'utf8');

  // 3. Write workspace manifest
  const manifest = {
    manifestVersion: '1.0.0',
    type: 'edu7-textbook-workspace',
    workspaceId: tbKey,
    part: options.part,
    grade: options.grade,
    subject: options.subject,
    edition: options.edition,
    title: options.title || options.indexDoc.textbook.title,
    source: {
      engine: 'edu7-ts-content-engine',
      engineVersion: '1.0.0',
      sourcePdf: {
        relativePath: 'source.pdf',
        mimeType: 'application/pdf',
        sizeBytes: options.pdfBuffer.length,
        sha256: options.pdfSha256,
      },
    },
    counts: {
      units: flatUnits.length,
      lessons: flatLessons.length,
      concepts: 0,
      questions: 0,
      flashcards: 0,
      resources: 0,
      assets: assetsList.length,
    },
    package: {
      relativePath: 'edu7-content-package.json',
      profile: CONTENT_PROFILE,
      profileVersion: CONTENT_PROFILE_VERSION,
    },
    contentVersion: 1,
    updatedAt: new Date().toISOString(),
    contentHash: options.pdfSha256,
  };

  const manifestPath = path.join(options.targetDir, 'book_manifest.json');
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  return {
    unitCount: flatUnits.length,
    lessonCount: flatLessons.length,
    assetCount: assetsList.length,
  };
}

export class ContentEngineService implements ContentEnginePort {
  private readonly geminiEngine: GeminiContentEngine;

  constructor(
    _unusedPythonCommand?: string,
    _unusedEngineRoot?: string,
    geminiApiKey?: string,
    geminiModel?: string,
  ) {
    this.geminiEngine = new GeminiContentEngine({
      apiKey: geminiApiKey,
      model: geminiModel,
    });
  }

  getGeminiEngine(): GeminiContentEngine {
    return this.geminiEngine;
  }

  async identify(input: ContentEngineIdentityInput): Promise<ContentEngineIdentityResult> {
    const meta = await getPdfMetadata(input.pdf);
    const analysisPages = Math.min(input.analysisPages ?? 12, meta.pageCount);

    // Analyze structure using Cover (page 1) + TOC (pages 4-12) + page offset reconciliation
    const indexDoc = await this.geminiEngine.processBookWithCoverAndToc(
      input.pdf,
      meta.pageCount,
      'source-textbook.pdf',
      input.declared,
    );

    const normPart = normalizePart(indexDoc.textbook.part);
    const part = normPart === 'unknown' ? 'PART_1' : normPart;

    return {
      schemaVersion: '1.0',
      status: indexDoc.units.length > 0 ? 'PROPOSED' : 'NEEDS_REVIEW',
      source: {
        fileName: 'source-textbook.pdf',
        sha256: meta.sha256,
        pageCount: meta.pageCount,
        analysisPages,
      },
      identity: {
        title: indexDoc.textbook.title || null,
        subjectKey: indexDoc.textbook.subjectKey || null,
        gradeKey: indexDoc.textbook.gradeKey || null,
        part,
        edition: indexDoc.textbook.edition || '2026',
        printingYear: Number(indexDoc.textbook.edition) || 2026,
        publicationYear: Number(indexDoc.textbook.edition) || 2026,
        issuer: 'وزارة التربية والتعليم',
      },
      evidence: [
        {
          type: 'GEMINI_TOC_SCAN',
          unitsFound: indexDoc.units.length,
          lessonsFound: indexDoc.units.reduce((acc, u) => acc + u.lessons.length, 0),
        },
      ],
      conflicts: [],
      toc: indexDoc as unknown as Record<string, unknown>,
    };
  }

  async prepare(input: ContentEnginePrepareInput): Promise<ContentEnginePrepareResult> {
    const meta = await getPdfMetadata(input.pdf);
    await fs.mkdir(input.workspaceDir, { recursive: true });

    // 1. Analyze TOC & structure using Cover (page 1) + TOC (pages 4-12) + page offset reconciliation
    const indexDoc = await this.geminiEngine.processBookWithCoverAndToc(
      input.pdf,
      meta.pageCount,
      'source.pdf',
      {
        subjectKey: input.subject,
        gradeKey: input.grade,
        part: input.part,
        edition: input.edition,
        title: input.title,
      },
    );

    // Ensure valid index document
    const validation = validateIndexDocument(indexDoc);
    if (!validation.ok) {
      console.warn('[ContentEngineService] Index validation warnings:', validation.error);
    }

    const edition = input.edition || indexDoc.textbook.edition || '2026';
    const editionNorm = edition.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').replace(/^ED(?=\d)/, '');
    const gradeNorm = input.grade.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const subjectNorm = input.subject.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

    let totalLessonsSliced = 0;
    let totalUnitsProcessed = 0;

    if (input.part === 'BOTH') {
      const p1Dir = path.join(input.workspaceDir, 'P1', gradeNorm, subjectNorm, `ED${editionNorm}`);
      const p2Dir = path.join(input.workspaceDir, 'P2', gradeNorm, subjectNorm, `ED${editionNorm}`);

      const midpoint = Math.ceil(indexDoc.units.length / 2);
      const p1Units = indexDoc.units.slice(0, midpoint);
      const p2Units = indexDoc.units.slice(midpoint);
      const finalP1 = p1Units.length > 0 ? p1Units : indexDoc.units;
      const finalP2 = p2Units.length > 0 ? p2Units : indexDoc.units;

      const r1 = await writePartWorkspace({
        targetDir: p1Dir,
        part: 'PART_1',
        partCode: 'P01',
        subject: input.subject,
        grade: input.grade,
        edition,
        title: input.title,
        pdfBuffer: input.pdf,
        pdfSha256: meta.sha256,
        units: finalP1,
        indexDoc,
      });

      const r2 = await writePartWorkspace({
        targetDir: p2Dir,
        part: 'PART_2',
        partCode: 'P02',
        subject: input.subject,
        grade: input.grade,
        edition,
        title: input.title,
        pdfBuffer: input.pdf,
        pdfSha256: meta.sha256,
        units: finalP2,
        indexDoc,
      });

      // Also write root workspace for direct inspector access
      await writePartWorkspace({
        targetDir: input.workspaceDir,
        part: 'PART_1',
        partCode: 'P01',
        subject: input.subject,
        grade: input.grade,
        edition,
        title: input.title,
        pdfBuffer: input.pdf,
        pdfSha256: meta.sha256,
        units: indexDoc.units,
        indexDoc,
      });

      totalLessonsSliced = r1.lessonCount + r2.lessonCount;
      totalUnitsProcessed = r1.unitCount + r2.unitCount;
    } else {
      const part = input.part === 'PART_2' ? 'PART_2' : 'PART_1';
      const partCode = part === 'PART_2' ? 'P02' : 'P01';

      const res = await writePartWorkspace({
        targetDir: input.workspaceDir,
        part,
        partCode,
        subject: input.subject,
        grade: input.grade,
        edition,
        title: input.title,
        pdfBuffer: input.pdf,
        pdfSha256: meta.sha256,
        units: indexDoc.units,
        indexDoc,
      });

      totalLessonsSliced = res.lessonCount;
      totalUnitsProcessed = res.unitCount;
    }

    return {
      workspaceDir: input.workspaceDir,
      stdout: `Successfully sliced ${totalLessonsSliced} lessons across ${totalUnitsProcessed} units into standalone PDFs.`,
      stderr: '',
    };
  }
}
