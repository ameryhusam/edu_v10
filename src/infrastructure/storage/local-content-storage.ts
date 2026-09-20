/**
 * Local filesystem implementation of ContentStorage port.
 *
 * Stores content files (PDFs, images, audio, diagrams) in a dedicated storage
 * directory. Validates storage keys to avoid path traversal, calculates SHA-256
 * checksums on writes, and supports byte-range read streams for efficient video/PDF streaming.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { ContentStorage } from '../../contexts/content/application/ports.js';

export interface LocalStorageOptions {
  readonly rootDir: string;
  readonly publicUrlPrefix?: string;
}

export class LocalContentStorage implements ContentStorage {
  private readonly rootDir: string;
  private readonly publicUrlPrefix: string;

  constructor(options: LocalStorageOptions) {
    this.rootDir = path.resolve(options.rootDir);
    this.publicUrlPrefix = options.publicUrlPrefix ?? '/api/v1/content/assets/file';
    fs.mkdirSync(this.rootDir, { recursive: true });
  }

  private resolvePath(storageKey: string): string {
    const cleaned = storageKey.replace(/^[/\\]+/, '').replace(/\.\.[/\\]/g, '');
    const fullPath = path.resolve(this.rootDir, cleaned);
    if (!fullPath.startsWith(this.rootDir)) {
      throw new Error(`Invalid storage key: path escapes root directory (${storageKey})`);
    }
    return fullPath;
  }

  async exists(storageKey: string): Promise<boolean> {
    try {
      const fullPath = this.resolvePath(storageKey);
      await fs.promises.access(fullPath, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  async readStream(
    storageKey: string,
    range?: { start?: number; end?: number },
  ): Promise<NodeJS.ReadableStream | null> {
    try {
      const fullPath = this.resolvePath(storageKey);
      const exists = await this.exists(storageKey);
      if (!exists) return null;

      const options: { start?: number; end?: number } = {};
      if (range?.start !== undefined) options.start = range.start;
      if (range?.end !== undefined) options.end = range.end;

      return fs.createReadStream(fullPath, options);
    } catch {
      return null;
    }
  }

  async writeStream(
    storageKey: string,
    stream: NodeJS.ReadableStream,
    mimeType: string,
  ): Promise<{ sizeBytes: number; sha256: string }> {
    const fullPath = this.resolvePath(storageKey);
    await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });

    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      let sizeBytes = 0;

      const outStream = fs.createWriteStream(fullPath);

      stream.on('data', (chunk: Buffer) => {
        hash.update(chunk);
        sizeBytes += chunk.length;
      });

      stream.on('error', (err) => {
        outStream.destroy();
        reject(err);
      });

      outStream.on('error', (err) => {
        reject(err);
      });

      outStream.on('finish', () => {
        const sha256 = hash.digest('hex');
        resolve({ sizeBytes, sha256 });
      });

      stream.pipe(outStream);
    });
  }

  async writeBuffer(
    storageKey: string,
    buffer: Buffer,
    _mimeType: string,
  ): Promise<{ sizeBytes: number; sha256: string }> {
    const fullPath = this.resolvePath(storageKey);
    await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.promises.writeFile(fullPath, buffer);

    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    return {
      sizeBytes: buffer.length,
      sha256: hash,
    };
  }

  async getMetadata(
    storageKey: string,
  ): Promise<{ sizeBytes: number; mimeType: string; updatedAt: Date } | null> {
    try {
      const fullPath = this.resolvePath(storageKey);
      const stats = await fs.promises.stat(fullPath);
      if (!stats.isFile()) return null;

      const ext = path.extname(storageKey).toLowerCase();
      const mimeType = this.guessMimeType(ext);

      return {
        sizeBytes: stats.size,
        mimeType,
        updatedAt: stats.mtime,
      };
    } catch {
      return null;
    }
  }

  async delete(storageKey: string): Promise<void> {
    try {
      const fullPath = this.resolvePath(storageKey);
      await fs.promises.unlink(fullPath);
    } catch {
      // Idempotent: ignore if already not existing
    }
  }

  async getPublicUrl(storageKey: string): Promise<string | null> {
    const encoded = encodeURIComponent(storageKey);
    return `${this.publicUrlPrefix}?key=${encoded}`;
  }

  private guessMimeType(ext: string): string {
    switch (ext) {
      case '.pdf':
        return 'application/pdf';
      case '.png':
        return 'image/png';
      case '.jpg':
      case '.jpeg':
        return 'image/jpeg';
      case '.svg':
        return 'image/svg+xml';
      case '.json':
        return 'application/json';
      case '.txt':
        return 'text/plain';
      case '.mp3':
        return 'audio/mpeg';
      case '.mp4':
        return 'video/mp4';
      default:
        return 'application/octet-stream';
    }
  }
}
