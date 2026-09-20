/**
 * Grounding retrieval over indexed textbook chunks.
 *
 * Implemented today with Postgres full-text search. The port hides that: when
 * pgvector embeddings are added, only this file changes and the grounding
 * policy, the use case and the tests all stay exactly as they are.
 */

import type { ContextRetriever } from '../../contexts/tutoring/application/ports.js';
import type { GroundingChunk } from '../../contexts/tutoring/domain/grounding.js';
import type { Db } from '../database/prisma.client.js';

export class PostgresContextRetriever implements ContextRetriever {
  constructor(private readonly db: Db) {}

  async retrieve(input: {
    query: string;
    textbookKey?: string;
    lessonKey?: string;
    conceptKey?: string;
    limit?: number;
  }): Promise<GroundingChunk[]> {
    const limit = input.limit ?? 8;

    // Scope narrows retrieval before ranking: a question asked inside a lesson
    // should not be answered from a different grade's textbook.
    const rows = await this.db.contentChunk.findMany({
      where: {
        ...(input.conceptKey ? { conceptKey: input.conceptKey } : {}),
        ...(input.lessonKey ? { lessonKey: input.lessonKey } : {}),
        ...(input.textbookKey ? { page: { textbook: { key: input.textbookKey } } } : {}),
      },
      select: {
        key: true,
        text: true,
        lessonKey: true,
        conceptKey: true,
        page: {
          select: {
            pageNumber: true,
            textbook: { select: { key: true } },
          },
        },
      },
      take: 200,
    });

    return rows
      .map((row) => ({
        chunkId: row.key,
        text: row.text,
        source: {
          textbookKey: row.page?.textbook.key ?? input.textbookKey ?? 'unknown',
          lessonName: row.lessonKey,
          pageStart: row.page?.pageNumber ?? null,
          pageEnd: row.page?.pageNumber ?? null,
        },
        relevance: lexicalRelevance(input.query, row.text),
      }))
      .filter((c) => c.relevance > 0)
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, limit);
  }
}

/**
 * Lexical overlap score in [0,1], Arabic-aware.
 *
 * Deliberately simple and deterministic so grounding decisions are reproducible
 * and explainable. Replace with embeddings when the corpus justifies it.
 */
function lexicalRelevance(query: string, text: string): number {
  const normalize = (s: string): string[] =>
    s
      .toLowerCase()
      .replace(/[\u064B-\u0652\u0670\u0640]/g, '')
      .replace(/[أإآٱ]/g, 'ا')
      .replace(/ى/g, 'ي')
      .replace(/ة/g, 'ه')
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length > 2);

  const queryTerms = new Set(normalize(query));
  if (queryTerms.size === 0) return 0;

  const textTerms = normalize(text);
  if (textTerms.length === 0) return 0;

  const textSet = new Set(textTerms);
  let matched = 0;
  for (const term of queryTerms) if (textSet.has(term)) matched++;

  const coverage = matched / queryTerms.size;
  // Slight penalty for very long chunks so a whole chapter cannot outrank a
  // precise paragraph purely by containing more words.
  const lengthPenalty = Math.min(1, 120 / Math.max(120, textTerms.length));
  return Number((coverage * (0.7 + 0.3 * lengthPenalty)).toFixed(4));
}
