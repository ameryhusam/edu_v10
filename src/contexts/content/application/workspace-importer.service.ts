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
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ContentImportService, ImportResult } from './content-import.service.js';
import type { ContentAssetService } from './content-asset.service.js';
import type { WorkspacePort } from './workspace.ports.js';
import { Errors, DomainErrorException } from '../../../shared/kernel/errors.js';
import type { ContentPackage } from '../domain/export-profile.js';
import type { AuthorContext, ContentAuthoringService } from './authoring.service.js';
import { textbookKey as buildTextbookKey } from '../../../shared/kernel/identifiers.js';
import type { ContentEnginePort } from './content-engine.port.js';

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
    private readonly workspaceManager: WorkspacePort,
    private readonly contentImportService: ContentImportService,
    private readonly assetService: ContentAssetService,
    private readonly contentEngine: ContentEnginePort,
    private readonly engineTimeoutMs: number,
    private readonly authoring: ContentAuthoringService,
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

    // Content structure is created first. ContentAsset rows have real foreign
    // keys to Textbook/Unit/Lesson/Concept, so asset registration must never
    // race ahead of the canonical content authoring transaction.
    const authorCtx: AuthorContext = { actorKey: options.actorKey || 'SYSTEM_WORKSPACE_IMPORTER' };
    const importRes = await this.contentImportService.importPackage(authorCtx, pkg, { dryRun });
    if (!importRes.ok) throw new DomainErrorException(importRes.error);

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

    // Reconcile physical page/AI-page/resource files that may have been added
    // after preparation. The workspace is intentionally an editable content
    // source; package manifests are not the only source of physical assets.
    const packagedPaths = new Set((pkg.assets ?? []).map((asset) => asset.relativePath));
    const discovered = await this.discoverEditableAssets(workspaceDir, textbookKey, packagedPaths);
    for (const asset of discovered) {
      if (!dryRun && options.syncAssets !== false) {
        await this.assetService.uploadAsset(asset);
        assetsUploaded++;
      }
      assetsVerified++;
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

  private async discoverEditableAssets(
    workspaceDir: string,
    textbookKey: string,
    packagedPaths: Set<string>,
  ): Promise<Array<{
    textbookKey: string;
    relativePath: string;
    buffer: Buffer;
    assetType: any;
    scope: 'TEXTBOOK' | 'LESSON';
    lessonKey?: string | null;
    unitKey?: string | null;
    mimeType?: string;
    originalName?: string;
    pageStart?: number | null;
    pageEnd?: number | null;
    title?: string | null;
  }>> {
    const discovered: Array<any> = [];
    const add = async (
      relativePath: string,
      assetType: string,
      scope: 'TEXTBOOK' | 'LESSON',
      unitSlug?: string,
      lessonSlug?: string,
    ) => {
      if (packagedPaths.has(relativePath)) return;
      const full = path.join(workspaceDir, relativePath);
      const buffer = await fs.readFile(full);
      const parts = relativePath.split('/');
      const file = parts.at(-1);
      if (!file) return;

      const mimeType =
        file.endsWith('.png') ? 'image/png' :
        file.endsWith('.jpg') || file.endsWith('.jpeg') ? 'image/jpeg' :
        file.endsWith('.webp') ? 'image/webp' :
        file.endsWith('.mp3') ? 'audio/mpeg' :
        file.endsWith('.wav') ? 'audio/wav' :
        file.endsWith('.mp4') ? 'video/mp4' :
        file.endsWith('.webm') ? 'video/webm' :
        'application/octet-stream';
      const pageMatch = file.match(/page_(\d+)/i);
      discovered.push({
        textbookKey,
        relativePath,
        buffer,
        assetType,
        scope,
        ...(unitSlug && lessonSlug ? {
          unitKey: `${textbookKey}-U-${unitSlug}`,
          lessonKey: `${textbookKey}-U-${unitSlug}-L-${lessonSlug}`,
        } : {}),
        mimeType,
        originalName: file,
        pageStart: pageMatch ? Number(pageMatch[1]) : null,
        pageEnd: pageMatch ? Number(pageMatch[1]) : null,
      });
    };

    const cover = path.join(workspaceDir, 'cover', 'cover.png');
    try { await fs.access(cover); await add('cover/cover.png', 'PAGE_IMAGE', 'TEXTBOOK'); } catch {}

    const unitEntries = await fs.readdir(workspaceDir, { withFileTypes: true });
    for (const unitEntry of unitEntries) {
      if (!unitEntry.isDirectory() || !unitEntry.name.startsWith('unit_')) continue;
      const unitDir = path.join(workspaceDir, unitEntry.name);
      const lessonEntries = await fs.readdir(unitDir, { withFileTypes: true });
      for (const lessonEntry of lessonEntries) {
        if (!lessonEntry.isDirectory() || !lessonEntry.name.startsWith('lesson_')) continue;
        const lessonDir = path.join(unitDir, lessonEntry.name);
        const manifestPath = path.join(lessonDir, 'lesson_manifest.json');
        let manifest: any;
        try { manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')); } catch { continue; }
        const unitSlug = String(manifest.unitSlug ?? '').trim();
        const lessonSlug = String(manifest.lessonSlug ?? '').trim();
        if (!unitSlug || !lessonSlug) continue;

        for (const [dirName, type] of [['pages', 'PAGE_IMAGE'], ['ai_pages', 'IMAGE_SUMMARY']] as const) {
          const dir = path.join(lessonDir, dirName);
          try {
            const files = await fs.readdir(dir);
            for (const file of files.filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).sort()) {
              await add(`${unitEntry.name}/${lessonEntry.name}/${dirName}/${file}`, type, 'LESSON', unitSlug, lessonSlug);
            }
          } catch {}
        }

        const resourceDir = path.join(lessonDir, 'resource');
        try {
          const files = await fs.readdir(resourceDir, { recursive: true } as any);
          for (const file of files as string[]) {
            const rel = `${unitEntry.name}/${lessonEntry.name}/resource/${file}`;
            const full = path.join(workspaceDir, rel);
            const stat = await fs.stat(full);
            if (!stat.isFile()) continue;
            const ext = path.extname(file).toLowerCase();
            const type = ['.mp3','.wav','.m4a','.ogg'].includes(ext) ? 'AUDIO'
              : ['.mp4','.webm','.mov'].includes(ext) ? 'VIDEO' : 'RESOURCE_FILE';
            await add(rel, type, 'LESSON', unitSlug, lessonSlug);
          }
        } catch {}
      }
    }
    return discovered;
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
   * Analyzes a raw PDF first, reconciles its physical identity, and only then
   * creates/resolves the canonical textbook and prepares Workspace content.
   *
   * A declared identity is supported for the existing admin flow. A mismatch
   * never mutates a frozen Textbook identity; it returns CONFIRM_REQUIRED so
   * the caller can explicitly accept the detected identity or cancel.
   */
  async prepareBookImport(input: {
    pdfBuffer: Buffer;
    declared?: {
      subjectKey?: string;
      gradeKey?: string;
      part?: 'PART_1' | 'PART_2';
      edition?: string;
      title?: string;
    };
    confirmDetectedIdentity?: boolean;
  }) {
    const proposal = await this.contentEngine.identify({ pdf: input.pdfBuffer, analysisPages: 15, dpi: 150 });
    const detected = proposal.identity;
    const conflicts: Array<{ field: string; declared: string | null; detected: string | null }> = [];
    const compare = (field: 'subjectKey' | 'gradeKey' | 'part' | 'edition') => {
      const declared = input.declared?.[field] ?? null;
      const value = detected[field] ?? null;
      if (declared && value && declared.toUpperCase() !== value.toUpperCase()) conflicts.push({ field, declared, detected: value });
    };
    compare('subjectKey'); compare('gradeKey'); compare('part'); compare('edition');

    if (proposal.status === 'NEEDS_REVIEW' || !detected.subjectKey || !detected.gradeKey || !detected.part || (detected.part !== 'BOTH' && !detected.edition)) {
      return { status: 'NEEDS_REVIEW' as const, proposal, conflicts };
    }
    if (conflicts.length > 0 && !input.confirmDetectedIdentity) {
      return { status: 'CONFIRM_REQUIRED' as const, proposal, conflicts };
    }

    const parts: Array<'PART_1' | 'PART_2'> = detected.part === 'BOTH' ? ['PART_1', 'PART_2'] : [detected.part];
    const textbooks: Array<{ key: string; created: boolean; part: 'PART_1' | 'PART_2' }> = [];
    for (const part of parts) {
      const edition = detected.edition!;
      const title = (detected.title || input.declared?.title || `${detected.subjectKey} ${detected.gradeKey} ${part}`).trim();
      const created = await this.authoring.createTextbook(
        { actorKey: 'SYSTEM_CONTENT_IMPORT' },
        {
          subjectKey: detected.subjectKey,
          gradeKey: detected.gradeKey,
          part,
          title,
          edition,
          issuer: detected.issuer ?? null,
          publishYear: detected.publicationYear ?? null,
        },
      );
      if (created.ok) {
        textbooks.push({ key: created.value.key, created: true, part });
      } else if (created.error.code === 'content.textbook_exists') {
        const built = buildTextbookKey({ subject: detected.subjectKey, grade: Number(String(detected.gradeKey).replace(/^G/i, '')), part, edition });
        if (!built.ok) throw new DomainErrorException(built.error);
        textbooks.push({ key: built.value, created: false, part });
      } else {
        throw new DomainErrorException(created.error);
      }
    }

    const workspaceRoot = detected.part === 'BOTH'
      ? path.resolve(this.workspaceManager.getWorkspaceDir({ part: 'PART_1', grade: detected.gradeKey, subject: detected.subjectKey, edition: detected.edition }), '../../../../')
      : this.workspaceManager.getWorkspaceDir({ part: parts[0]!, grade: detected.gradeKey, subject: detected.subjectKey, edition: detected.edition });
    const prepared = await this.prepareWorkspace({
      part: detected.part === 'BOTH' ? 'BOTH' as any : parts[0]!,
      grade: detected.gradeKey,
      subject: detected.subjectKey,
      edition: detected.edition,
      title: detected.title ?? input.declared?.title,
      pdfBuffer: input.pdfBuffer,
      autoSegment: true,
      workspaceRootOverride: workspaceRoot,
    });
    return { status: 'PREPARED' as const, proposal, conflicts, textbooks, prepared };
  }

  /**
   * Prepares and stores a textbook source PDF into workspace
   */
  async prepareWorkspace(input: {
    part: 'PART_1' | 'PART_2';
    grade: string;
    subject: string;
    edition?: string;
    title?: string;
    pdfBuffer?: Buffer;
    autoSegment?: boolean;
    units?: Array<any>;
    workspaceRootOverride?: string;
  }) {
    const edition = input.edition;
    const coords = { part: input.part, grade: input.grade, subject: input.subject, ...(edition ? { edition } : {}) };
    const wsDir = input.workspaceRootOverride ?? (edition
      ? this.workspaceManager.getWorkspaceDir(coords)
      : this.workspaceManager.getWorkspaceDir({ part: input.part, grade: input.grade, subject: input.subject }));

    if (input.pdfBuffer && input.pdfBuffer.length > 0) {
      if (input.autoSegment === false) {
        throw new DomainErrorException(
          Errors.validation(
            'workspace.prepare_requires_engine',
            'Book upload must run through the Python content engine; disabling segmentation is not supported for uploaded books.',
          ),
        );
      }

      const engineResult = await this.contentEngine.prepare({
        pdf: input.pdfBuffer,
        workspaceDir: wsDir,
        subject: input.subject,
        grade: input.grade,
        part: input.part,
        edition,
        title: input.title,
        timeoutMs: this.engineTimeoutMs,
      });

      const preparedWorkspaceDir = engineResult.workspaceDir;
      const index = await this.workspaceManager.readIndexManifest(preparedWorkspaceDir);
      const pkg = await this.workspaceManager.readContentPackage(preparedWorkspaceDir);
      if (!index || !pkg) {
        throw new DomainErrorException(
          Errors.internal(
            'workspace.engine_output_invalid',
            'The content engine completed but did not produce a valid workspace package.',
            { stdout: engineResult.stdout.slice(-4000), stderr: engineResult.stderr.slice(-4000) },
          ),
        );
      }
      return {
        workspaceDir: preparedWorkspaceDir,
        sourcePdfPersisted: false,
        indexManifest: index,
        package: pkg,
        segmentationStatus: 'PREPARED_BY_CONTENT_ENGINE' as const,
        engine: { stdout: engineResult.stdout, stderr: engineResult.stderr },
      };
    }

    const index = await this.workspaceManager.readIndexManifest(wsDir);
    const pkg = await this.workspaceManager.readContentPackage(wsDir);
    return {
      workspaceDir: wsDir,
      indexManifest: index,
      package: pkg,
      segmentationStatus: index && pkg ? 'RECONCILED' as const : 'REQUIRES_CONTENT_ENGINE' as const,
    };
  }

  /**
   * Segments an existing workspace
   */
  async segmentWorkspace(workspaceDir: string) {
    return this.workspaceManager.segmentWorkspace(workspaceDir);
  }
}
