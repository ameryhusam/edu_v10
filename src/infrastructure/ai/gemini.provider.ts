/**
 * Gemini adapter with bounded, quota-aware key/model failover.
 *
 * Keys and model order are supplied by environment configuration at the
 * composition root. No key is logged, persisted, or returned to callers.
 */
import { GoogleGenAI } from '@google/genai';
import type {
  AiProvider,
  CompletionRequest,
  CompletionResponse,
} from '../../contexts/tutoring/application/ports.js';

export interface GeminiConfig {
  readonly apiKey?: string;
  readonly apiKeys?: readonly string[];
  readonly model?: string;
  readonly models?: readonly string[];
  readonly maxRetries?: number;
  readonly timeoutMs?: number;
  readonly cooldownMs?: number;
}

function uniqueNonPlaceholder(values: readonly (string | undefined)[]): string[] {
  return [...new Set(values.map((value) => value?.trim() ?? '')
    .filter((value) => value.length > 0 && !value.startsWith('YOUR_')))];
}

function statusOf(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const candidate = error as { status?: unknown; statusCode?: unknown; code?: unknown };
  for (const value of [candidate.status, candidate.statusCode]) {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (Number.isInteger(parsed) && parsed >= 100 && parsed <= 599) return parsed;
  }
  return undefined;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Gemini request timed out')), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export class GeminiProvider implements AiProvider {
  readonly id = 'gemini';
  private readonly apiKeys: string[];
  private readonly models: string[];
  private readonly clients = new Map<string, GoogleGenAI>();
  private readonly retryAt = new Map<string, number>();
  private keyCursor = 0;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;
  private readonly cooldownMs: number;

  constructor(private readonly config: GeminiConfig) {
    this.apiKeys = uniqueNonPlaceholder([...(config.apiKeys ?? []), config.apiKey]);
    this.models = [...new Set([...(config.models ?? []), config.model ?? 'gemini-2.5-flash']
      .map((model) => model.trim()).filter(Boolean))];
    this.maxRetries = Math.max(0, Math.floor(config.maxRetries ?? 2));
    this.timeoutMs = Math.max(1, Math.floor(config.timeoutMs ?? 60_000));
    this.cooldownMs = Math.max(0, Math.floor(config.cooldownMs ?? 300_000));
  }

  isAvailable(): boolean {
    return this.apiKeys.length > 0;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    if (!this.isAvailable()) throw new Error('Gemini is not configured.');

    const started = Date.now();
    const prompt = [
      request.context ? `CONTEXT:\n${request.context}` : null,
      request.userPrompt,
    ].filter(Boolean).join('\n\n');

    const generationConfig: Record<string, unknown> = {
      systemInstruction: request.systemInstruction,
      maxOutputTokens: request.maxOutputTokens ?? 800,
      temperature: 0.2,
    };
    if (request.jsonSchemaName || request.jsonSchema) {
      generationConfig.responseMimeType = 'application/json';
      if (request.jsonSchema) generationConfig.responseJsonSchema = request.jsonSchema;
    }

    let lastError: unknown;
    for (let modelIndex = 0; modelIndex < this.models.length; modelIndex += 1) {
      const model = this.models[modelIndex]!;
      const keyOrder = this.getKeyOrder();
      let modelUnavailable = false;

      for (const keyIndex of keyOrder) {
        const key = this.apiKeys[keyIndex]!;
        let retryDelay = 400;
        for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
          try {
            const response = await withTimeout(
              this.getClient(key).models.generateContent({
                model,
                contents: prompt,
                config: generationConfig as any,
              }),
              this.timeoutMs,
            );
            this.keyCursor = (keyIndex + 1) % this.apiKeys.length;
            const usage = response.usageMetadata;
            return {
              text: response.text ?? '',
              providerId: this.id,
              modelId: model,
              tokensIn: usage?.promptTokenCount ?? null,
              tokensOut: usage?.candidatesTokenCount ?? null,
              latencyMs: Date.now() - started,
              degraded: false,
            };
          } catch (error) {
            lastError = error;
            const status = statusOf(error);
            const message = messageOf(error);
            const unavailableModel = status === 404 ||
              message.includes('model not found') ||
              message.includes('unsupported model') ||
              message.includes('model is not available');

            if (unavailableModel) {
              modelUnavailable = true;
              break;
            }

            if (status === 401 || status === 403 || status === 429) {
              this.retryAt.set(key, Date.now() + this.cooldownMs);
              break;
            }

            const transient = status === 408 || (status !== undefined && status >= 500) ||
              message.includes('timed out') || message.includes('timeout') ||
              message.includes('fetch failed') || message.includes('network') ||
              status === undefined;
            if (transient && attempt < this.maxRetries) {
              await sleep(retryDelay);
              retryDelay = Math.min(retryDelay * 2, 5_000);
              continue;
            }
            if (transient) break;

            // Invalid request/schema errors are not fixed by changing API keys.
            throw error;
          }
        }
        if (modelUnavailable) break;
      }
      // Continue to the next explicitly configured model after model-level or
      // exhausted key/network failures; never invent a model outside config.
    }

    throw lastError instanceof Error ? lastError : new Error('Gemini request failed.');
  }

  private getClient(key: string): GoogleGenAI {
    let client = this.clients.get(key);
    if (!client) {
      client = new GoogleGenAI({ apiKey: key });
      this.clients.set(key, client);
    }
    return client;
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
