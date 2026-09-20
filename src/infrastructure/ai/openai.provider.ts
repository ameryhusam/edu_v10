/**
 * OpenAI adapter.
 *
 * Provider details stay here: HTTP endpoint shape, model names, token accounting
 * and response-format hints. The tutoring use case receives the same narrow
 * AiProvider port it already uses for Gemini and the deterministic fallback.
 */

import type {
  AiProvider,
  CompletionRequest,
  CompletionResponse,
} from '../../contexts/tutoring/application/ports.js';

export interface OpenAiConfig {
  readonly apiKey: string | undefined;
  readonly model?: string;
  readonly baseUrl?: string;
}

interface OpenAiChatCompletionResponse {
  readonly model?: string;
  readonly choices?: ReadonlyArray<{
    readonly message?: {
      readonly content?: string | null;
    };
  }>;
  readonly usage?: {
    readonly prompt_tokens?: number;
    readonly completion_tokens?: number;
  };
  readonly error?: {
    readonly message?: string;
    readonly type?: string;
    readonly code?: string | number | null;
  };
}

export class OpenAiProvider implements AiProvider {
  readonly id = 'openai';
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(private readonly config: OpenAiConfig) {
    this.model = config.model ?? 'gpt-4o-mini';
    this.baseUrl = (config.baseUrl ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
  }

  isAvailable(): boolean {
    const key = this.config.apiKey;
    return Boolean(key && key.trim() && !key.startsWith('YOUR_'));
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const started = Date.now();
    const prompt = [
      request.context ? `CONTEXT:\n${request.context}` : null,
      request.userPrompt,
    ]
      .filter(Boolean)
      .join('\n\n');

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey!}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: request.systemInstruction },
          { role: 'user', content: prompt },
        ],
        max_tokens: request.maxOutputTokens ?? 800,
        // Low temperature: this is a grounded tutor, not an open-ended chat bot.
        temperature: 0.2,
        ...(request.jsonSchemaName ? { response_format: { type: 'json_object' } } : {}),
      }),
    });

    const body = (await response.json().catch(() => ({}))) as OpenAiChatCompletionResponse;
    if (!response.ok) {
      const message = body.error?.message ?? `OpenAI request failed with status ${response.status}`;
      throw new Error(message);
    }

    const text = body.choices?.[0]?.message?.content ?? '';
    if (!text.trim()) {
      throw new Error('OpenAI returned an empty completion.');
    }

    return {
      text,
      providerId: this.id,
      modelId: body.model ?? this.model,
      tokensIn: body.usage?.prompt_tokens ?? null,
      tokensOut: body.usage?.completion_tokens ?? null,
      latencyMs: Date.now() - started,
      degraded: false,
    };
  }
}
