/**
 * One error type for the whole client, carrying the backend's stable code.
 *
 * The backend's `message` is developer-facing and English. Showing it to a
 * learner is the failure §9 warns about — so `ApiError` keeps the message for
 * logs and exposes `code`, which the i18n layer turns into something a person
 * should read.
 *
 * The important distinction this type preserves is **refusal vs failure**. A
 * 403 "you have not met the prerequisite" is a pedagogically meaningful answer
 * and often the most useful thing on the screen. A 500 is a broken system.
 * Rendering both as "something went wrong" throws away the product.
 */

export type ApiErrorKind =
  | 'VALIDATION'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'PRECONDITION'
  | 'UNAVAILABLE'
  | 'INTERNAL'
  | 'OFFLINE';

function kindFromStatus(status: number): ApiErrorKind {
  switch (status) {
    case 400:
      return 'VALIDATION';
    case 401:
      return 'UNAUTHENTICATED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 422:
      return 'PRECONDITION';
    case 503:
      return 'UNAVAILABLE';
    default:
      return 'INTERNAL';
  }
}

export class ApiError extends Error {
  readonly code: string;
  readonly kind: ApiErrorKind;
  readonly status: number;
  readonly details: unknown;
  /** Surfaced in the UI on an unmapped error, so a report can be traced. */
  readonly requestId: string | null;

  constructor(init: {
    code: string;
    message: string;
    kind: ApiErrorKind;
    status: number;
    details?: unknown;
    requestId?: string | null;
  }) {
    super(init.message);
    this.name = 'ApiError';
    this.code = init.code;
    this.kind = init.kind;
    this.status = init.status;
    this.details = init.details ?? null;
    this.requestId = init.requestId ?? null;
  }

  static fromEnvelope(
    error: { code: string; message: string; details?: unknown },
    status: number,
    requestId?: string | null,
  ): ApiError {
    return new ApiError({
      code: error.code,
      message: error.message,
      kind: kindFromStatus(status),
      status,
      details: error.details,
      requestId: requestId ?? null,
    });
  }

  /** The device could not reach the server at all. */
  static offline(): ApiError {
    return new ApiError({
      code: 'client.offline',
      message: 'The server could not be reached.',
      kind: 'OFFLINE',
      status: 0,
    });
  }

  /** True when the answer is "no", as opposed to "it broke". */
  get isRefusal(): boolean {
    return (
      this.kind === 'FORBIDDEN' || this.kind === 'PRECONDITION' || this.kind === 'CONFLICT'
    );
  }
}

/**
 * Build an `ApiError` from a non-2xx response.
 *
 * Tolerates a body that is not the envelope — a proxy error page or a gateway
 * timeout is HTML, and parsing it must not throw a second, more confusing
 * error on top of the first.
 */
export async function toApiError(response: Response): Promise<ApiError> {
  let code = `http.${response.status}`;
  let message = response.statusText || 'Request failed.';
  let details: unknown = null;
  let requestId: string | null = null;

  try {
    const body = (await response.json()) as {
      ok?: boolean;
      error?: { code?: string; message?: string; details?: unknown };
      meta?: { requestId?: string };
    };
    if (body.error?.code) code = body.error.code;
    if (body.error?.message) message = body.error.message;
    if (body.error?.details !== undefined) details = body.error.details;
    if (body.meta?.requestId) requestId = body.meta.requestId;
  } catch {
    // Body was not JSON. The status alone is what we have.
  }

  return new ApiError({
    code,
    message,
    kind: kindFromStatus(response.status),
    status: response.status,
    details,
    requestId,
  });
}
