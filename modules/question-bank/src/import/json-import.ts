import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

import type { CanonicalQuestion } from '../canonical';

export interface ImportPreviewItem {
  id?: string;
  key?: string | null;
  fingerprint: string;
  errors: string[];
  canonical?: CanonicalQuestion | null;
}

function normalizeText(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

function computeFingerprint(q: CanonicalQuestion): string {
  // Normalize question text + type + lesson.id + options (if any)
  const parts: string[] = [];
  parts.push(q.type);
  parts.push(q.lesson?.id ?? '');
  parts.push(normalizeText(q.text));
  // for MCQ include sorted option texts
  if (q.answerData && (q.type === 'MCQ_SINGLE' || q.type === 'MCQ_MULTI')) {
    const ad: any = q.answerData;
    const opts: string[] = (ad.options ?? []).map((o: any) => normalizeText(o.text));
    opts.sort();
    parts.push(opts.join('|'));
  }
  // for matching include normalized pairs
  if (q.answerData && q.type === 'MATCHING') {
    const ad: any = q.answerData;
    const pairs = (ad.pairs ?? []).map((p: any) => `${p.leftId}->${p.rightId}`).sort();
    parts.push(pairs.join('|'));
  }

  const src = parts.join('||');
  return crypto.createHash('sha256').update(src).digest('hex');
}

function validateCanonical(q: any): string[] {
  const errors: string[] = [];
  if (!q) { errors.push('question is null'); return errors; }
  if (!q.type) errors.push('type is required');
  if (!q.text) errors.push('text is required');
  if (!q.lesson || !q.lesson.id) errors.push('lesson.id is required');
  if (typeof q.points !== 'number') errors.push('points must be a number');
  // type-specific checks
  if (q.type === 'MCQ_SINGLE' || q.type === 'MCQ_MULTI') {
    if (!(q.answerData && Array.isArray(q.answerData.options) && q.answerData.options.length > 0)) {
      errors.push('MCQ must have options');
    }
    if (!(q.answerData && Array.isArray(q.answerData.correctOptions) && q.answerData.correctOptions.length > 0)) {
      errors.push('MCQ must have correctOptions');
    }
  }
  if (q.type === 'MATCHING') {
    if (!(q.answerData && Array.isArray(q.answerData.left) && Array.isArray(q.answerData.right))) {
      errors.push('MATCHING must have left and right arrays');
    }
    if (!(q.answerData && Array.isArray(q.answerData.pairs) && q.answerData.pairs.length > 0)) {
      errors.push('MATCHING must have pairs');
    }
  }
  return errors;
}

export async function previewImportFromSample(sampleFile: string): Promise<ImportPreviewItem[]> {
  const full = path.join(process.cwd(), sampleFile);
  const raw = await fs.readFile(full, 'utf8');
  let arr: any[];
  try { arr = JSON.parse(raw); } catch (err) { throw new Error('Invalid JSON file'); }
  const results: ImportPreviewItem[] = [];
  for (const item of arr) {
    const errors = validateCanonical(item);
    const fingerprint = computeFingerprint(item as CanonicalQuestion);
    results.push({ id: item.id, key: item.key ?? null, fingerprint, errors, canonical: errors.length === 0 ? (item as CanonicalQuestion) : null });
  }
  return results;
}
