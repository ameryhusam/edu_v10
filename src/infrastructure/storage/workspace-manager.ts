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
  readonly edition?: string | undefined;
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
  readonly storagePolicy?: {
    readonly sourcePdfPersisted?: boolean;
    readonly unitPdfPersisted?: boolean;
    readonly bookPdfPersisted?: boolean;
    readonly textbookPageImagesPersisted?: boolean;
  };
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

  constructor(workspaceBaseDir: string) {
    this.workspaceBaseDir = path.resolve(workspaceBaseDir);
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
    const base = path.join(this.workspaceBaseDir, termNorm, gradeNorm, subjectNorm);
    if (!coords.edition) return base;
    const editionNorm = coords.edition.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').replace(/^ED(?=\d)/, '');
    if (!editionNorm) throw new Error('Printed edition is required for a textbook workspace.');
    return path.join(base, `ED${editionNorm}`);
  }

  /** Resolves the canonical workspace path from the derived textbook key. */
  getWorkspaceDirFromTextbookKey(textbookKey: string): string {
    const match = /^EDU-(.+?)-G(\d+)-T(\d+)-ED(.+)$/i.exec(textbookKey.trim());
    if (!match) throw new Error(`Invalid textbook key: ${textbookKey}`);

    const [, subject, grade, term, edition] = match;
    if (!subject || !grade || !term || !edition) {
      throw new Error(`Invalid textbook key coordinates: ${textbookKey}`);
    }

    return this.getWorkspaceDir({
      subject,
      grade: `G${grade}`,
      term: `T${term}`,
      edition,
    });
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
    const wsDir = this.getWorkspaceDir({ ...coords, edition });
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
    const sourcePersisted = indexManifest?.storagePolicy?.sourcePdfPersisted !== false;
    const sourcePdfExists = sourcePersisted && fs.existsSync(pdfFullPath);

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
  /**
   * Validates a workspace produced by the canonical Python content engine.
   *
   * This method intentionally does NOT fabricate unit/lesson PDFs. Physical
   * PDF slicing, printed-page ↔ PDF-page mapping and page rendering belong to
   * edu7-content-engine. Node consumes the resulting workspace as an artifact.
   */
  async segmentWorkspace(workspaceDir: string): Promise<{
    indexManifest: WorkspaceIndexManifest;
    package: ContentPackage;
  }> {
    const indexManifest = await this.readIndexManifest(workspaceDir);
    const pkg = await this.readContentPackage(workspaceDir);
    if (!indexManifest || !pkg) {
      throw new Error(
        'Workspace is not segmented. Run edu7-content-engine prepare first; Node will only reconcile the generated workspace.',
      );
    }

    const referenced = new Set<string>();
    for (const asset of pkg.assets ?? []) {
      referenced.add(asset.relativePath);
      const file = await this.readAssetFile(workspaceDir, asset.relativePath);
      if (!file) throw new Error(`Workspace asset missing: ${asset.relativePath}`);
      const sha256 = crypto.createHash('sha256').update(file).digest('hex');
      if (asset.sha256 && sha256.toLowerCase() !== asset.sha256.toLowerCase()) {
        throw new Error(`Workspace asset checksum mismatch: ${asset.relativePath}`);
      }
    }

    const source = indexManifest.source?.sourcePdf;
    const sourcePersisted = indexManifest.storagePolicy?.sourcePdfPersisted !== false;
    if (source && sourcePersisted) {
      const sourceFile = await this.readAssetFile(workspaceDir, source.relativePath);
      if (!sourceFile) throw new Error(`Workspace source PDF missing: ${source.relativePath}`);
      const sourceHash = crypto.createHash('sha256').update(sourceFile).digest('hex');
      if (source.sha256 && sourceHash !== source.sha256) {
        throw new Error('Workspace source PDF checksum mismatch');
      }
    }

    return { indexManifest, package: pkg };
  }
}

