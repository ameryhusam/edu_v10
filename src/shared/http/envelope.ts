/**
 * One response shape for the entire API.
 *
 * Every endpoint returns this envelope — success or failure, no exceptions.
 * The client therefore has exactly one parser and one error path, instead of
 * guessing whether a given route returns a bare array, `{data}`, or `{result}`.
 */

import type { DomainError, ErrorKind } from '../kernel/errors.js';

export interface ApiMeta {
  readonly requestId: string;
  readonly at: string;
  readonly [key: string]: unknown;
}

export type ApiResponse<T> =
  | { readonly ok: true; readonly data: T; readonly meta: ApiMeta }
  | {
      readonly ok: false;
      readonly error: { readonly code: string; readonly message: string; readonly details?: unknown };
      readonly meta: ApiMeta;
    };

export function success<T>(data: T, requestId: string, extra?: Record<string, unknown>): ApiResponse<T> {
  return {
    ok: true,
    data,
    meta: { requestId, at: new Date().toISOString(), ...extra },
  };
}

export function failure(error: DomainError, requestId: string): ApiResponse<never> {
  return {
    ok: false,
    error: {
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    },
    meta: { requestId, at: new Date().toISOString() },
  };
}

/** The only place domain semantics become HTTP status codes. */
const STATUS_BY_KIND: Record<ErrorKind, number> = {
  VALIDATION: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PRECONDITION: 422,
  UNAVAILABLE: 503,
  INTERNAL: 500,
};

export function statusFor(error: DomainError): number {
  return STATUS_BY_KIND[error.kind] ?? 500;
}
