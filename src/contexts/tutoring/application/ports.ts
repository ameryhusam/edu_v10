/**
 * Ports owned by the Tutoring (AI) context.
 *
 * The provider port is deliberately narrow and provider-agnostic. Gemini,
 * OpenAI, a local model or a deterministic stub all satisfy the same shape, so
 * swapping providers is a composition-root edit, never a domain edit.
 *
 * Note what the port does NOT expose: no `model` string, no `temperature`, no
 * provider SDK types. Those are adapter concerns. What crosses the boundary is
 * a task, a grounded context, and a budget.
 */

import type { GroundingChunk } from '../domain/grounding.js';

export type TutoringTask =
  | 'EXPLAIN_CONCEPT'
  | 'ANSWER_QUESTION'
  | 'GENERATE_HINT'
  | 'GENERATE_QUESTIONS'
  | 'GRADE_ESSAY'
  | 'SUMMARISE_PROGRESS';

export interface CompletionRequest {
  readonly task: TutoringTask;
  readonly systemInstruction: string;
  readonly userPrompt: string;
  /** Rendered, already-budgeted grounding context. May be empty for non-factual tasks. */
  readonly context?: string;
  readonly maxOutputTokens?: number;
  /** Ask the provider for strict JSON matching this named schema. */
  readonly jsonSchemaName?: string;
  readonly language?: 'ar' | 'en';
}

export interface CompletionResponse {
  readonly text: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly tokensIn: number | null;
  readonly tokensOut: number | null;
  readonly latencyMs: number;
  /** True when the deterministic fallback answered instead of a live model. */
  readonly degraded: boolean;
}

export interface AiProvider {
  readonly id: string;
  /** Cheap health signal used to pick a provider without paying for a call. */
  isAvailable(): boolean;
  complete(request: CompletionRequest): Promise<CompletionResponse>;
}

/** Retrieval over indexed textbook pages. Owned by Content, consumed here. */
export interface ContextRetriever {
  retrieve(input: {
    query: string;
    textbookKey?: string;
    lessonKey?: string;
    conceptKey?: string;
    limit?: number;
  }): Promise<GroundingChunk[]>;
}

/** Every AI interaction is recorded — cost, provenance and safety review. */
export interface AiInteractionLog {
  record(entry: {
    task: TutoringTask;
    learnerKey: string | null;
    providerId: string;
    modelId: string;
    grounded: boolean;
    chunkIds: readonly string[];
    refused: boolean;
    refusalReason?: string;
    tokensIn: number | null;
    tokensOut: number | null;
    latencyMs: number;
    at: Date;
  }): Promise<void>;
}

/** Per-learner spend guard, enforced before any provider call. */
export interface AiUsageQuota {
  check(learnerKey: string): Promise<{ allowed: boolean; remaining: number; resetAt: Date }>;
  consume(learnerKey: string, units: number): Promise<void>;
}
