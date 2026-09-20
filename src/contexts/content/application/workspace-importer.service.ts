/**
 * Workspace Importer Application Service
 *
 * Implements the workspace ingestion pipeline defined in the final project plan:
 *  1. Discovers and reads the Workspace directory and `index.json` / `edu7-content-package.json`
 *  2. Verifies local asset files (PDFs, page renders, lesson sub-packages) and their checksums
 *  3. Ingests the content structure and questions via ContentImportService
 *  4. Synchronises assets into ContentStorage and ContentAssetRepository
 */

import * as crypto from 'node:crypto';
import type { ContentImportService, ImportResult } from './content-import.service.js';
import type { ContentAssetService } from './content-asset.service.js';
import type { WorkspaceManager } from '../../../infrastructure/storage/workspace-manager.js';
import { Errors, DomainErrorException } from '../../../shared/kernel/errors.js';
import type { ContentPackage } from '../domain/export-profile.js';
import type { AuthorContext } from './authoring.service.js';

export interface WorkspaceImportOptions {
  readonly dryRun?: boolean;
  readonly syncAssets?: boolean;
  readonly actorKey?: string;
}

export interface WorkspaceImportResult {
  readonly workspaceDir: string;
  readonly textbookKey: string;
  readonly dryRun: boolean;
  readonly importSummary: ImportResult;
  readonly assetsVerified: number;
  readonly assetsUploaded: number;
  readonly missingAssets: readonly string[];
}

export class WorkspaceImporterService {
  constructor(
    private readonly workspaceManager: WorkspaceManager,
    private readonly contentImportService: ContentImportService,
    private readonly assetService: ContentAssetService,
  ) {}

  /**
   * Ingests a full workspace directory by path
   */
  async importFromWorkspace(
    workspaceDir: string,
    options: WorkspaceImportOptions = {},
  ): Promise<WorkspaceImportResult> {
    const pkg = await this.workspaceManager.readContentPackage(workspaceDir);
    if (!pkg) {
      throw new DomainErrorException(
        Errors.validation(
          'workspace.package_not_found',
          `Could not find edu7-content-package.json in workspace directory: ${workspaceDir}`,
        ),
      );
    }

    const textbookKey = pkg.textbook.key;
    const dryRun = options.dryRun ?? false;

    // 1. Check local assets if present in package
    const missingAssets: string[] = [];
    let assetsVerified = 0;
    let assetsUploaded = 0;

    if (pkg.assets && pkg.assets.length > 0) {
      for (const asset of pkg.assets) {
        const fileBuf = await this.workspaceManager.readAssetFile(workspaceDir, asset.relativePath);
        if (!fileBuf) {
          missingAssets.push(asset.relativePath);
          continue;
        }

        const sha256 = crypto.createHash('sha256').update(fileBuf).digest('hex');
        if (asset.sha256 && sha256.toLowerCase() !== asset.sha256.toLowerCase()) {
          missingAssets.push(`${asset.relativePath} (checksum mismatch)`);
          continue;
        }

        assetsVerified++;

        if (!dryRun && options.syncAssets !== false) {
          await this.assetService.uploadAsset({
            textbookKey,
            relativePath: asset.relativePath,
            buffer: fileBuf,
            assetType: asset.assetType as any,
            scope: asset.scope,
            unitKey: asset.unitSlug ? `${textbookKey}-U-${asset.unitSlug}` : null,
            lessonKey: asset.lessonSlug && asset.unitSlug ? `${textbookKey}-U-${asset.unitSlug}-L-${asset.lessonSlug}` : null,
            conceptKey: asset.conceptSlug && asset.lessonSlug && asset.unitSlug ? `${textbookKey}-U-${asset.unitSlug}-L-${asset.lessonSlug}-C-${asset.conceptSlug}` : null,
            mimeType: asset.mimeType,
            originalName: asset.originalName,
            pageStart: asset.pageStart,
            pageEnd: asset.pageEnd,
            title: asset.title,
            altText: asset.altText,
            caption: asset.caption,
          });
          assetsUploaded++;
        }
      }
    }

    // 2. Perform ContentImportService execution
    const authorCtx: AuthorContext = { actorKey: options.actorKey || 'SYSTEM_WORKSPACE_IMPORTER' };
    const importRes = await this.contentImportService.importPackage(authorCtx, pkg, {
      dryRun,
    });

    if (!importRes.ok) {
      throw new DomainErrorException(importRes.error);
    }

    return {
      workspaceDir,
      textbookKey,
      dryRun,
      importSummary: importRes.value,
      assetsVerified,
      assetsUploaded,
      missingAssets,
    };
  }

  /**
   * Lists all existing workspaces
   */
  async listWorkspaces() {
    return this.workspaceManager.listAllWorkspaces();
  }

  /**
   * Inspects a workspace
   */
  async inspectWorkspace(workspaceDir: string) {
    return this.workspaceManager.inspectWorkspace(workspaceDir);
  }

  /**
   * Prepares and stores a textbook source PDF into workspace
   */
  async prepareWorkspace(input: {
    term: string;
    grade: string;
    subject: string;
    edition?: string;
    title?: string;
    pdfBuffer?: Buffer;
    autoSegment?: boolean;
    units?: Array<any>;
  }) {
    const coords = {
      term: input.term,
      grade: input.grade,
      subject: input.subject,
    };

    let storeRes;
    if (input.pdfBuffer && input.pdfBuffer.length > 0) {
      storeRes = await this.workspaceManager.storeTextbookSource(
        coords,
        input.pdfBuffer,
        input.edition || '2026',
        input.title,
      );
    } else {
      const wsDir = this.workspaceManager.getWorkspaceDir(coords);
      storeRes = {
        workspaceDir: wsDir,
        pdfRelativePath: 'textbook/textbook.pdf',
        pdfFullPath: `${wsDir}/textbook/textbook.pdf`,
        sizeBytes: 0,
        sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      };
    }

    if (input.autoSegment !== false) {
      const segmentRes = await this.workspaceManager.segmentWorkspace(
        storeRes.workspaceDir,
        input.units || [],
      );
      return {
        ...storeRes,
        ...segmentRes,
      };
    }

    const index = await this.workspaceManager.readIndexManifest(storeRes.workspaceDir);
    const pkg = await this.workspaceManager.readContentPackage(storeRes.workspaceDir);

    return {
      ...storeRes,
      indexManifest: index,
      package: pkg,
    };
  }

  /**
   * Segments an existing workspace
   */
  async segmentWorkspace(workspaceDir: string, units?: Array<any>) {
    return this.workspaceManager.segmentWorkspace(workspaceDir, units);
  }
}
