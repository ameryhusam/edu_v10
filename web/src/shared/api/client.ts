/**
 * The only module in the frontend that performs HTTP.
 *
 * FE1 enforces that: `fetch` anywhere else fails the architecture check. The
 * reason is not tidiness. Authentication, refresh, envelope unwrapping and
 * error mapping have to happen on *every* request, and a single component that
 * calls `fetch` directly is a request that silently skips all four.
 */

import { ApiError, toApiError } from './errors';

/**
 * Requests go to this origin's `/api`, never to an absolute backend URL.
 *
 * The browser running this code is not the machine running the API. A hardcoded
 * `http://localhost:3000` works on a developer's laptop and breaks everywhere
 * else, including the sandbox preview. The dev server proxies `/api` onward.
 */
const BASE = '/api/v1';

/** The envelope every Edu7 endpoint returns, success or failure. */
type Envelope<T> =
  | { ok: true; data: T; meta: { requestId: string; at: string } }
  | {
      ok: false;
      error: { code: string; message: string; details?: unknown };
      meta: { requestId: string; at: string };
    };

export interface RequestOptions {
  readonly method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  readonly body?: unknown;
  /** Raw browser body for binary uploads; uses the same auth/refresh path. */
  readonly rawBody?: BodyInit;
  readonly rawContentType?: string;
  readonly query?: Record<string, string | number | boolean | undefined | null>;
  readonly signal?: AbortSignal;
  /** Set for login/refresh, which must not recurse into the refresh flow. */
  readonly skipAuthRefresh?: boolean;
}

/**
 * The access token lives in memory only.
 *
 * Not in localStorage: anything readable by script is readable by injected
 * script. The refresh token is an httpOnly cookie the backend sets, which JS
 * cannot read at all — so a page reload recovers the session by calling
 * `/auth/refresh`, and an XSS cannot exfiltrate a long-lived credential.
 */
let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

/** Notified when the session ends unrecoverably, so the app can show sign-in. */
type SessionEndedListener = () => void;
let onSessionEnded: SessionEndedListener | null = null;

export function setSessionEndedListener(listener: SessionEndedListener | null): void {
  onSessionEnded = listener;
}

/**
 * In-flight refresh, shared by every caller.
 *
 * Without this, a dashboard firing six queries against an expired token starts
 * six refreshes. Five of them present an already-rotated token, and the
 * backend's reuse detection — correctly — treats that as theft and kills the
 * session. Single-flight is not an optimisation here; it is what keeps a
 * correct security feature from logging everyone out.
 */
let refreshInFlight: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const response = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // The refresh cookie is httpOnly; it only travels if we ask for it.
        credentials: 'same-origin',
      });

      const envelope = (await response.json()) as Envelope<{
        tokens: { accessToken: string };
      }>;

      if (!response.ok || !envelope.ok) {
        accessToken = null;
        return false;
      }

      accessToken = envelope.data.tokens.accessToken;
      return true;
    } catch {
      accessToken = null;
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = `${BASE}/${path.replace(/^\//, '')}`;
  if (!query) return url;

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    // Undefined and null are omitted rather than serialised as "undefined" —
    // a string the backend would reject as an invalid key.
    if (value === undefined || value === null) continue;
    params.append(key, String(value));
  }

  const serialised = params.toString();
  return serialised ? `${url}?${serialised}` : url;
}

/**
 * Perform one request and return the unwrapped `data`.
 *
 * The envelope is unwrapped exactly once, here. Callers receive domain data or
 * an `ApiError` — never `{ok, data, meta}`, and never a raw `Response`.
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  // Captured before dispatch: whether this call was made as somebody.
  const hadToken = accessToken !== null;

  const send = async (): Promise<Response> => {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (options.rawBody !== undefined) {
      headers['content-type'] = options.rawContentType ?? 'application/octet-stream';
    } else if (options.body !== undefined) {
      headers['content-type'] = 'application/json';
    }
    if (accessToken) headers['authorization'] = `Bearer ${accessToken}`;

    return fetch(buildUrl(path, options.query), {
      method: options.method ?? 'GET',
      headers,
      credentials: 'same-origin',
      ...(options.rawBody !== undefined
        ? { body: options.rawBody }
        : options.body !== undefined
          ? { body: JSON.stringify(options.body) }
          : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  };

  let response: Response;
  try {
    response = await send();
  } catch {
    // A thrown fetch is a transport failure, not an API refusal: the device is
    // offline, or the server is unreachable. Distinguished from a 4xx/5xx
    // because the UI answer is different — "check your connection", with a
    // retry, rather than an explanation of what was rejected.
    throw ApiError.offline();
  }

  // 401 once: refresh, then replay. Twice: the session is genuinely over.
  if (response.status === 401 && !options.skipAuthRefresh) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      try {
        response = await send();
      } catch {
        throw ApiError.offline();
      }
    } else {
      /**
       * Announce the end of a session only if one had actually begun.
       *
       * `hadToken` is read before the request goes out. The cold-load probe
       * for `/auth/me` runs with no token and no refresh cookie, so it 401s,
       * fails to refresh, and used to fire this listener — which clears the
       * session. Harmless when it lost the race, fatal when it won it: a user
       * who signed in while that probe was still in flight had their brand
       * new session wiped and was returned to the login form.
       *
       * "Ending a session" is meaningless when there was never a session to
       * end, so the signal is now tied to having presented credentials.
       */
      if (hadToken) onSessionEnded?.();
      throw await toApiError(response);
    }
  }

  if (!response.ok) throw await toApiError(response);

  const envelope = (await response.json()) as Envelope<T>;
  if (!envelope.ok) throw ApiError.fromEnvelope(envelope.error, response.status, envelope.meta.requestId);

  return envelope.data;
}

export const api = {
  get: <T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'POST', ...(body !== undefined ? { body } : {}) }),
  postRaw: <T>(path: string, body: BodyInit, options?: Omit<RequestOptions, 'method' | 'body' | 'rawBody'>) =>
    request<T>(path, { ...options, method: 'POST', rawBody: body }),
  patch: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'PATCH', ...(body !== undefined ? { body } : {}) }),
  put: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'PUT', ...(body !== undefined ? { body } : {}) }),
  delete: <T>(path: string, options?: Omit<RequestOptions, 'method'>) =>
    request<T>(path, { ...options, method: 'DELETE' }),
};
