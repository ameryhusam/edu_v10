/**
 * Unit tests for Content Assets domain and export profile integration.
 */

import { describe, expect, it } from 'vitest';
import {
  CONTENT_ASSET_SCOPES,
  CONTENT_ASSET_TYPES,
  deriveAssetKey,
  deriveAssetStorageKey,
  isSupportedAssetScope,
  isSupportedAssetType,
  validateAssetPath,
  validateSha256,
} from '../../src/contexts/content/domain/assets.js';
import {
  CONTENT_PROFILE,
  CONTENT_PROFILE_VERSION,
  checkPackageIntegrity,
  sortPackage,
  type ContentPackage,
} from '../../src/contexts/content/domain/export-profile.js';

describe('Content Assets Domain', () => {
  describe('validateAssetPath', () => {
    it('accepts valid relative paths', () => {
      const res = validateAssetPath('assets/pdf/textbook.pdf');
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value).toBe('assets/pdf/textbook.pdf');
      }
    });

    it('normalizes Windows backslashes', () => {
      const res = validateAssetPath('assets\\images\\diagram.png');
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value).toBe('assets/images/diagram.png');
      }
    });

    it('rejects path traversal attempts', () => {
      const res1 = validateAssetPath('../secret.pdf');
      expect(res1.ok).toBe(false);

      const res2 = validateAssetPath('assets/../../secret.pdf');
      expect(res2.ok).toBe(false);
    });

    it('rejects absolute paths', () => {
      const res = validateAssetPath('/etc/passwd');
      expect(res.ok).toBe(false);
    });

    it('rejects empty paths', () => {
      const res = validateAssetPath('');
      expect(res.ok).toBe(false);
    });
  });

  describe('validateSha256', () => {
    it('accepts valid 64-char hex strings', () => {
      const valid = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
      const res = validateSha256(valid);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value).toBe(valid);
      }
    });

    it('normalizes uppercase hex strings', () => {
      const upper = 'E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855';
      const res = validateSha256(upper);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value).toBe(upper.toLowerCase());
      }
    });

    it('rejects invalid lengths and characters', () => {
      expect(validateSha256('abc').ok).toBe(false);
      expect(validateSha256('z'.repeat(64)).ok).toBe(false);
    });
  });

  describe('deriveAssetStorageKey and deriveAssetKey', () => {
    it('derives deterministic storage keys isolated by textbook', () => {
      const key = deriveAssetStorageKey('EDU-MATH-G07-T1-ED2026', 'pdf/book.pdf');
      expect(key).toBe('content/EDU-MATH-G07-T1-ED2026/pdf/book.pdf');
    });

    it('derives stable asset keys using parent node and relative path', () => {
      const res = deriveAssetKey('EDU-MATH-G07-T1-ED2026', 'pdf/book.pdf');
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value).toMatch(/^EDU-MATH-G07-T1-ED2026-AST[a-f0-9]{8}$/);
      }
    });
  });

  describe('Supported Scopes and Types', () => {
    it('recognizes valid types and scopes', () => {
      expect(isSupportedAssetType('TEXTBOOK_PDF')).toBe(true);
      expect(isSupportedAssetType('INVALID_TYPE')).toBe(false);
      expect(isSupportedAssetScope('TEXTBOOK')).toBe(true);
      expect(isSupportedAssetScope('LESSON')).toBe(true);
      expect(isSupportedAssetScope('UNKNOWN_SCOPE')).toBe(false);
    });
  });
});

describe('Export Profile Assets Integration', () => {
  const basePackage: ContentPackage = {
    meta: {
      profile: CONTENT_PROFILE,
      profileVersion: CONTENT_PROFILE_VERSION,
      scope: 'FULL',
      exportedAt: '2026-09-20T00:00:00.000Z',
    },
    textbook: {
      key: 'EDU-MATH-G07-P1-ED2026',
      subjectKey: 'MATH',
      gradeKey: 'G07',
      part: 'PART_1',
      title: 'Mathematics',
      edition: '2026',
      description: null,
      issuer: null,
      isbn: null,
      publishYear: null,
      totalPages: null,
      status: 'DRAFT',
    },
    units: [
      {
        key: 'EDU-MATH-G07-T1-ED2026-U-ALGEBRA',
        slug: 'ALGEBRA',
        parentUnitSlug: null,
        name: 'Algebra',
        orderIndex: 0,
        startPage: null,
        endPage: null,
        isActive: true,
        sourceRef: null,
      },
    ],
    lessons: [
      {
        key: 'EDU-MATH-G07-T1-ED2026-U-ALGEBRA-L-EQUATIONS',
        slug: 'EQUATIONS',
        unitSlug: 'ALGEBRA',
        name: 'Equations',
        description: null,
        orderIndex: 0,
        startPage: null,
        endPage: null,
        estimatedMins: null,
        isActive: true,
        sourceRef: null,
      },
    ],
    concepts: [
      {
        key: 'EDU-MATH-G07-T1-ED2026-U-ALGEBRA-L-EQUATIONS-C-LINEAR',
        slug: 'LINEAR',
        unitSlug: 'ALGEBRA',
        lessonSlug: 'EQUATIONS',
        name: 'Linear Equations',
        description: null,
        orderIndex: 0,
        difficulty: 1,
        importance: 1,
        masteryThreshold: 0.8,
        isCore: true,
        isActive: true,
        pageNumber: null,
        sourceRef: null,
      },
    ],
    prerequisites: [],
    questions: [],
  };

  it('validates package integrity with valid assets', () => {
    const pkg: ContentPackage = {
      ...basePackage,
      assets: [
        {
          scope: 'TEXTBOOK',
          assetType: 'TEXTBOOK_PDF',
          originalName: 'math_g7.pdf',
          relativePath: 'assets/math_g7.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1048576,
          sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        },
        {
          scope: 'LESSON',
          unitSlug: 'ALGEBRA',
          lessonSlug: 'EQUATIONS',
          assetType: 'PAGE_IMAGE',
          originalName: 'page_12.png',
          relativePath: 'assets/page_12.png',
          mimeType: 'image/png',
          sizeBytes: 204800,
          sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        },
      ],
    };

    const res = checkPackageIntegrity(pkg);
    expect(res.ok).toBe(true);
    expect(res.problems).toHaveLength(0);
  });

  it('reports missing unit/lesson references in scoped assets', () => {
    const pkg: ContentPackage = {
      ...basePackage,
      assets: [
        {
          scope: 'LESSON',
          unitSlug: 'ALGEBRA',
          lessonSlug: 'NON_EXISTENT',
          assetType: 'PAGE_IMAGE',
          originalName: 'page_1.png',
          relativePath: 'assets/page_1.png',
          mimeType: 'image/png',
          sizeBytes: 100,
          sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        },
      ],
    };

    const res = checkPackageIntegrity(pkg);
    expect(res.ok).toBe(false);
    expect(res.problems.some((p) => p.includes('references missing lesson'))).toBe(true);
  });

  it('sorts assets deterministically', () => {
    const pkg: ContentPackage = {
      ...basePackage,
      assets: [
        {
          scope: 'TEXTBOOK',
          assetType: 'TEXTBOOK_PDF',
          originalName: 'b.pdf',
          relativePath: 'b.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 100,
          sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        },
        {
          scope: 'TEXTBOOK',
          assetType: 'TEXTBOOK_PDF',
          originalName: 'a.pdf',
          relativePath: 'a.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 100,
          sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        },
      ],
    };

    const sorted = sortPackage(pkg);
    expect(sorted.assets?.[0]?.relativePath).toBe('a.pdf');
    expect(sorted.assets?.[1]?.relativePath).toBe('b.pdf');
  });
});

