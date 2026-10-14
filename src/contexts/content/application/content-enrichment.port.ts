import type { AuthorContext } from './authoring.service.js';
import type { Result } from '../../../shared/kernel/result.js';

export interface EnrichedConceptResult {
  readonly key: string;
  readonly name: string;
  readonly slug: string;
  readonly misconceptionsCount: number;
}

export interface EnrichedQuestionResult {
  readonly key: string;
  readonly text: string;
  readonly type: string;
}

export interface ContentEnrichmentPort {
  enrichLessonConcepts(
    ctx: AuthorContext,
    lessonKey: string,
  ): Promise<Result<{ concepts: EnrichedConceptResult[] }>>;

  enrichLessonQuestions(
    ctx: AuthorContext,
    lessonKey: string,
    count?: number,
  ): Promise<Result<{ questions: EnrichedQuestionResult[] }>>;
}
