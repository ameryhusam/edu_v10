import { afterEach, describe, expect, it, vi } from 'vitest';

const { generateContent } = vi.hoisted(() => ({ generateContent: vi.fn() }));

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(({ apiKey }: { apiKey: string }) => ({
    models: {
      generateContent: (request: unknown) => generateContent(apiKey, request),
    },
  })),
}));

import { GeminiProvider } from '../../src/infrastructure/ai/gemini.provider.js';

describe('GeminiProvider', () => {
  afterEach(() => {
    generateContent.mockReset();
    vi.clearAllMocks();
  });

  it('is unavailable without a configured key', () => {
    expect(new GeminiProvider({}).isAvailable()).toBe(false);
    expect(new GeminiProvider({ apiKey: 'YOUR_GEMINI_KEY' }).isAvailable()).toBe(false);
    expect(new GeminiProvider({ apiKey: 'test-key' }).isAvailable()).toBe(true);
  });

  it('rotates to the next configured key after quota failure', async () => {
    const usedKeys: string[] = [];
    generateContent.mockImplementation(async (key: string) => {
      usedKeys.push(key);
      if (key === 'key-one') throw Object.assign(new Error('quota exceeded'), { status: 429 });
      return {
        text: 'Grounded answer [#1 | chunk-a]',
        usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 4 },
      };
    });

    const provider = new GeminiProvider({
      apiKeys: ['key-one', 'key-two'],
      model: 'gemini-test',
      cooldownMs: 60_000,
    });
    const response = await provider.complete({
      task: 'ANSWER_QUESTION',
      systemInstruction: 'Answer only from context.',
      userPrompt: 'Explain fractions.',
      context: 'Fractions describe parts of a whole.',
    });

    expect(usedKeys).toEqual(['key-one', 'key-two']);
    expect(response).toMatchObject({
      text: 'Grounded answer [#1 | chunk-a]',
      providerId: 'gemini',
      modelId: 'gemini-test',
      tokensIn: 8,
      tokensOut: 4,
      degraded: false,
    });
  });

  it('moves to the next configured model when the primary model is unavailable', async () => {
    const requestedModels: string[] = [];
    generateContent.mockImplementation(async (_key: string, request: { model: string }) => {
      requestedModels.push(request.model);
      if (request.model === 'gemini-primary') {
        throw Object.assign(new Error('model not found'), { status: 404 });
      }
      return { text: 'Fallback answer', usageMetadata: {} };
    });

    const provider = new GeminiProvider({
      apiKey: 'key-one',
      model: 'gemini-ignored-when-list-set',
      models: ['gemini-primary', 'gemini-fallback'],
    });
    const response = await provider.complete({
      task: 'ANSWER_QUESTION',
      systemInstruction: 'Use context.',
      userPrompt: 'Explain.',
      context: 'Grounded source.',
    });

    expect(requestedModels).toEqual(['gemini-primary', 'gemini-fallback']);
    expect(response.modelId).toBe('gemini-fallback');
  });
});