describe('ContentAssetService Application Service', () => {
  class MemoryStorage {
    files = new Map<string, Buffer>();

    async writeBuffer(storageKey: string, buffer: Buffer, _mimeType: string) {
      this.files.set(storageKey, buffer);
      return {
        sizeBytes: buffer.length,
        sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        storageKey,
      };
    }

    async readStream(storageKey: string) {
      const buf = this.files.get(storageKey);
      if (!buf) return null;
      const { Readable } = await import('node:stream');
      return Readable.from(buf);
    }

    async exists(storageKey: string) {
      return this.files.has(storageKey);
    }
  }

  class MemoryAssetRepo {
    assets = new Map<string, any>();

    async createAsset(input: any) {
      const record = { id: 'asset_1', ...input, isActive: true, createdAt: new Date(), updatedAt: new Date() };
      this.assets.set(input.key, record);
      return record;
    }

    async findAssetByKey(key: string) {
      return this.assets.get(key) || null;
    }

    async updateAssetMetadata(key: string, input: any) {
      const existing = this.assets.get(key);
      const updated = { ...existing, ...input, updatedAt: new Date() };
      this.assets.set(key, updated);
      return updated;
    }

    async listAssetsForTextbook(textbookKey: string) {
      return Array.from(this.assets.values()).filter((a) => a.textbookKey === textbookKey);
    }

    async deactivateAsset(key: string) {
      const a = this.assets.get(key);
      if (a) a.isActive = false;
    }
  }

  it('uploads a textbook source PDF and derives isolated storage path', async () => {
    const { ContentAssetService } = await import('../../src/contexts/content/application/content-asset.service.js');
    const storage = new MemoryStorage();
    const repo = new MemoryAssetRepo();
    const service = new ContentAssetService(repo as any, storage as any);

    const pdfBuffer = Buffer.from('%PDF-1.4 mock pdf content');
    const record = await service.uploadTextbookSource({
      subject: 'MATH',
      grade: 'G07',
      part: 'PART_1',
      edition: '2026',
      title: 'Grade 7 Math',
      buffer: pdfBuffer,
    });

    expect(record.assetType).toBe('TEXTBOOK_PDF');
    expect(record.storageKey).toBe('content/EDU-MATH-G07-P1-ED2026/textbook/textbook.pdf');
    expect(record.relativePath).toBe('textbook/textbook.pdf');
    expect(storage.files.has(record.storageKey)).toBe(true);
  });

  it('uploads and streams an asset with byte verification', async () => {
    const { ContentAssetService } = await import('../../src/contexts/content/application/content-asset.service.js');
    const storage = new MemoryStorage();
    const repo = new MemoryAssetRepo();
    const service = new ContentAssetService(repo as any, storage as any);

    const assetBuf = Buffer.from('hello asset content');
    const record = await service.uploadAsset({
      textbookKey: 'EDU-MATH-G07-T1-ED2026',
      relativePath: 'units/unit_01/lesson_01/diagram.png',
      buffer: assetBuf,
      assetType: 'PAGE_IMAGE',
      scope: 'LESSON',
      title: 'Sample Diagram',
    });

    expect(record.scope).toBe('LESSON');
    expect(record.storageKey).toBe('content/EDU-MATH-G07-T1-ED2026/units/unit_01/lesson_01/diagram.png');

    const streamResult = await service.getAssetStream(record.key);
    expect(streamResult).not.toBeNull();
    expect(streamResult?.asset.key).toBe(record.key);
  });
});

