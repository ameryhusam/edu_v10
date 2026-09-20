import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAiProvider } from '../../src/infrastructure/ai/openai.provider.js';

describe('OpenAiProvider', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is unavailable without a real API key', () => {
    expect(new OpenAiProvider({ apiKey: undefined }).isAvailable()).toBe(false);
    expect(new OpenAiProvider({ apiKey: 'YOUR_OPENAI_KEY' }).isAvailable()).toBe(false);
    expect(new OpenAiProvider({ apiKey: 'sk-test' }).isAvailable()).toBe(true);
  });

  it('maps chat completions onto the common AiProvider response', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        model: 'gpt-test',
        choices: [{ message: { content: 'Grounded answer [#1 | chunk-a]' } }],
        usage: { prompt_tokens: 12, completion_tokens: 7 },
      }),
    } as unknown as Response);

    const provider = new OpenAiProvider({
      apiKey: 'sk-test',
      model: 'gpt-test',
      baseUrl: 'https://api.openai.test/v1/',
    });

    const response = await provider.complete({
      task: 'ANSWER_QUESTION',
      systemInstruction: 'Answer only from context.',
      userPrompt: 'Explain fractions.',
      context: 'Fractions describe parts of a whole. [#1 | chunk-a]',
      maxOutputTokens: 120,
      language: 'en',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.test/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer sk-test' }),
      }),
    );
    expect(response).toMatchObject({
      text: 'Grounded answer [#1 | chunk-a]',
      providerId: 'openai',
      modelId: 'gpt-test',
      tokensIn: 12,
      tokensOut: 7,
      degraded: false,
    });
  });
});
