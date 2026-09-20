/**
 * Manual grading queue.
 *
 * Essay answers deliberately enter Assessment as REQUIRES_MANUAL_REVIEW and
 * carry no mastery weight. This read use case is the staff-facing queue that
 * makes those answers visible without mixing them into CAT selection or learner
 * mastery before a human mark exists.
 */

import type { ManualReviewListPage, ManualReviewRepository } from './ports.js';

export interface ListManualReviewsQuery {
  readonly limit: number;
  readonly offset?: number;
  /** Undefined means platform-wide; an empty list means no scoped access. */
  readonly schoolIds?: readonly string[] | undefined;
  readonly learnerKey?: string | undefined;
}

export class ListManualReviewsUseCase {
  constructor(private readonly attempts: ManualReviewRepository) {}

  execute(query: ListManualReviewsQuery): Promise<ManualReviewListPage> {
    return this.attempts.listPendingManualReviews({
      limit: Math.min(100, Math.max(1, query.limit)),
      offset: Math.max(0, query.offset ?? 0),
      ...(query.schoolIds ? { schoolIds: query.schoolIds } : {}),
      ...(query.learnerKey ? { learnerKey: query.learnerKey } : {}),
    });
  }
}
