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

    const response = await this.client.models.generateContent({
      model: this.model,
      contents: prompt,
      config: {
        systemInstruction: request.systemInstruction,
        maxOutputTokens: request.maxOutputTokens ?? 800,
        // Low temperature: this is a tutor quoting a textbook, not a poet.
        temperature: 0.2,
        ...(request.jsonSchemaName ? { responseMimeType: 'application/json' } : {}),
      },
    });

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
