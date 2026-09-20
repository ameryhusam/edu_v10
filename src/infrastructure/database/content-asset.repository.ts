/**
 * Content Asset Repository (Prisma and in-memory store adapter).
 *
 * Persists and retrieves content assets (PDFs, images, diagrams, audio)
 * attached to textbooks, units, lessons, or concepts.
 */

import type {
  ContentAssetRepository,
  ContentAssetRecord,
  CreateAssetInput,
} from '../../contexts/content/application/ports.js';
import type { ContentAssetScope, ContentAssetType } from '../../contexts/content/domain/assets.js';
import type { Db } from './prisma.client.js';

export class PrismaContentAssetRepository implements ContentAssetRepository {
  private inMemoryAssets = new Map<string, ContentAssetRecord>();

  constructor(private readonly db?: Db) {}

  async findAssetByKey(key: string): Promise<ContentAssetRecord | null> {
    const mem = this.inMemoryAssets.get(key);
    if (mem && mem.isActive) return mem;

    if (this.db) {
      const row = await this.db.learningResource.findUnique({
        where: { key },
        include: { textbook: true, lesson: true, concept: true },
      });
      if (row && row.isActive) {
        return this.mapResourceToAsset(row);
      }
    }
    return null;
  }

  async findAssetByStorageKey(storageKey: string): Promise<ContentAssetRecord | null> {
    for (const asset of this.inMemoryAssets.values()) {
      if (asset.storageKey === storageKey && asset.isActive) {
        return asset;
      }
    }
    if (this.db) {
      const row = await this.db.learningResource.findFirst({
        where: { url: storageKey, isActive: true },
        include: { textbook: true, lesson: true, concept: true },
      });
      if (row) return this.mapResourceToAsset(row);
    }
    return null;
  }

  async findAssetByChecksum(textbookKey: string, sha256: string): Promise<ContentAssetRecord | null> {
    for (const asset of this.inMemoryAssets.values()) {
      if (asset.textbookKey === textbookKey && asset.sha256 === sha256 && asset.isActive) {
        return asset;
      }
    }
    return null;
  }

  async findAssetByRelativePath(
    textbookKey: string,
    relativePath: string,
  ): Promise<ContentAssetRecord | null> {
    for (const asset of this.inMemoryAssets.values()) {
      if (
        asset.textbookKey === textbookKey &&
        asset.relativePath === relativePath &&
        asset.isActive
      ) {
        return asset;
      }
    }
    return null;
  }

  async listAssetsForTextbook(
    textbookKey: string,
    options?: { scope?: ContentAssetScope; assetType?: ContentAssetType },
  ): Promise<readonly ContentAssetRecord[]> {
    const list: ContentAssetRecord[] = [];
    for (const asset of this.inMemoryAssets.values()) {
      if (asset.textbookKey !== textbookKey || !asset.isActive) continue;
      if (options?.scope && asset.scope !== options.scope) continue;
      if (options?.assetType && asset.assetType !== options.assetType) continue;
      list.push(asset);
    }
    return list;
  }

  async listAssetsForNode(input: {
    scope: ContentAssetScope;
    nodeKey: string;
  }): Promise<readonly ContentAssetRecord[]> {
    const list: ContentAssetRecord[] = [];
    for (const asset of this.inMemoryAssets.values()) {
      if (!asset.isActive || asset.scope !== input.scope) continue;
      if (
        (input.scope === 'TEXTBOOK' && asset.textbookKey === input.nodeKey) ||
        (input.scope === 'UNIT' && asset.unitKey === input.nodeKey) ||
        (input.scope === 'LESSON' && asset.lessonKey === input.nodeKey) ||
        (input.scope === 'CONCEPT' && asset.conceptKey === input.nodeKey)
      ) {
        list.push(asset);
      }
    }
    return list;
  }

  async createAsset(input: CreateAssetInput): Promise<ContentAssetRecord> {
    const now = new Date();
    const record: ContentAssetRecord = {
      id: input.key,
      key: input.key,
      assetType: input.assetType,
      originalName: input.originalName,
      relativePath: input.relativePath,
      storageKey: input.storageKey,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      sha256: input.sha256,
      version: input.version ?? 1,
      isActive: true,
      scope: input.scope,
      textbookId: input.textbookKey,
      textbookKey: input.textbookKey,
      unitId: input.unitKey ?? null,
      unitKey: input.unitKey ?? null,
      lessonId: input.lessonKey ?? null,
      lessonKey: input.lessonKey ?? null,
      conceptId: input.conceptKey ?? null,
      conceptKey: input.conceptKey ?? null,
      pageStart: input.pageStart ?? null,
      pageEnd: input.pageEnd ?? null,
      title: input.title ?? null,
      altText: input.altText ?? null,
      caption: input.caption ?? null,
      createdAt: now,
      updatedAt: now,
    };

    this.inMemoryAssets.set(record.key, record);
    return record;
  }

  async updateAssetMetadata(
    key: string,
    input: Partial<CreateAssetInput>,
  ): Promise<ContentAssetRecord> {
    const existing = await this.findAssetByKey(key);
    if (!existing) {
      throw new Error(`Asset not found: ${key}`);
    }

    const updated: ContentAssetRecord = {
      ...existing,
      ...input,
      updatedAt: new Date(),
    };

    this.inMemoryAssets.set(key, updated);
    return updated;
  }

  async deactivateAsset(key: string): Promise<void> {
    const existing = this.inMemoryAssets.get(key);
    if (existing) {
      this.inMemoryAssets.set(key, { ...existing, isActive: false, updatedAt: new Date() });
    }
  }

  private mapResourceToAsset(row: any): ContentAssetRecord {
    return {
      id: row.id,
      key: row.key,
      assetType: 'RESOURCE_FILE',
      originalName: row.title,
      relativePath: row.url || '',
      storageKey: row.url || '',
      mimeType: 'application/octet-stream',
      sizeBytes: 0,
      sha256: '',
      version: 1,
      isActive: row.isActive,
      scope: row.conceptId ? 'CONCEPT' : row.lessonId ? 'LESSON' : 'TEXTBOOK',
      textbookId: row.textbook?.id || row.textbookId || '',
      textbookKey: row.textbook?.key || '',
      unitId: null,
      unitKey: null,
      lessonId: row.lesson?.id || row.lessonId || null,
      lessonKey: row.lesson?.key || null,
      conceptId: row.concept?.id || row.conceptId || null,
      conceptKey: row.concept?.key || null,
      pageStart: row.pageStart || null,
      pageEnd: row.pageEnd || null,
      title: row.title,
      altText: null,
      caption: null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
