/**
 * Grounding policy — the rule that makes AI safe in an educational product.
 *
 * PURE. The single hardest requirement for AI in education is not fluency, it
 * is REFUSAL. A tutor that invents a plausible answer outside the textbook is
 * worse than no tutor, because a child cannot detect the error and a teacher
 * cannot audit it.
 *
 * So grounding is enforced as a domain rule, not as prompt etiquette:
 *
 *   1. Retrieved passages are the only permitted source of factual content.
 *   2. Below a minimum retrieval quality the request is REFUSED before any
 *      provider is called. No tokens spent, no hallucination possible.
 *   3. Every answer carries citations back to real pages. A citation to a page
 *      that was not retrieved is a bug, and is detected here.
 */

export interface GroundingChunk {
  readonly chunkId: string;
  readonly text: string;
  /** Where this text really came from — never synthesised. */
  readonly source: {
    readonly textbookKey: string;
    readonly unitName?: string | null;
    readonly lessonName?: string | null;
    readonly pageStart?: number | null;
    readonly pageEnd?: number | null;
  };
  /** Retrieval score in [0,1]. */
  readonly relevance: number;
}

export interface GroundingPolicy {
  /** Minimum chunks required before answering at all. */
  readonly minChunks: number;
  /** Minimum relevance of the best chunk. */
  readonly minTopRelevance: number;
  /** Total characters of context allowed into the prompt. */
  readonly maxContextChars: number;
}

export const DEFAULT_GROUNDING_POLICY: GroundingPolicy = Object.freeze({
  minChunks: 1,
  minTopRelevance: 0.35,
  maxContextChars: 12_000,
});

export type GroundingVerdict =
  | { readonly sufficient: true; readonly chunks: readonly GroundingChunk[]; readonly contextChars: number }
  | { readonly sufficient: false; readonly reason: 'NO_CHUNKS' | 'LOW_RELEVANCE'; readonly bestRelevance: number };

/** The exact sentence returned when grounding fails. Never a guess. */
export const INSUFFICIENT_CONTEXT_MESSAGE_AR =
  'لا توجد معلومات كافية في المصدر المحدد للإجابة عن هذا السؤال.';
export const INSUFFICIENT_CONTEXT_MESSAGE_EN =
  'The selected source does not contain enough information to answer this question.';

export function assessGrounding(
  chunks: readonly GroundingChunk[],
  policy: GroundingPolicy = DEFAULT_GROUNDING_POLICY,
): GroundingVerdict {
  if (chunks.length < policy.minChunks) {
    return { sufficient: false, reason: 'NO_CHUNKS', bestRelevance: 0 };
  }

  const ranked = [...chunks].sort((a, b) => b.relevance - a.relevance);
  const best = ranked[0]!.relevance;
  if (best < policy.minTopRelevance) {
    return { sufficient: false, reason: 'LOW_RELEVANCE', bestRelevance: best };
  }

  // Fill the context budget best-first so the strongest evidence always
  // survives truncation.
  const selected: GroundingChunk[] = [];
  let used = 0;
  for (const chunk of ranked) {
    const cost = chunk.text.length;
    if (used + cost > policy.maxContextChars) continue;
    selected.push(chunk);
    used += cost;
  }

  if (selected.length === 0) {
    return { sufficient: false, reason: 'NO_CHUNKS', bestRelevance: best };
  }
  return { sufficient: true, chunks: selected, contextChars: used };
}

export interface Citation {
  readonly chunkId: string;
  readonly label: string;
  readonly pageStart: number | null;
  readonly pageEnd: number | null;
}

export function toCitations(chunks: readonly GroundingChunk[]): Citation[] {
  return chunks.map((c) => {
    const trail = [c.source.unitName, c.source.lessonName].filter(Boolean).join(' / ');
    const pages =
      c.source.pageStart != null
        ? c.source.pageEnd != null && c.source.pageEnd !== c.source.pageStart
          ? ` (pp. ${c.source.pageStart}-${c.source.pageEnd})`
          : ` (p. ${c.source.pageStart})`
        : '';
    return {
      chunkId: c.chunkId,
      label: `${trail || c.source.textbookKey}${pages}`,
      pageStart: c.source.pageStart ?? null,
      pageEnd: c.source.pageEnd ?? null,
    };
  });
}

/** Render retrieved context deterministically for the prompt. */
export function renderContext(chunks: readonly GroundingChunk[]): string {
  return chunks
    .map((c, i) => {
      const trail = [c.source.unitName, c.source.lessonName].filter(Boolean).join(' / ');
      return `[#${i + 1} | ${c.chunkId}] ${trail}\n${c.text}`;
    })
    .join('\n\n---\n\n');
}

/**
 * Post-generation guard: verify every citation the model emitted refers to a
 * chunk we actually supplied. Models cite confidently and wrongly.
 */
export function validateCitations(
  emitted: readonly string[],
  supplied: readonly GroundingChunk[],
): { valid: string[]; fabricated: string[] } {
  const ids = new Set(supplied.map((c) => c.chunkId));
  const valid: string[] = [];
  const fabricated: string[] = [];
  for (const id of emitted) (ids.has(id) ? valid : fabricated).push(id);
  return { valid, fabricated };
}
