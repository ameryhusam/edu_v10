import * as crypto from 'node:crypto';
import { PDFDocument } from 'pdf-lib';

export interface PdfMetadata {
  readonly pageCount: number;
  readonly sha256: string;
}

export interface LessonSliceResult {
  readonly buffer: Buffer;
  readonly sha256: string;
  readonly pageCount: number;
  readonly startPage: number;
  readonly endPage: number;
}

export interface ExtractedPagesResult {
  readonly buffer: Buffer;
  readonly sha256: string;
  readonly startPage: number;
  readonly endPage: number;
  readonly pageCount: number;
}

/**
 * Reads basic PDF metadata including total physical page count and content SHA-256.
 */
export async function getPdfMetadata(pdfBuffer: Buffer): Promise<PdfMetadata> {
  const sha256 = crypto.createHash('sha256').update(pdfBuffer).digest('hex');
  const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
  const pageCount = pdfDoc.getPageCount();
  return { pageCount, sha256 };
}

/**
 * Extracts a contiguous range of physical pages (1-indexed, inclusive) into a standalone PDF buffer.
 */
export async function extractPagesRange(
  pdfBuffer: Buffer,
  startPage: number,
  endPage: number,
): Promise<ExtractedPagesResult> {
  const srcDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
  const totalPages = srcDoc.getPageCount();

  const safeStart = Math.max(1, Math.min(startPage, totalPages));
  const safeEnd = Math.max(safeStart, Math.min(endPage, totalPages));

  const pageIndices: number[] = [];
  for (let i = safeStart - 1; i <= safeEnd - 1; i++) {
    pageIndices.push(i);
  }

  const subDoc = await PDFDocument.create();
  const copied = await subDoc.copyPages(srcDoc, pageIndices);
  for (const page of copied) {
    subDoc.addPage(page);
  }

  const uint8 = await subDoc.save();
  const buffer = Buffer.from(uint8);
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

  return {
    buffer,
    sha256,
    startPage: safeStart,
    endPage: safeEnd,
    pageCount: copied.length,
  };
}

/**
 * Extracts the single cover page (physical page 1) of the PDF for book metadata identification.
 */
export async function extractCoverPage(pdfBuffer: Buffer): Promise<Buffer> {
  const result = await extractPagesRange(pdfBuffer, 1, 1);
  return result.buffer;
}

/**
 * Extracts the Table of Contents (TOC) pages (default: physical pages 4 to 12).
 * Automatically clamps to total pages if the PDF has fewer pages.
 */
export async function extractTocPages(
  pdfBuffer: Buffer,
  startPage = 4,
  endPage = 12,
): Promise<ExtractedPagesResult> {
  const srcDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
  const totalPages = srcDoc.getPageCount();

  const actualStart = Math.min(startPage, totalPages);
  const actualEnd = Math.min(endPage, totalPages);

  return extractPagesRange(pdfBuffer, actualStart, actualEnd);
}

/**
 * Extracts pages 1 through 12 (Cover, Preliminaries, and Table of Contents) in ONE single call.
 * Clamps to total page count if the book has fewer than 12 pages.
 */
export async function extractCoverAndTocPages(
  pdfBuffer: Buffer,
  maxPages = 12,
): Promise<ExtractedPagesResult> {
  const srcDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
  const totalPages = srcDoc.getPageCount();
  const actualEnd = Math.min(maxPages, totalPages);
  return extractPagesRange(pdfBuffer, 1, actualEnd);
}

/**
 * Extracts a subset of pages into a lightweight PDF buffer for Gemini sampling / TOC extraction.
 * pageNumbers are 1-based.
 */
export async function samplePdfPages(pdfBuffer: Buffer, pageNumbers: number[]): Promise<Buffer> {
  const srcDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
  const totalPages = srcDoc.getPageCount();

  let validZeroIndices = pageNumbers
    .filter((p) => p >= 1 && p <= totalPages)
    .map((p) => p - 1);

  if (validZeroIndices.length === 0) {
    // Fallback: take first 5 pages for title & TOC
    for (let i = 0; i < Math.min(5, totalPages); i++) {
      validZeroIndices.push(i);
    }
  }

  if (validZeroIndices.length > 9) {
    validZeroIndices = validZeroIndices.slice(0, 9);
  }

  const subDoc = await PDFDocument.create();
  const copied = await subDoc.copyPages(srcDoc, validZeroIndices);
  for (const page of copied) {
    subDoc.addPage(page);
  }

  const uint8 = await subDoc.save();
  return Buffer.from(uint8);
}

/**
 * Slices a specific range of pages (1-based, inclusive) into a standalone lesson PDF.
 * Never keeps full book or unit PDFs in persistent storage.
 */
export async function sliceLessonPdf(
  srcPdfBuffer: Buffer,
  startPage: number,
  endPage: number,
): Promise<LessonSliceResult> {
  const result = await extractPagesRange(srcPdfBuffer, startPage, endPage);
  return {
    buffer: result.buffer,
    sha256: result.sha256,
    pageCount: result.pageCount,
    startPage: result.startPage,
    endPage: result.endPage,
  };
}
