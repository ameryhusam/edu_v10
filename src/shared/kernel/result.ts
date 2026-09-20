/**
 * Result — explicit success/failure without exceptions.
 *
 * Domain and application layers return `Result` instead of throwing. Only the
 * interface layer converts a failure into an HTTP status. This keeps pedagogy
 * decisions free of transport concerns.
 */

import type { DomainError } from './errors.js';

export type Result<T, E = DomainError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const Ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

export const Err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export function isOk<T, E>(r: Result<T, E>): r is { ok: true; value: T } {
  return r.ok;
}

export function isErr<T, E>(r: Result<T, E>): r is { ok: false; error: E } {
  return !r.ok;
}

/** Unwrap or throw — only for tests and composition-root bootstrapping. */
export function unwrap<T, E>(r: Result<T, E>): T {
  if (r.ok) return r.value;
  throw new Error(`unwrap() on failed Result: ${JSON.stringify(r.error)}`);
}

export function map<T, U, E>(r: Result<T, E>, fn: (v: T) => U): Result<U, E> {
  return r.ok ? Ok(fn(r.value)) : r;
}

export async function mapAsync<T, U, E>(
  r: Result<T, E>,
  fn: (v: T) => Promise<U>,
): Promise<Result<U, E>> {
  return r.ok ? Ok(await fn(r.value)) : r;
}

/** Collect a list of Results into a Result of list (fails on first error). */
export function all<T, E>(results: readonly Result<T, E>[]): Result<T[], E> {
  const out: T[] = [];
  for (const r of results) {
    if (!r.ok) return r;
    out.push(r.value);
  }
  return Ok(out);
}
