/**
 * Content Asset Application Service
 *
 * Orchestrates physical content asset uploads, retrieval, streaming, and metadata
 * association within the Content bounded context.
 */

import {
  validateAsset,
  validateAssetPath,
  deriveStorageKey,
  type ContentAssetScope,
  type ContentAssetType,
} from '../domain/assets.js';
import type {
  ContentAssetRepository,
  ContentAssetRecord,
  ContentStorage,
  CreateAssetInput,
} from './ports.js';
import type { ContentAssetExport, ContentPackage } from '../domain/export-profile.js';
import { Errors, DomainErrorException } from '../../../shared/kernel/errors.js';
import { contentAssetKey, textbookKey as buildTextbookKey } from '../../../shared/kernel/identifiers.js';

export interface UploadTextbookSourceInput {
  readonly term: string;
  readonly grade: string;
  readonly subject: string;
  readonly edition?: string;
  readonly title?: string;
  readonly buffer: Buffer;
}

export interface UploadAssetInput {
  readonly textbookKey: string;
  readonly relativePath: string;
  readonly buffer: Buffer;
  readonly assetType: ContentAssetType;
  readonly scope: ContentAssetScope;
  readonly unitKey?: string | null;
  readonly lessonKey?: string | null;
  readonly conceptKey?: string | null;
  readonly mimeType?: string;
  readonly originalName?: string;
  readonly pageStart?: number | null;
  readonly pageEnd?: number | null;
  readonly title?: string | null;
  readonly altText?: string | null;
  readonly caption?: string | null;
}

export class ContentAssetService {
  constructor(
    private readonly assetRepo: ContentAssetRepository,
    private readonly storage: ContentStorage,
  ) {}

  /**
   * Stores a raw textbook PDF as the foundational source asset
   */
  async uploadTextbookSource(input: UploadTextbookSourceInput): Promise<ContentAssetRecord> {
    const edition = input.edition || '2026';
    const gradeNum = parseInt(input.grade.replace(/\D/g, ''), 10) || 1;
    const termNum = parseInt(input.term.replace(/\D/g, ''), 10) || 1;

    const tbKeyRes = buildTextbookKey({
      subject: input.subject,
      grade: gradeNum,
      term: termNum,
      edition,
    });

    if (!tbKeyRes.ok) {
      throw new DomainErrorException(tbKeyRes.error);
    }
    const tbKey = tbKeyRes.value;

    const relativePath = 'textbook/textbook.pdf';
    return this.uploadAsset({
      textbookKey: tbKey,
      relativePath,
      buffer: input.buffer,
      assetType: 'TEXTBOOK_PDF',
      scope: 'TEXTBOOK',
      mimeType: 'application/pdf',
      originalName: `${input.subject}_${input.grade}_${input.term}.pdf`,
      title: input.title || `Textbook ${input.subject} ${input.grade}`,
    });
  }

