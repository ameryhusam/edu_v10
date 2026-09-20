/**
 * Gemini adapter.
 *
 * Everything provider-specific is confined here: SDK types, model names,
 * token accounting, retry. The use case above it knows none of this, which is
 * why swapping to another provider is a one-line change in the composition root.
 */

import { GoogleGenAI } from '@google/genai';
import type {
  AiProvider,
  CompletionRequest,
  CompletionResponse,
} from '../../contexts/tutoring/application/ports.js';

export interface GeminiConfig {
  readonly apiKey: string | undefined;
  readonly model?: string;
  readonly maxRetries?: number;
  readonly timeoutMs?: number;
}

export class GeminiProvider implements AiProvider {
  readonly id = 'gemini';
  private client: GoogleGenAI | null = null;
  private readonly model: string;

  constructor(private readonly config: GeminiConfig) {
    this.model = config.model ?? 'gemini-2.5-flash';
  }

  isAvailable(): boolean {
    const key = this.config.apiKey;
    return Boolean(key && key.trim() && !key.startsWith('YOUR_'));
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    if (!this.client) {
      this.client = new GoogleGenAI({ apiKey: this.config.apiKey! });
    }

    const started = Date.now();
    const prompt = [
      request.context ? `CONTEXT:\n${request.context}` : null,
      request.userPrompt,
    ]
      .filter(Boolean)
      .join('\n\n');

    const config: Record<string, unknown> = {
      systemInstruction: request.systemInstruction,
      maxOutputTokens: request.maxOutputTokens ?? 800,
      temperature: 0.2,
    };
    if (request.jsonSchemaName || request.jsonSchema) {
      config.responseMimeType = 'application/json';
      if (request.jsonSchema) config.responseJsonSchema = request.jsonSchema;
    }

    const maxRetries = this.config.maxRetries ?? 2;
    let response: Awaited<ReturnType<GoogleGenAI['models']['generateContent']>> | null = null;
    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        response = await Promise.race([
          this.client.models.generateContent({ model: this.model, contents: prompt, config: config as any }),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Gemini request timed out')), this.config.timeoutMs ?? 60_000)),
        ]);
        break;
      } catch (error) {
        lastError = error;
        if (attempt === maxRetries) throw error;
        await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
      }
    }
    if (!response) throw lastError instanceof Error ? lastError : new Error('Gemini request failed');

    const usage = response.usageMetadata;
    return {
      text: response.text ?? '',
      providerId: this.id,
      modelId: this.model,
      tokensIn: usage?.promptTokenCount ?? null,
      tokensOut: usage?.candidatesTokenCount ?? null,
      latencyMs: Date.now() - started,
      degraded: false,
    };
  }
}
