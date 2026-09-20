/**
 * Deterministic fallback provider.
 *
 * This is not a toy. It is a product requirement: schools lose connectivity,
 * API keys expire, quotas run out, and a lesson must not break because a model
 * was unreachable. It answers strictly by extracting from the supplied grounded
 * context — it never generates a claim of its own.
 *
 * It is also what makes the AI paths testable in CI with no network and no key,
 * and it is always last in the provider chain.
 */

import type {
  AiProvider,
  CompletionRequest,
  CompletionResponse,
} from '../../contexts/tutoring/application/ports.js';

export class DeterministicProvider implements AiProvider {
  readonly id = 'deterministic';

  /** Always available — that is the entire point of a fallback. */
  isAvailable(): boolean {
    return true;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const started = Date.now();
    const text = this.respond(request);
    return {
      text,
      providerId: this.id,
      modelId: 'extractive-v1',
      tokensIn: null,
      tokensOut: null,
      latencyMs: Date.now() - started,
      degraded: true,
    };
  }

  private respond(request: CompletionRequest): string {
    const context = request.context?.trim();
    if (!context) {
      return request.language === 'en'
        ? 'The selected source does not contain enough information to answer this question.'
        : 'لا توجد معلومات كافية في المصدر المحدد للإجابة عن هذا السؤال.';
    }

    switch (request.task) {
      case 'GENERATE_HINT':
        return this.hint(context, request.language);
      case 'ANSWER_QUESTION':
      case 'EXPLAIN_CONCEPT':
        return this.extractiveAnswer(context, request.userPrompt, request.language);
      default:
        return this.extractiveAnswer(context, request.userPrompt, request.language);
    }
  }

  /**
   * Rank context sentences by overlap with the question and return the best
   * few verbatim, with their citation tags intact. Crude, but honest: every
   * word returned came from the textbook.
   */
  private extractiveAnswer(context: string, question: string, lang?: 'ar' | 'en'): string {
    const blocks = context.split(/\n\n---\n\n/);
    const terms = new Set(
      question
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((w) => w.length > 2),
    );

    const scored = blocks
      .map((block) => {
        const words = block.toLowerCase().split(/[^\p{L}\p{N}]+/u);
        const hits = words.filter((w) => terms.has(w)).length;
        return { block, score: hits / Math.max(1, Math.sqrt(words.length)) };
      })
      .sort((a, b) => b.score - a.score);

    const best = scored.filter((s) => s.score > 0).slice(0, 2);
    if (best.length === 0) {
      return lang === 'en'
        ? 'The selected source does not contain enough information to answer this question.'
        : 'لا توجد معلومات كافية في المصدر المحدد للإجابة عن هذا السؤال.';
    }

    const header =
      lang === 'en'
        ? 'From your textbook (offline mode — passages shown verbatim):'
        : 'من كتابك المدرسي (الوضع دون اتصال — المقاطع كما وردت):';

    return `${header}\n\n${best.map((b) => b.block.trim()).join('\n\n')}`;
  }

  private hint(context: string, lang?: 'ar' | 'en'): string {
    const firstSentence = context.split(/[.。؟?!\n]/).find((s) => s.trim().length > 20)?.trim();
    const prefix = lang === 'en' ? 'Look again at this idea: ' : 'أعد النظر في هذه الفكرة: ';
    return firstSentence ? `${prefix}${firstSentence}` : prefix;
  }
}
