/** Persistent ContentAsset repository.
 *
 * Binary bytes are owned by ContentStorage. This adapter persists only asset
 * metadata and placement in PostgreSQL; it deliberately has no process-local
 * cache so a restart cannot make an asset disappear.
 */
import type { ContentAssetRepository, ContentAssetRecord, CreateAssetInput } from '../../contexts/content/application/ports.js';
import type { ContentAssetScope, ContentAssetType } from '../../contexts/content/domain/assets.js';
import type { Db } from './prisma.client.js';

export class PrismaContentAssetRepository implements ContentAssetRepository {
  constructor(private readonly db: Db) {}

  private map(row: any): ContentAssetRecord {
    return {
      id: row.id,
      key: row.key,
      assetType: row.assetType as ContentAssetType,
      originalName: row.originalName,
      relativePath: row.relativePath,
      storageKey: row.storageKey,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      sha256: row.sha256,
      version: row.version,
      isActive: row.isActive,
      scope: row.scope as ContentAssetScope,
      textbookId: row.textbookId,
      textbookKey: row.textbook?.key ?? '',
      unitId: row.unitId ?? null,
      unitKey: row.unit?.key ?? null,
      lessonId: row.lessonId ?? null,
      lessonKey: row.lesson?.key ?? null,
      conceptId: row.conceptId ?? null,
      conceptKey: row.concept?.key ?? null,
      pageStart: row.pageStart ?? null,
      pageEnd: row.pageEnd ?? null,
      title: row.title ?? null,
      altText: row.altText ?? null,
      caption: row.caption ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private readonly include = { textbook: true, unit: true, lesson: true, concept: true } as const;

  async findAssetByKey(key: string): Promise<ContentAssetRecord | null> {
    const row = await this.db.contentAsset.findUnique({ where: { key }, include: this.include });
    return row && row.isActive ? this.map(row) : null;
  }

  async findAssetByStorageKey(storageKey: string): Promise<ContentAssetRecord | null> {
    const row = await this.db.contentAsset.findFirst({ where: { storageKey, isActive: true }, include: this.include });
    return row ? this.map(row) : null;
  }

  async findAssetByChecksum(textbookKey: string, sha256: string): Promise<ContentAssetRecord | null> {
    const row = await this.db.contentAsset.findFirst({
      where: { sha256, isActive: true, textbook: { key: textbookKey } },
      include: this.include,
    });
    return row ? this.map(row) : null;
  }

  async findAssetByRelativePath(textbookKey: string, relativePath: string): Promise<ContentAssetRecord | null> {
    const row = await this.db.contentAsset.findFirst({
      where: { relativePath, isActive: true, textbook: { key: textbookKey } },
      include: this.include,
    });
    return row ? this.map(row) : null;
  }

  async listAssetsForLesson(lessonKey: string, options?: { assetType?: ContentAssetType }): Promise<readonly ContentAssetRecord[]> {
    const rows = await this.db.contentAsset.findMany({
      where: {
        lesson: { key: lessonKey },
        isActive: true,
        ...(options?.assetType ? { assetType: options.assetType as never } : {}),
      },
      include: this.include,
      orderBy: [{ pageStart: 'asc' }, { relativePath: 'asc' }],
    });
    return rows.map((row) => this.map(row));
  }

  async listAssetsForTextbook(textbookKey: string, options?: { scope?: ContentAssetScope; assetType?: ContentAssetType }): Promise<readonly ContentAssetRecord[]> {
    const rows = await this.db.contentAsset.findMany({
      where: { textbook: { key: textbookKey }, isActive: true, ...(options?.scope ? { scope: options.scope } : {}), ...(options?.assetType ? { assetType: options.assetType } : {}) },
      include: this.include,
      orderBy: [{ createdAt: 'asc' }, { key: 'asc' }],
    });
    return rows.map((row) => this.map(row));
  }

  async listAssetsForNode(input: { scope: ContentAssetScope; nodeKey: string }): Promise<readonly ContentAssetRecord[]> {
    const where = input.scope === 'TEXTBOOK'
      ? { textbook: { key: input.nodeKey } }
      : input.scope === 'UNIT'
        ? { unit: { key: input.nodeKey } }
        : input.scope === 'LESSON'
          ? { lesson: { key: input.nodeKey } }
          : { concept: { key: input.nodeKey } };
    const rows = await this.db.contentAsset.findMany({ where: { ...where, isActive: true }, include: this.include, orderBy: { key: 'asc' } });
    return rows.map((row) => this.map(row));
  }

  async createAsset(input: CreateAssetInput): Promise<ContentAssetRecord> {
    const row = await this.db.contentAsset.create({
      data: {
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
        textbook: { connect: { key: input.textbookKey } },
        ...(input.unitKey ? { unit: { connect: { key: input.unitKey } } } : {}),
        ...(input.lessonKey ? { lesson: { connect: { key: input.lessonKey } } } : {}),
        ...(input.conceptKey ? { concept: { connect: { key: input.conceptKey } } } : {}),
        pageStart: input.pageStart ?? null,
        pageEnd: input.pageEnd ?? null,
        title: input.title ?? null,
        altText: input.altText ?? null,
        caption: input.caption ?? null,
      },
      include: this.include,
    });
    return this.map(row);
  }

  async updateAssetMetadata(key: string, input: Partial<CreateAssetInput>): Promise<ContentAssetRecord> {
    const row = await this.db.contentAsset.update({
      where: { key },
      data: {
        ...(input.originalName !== undefined ? { originalName: input.originalName } : {}),
        ...(input.relativePath !== undefined ? { relativePath: input.relativePath } : {}),
        ...(input.storageKey !== undefined ? { storageKey: input.storageKey } : {}),
        ...(input.mimeType !== undefined ? { mimeType: input.mimeType } : {}),
        ...(input.sizeBytes !== undefined ? { sizeBytes: input.sizeBytes } : {}),
        ...(input.sha256 !== undefined ? { sha256: input.sha256 } : {}),
        ...(input.version !== undefined ? { version: input.version } : {}),
        ...(input.scope !== undefined ? { scope: input.scope } : {}),
        ...(input.unitKey !== undefined ? { unit: input.unitKey ? { connect: { key: input.unitKey } } : { disconnect: true } } : {}),
        ...(input.lessonKey !== undefined ? { lesson: input.lessonKey ? { connect: { key: input.lessonKey } } : { disconnect: true } } : {}),
        ...(input.conceptKey !== undefined ? { concept: input.conceptKey ? { connect: { key: input.conceptKey } } : { disconnect: true } } : {}),
        ...(input.pageStart !== undefined ? { pageStart: input.pageStart } : {}),
        ...(input.pageEnd !== undefined ? { pageEnd: input.pageEnd } : {}),
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.altText !== undefined ? { altText: input.altText } : {}),
        ...(input.caption !== undefined ? { caption: input.caption } : {}),
      },
      include: this.include,
    });
    return this.map(row);
  }

  async deactivateAsset(key: string): Promise<void> {
    await this.db.contentAsset.update({ where: { key }, data: { isActive: false } });
  }
}
