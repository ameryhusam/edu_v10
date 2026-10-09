/**
 * OpenAI-compatible adapter with bounded, quota-aware key/model failover.
 * The global fetch implementation maintains its connection pool; no client or
 * secret is logged, persisted, or returned to the caller.
 */
import type {
  AiProvider,
  CompletionRequest,
  CompletionResponse,
} from '../../contexts/tutoring/application/ports.js';

export interface OpenAiConfig {
  readonly apiKey?: string;
  readonly apiKeys?: readonly string[];
  readonly model?: string;
  readonly models?: readonly string[];
  readonly baseUrl?: string;
  readonly maxRetries?: number;
  readonly timeoutMs?: number;
  readonly cooldownMs?: number;
}

interface OpenAiChatCompletionResponse {
  readonly model?: string;
  readonly choices?: ReadonlyArray<{ readonly message?: { readonly content?: string | null } }>;
  readonly usage?: { readonly prompt_tokens?: number; readonly completion_tokens?: number };
  readonly error?: { readonly message?: string; readonly type?: string; readonly code?: string | number | null };
}

function uniqueNonPlaceholder(values: readonly (string | undefined)[]): string[] {
  return [...new Set(values.map((value) => value?.trim() ?? '')
    .filter((value) => value.length > 0 && !value.startsWith('YOUR_')))];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(body: OpenAiChatCompletionResponse, status: number): string {
  return body.error?.message ?? `OpenAI request failed with status ${status}`;
}

export class OpenAiProvider implements AiProvider {
  readonly id = 'openai';
  private readonly apiKeys: string[];
  private readonly models: string[];
  private readonly baseUrl: string;
  private readonly retryAt = new Map<string, number>();
  private keyCursor = 0;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;
  private readonly cooldownMs: number;

  constructor(private readonly config: OpenAiConfig) {
    this.apiKeys = uniqueNonPlaceholder([...(config.apiKeys ?? []), config.apiKey]);
    this.models = [...new Set((config.models?.length ? config.models : [config.model ?? 'gpt-4o-mini'])
      .map((model) => model.trim()).filter(Boolean))];
    this.baseUrl = (config.baseUrl ?? 'https://api.openai.com/v1').replace(/\\/+$/, '');
    this.maxRetries = Math.max(0, Math.floor(config.maxRetries ?? 2));
    this.timeoutMs = Math.max(1, Math.floor(config.timeoutMs ?? 60_000));
    this.cooldownMs = Math.max(0, Math.floor(config.cooldownMs ?? 300_000));
  }

  isAvailable(): boolean {
    return this.apiKeys.length > 0;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    if (!this.isAvailable()) throw new Error('OpenAI is not configured.');

    const started = Date.now();
    const prompt = [
      request.context ? `CONTEXT:\n${request.context}` : null,
      request.userPrompt,
    ].filter(Boolean).join('\n\n');

    let lastError: unknown;
    for (const model of this.models) {
      const keyOrder = this.getKeyOrder();
      let modelUnavailable = false;
      for (const keyIndex of keyOrder) {
        const key = this.apiKeys[keyIndex]!;
        let delay = 400;
        for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
          let response: Response;
          try {
            response = await fetch(`${this.baseUrl}/chat/completions`, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${key}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                model,
                messages: [
                  { role: 'system', content: request.systemInstruction },
                  { role: 'user', content: prompt },
                ],
                max_tokens: request.maxOutputTokens ?? 800,
                temperature: 0.2,
                ...(request.jsonSchemaName || request.jsonSchema
                  ? { response_format: { type: 'json_object' } }
                  : {}),
              }),
              signal: AbortSignal.timeout(this.timeoutMs),
            });
          } catch (error) {
            lastError = error;
            if (attempt < this.maxRetries) {
              await sleep(delay);
              delay = Math.min(delay * 2, 5_000);
              continue;
            }
            break;
          }

          const body = (await response.json().catch(() => ({}))) as OpenAiChatCompletionResponse;
          if (response.ok) {
            const text = body.choices?.[0]?.message?.content ?? '';
            if (!text.trim()) throw new Error('OpenAI returned an empty completion.');
            this.keyCursor = (keyIndex + 1) % this.apiKeys.length;
            return {
              text,
              providerId: this.id,
              modelId: body.model ?? model,
              tokensIn: body.usage?.prompt_tokens ?? null,
              tokensOut: body.usage?.completion_tokens ?? null,
              latencyMs: Date.now() - started,
              degraded: false,
            };
          }

          const message = errorMessage(body, response.status);
          lastError = new Error(message);
          const errorCode = String(body.error?.code ?? '').toLowerCase();
          const lowerMessage = message.toLowerCase();
          const unavailableModel = response.status === 404 ||
            errorCode.includes('model_not_found') ||
            lowerMessage.includes('model not found') ||
            lowerMessage.includes('does not exist');
          if (unavailableModel) {
            modelUnavailable = true;
            break;
          }

          if (response.status === 401 || response.status === 403 || response.status === 429) {
            this.retryAt.set(key, Date.now() + this.cooldownMs);
            break;
          }

          if (response.status === 408 || response.status >= 500) {
            if (attempt < this.maxRetries) {
              await sleep(delay);
              delay = Math.min(delay * 2, 5_000);
              continue;
            }
            break;
          }

          // Invalid request/payload errors will not be fixed by another key.
          throw new Error(message);
        }
        if (modelUnavailable) break;
      }
    }

    throw lastError instanceof Error ? lastError : new Error('OpenAI request failed.');
  }

  private getKeyOrder(): number[] {
    const now = Date.now();
    const ordered = this.apiKeys.map((_, offset) =>
      (this.keyCursor + offset) % this.apiKeys.length);
    const ready = ordered.filter((index) =>
      (this.retryAt.get(this.apiKeys[index]!) ?? 0) <= now);
    const cooling = ordered.filter((index) => !ready.includes(index))
      .sort((a, b) =>
        (this.retryAt.get(this.apiKeys[a]!) ?? 0) -
        (this.retryAt.get(this.apiKeys[b]!) ?? 0));
    return [...ready, ...cooling];
  }
}
