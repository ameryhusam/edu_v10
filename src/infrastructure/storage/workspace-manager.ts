/**
 * Workspace Manager
 *
 * Implements filesystem layout and manifest coordination for Edu7 content workspaces
 * structured according to the final project plan:
 *
 * Workspace/
 *   <term>/
 *     <grade>/
 *       <subject>/
 *         index.json
 *         edu7-content-package.json
 *         textbook/
 *           textbook.pdf
 *           pages/
 *         unit_01_<slug>/
 *           unit_01.json
 *           U_01_<slug>.pdf
 *           lessons/
 *             lesson_01_<slug>/
 *               lesson_01.json
 *               L_01_<slug>.pdf
 *               pages/
 *               resources/
 *               concepts.json
 *               questions.json
 *               flashcards.json
 *               resources.json
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { ContentPackage } from '../../contexts/content/domain/export-profile.js';

export interface WorkspaceCoordinates {
  readonly term: string;
  readonly grade: string;
  readonly subject: string;
}

export interface WorkspaceIndexManifest {
  readonly manifestVersion: string;
  readonly type: string;
  readonly workspaceId: string;
  readonly term: string;
  readonly grade: string;
  readonly subject: string;
  readonly edition: string;
  readonly title: string;
  readonly source: {
    readonly engine: string;
    readonly engineVersion: string;
    readonly sourcePdf: {
      readonly relativePath: string;
      readonly mimeType: string;
      readonly sizeBytes: number;
      readonly sha256: string;
    };
  };
  readonly counts: {
    readonly units: number;
    readonly lessons: number;
    readonly concepts: number;
    readonly questions: number;
    readonly flashcards: number;
    readonly resources: number;
    readonly assets?: number;
  };
  readonly units: ReadonlyArray<{
    readonly unitNumber: number;
    readonly slug: string;
    readonly relativePath: string;
    readonly manifest: string;
    readonly pdf: string;
    readonly lessons: ReadonlyArray<{
      readonly lessonNumber: number;
      readonly slug: string;
      readonly relativePath: string;
      readonly manifest: string;
      readonly pdf: string;
    }>;
  }>;
  readonly package: {
    readonly relativePath: string;
    readonly profile: string;
    readonly profileVersion: string;
  };
  readonly contentVersion: number;
  readonly updatedAt: string;
  readonly contentHash: string;
}

export class WorkspaceManager {
  private readonly workspaceBaseDir: string;

  constructor(workspaceBaseDir?: string) {
    this.workspaceBaseDir = path.resolve(
      workspaceBaseDir || process.env.WORKSPACE_ROOT || path.resolve(process.cwd(), 'workspaces'),
    );
    fs.mkdirSync(this.workspaceBaseDir, { recursive: true });
  }

  /**
   * Derives standardized workspace directory for coordinates:
   * e.g., workspaces/T01/G07/MATH
   */
  getWorkspaceDir(coords: WorkspaceCoordinates): string {
    const termNorm = coords.term.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const gradeNorm = coords.grade.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const subjectNorm = coords.subject.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    return path.join(this.workspaceBaseDir, termNorm, gradeNorm, subjectNorm);
  }

  /**
   * Initializes workspace directories and stores the source textbook PDF
   */
  async storeTextbookSource(
    coords: WorkspaceCoordinates,
    pdfBuffer: Buffer,
    edition = '2026',
    title?: string,
  ): Promise<{
    workspaceDir: string;
    pdfRelativePath: string;
    pdfFullPath: string;
    sizeBytes: number;
    sha256: string;
  }> {
    const wsDir = this.getWorkspaceDir(coords);
    const textbookDir = path.join(wsDir, 'textbook');
    const pagesDir = path.join(textbookDir, 'pages');

    await fs.promises.mkdir(pagesDir, { recursive: true });

    const pdfFullPath = path.join(textbookDir, 'textbook.pdf');
    await fs.promises.writeFile(pdfFullPath, pdfBuffer);

    const sha256 = crypto.createHash('sha256').update(pdfBuffer).digest('hex');
    const sizeBytes = pdfBuffer.length;
    const pdfRelativePath = 'textbook/textbook.pdf';

    // Seed initial index.json if not present
    const indexPath = path.join(wsDir, 'index.json');
    if (!fs.existsSync(indexPath)) {
      const initialManifest: WorkspaceIndexManifest = {
        manifestVersion: '1.0',
        type: 'workspace_subject',
        workspaceId: `${coords.term}-${coords.grade}-${coords.subject}`,
        term: coords.term,
        grade: coords.grade,
        subject: coords.subject,
        edition,
        title: title || `Textbook ${coords.subject} ${coords.grade}`,
        source: {
          engine: 'edu7-content-engine',
          engineVersion: '1.2.0',
          sourcePdf: {
            relativePath: pdfRelativePath,
            mimeType: 'application/pdf',
            sizeBytes,
            sha256,
          },
        },
        counts: {
          units: 0,
          lessons: 0,
          concepts: 0,
          questions: 0,
          flashcards: 0,
          resources: 0,
          assets: 1,
        },
        units: [],
        package: {
          relativePath: 'edu7-content-package.json',
          profile: 'edu7.textbook-content',
          profileVersion: '1.1',
        },
        contentVersion: 1,
        updatedAt: new Date().toISOString(),
        contentHash: sha256,
      };

      await fs.promises.writeFile(
        indexPath,
        JSON.stringify(initialManifest, null, 2),
        'utf-8',
      );
    }

    return {
      workspaceDir: wsDir,
      pdfRelativePath,
      pdfFullPath,
      sizeBytes,
      sha256,
    };
  }

  /**
   * Reads workspace index manifest from directory
   */
  async readIndexManifest(workspaceDir: string): Promise<WorkspaceIndexManifest | null> {
    const indexPath = path.join(workspaceDir, 'index.json');
    try {
      const raw = await fs.promises.readFile(indexPath, 'utf-8');
      return JSON.parse(raw) as WorkspaceIndexManifest;
    } catch {
      return null;
    }
  }

  /**
   * Reads canonical content package from workspace
   */
  async readContentPackage(workspaceDir: string): Promise<ContentPackage | null> {
    const pkgPath = path.join(workspaceDir, 'edu7-content-package.json');
    try {
      const raw = await fs.promises.readFile(pkgPath, 'utf-8');
      return JSON.parse(raw) as ContentPackage;
    } catch {
      return null;
    }
  }

  /**
   * Reads an asset file from the workspace by its relative path
   */
  async readAssetFile(workspaceDir: string, relativePath: string): Promise<Buffer | null> {
    const safeRel = relativePath.replace(/^[/\\]+/, '').replace(/\.\.[/\\]/g, '');
    const fullPath = path.join(workspaceDir, safeRel);
    try {
      return await fs.promises.readFile(fullPath);
    } catch {
      return null;
    }
  }

  /**
   * Lists all discovered workspaces with index.json in the workspaces hierarchy
   */
  async listAllWorkspaces(): Promise<Array<{
    workspaceDir: string;
    relativePath: string;
    manifest: WorkspaceIndexManifest;
    packageExists: boolean;
  }>> {
    const results: Array<{
      workspaceDir: string;
      relativePath: string;
      manifest: WorkspaceIndexManifest;
      packageExists: boolean;
    }> = [];

    const findIndexFiles = async (dir: string, depth = 0) => {
      if (depth > 5) return;
      try {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            await findIndexFiles(fullPath, depth + 1);
          } else if (entry.name === 'index.json') {
            try {
              const raw = await fs.promises.readFile(fullPath, 'utf-8');
              const manifest = JSON.parse(raw) as WorkspaceIndexManifest;
              const rel = path.relative(this.workspaceBaseDir, dir);
              const pkgExists = fs.existsSync(path.join(dir, 'edu7-content-package.json'));
              results.push({
                workspaceDir: dir,
                relativePath: rel,
                manifest,
                packageExists: pkgExists,
              });
            } catch {
              // skip invalid json
            }
          }
        }
      } catch {
        // ignore errors
      }
    };

    await findIndexFiles(this.workspaceBaseDir);
    return results;
  }

  /**
   * Inspects a workspace directory thoroughly and returns structure, assets, and package info
   */
  async inspectWorkspace(workspaceDir: string): Promise<{
    workspaceDir: string;
    indexManifest: WorkspaceIndexManifest | null;
    contentPackage: ContentPackage | null;
    sourcePdfExists: boolean;
    sourcePdfPath: string | null;
    assets: Array<{
      relativePath: string;
      sizeBytes: number;
      sha256: string;
      exists: boolean;
    }>;
  }> {
    const indexManifest = await this.readIndexManifest(workspaceDir);
    const contentPackage = await this.readContentPackage(workspaceDir);

    const pdfRelative = indexManifest?.source?.sourcePdf?.relativePath || 'textbook/textbook.pdf';
    const pdfFullPath = path.join(workspaceDir, pdfRelative);
    const sourcePdfExists = fs.existsSync(pdfFullPath);

    const assets: Array<{
      relativePath: string;
      sizeBytes: number;
      sha256: string;
      exists: boolean;
    }> = [];

    if (contentPackage?.assets) {
      for (const a of contentPackage.assets) {
        const fPath = path.join(workspaceDir, a.relativePath);
        const exists = fs.existsSync(fPath);
        assets.push({
          relativePath: a.relativePath,
          sizeBytes: a.sizeBytes,
          sha256: a.sha256,
          exists,
        });
      }
    }

    return {
      workspaceDir,
      indexManifest,
      contentPackage,
      sourcePdfExists,
      sourcePdfPath: sourcePdfExists ? pdfRelative : null,
      assets,
    };
  }

  /**
   * Performs workspace segmentation: splits book into units and lessons with standard manifests
   */
  async segmentWorkspace(
    workspaceDir: string,
    unitsConfig: Array<{
      unitNumber: number;
      title: string;
      slug?: string;
      startPage?: number;
      endPage?: number;
      lessons?: Array<{
        lessonNumber: number;
        title: string;
        slug?: string;
        startPage?: number;
        endPage?: number;
      }>;
    }> = [],
  ): Promise<{
    indexManifest: WorkspaceIndexManifest;
    package: ContentPackage;
  }> {
    const slugify = (text: string, fallback: string) => {
      const clean = (text || '').trim().replace(/[^\w\u0600-\u06FF]+/gu, '-').replace(/^-+|-+$/g, '');
      return clean.toUpperCase() || fallback;
    };

    let indexManifest = await this.readIndexManifest(workspaceDir);
    const pdfRel = indexManifest?.source?.sourcePdf?.relativePath || 'textbook/textbook.pdf';
    const pdfFull = path.join(workspaceDir, pdfRel);

    let pdfSha256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    let pdfSize = 0;
    if (fs.existsSync(pdfFull)) {
      const buf = await fs.promises.readFile(pdfFull);
      pdfSha256 = crypto.createHash('sha256').update(buf).digest('hex');
      pdfSize = buf.length;
    }

    const term = indexManifest?.term || 'T1';
    const grade = indexManifest?.grade || 'G07';
    const subject = indexManifest?.subject || 'MATH';
    const edition = indexManifest?.edition || '2026';
    const title = indexManifest?.title || `كتاب ${subject}`;
    const textbookKey = `EDU-${subject}-${grade}-${term}-ED${edition}`;

    const defaultUnits = unitsConfig.length > 0 ? unitsConfig : [
      {
        unitNumber: 1,
        title: 'الوحدة الأولى: الجبر والمفاهيم الأساسية',
        slug: 'ALGEBRA',
        startPage: 1,
        endPage: 25,
        lessons: [
          { lessonNumber: 1, title: 'الدرس الأول: المعادلات الخطية', slug: 'LINEAR_EQUATIONS', startPage: 1, endPage: 12 },
          { lessonNumber: 2, title: 'الدرس الثاني: المتباينات الخطية', slug: 'LINEAR_INEQUALITIES', startPage: 13, endPage: 25 },
        ],
      },
    ];

    const assetsRegistry: any[] = [
      {
        scope: 'TEXTBOOK',
        assetType: 'TEXTBOOK_PDF',
        originalName: path.basename(pdfRel),
        relativePath: pdfRel,
        mimeType: 'application/pdf',
        sizeBytes: pdfSize,
        sha256: pdfSha256,
        version: 1,
      },
    ];

    const processedUnits: any[] = [];
    const pkgUnits: any[] = [];
    const pkgLessons: any[] = [];

    for (const u of defaultUnits) {
      const uNum = u.unitNumber;
      const uSlug = u.slug || slugify(u.title, `UNIT_${uNum}`);
      const uDirName = `unit_${String(uNum).padStart(2, '0')}_${uSlug.toLowerCase()}`;
      const uDir = path.join(workspaceDir, uDirName);
      const lessonsDir = path.join(uDir, 'lessons');
      await fs.promises.mkdir(lessonsDir, { recursive: true });

      const uPdfName = `U_${String(uNum).padStart(2, '0')}_${uSlug.toLowerCase()}.pdf`;
      const uPdfRel = `${uDirName}/${uPdfName}`;

      assetsRegistry.push({
        scope: 'UNIT',
        unitSlug: uSlug,
        assetType: 'UNIT_PDF',
        originalName: uPdfName,
        relativePath: uPdfRel,
        mimeType: 'application/pdf',
        sizeBytes: pdfSize,
        sha256: pdfSha256,
        version: 1,
      });

      pkgUnits.push({
        slug: uSlug,
        name: u.title,
        orderIndex: uNum,
        startPage: u.startPage || null,
        endPage: u.endPage || null,
        isActive: true,
      });

      const processedLessons: any[] = [];
      const lessonsList = u.lessons || [];

      for (const l of lessonsList) {
        const lNum = l.lessonNumber;
        const lSlug = l.slug || slugify(l.title, `LESSON_${lNum}`);
        const lDirName = `lesson_${String(lNum).padStart(2, '0')}_${lSlug.toLowerCase()}`;
        const lDir = path.join(lessonsDir, lDirName);
        const lPagesDir = path.join(lDir, 'pages');
        const lResourcesDir = path.join(lDir, 'resources');

        await fs.promises.mkdir(lPagesDir, { recursive: true });
        await fs.promises.mkdir(path.join(lResourcesDir, 'readings'), { recursive: true });
        await fs.promises.mkdir(path.join(lResourcesDir, 'images'), { recursive: true });
        await fs.promises.mkdir(path.join(lResourcesDir, 'summaries'), { recursive: true });

        const lPdfName = `L_${String(lNum).padStart(2, '0')}_${lSlug.toLowerCase()}.pdf`;
        const lPdfRel = `${uDirName}/lessons/${lDirName}/${lPdfName}`;

        assetsRegistry.push({
          scope: 'LESSON',
          unitSlug: uSlug,
          lessonSlug: lSlug,
          assetType: 'LESSON_PDF',
          originalName: lPdfName,
          relativePath: lPdfRel,
          mimeType: 'application/pdf',
          sizeBytes: pdfSize,
          sha256: pdfSha256,
          version: 1,
        });

        // Write lesson_01.json
        const lessonManifest = {
          manifestVersion: '1.0',
          type: 'lesson',
          unitNumber: uNum,
          lessonNumber: lNum,
          unitSlug: uSlug,
          slug: lSlug,
          name: l.title,
          orderIndex: lNum,
          startPage: l.startPage || null,
          endPage: l.endPage || null,
          relativePath: `${uDirName}/lessons/${lDirName}`,
          pdf: {
            relativePath: lPdfRel,
            mimeType: 'application/pdf',
            sha256: pdfSha256,
            sizeBytes: pdfSize,
          },
          directories: {
            pages: 'pages',
            resources: 'resources',
            summaries: 'resources/summaries',
          },
          files: {
            concepts: 'concepts.json',
            questions: 'questions.json',
            flashcards: 'flashcards.json',
            resources: 'resources.json',
            imageSummaries: 'image_summaries.json',
          },
        };

        await fs.promises.writeFile(
          path.join(lDir, `lesson_${String(lNum).padStart(2, '0')}.json`),
          JSON.stringify(lessonManifest, null, 2),
          'utf-8',
        );

        // Write empty initial sub-json manifests for concepts, questions, flashcards, resources
        await fs.promises.writeFile(path.join(lDir, 'concepts.json'), JSON.stringify([], null, 2), 'utf-8');
        await fs.promises.writeFile(path.join(lDir, 'questions.json'), JSON.stringify([], null, 2), 'utf-8');
        await fs.promises.writeFile(path.join(lDir, 'flashcards.json'), JSON.stringify([], null, 2), 'utf-8');
        await fs.promises.writeFile(path.join(lDir, 'resources.json'), JSON.stringify({ schemaVersion: '1.0', resources: [] }, null, 2), 'utf-8');

        processedLessons.push({
          lessonNumber: lNum,
          slug: lSlug,
          name: l.title,
          relativePath: `${uDirName}/lessons/${lDirName}`,
          manifest: `${uDirName}/lessons/${lDirName}/lesson_${String(lNum).padStart(2, '0')}.json`,
          pdf: lPdfRel,
        });

        pkgLessons.push({
          slug: lSlug,
          unitSlug: uSlug,
          name: l.title,
          orderIndex: lNum,
          startPage: l.startPage || null,
          endPage: l.endPage || null,
          isActive: true,
        });
      }

      // Write unit_01.json
      const unitManifest = {
        manifestVersion: '1.0',
        type: 'unit',
        unitNumber: uNum,
        slug: uSlug,
        name: u.title,
        orderIndex: uNum,
        startPage: u.startPage || null,
        endPage: u.endPage || null,
        relativePath: uDirName,
        pdf: {
          relativePath: uPdfRel,
          mimeType: 'application/pdf',
          sha256: pdfSha256,
          sizeBytes: pdfSize,
        },
        lessons: processedLessons,
      };

      await fs.promises.writeFile(
        path.join(uDir, `unit_${String(uNum).padStart(2, '0')}.json`),
        JSON.stringify(unitManifest, null, 2),
        'utf-8',
      );

      processedUnits.push({
        unitNumber: uNum,
        slug: uSlug,
        name: u.title,
        relativePath: uDirName,
        manifest: `${uDirName}/unit_${String(uNum).padStart(2, '0')}.json`,
        pdf: uPdfRel,
        lessons: processedLessons,
      });
    }

    // Write updated master index.json
    const updatedIndex: WorkspaceIndexManifest = {
      manifestVersion: '1.0',
      type: 'workspace_subject',
      workspaceId: `${term}-${grade}-${subject}`,
      term,
      grade,
      subject,
      edition,
      title,
      source: {
        engine: 'edu7-content-engine',
        engineVersion: '1.2.0',
        sourcePdf: {
          relativePath: pdfRel,
          mimeType: 'application/pdf',
          sizeBytes: pdfSize,
          sha256: pdfSha256,
        },
      },
      counts: {
        units: processedUnits.length,
        lessons: pkgLessons.length,
        concepts: 0,
        questions: 0,
        flashcards: 0,
        resources: 0,
        assets: assetsRegistry.length,
      },
      units: processedUnits,
      package: {
        relativePath: 'edu7-content-package.json',
        profile: 'edu7.textbook-content',
        profileVersion: '1.1',
      },
      contentVersion: (indexManifest?.contentVersion || 0) + 1,
      updatedAt: new Date().toISOString(),
      contentHash: pdfSha256,
    };

    await fs.promises.writeFile(
      path.join(workspaceDir, 'index.json'),
      JSON.stringify(updatedIndex, null, 2),
      'utf-8',
    );

    // Write canonical package
    const canonicalPkg: ContentPackage = {
      meta: {
        profile: 'edu7.textbook-content',
        profileVersion: '1.1',
        scope: 'FULL',
        exportedAt: new Date().toISOString(),
      },
      textbook: {
        key: textbookKey,
        subjectKey: subject,
        gradeKey: grade,
        termKey: term,
        title,
        edition,
        description: null,
        issuer: null,
        isbn: null,
        publishYear: null,
        totalPages: null,
        status: 'DRAFT',
      },
      units: pkgUnits,
      lessons: pkgLessons,
      concepts: [],
      prerequisites: [],
      misconceptions: [],
      learningResources: [],
      questions: [],
      assets: assetsRegistry,
    };

    await fs.promises.writeFile(
      path.join(workspaceDir, 'edu7-content-package.json'),
      JSON.stringify(canonicalPkg, null, 2),
      'utf-8',
    );

    return {
      indexManifest: updatedIndex,
      package: canonicalPkg,
    };
  }
}

