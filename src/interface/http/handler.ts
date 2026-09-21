/**
 * The bridge from a use case to HTTP.
 *
 * A route handler's whole job is: validate input, call one use case, render the
 * Result. Anything more than that belongs in the application layer. `handle()`
 * makes the correct version the shortest one to write.
 */

import type { Request, RequestHandler, Response } from 'express';
import type { ZodType } from 'zod';
import { Errors, type DomainError } from '../../shared/kernel/errors.js';
import { failure, statusFor, success } from '../../shared/http/envelope.js';
import type { Result } from '../../shared/kernel/result.js';
import type { Actor } from './middleware/context.js';

export interface HandlerContext<TInput> {
  readonly input: TInput;
  readonly actor: Actor | undefined;
  readonly req: Request;
}

export interface HandlerOptions<TInput, TOutput> {
  /** Zod schema applied to the merged params/query/body payload. */
  readonly input?: ZodType<TInput>;
  /** Reject with 401 before the use case runs when true. */
  readonly requireAuth?: boolean;
  /** When true, validate req.body directly instead of merging JSON/query/params. */
  readonly rawBody?: boolean;
  readonly execute: (ctx: HandlerContext<TInput>) => Promise<Result<TOutput>>;
  /** HTTP status on success. Defaults to 200. */
  readonly successStatus?: number;
  /**
   * Response-shaping side effect on success, before the body is sent.
   *
   * Exists for transport concerns that genuinely belong to HTTP and to nothing
   * else — setting an httpOnly cookie is the motivating case. It must not
   * contain business logic; if it needs the database, it belongs in the use
   * case.
   */
  readonly onSuccess?: (ctx: { value: TOutput; res: Response; req: Request }) => void;
}

export function handle<TInput, TOutput>(options: HandlerOptions<TInput, TOutput>): RequestHandler {
  return async (req: Request, res: Response): Promise<void> => {
    const reply = (error: DomainError): void => {
      res.status(statusFor(error)).json(failure(error, req.requestId));
    };

    if (options.requireAuth && !req.actor) {
      reply(Errors.unauthenticated('auth.required', 'Authentication is required.'));
      return;
    }

    let input = {} as TInput;
    if (options.input) {
      const merged = options.rawBody ? req.body : { ...req.query, ...req.params, ...(req.body ?? {}) };
      const parsed = options.input.safeParse(merged);
      if (!parsed.success) {
        reply(
          Errors.validation('request.invalid_input', 'The request payload is invalid.', {
            issues: parsed.error.issues.map((i) => ({
              path: i.path.join('.'),
              message: i.message,
            })),
          }),
        );
        return;
      }
      input = parsed.data;
    }

    const result = await options.execute({ input, actor: req.actor, req });

    if (!result.ok) {
      reply(result.error);
      return;
    }
    options.onSuccess?.({ value: result.value, res, req });
    res.status(options.successStatus ?? 200).json(success(result.value, req.requestId));
  };
}
