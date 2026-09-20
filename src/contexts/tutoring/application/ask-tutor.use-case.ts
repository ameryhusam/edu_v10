/**
 * AskTutor — grounded question answering.
 *
 * Order of operations is the safety design, and it is deliberate:
 *
 *   quota → retrieve → assess grounding → REFUSE or call provider → validate
 *   citations → log
 *
 * Refusal happens BEFORE the provider call. A model that is never asked cannot
 * hallucinate, and the refusal costs nothing. Most "AI safety" in education is
 * really just this ordering.
 */

import type { Clock } from '../../../shared/kernel/clock.js';
import { Errors } from '../../../shared/kernel/errors.js';
import { Err, Ok, type Result } from '../../../shared/kernel/result.js';
import {
  assessGrounding,
  renderContext,
  toCitations,
  validateCitations,
  DEFAULT_GROUNDING_POLICY,
  INSUFFICIENT_CONTEXT_MESSAGE_AR,
  INSUFFICIENT_CONTEXT_MESSAGE_EN,
  type Citation,
  type GroundingPolicy,
} from '../domain/grounding.js';
import { TUTOR_SYSTEM_INSTRUCTION } from '../domain/prompts.js';
import type {
  AiInteractionLog,
  AiProvider,
  AiUsageQuota,
  CompletionResponse,
  ContextRetriever,
} from './ports.js';

export interface AskTutorCommand {
  readonly learnerKey: string;
  readonly question: string;
  readonly textbookKey?: string;
  readonly lessonKey?: string;
  readonly conceptKey?: string;
  readonly language?: 'ar' | 'en';
  /** Current mastery, so the explanation can be pitched at the right level. */
  readonly masteryHint?: number;
}

export interface AskTutorResult {
  readonly answer: string;
  readonly grounded: boolean;
  readonly refused: boolean;
  readonly citations: readonly Citation[];
  readonly providerId: string;
  readonly degraded: boolean;
}

export class AskTutorUseCase {
  constructor(
    private readonly retriever: ContextRetriever,
    private readonly providers: readonly AiProvider[],
    private readonly quota: AiUsageQuota,
    private readonly log: AiInteractionLog,
    private readonly clock: Clock,
    private readonly policy: GroundingPolicy = DEFAULT_GROUNDING_POLICY,
  ) {}

  async execute(command: AskTutorCommand): Promise<Result<AskTutorResult>> {
    const question = command.question.trim();
    if (question.length < 3) {
      return Err(Errors.validation('tutoring.question_too_short', 'Please ask a fuller question.'));
    }

    const quota = await this.quota.check(command.learnerKey);
    if (!quota.allowed) {
      return Err(
        Errors.forbidden('tutoring.quota_exceeded', 'The AI usage limit for this period has been reached.', {
          resetAt: quota.resetAt.toISOString(),
        }),
      );
    }

    const chunks = await this.retriever.retrieve({
      query: question,
      ...(command.textbookKey ? { textbookKey: command.textbookKey } : {}),
      ...(command.lessonKey ? { lessonKey: command.lessonKey } : {}),
      ...(command.conceptKey ? { conceptKey: command.conceptKey } : {}),
      limit: 8,
    });

    const grounding = assessGrounding(chunks, this.policy);
    const language = command.language ?? 'ar';

    // ── Refuse before spending anything ──────────────────────────────────
    if (!grounding.sufficient) {
      const answer =
        language === 'ar' ? INSUFFICIENT_CONTEXT_MESSAGE_AR : INSUFFICIENT_CONTEXT_MESSAGE_EN;

      await this.log.record({
        task: 'ANSWER_QUESTION',
        learnerKey: command.learnerKey,
        providerId: 'none',
        modelId: 'none',
        grounded: false,
        chunkIds: [],
        refused: true,
        refusalReason: grounding.reason,
        tokensIn: null,
        tokensOut: null,
        latencyMs: 0,
        at: this.clock.now(),
      });

      return Ok({
        answer,
        grounded: false,
        refused: true,
        citations: [],
        providerId: 'none',
        degraded: false,
      });
    }

    const completionRequest = {
      task: 'ANSWER_QUESTION' as const,
      systemInstruction: TUTOR_SYSTEM_INSTRUCTION(language),
      userPrompt: buildUserPrompt(question, command.masteryHint),
      context: renderContext(grounding.chunks),
      language,
      maxOutputTokens: 800,
    };

    let response: CompletionResponse | null = null;
    let lastProviderError: unknown = null;
    for (const provider of this.providers) {
      if (!provider.isAvailable()) continue;
      try {
        response = await provider.complete(completionRequest);
        break;
      } catch (error) {
        // Provider failures are operational, not educational. Try the next
        // adapter and let the deterministic fallback keep the lesson usable.
        lastProviderError = error;
      }
    }

    if (!response) {
      const reason = describeProviderError(lastProviderError);
      return Err(
        Errors.unavailable(
          'tutoring.no_provider_available',
          'No AI provider is currently available.',
          reason ? { reason } : undefined,
        ),
      );
    }

    await this.quota.consume(command.learnerKey, 1);

    // Trust nothing the model says about its own sources.
    const emitted = [...response.text.matchAll(/\[#\d+\s*\|\s*([^\]]+)\]/g)].map((m) => m[1]!.trim());
    const { fabricated } = validateCitations(emitted, grounding.chunks);

    await this.log.record({
      task: 'ANSWER_QUESTION',
      learnerKey: command.learnerKey,
      providerId: response.providerId,
      modelId: response.modelId,
      grounded: true,
      chunkIds: grounding.chunks.map((c) => c.chunkId),
      refused: false,
      ...(fabricated.length > 0 ? { refusalReason: `fabricated_citations:${fabricated.length}` } : {}),
      tokensIn: response.tokensIn,
      tokensOut: response.tokensOut,
      latencyMs: response.latencyMs,
      at: this.clock.now(),
    });

    return Ok({
      answer: response.text,
      grounded: true,
      refused: false,
      citations: toCitations(grounding.chunks),
      providerId: response.providerId,
      degraded: response.degraded,
    });
  }
}

function describeProviderError(error: unknown): string | undefined {
  if (!error) return undefined;
  return error instanceof Error ? error.message : String(error);
}

function buildUserPrompt(question: string, masteryHint?: number): string {
  const level =
    masteryHint == null
      ? ''
      : `\nLearner's current mastery of this topic: ${(masteryHint * 100).toFixed(0)}%. ` +
        (masteryHint < 0.4
          ? 'Start from fundamentals and use a concrete example.'
          : masteryHint < 0.8
            ? 'Assume the basics are known; focus on the tricky step.'
            : 'Be concise; the learner is close to mastery.');

  return `Question: ${question}${level}`;
}
