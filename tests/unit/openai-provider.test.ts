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
  it('rotates to the next configured key after a quota response', async () => {
    const calls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      const authorization = new Headers(init?.headers).get('Authorization') ?? '';
      calls.push(authorization);
      if (authorization === 'Bearer sk-first') {
        return {
          ok: false,
          status: 429,
          json: async () => ({ error: { message: 'quota exceeded', code: 'rate_limit_exceeded' } }),
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          model: 'gpt-test',
          choices: [{ message: { content: 'Recovered answer [#1 | chunk-a]' } }],
          usage: { prompt_tokens: 3, completion_tokens: 2 },
        }),
      } as unknown as Response;
    });

    const provider = new OpenAiProvider({
      apiKeys: ['sk-first', 'sk-second'],
      model: 'gpt-test',
      cooldownMs: 60_000,
    });
    const response = await provider.complete({
      task: 'ANSWER_QUESTION',
      systemInstruction: 'Answer only from context.',
      userPrompt: 'What is a fraction?',
      context: 'A fraction represents part of a whole.',
    });

    expect(calls).toEqual(['Bearer sk-first', 'Bearer sk-second']);
    expect(response.text).toBe('Recovered answer [#1 | chunk-a]');
  });

  it('tries only the explicitly configured model fallback list', async () => {
    const requestedModels: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { model: string };
      requestedModels.push(body.model);
      if (body.model === 'gpt-primary') {
        return {
          ok: false,
          status: 404,
          json: async () => ({ error: { message: 'model not found', code: 'model_not_found' } }),
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ model: body.model, choices: [{ message: { content: 'Fallback answer' } }] }),
      } as unknown as Response;
    });

    const provider = new OpenAiProvider({
      apiKey: 'sk-test',
      model: 'gpt-ignored-when-list-set',
      models: ['gpt-primary', 'gpt-fallback'],
    });
    await provider.complete({
      task: 'ANSWER_QUESTION',
      systemInstruction: 'Use context.',
      userPrompt: 'Explain.',
      context: 'Grounded source.',
    });
    expect(requestedModels).toEqual(['gpt-primary', 'gpt-fallback']);
  });

});