  /**
   * Uploads and registers a content asset binary with metadata
   */
  async uploadAsset(input: UploadAssetInput): Promise<ContentAssetRecord> {
    const validPathRes = validateAssetPath(input.relativePath);
    if (!validPathRes.ok) {
      throw new DomainErrorException(validPathRes.error);
    }
    const cleanRelPath = validPathRes.value;

    const storageKey = deriveStorageKey(input.textbookKey, cleanRelPath);
    const mimeType = input.mimeType || this.inferMimeType(cleanRelPath);

    const { sizeBytes, sha256 } = await this.storage.writeBuffer(
      storageKey,
      input.buffer,
      mimeType,
    );

    const assetKeyRes = contentAssetKey(input.textbookKey, cleanRelPath);
    if (!assetKeyRes.ok) {
      throw new DomainErrorException(assetKeyRes.error);
    }
    const assetKey = assetKeyRes.value;

    const validRes = validateAsset({
      key: assetKey,
      assetType: input.assetType,
      originalName: input.originalName || cleanRelPath.split('/').pop() || 'asset',
      relativePath: cleanRelPath,
      storageKey,
      mimeType,
      sizeBytes,
      sha256,
      version: 1,
      scope: input.scope,
      textbookKey: input.textbookKey,
      unitKey: input.unitKey ?? null,
      lessonKey: input.lessonKey ?? null,
      conceptKey: input.conceptKey ?? null,
      pageStart: input.pageStart ?? null,
      pageEnd: input.pageEnd ?? null,
      title: input.title ?? null,
      altText: input.altText ?? null,
      caption: input.caption ?? null,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    if (!validRes.ok) {
      throw new DomainErrorException(validRes.error);
    }

    const createInput: CreateAssetInput = {
      key: assetKey,
      assetType: input.assetType,
      originalName: input.originalName || cleanRelPath.split('/').pop() || 'asset',
      relativePath: cleanRelPath,
      storageKey,
      mimeType,
      sizeBytes,
      sha256,
      version: 1,
      scope: input.scope,
      textbookKey: input.textbookKey,
      unitKey: input.unitKey ?? null,
      lessonKey: input.lessonKey ?? null,
      conceptKey: input.conceptKey ?? null,
      pageStart: input.pageStart ?? null,
      pageEnd: input.pageEnd ?? null,
      title: input.title ?? null,
      altText: input.altText ?? null,
      caption: input.caption ?? null,
    };

    const existing = await this.assetRepo.findAssetByKey(assetKey);
    if (existing) {
      return this.assetRepo.updateAssetMetadata(assetKey, createInput);
    }

    return this.assetRepo.createAsset(createInput);
  }

  /**
   * Fetches an asset's readable stream, supporting HTTP byte-range slicing
   */
  async getAssetStream(
    assetKey: string,
    range?: { start?: number; end?: number },
  ): Promise<{
    stream: NodeJS.ReadableStream;
    asset: ContentAssetRecord;
  } | null> {
    const asset = await this.assetRepo.findAssetByKey(assetKey);
    if (!asset || !asset.isActive) return null;

    const stream = await this.storage.readStream(asset.storageKey, range);
    if (!stream) return null;

    return { stream, asset };
  }

  /**
   * Fetches asset metadata by key
   */
  async getAssetByKey(key: string): Promise<ContentAssetRecord | null> {
    return this.assetRepo.findAssetByKey(key);
  }

  /**
   * Lists assets for a given textbook
   */
  async listTextbookAssets(
    textbookKey: string,
    options?: { scope?: ContentAssetScope; assetType?: ContentAssetType },
  ): Promise<readonly ContentAssetRecord[]> {
    return this.assetRepo.listAssetsForTextbook(textbookKey, options);
  }

  /**
   * Synchronises assets declared in an exported ContentPackage
   */
  async syncPackageAssets(
    textbookKey: string,
    packageAssets: readonly ContentAssetExport[],
  ): Promise<{
    registered: number;
    verified: number;
  }> {
    let registered = 0;
    let verified = 0;

    for (const exp of packageAssets) {
      const storageKey = deriveStorageKey(textbookKey, exp.relativePath);
      const existsInStorage = await this.storage.exists(storageKey);

      const assetKeyRes = contentAssetKey(textbookKey, exp.relativePath);
      if (!assetKeyRes.ok) continue;
      const assetKey = assetKeyRes.value;

      const existing = await this.assetRepo.findAssetByKey(assetKey);
      if (!existing) {
        await this.assetRepo.createAsset({
          key: assetKey,
          assetType: exp.assetType as ContentAssetType,
          originalName: exp.originalName,
          relativePath: exp.relativePath,
          storageKey,
          mimeType: exp.mimeType,
          sizeBytes: exp.sizeBytes,
          sha256: exp.sha256,
          version: exp.version,
          scope: exp.scope,
          textbookKey,
          unitKey: exp.unitSlug ? `${textbookKey}-U-${exp.unitSlug}` : null,
          lessonKey: exp.lessonSlug && exp.unitSlug ? `${textbookKey}-U-${exp.unitSlug}-L-${exp.lessonSlug}` : null,
          conceptKey: exp.conceptSlug && exp.lessonSlug && exp.unitSlug ? `${textbookKey}-U-${exp.unitSlug}-L-${exp.lessonSlug}-C-${exp.conceptSlug}` : null,
          pageStart: exp.pageStart ?? null,
          pageEnd: exp.pageEnd ?? null,
          title: exp.title ?? null,
          altText: exp.altText ?? null,
          caption: exp.caption ?? null,
        });
        registered++;
      }

      if (existsInStorage) {
        verified++;
      }
    }

    return { registered, verified };
  }

  private inferMimeType(relativePath: string): string {
    const ext = relativePath.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'pdf':
        return 'application/pdf';
      case 'png':
        return 'image/png';
      case 'jpg':
      case 'jpeg':
        return 'image/jpeg';
      case 'svg':
        return 'image/svg+xml';
      case 'json':
        return 'application/json';
      case 'txt':
        return 'text/plain';
      case 'mp3':
        return 'audio/mpeg';
      case 'mp4':
        return 'video/mp4';
      default:
        return 'application/octet-stream';
    }
  }
}
