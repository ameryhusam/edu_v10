/**
 * The API client's contract.
 *
 * The single-flight test is the one that matters. The backend rotates refresh
 * tokens and treats a reused one as theft — correctly. A dashboard firing six
 * queries against an expired access token would start six refreshes, five of
 * which present an already-rotated token, and the user gets signed out by a
 * security feature doing its job. Single-flight is what prevents that, and it
 * is invisible until it breaks.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, request, setAccessToken, setSessionEndedListener } from './client';
import { ApiError } from './errors';

function envelope(data: unknown): Response {
  return new Response(JSON.stringify({ ok: true, data, meta: { requestId: 'r', at: 'now' } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function failure(status: number, code: string): Response {
  return new Response(
    JSON.stringify({
      ok: false,
      error: { code, message: 'developer facing' },
      meta: { requestId: 'req-123', at: 'now' },
    }),
    { status, headers: { 'content-type': 'application/json' } },
  );
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  setAccessToken(null);
  setSessionEndedListener(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('request', () => {
  it('unwraps the envelope exactly once', async () => {
    fetchMock.mockResolvedValueOnce(envelope({ learnerKey: 'lrn_1', totalXp: 244 }));

    const result = await api.get<{ learnerKey: string; totalXp: number }>('engagement/xp');

    // The caller gets domain data, never {ok, data, meta}.
    expect(result).toEqual({ learnerKey: 'lrn_1', totalXp: 244 });
  });

  it('calls a relative URL so the browser never targets the API host directly', async () => {
    fetchMock.mockResolvedValueOnce(envelope({}));
    await api.get('learning/next-step');

    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url.startsWith('/api/v1/')).toBe(true);
    expect(url).not.toContain('localhost');
    expect(url).not.toContain('http://');
  });

  it('omits undefined query parameters rather than sending the string "undefined"', async () => {
    fetchMock.mockResolvedValueOnce(envelope({}));
    await api.get('learning/next-step', {
      query: { textbookKey: 'EDU-MATH', learnerKey: undefined, limit: null },
    });

    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url).toContain('textbookKey=EDU-MATH');
    expect(url).not.toContain('learnerKey');
    expect(url).not.toContain('undefined');
  });

  it('turns a refusal into an ApiError carrying the stable code', async () => {
    fetchMock.mockResolvedValueOnce(failure(403, 'learning.learner_not_accessible'));

    const error = await api.get('learning/mastery').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.code).toBe('learning.learner_not_accessible');
    expect(apiError.kind).toBe('FORBIDDEN');
    expect(apiError.isRefusal).toBe(true);
    expect(apiError.requestId).toBe('req-123');
  });

  it('reports an unreachable server as offline, not as a server error', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const error = (await api.get('learning/mastery').catch((e: unknown) => e)) as ApiError;

    // The UI answer differs: "check your connection" with a retry, rather than
    // an explanation of something the server decided.
    expect(error.kind).toBe('OFFLINE');
    expect(error.isRefusal).toBe(false);
  });
});

describe('token refresh', () => {
  it('refreshes once and replays the original request', async () => {
    setAccessToken('expired');

    fetchMock
      .mockResolvedValueOnce(failure(401, 'auth.token_expired'))
      .mockResolvedValueOnce(envelope({ tokens: { accessToken: 'fresh' } }))
      .mockResolvedValueOnce(envelope({ ok: 'replayed' }));

    const result = await api.get<{ ok: string }>('learning/mastery');

    expect(result).toEqual({ ok: 'replayed' });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // The replay must carry the NEW token, not the expired one it just failed
    // with — otherwise the retry 401s too and the user is signed out.
    const replayInit = fetchMock.mock.calls[2]![1] as RequestInit;
    expect((replayInit.headers as Record<string, string>)['authorization']).toBe('Bearer fresh');
  });

  it('issues ONE refresh for concurrent requests, not one per request', async () => {
    setAccessToken('expired');

    let refreshCalls = 0;
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/auth/refresh')) {
        refreshCalls += 1;
        return Promise.resolve(envelope({ tokens: { accessToken: 'fresh' } }));
      }
      // Every data call fails until a refresh has happened.
      return Promise.resolve(
        refreshCalls === 0 ? failure(401, 'auth.token_expired') : envelope({ done: true }),
      );
    });

    // Four queries in flight at once — a dashboard mounting.
    await Promise.all([
      api.get('learning/next-step'),
      api.get('learning/mastery'),
      api.get('instruction/due-work'),
      api.get('engagement/xp'),
    ]);

    // The whole point. Four refreshes would present a rotated token three
    // times and trip the backend's reuse detection.
    expect(refreshCalls).toBe(1);
  });

  it('ends the session when the refresh itself fails', async () => {
    setAccessToken('expired');
    const onEnded = vi.fn();
    setSessionEndedListener(onEnded);

    fetchMock
      .mockResolvedValueOnce(failure(401, 'auth.token_expired'))
      .mockResolvedValueOnce(failure(401, 'auth.refresh_invalid'));

    await expect(api.get('learning/mastery')).rejects.toBeInstanceOf(ApiError);
    expect(onEnded).toHaveBeenCalledTimes(1);
  });

  it('does not attempt a refresh when the caller opted out', async () => {
    // Login is the case: there is no session to refresh, and retrying turns
    // one clear "wrong password" into a confusing second 401.
    fetchMock.mockResolvedValueOnce(failure(401, 'auth.invalid_credentials'));

    const error = (await request('auth/login', {
      method: 'POST',
      body: { identifier: 'x', password: 'y' },
      skipAuthRefresh: true,
    }).catch((e: unknown) => e)) as ApiError;

    expect(error.code).toBe('auth.invalid_credentials');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
