/**
 * DomainError — the only error vocabulary crossing layer boundaries.
 *
 * A domain error is a *business* outcome ("this concept is locked because its
 * prerequisite is not mastered"), not a stack trace. Infrastructure exceptions
 * are caught at the adapter boundary and translated into these.
 */

export type ErrorKind =
  | 'VALIDATION' //   input violates a stated contract
  | 'NOT_FOUND' //    referenced aggregate does not exist
  | 'CONFLICT' //     violates an invariant / uniqueness / state machine
  | 'FORBIDDEN' //    actor lacks permission
  | 'UNAUTHENTICATED' // no or invalid credentials
  | 'PRECONDITION' // a pedagogical or workflow precondition is unmet
  | 'UNAVAILABLE' //  a downstream dependency (AI provider, storage) failed
  | 'INTERNAL'; //    a bug; never expected

export interface DomainError {
  readonly kind: ErrorKind;
  /** Stable machine code, e.g. `content.lesson_not_found`. Safe to switch on. */
  readonly code: string;
  /** Human message. May be shown to end users; keep free of internals. */
  readonly message: string;
  /** Structured, serialisable context for logs and field-level UI errors. */
  readonly details?: Readonly<Record<string, unknown>>;
}

const make =
  (kind: ErrorKind) =>
  (code: string, message: string, details?: Record<string, unknown>): DomainError => ({
    kind,
    code,
    message,
    ...(details ? { details } : {}),
  });

export const Errors = {
  validation: make('VALIDATION'),
  notFound: make('NOT_FOUND'),
  conflict: make('CONFLICT'),
  forbidden: make('FORBIDDEN'),
  unauthenticated: make('UNAUTHENTICATED'),
  precondition: make('PRECONDITION'),
  unavailable: make('UNAVAILABLE'),
  internal: make('INTERNAL'),
} as const;

/** Thrown only at the composition root when a Result cannot be handled. */
export class DomainErrorException extends Error {
  constructor(public readonly error: DomainError) {
    super(`[${error.code}] ${error.message}`);
    this.name = 'DomainErrorException';
  }
}
