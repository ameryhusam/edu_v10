import { describe, expect, it } from 'vitest';
import {
  assessGrounding,
  renderContext,
  toCitations,
  validateCitations,
  type GroundingChunk,
} from '../../src/contexts/tutoring/domain/grounding.js';

const chunk = (id: string, relevance: number, text = 'Some textbook content here.'): GroundingChunk => ({
  chunkId: id,
  text,
  relevance,
  source: { textbookKey: '2026-2027-T01-G07-MATH', lessonName: 'Fractions', pageStart: 12, pageEnd: 12 },
});

describe('grounding policy', () => {
  it('refuses when nothing was retrieved', () => {
    const verdict = assessGrounding([]);
    expect(verdict.sufficient).toBe(false);
    if (!verdict.sufficient) expect(verdict.reason).toBe('NO_CHUNKS');
  });

  it('refuses when the best passage is too weak', () => {
    const verdict = assessGrounding([chunk('a', 0.1), chunk('b', 0.05)]);
    expect(verdict.sufficient).toBe(false);
    if (!verdict.sufficient) expect(verdict.reason).toBe('LOW_RELEVANCE');
  });

  it('accepts a sufficiently relevant passage', () => {
    const verdict = assessGrounding([chunk('a', 0.8)]);
    expect(verdict.sufficient).toBe(true);
  });

  it('fills the context budget best-first so the strongest evidence survives', () => {
    const long = 'x'.repeat(5000);
    const verdict = assessGrounding(
      [chunk('weak', 0.4, long), chunk('strong', 0.95, long), chunk('mid', 0.7, long)],
      { minChunks: 1, minTopRelevance: 0.35, maxContextChars: 10_000 },
    );
    expect(verdict.sufficient).toBe(true);
    if (verdict.sufficient) {
      expect(verdict.chunks).toHaveLength(2);
      expect(verdict.chunks[0]!.chunkId).toBe('strong');
    }
  });
});

describe('citations', () => {
  it('builds a human-readable label with real page numbers', () => {
    const [citation] = toCitations([chunk('a', 0.9)]);
    expect(citation!.label).toContain('Fractions');
    expect(citation!.pageStart).toBe(12);
  });

  it('detects citations the model invented', () => {
    const { valid, fabricated } = validateCitations(['a', 'ghost'], [chunk('a', 0.9)]);
    expect(valid).toEqual(['a']);
    expect(fabricated).toEqual(['ghost']);
  });
});

describe('context rendering', () => {
  it('tags each passage so the model can cite it', () => {
    const rendered = renderContext([chunk('a', 0.9), chunk('b', 0.8)]);
    expect(rendered).toContain('[#1 | a]');
    expect(rendered).toContain('[#2 | b]');
  });
});
