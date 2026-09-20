/**
 * Asset domain contract — PURE.
 *
 * Edu7 treats physical files (PDFs, page images, diagrams, audio summaries) as
 * first-class assets distinct from pedagogical learning resources:
 *
 *   - A `ContentAsset` represents the physical binary file (PDF, PNG, MP3) in
 *     storage, its checksum, byte size, MIME type, and relative path.
 *   - A `LearningResource` represents the pedagogical material presented to a
 *     learner (e.g. reading, worked example, video) which may link to an asset.
 *
 * Rules:
 *   1. No Base64 in JSON packages or database tables.
 *   2. Storage keys are deterministic and protected against path traversal.
 *   3. Checksums (SHA-256) drive versioning and idempotent imports.
 *   4. Assets are scoped to Textbook, Unit, Lesson, or Concept.
 */

import { Errors } from '../../../shared/kernel/errors.js';
import { Err, Ok, type Result } from '../../../shared/kernel/result.js';
import { contentAssetKey } from '../../../shared/kernel/identifiers.js';

export const CONTENT_ASSET_TYPES = [
  'TEXTBOOK_PDF',
  'UNIT_PDF',
  'LESSON_PDF',
  'PAGE_IMAGE',
  'PAGE_TEXT',
  'RESOURCE_FILE',
  'IMAGE_SUMMARY',
  'AUDIO',
  'VIDEO',
] as const;

export type ContentAssetType = (typeof CONTENT_ASSET_TYPES)[number];

export const CONTENT_ASSET_SCOPES = ['TEXTBOOK', 'UNIT', 'LESSON', 'CONCEPT'] as const;

export type ContentAssetScope = (typeof CONTENT_ASSET_SCOPES)[number];

export interface ContentAssetMetadata {
  readonly assetType: ContentAssetType;
  readonly originalName: string;
  readonly relativePath: string;
  readonly storageKey: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly version: number;
  readonly pageStart?: number | null;
  readonly pageEnd?: number | null;
  readonly title?: string | null;
  readonly altText?: string | null;
  readonly caption?: string | null;
}

export interface ContentAssetLink {
  readonly scope: ContentAssetScope;
  readonly textbookKey: string;
  readonly unitKey?: string | null;
  readonly lessonKey?: string | null;
  readonly conceptKey?: string | null;
}

export interface ContentAsset extends ContentAssetMetadata, ContentAssetLink {
  readonly key: string;
  readonly isActive: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

const SHA256_REGEX = /^[a-fA-F0-9]{64}$/;

/**
 * Validates and normalises an asset's relative path.
 *
 * Refuses path traversal (`..`), absolute paths starting with `/`,
 * Windows backslashes (normalised to `/`), and empty segments.
 */
export function validateAssetPath(rawPath: string): Result<string> {
  const trimmed = String(rawPath ?? '').trim().replace(/\\/g, '/');
  if (!trimmed) {
    return Err(Errors.validation('asset.path_empty', 'Asset relative path cannot be empty.'));
  }

  if (trimmed.startsWith('/')) {
    return Err(
      Errors.validation('asset.path_absolute', 'Asset relative path must not be absolute.', {
        path: rawPath,
      }),
    );
  }

  const segments = trimmed.split('/').filter(Boolean);
  for (const segment of segments) {
    if (segment === '.' || segment === '..') {
      return Err(
        Errors.validation('asset.path_traversal', 'Asset relative path cannot contain traversal segments.', {
          path: rawPath,
        }),
      );
    }
  }

  const normalized = segments.join('/');
  if (!normalized) {
    return Err(Errors.validation('asset.path_invalid', 'Asset path contains no valid segments.', { path: rawPath }));
  }

  return Ok(normalized);
}

/**
 * Validates a SHA-256 hexadecimal checksum.
 */
export function validateSha256(rawHash: string): Result<string> {
  const hash = String(rawHash ?? '').trim().toLowerCase();
  if (!SHA256_REGEX.test(hash)) {
    return Err(
      Errors.validation('asset.sha256_invalid', 'Asset SHA-256 must be a 64-character hex string.', {
        hash: rawHash,
      }),
    );
  }
  return Ok(hash);
}

/**
 * Is this string a supported ContentAssetType?
 */
export function isSupportedAssetType(type: string): type is ContentAssetType {
  return (CONTENT_ASSET_TYPES as readonly string[]).includes(type);
}

/**
 * Is this string a supported ContentAssetScope?
 */
export function isSupportedAssetScope(scope: string): scope is ContentAssetScope {
  return (CONTENT_ASSET_SCOPES as readonly string[]).includes(scope);
}

/**
 * Canonical storage key derivation: `content/<textbookKey>/<normalizedRelativePath>`.
 * Guarantees sandbox isolation per textbook and avoids directory escape.
 */
export function deriveAssetStorageKey(textbookKey: string, normalizedRelativePath: string): string {
  const cleanPath = normalizedRelativePath.replace(/^\/+/, '');
  return `content/${textbookKey}/${cleanPath}`;
}

export const deriveStorageKey = deriveAssetStorageKey;

/**
 * Validates a ContentAsset record structure and fields.
 */
export function validateAsset(asset: ContentAsset): Result<ContentAsset> {
  const pathRes = validateAssetPath(asset.relativePath);
  if (!pathRes.ok) return pathRes;
  const hashRes = validateSha256(asset.sha256);
  if (!hashRes.ok) return hashRes;
  if (!isSupportedAssetType(asset.assetType)) {
    return Err(Errors.validation('asset.type_invalid', `Unsupported asset type: ${asset.assetType}`));
  }
  if (!isSupportedAssetScope(asset.scope)) {
    return Err(Errors.validation('asset.scope_invalid', `Unsupported asset scope: ${asset.scope}`));
  }
  return Ok(asset);
}

/**
 * Derive the canonical key for an asset based on its parent node key and relative path.
 */
export function deriveAssetKey(parentNodeKey: string, relativePath: string): Result<string> {
  const validated = validateAssetPath(relativePath);
  if (!validated.ok) return validated;
  return contentAssetKey(parentNodeKey, validated.value);
}
