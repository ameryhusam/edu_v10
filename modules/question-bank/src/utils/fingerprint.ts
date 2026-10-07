export function normalizeForFingerprint(q: any) {
  return q; // placeholder
}

import crypto from 'crypto';

export function computeFingerprint(q: any): string {
  const parts: string[] = [];
  parts.push(q.type ?? '');
  parts.push((q.lesson && q.lesson.id) ?? '');
  parts.push((q.text || '').toString().replace(/\s+/g,' ').trim().toLowerCase());
  if (q.answerData && (q.type === 'MCQ_SINGLE' || q.type === 'MCQ_MULTI')) {
    const opts = (q.answerData.options || []).map((o: any) => (o.text || '').toString().replace(/\s+/g,' ').trim().toLowerCase()).sort();
    parts.push(opts.join('|'));
  }
  if (q.answerData && q.type === 'MATCHING') {
    const pairs = (q.answerData.pairs || []).map((p: any) => `${p.leftId}->${p.rightId}`).sort();
    parts.push(pairs.join('|'));
  }
  const src = parts.join('||');
  return crypto.createHash('sha256').update(src).digest('hex');
}
