/**
 * Content readiness — drive Edu7's copy of a textbook through its lifecycle.
 *
 * Not a publishing or approval workflow. The textbook arrives already approved
 * by its ministry or publisher; Edu7 neither confers nor revokes that standing
 * (there is no code path that even creates a Textbook row). What this service
 * decides is narrower: whether Edu7's ingested copy is complete and consistent
 * enough to serve to learners. See docs/PUBLISHING-LIFECYCLE-GATE.md §10.
 *
 * The state machine itself is pure and lives in `domain/publication.ts`. This
 * service loads the current state, asks the machine, runs the structural gate
 * where the transition demands it, and persists the answer.
 *
 * The gate placement is the pedagogical decision here: structure is validated
 * on SUBMIT, not on APPROVE. A reviewer should be reading content, not
 * discovering that the book contains a prerequisite cycle. By the time a human
 * looks at it, it is already known to be traversable.
 */

import { Errors } from '../../../shared/kernel/errors.js';
import { Err, Ok, type Result } from '../../../shared/kernel/result.js';
import type { Clock } from '../../../shared/kernel/clock.js';
import {
  checkTransition,
  type PublicationAction,
  type PublicationState,
} from '../domain/publication.js';
import { validateStructure, type ValidationIssue } from '../domain/structural-validation.js';
import type { AuthorContext } from './authoring.service.js';
import type {
  ConceptRetirementNotifier,
  ContentAuditWriter,
  ContentRepository,
} from './ports.js';

export interface PublishResult {
  readonly textbookKey: string;
  readonly from: PublicationState;
  readonly to: PublicationState;
  readonly publishedAt: string | null;
}

export interface ReadinessReport {
  readonly textbookKey: string;
  readonly status: PublicationState;
  readonly ready: boolean;
  readonly issues: readonly ValidationIssue[];
}

/** Transitions that require the book to be structurally sound first. */
const REQUIRES_VALID_STRUCTURE: ReadonlySet<PublicationAction> = new Set(['SUBMIT']);

export class PublishingService {
  constructor(
    private readonly repo: ContentRepository,
    private readonly clock: Clock,
    private readonly audit?: ContentAuditWriter,
    private readonly retirement?: ConceptRetirementNotifier,
  ) {}

  /**
   * Dry run: what would SUBMIT say?
   *
   * Exists so an author can see every problem while still editing, rather than
   * learning about them one rejection at a time.
   */
  async checkReadiness(textbookKey: string): Promise<Result<ReadinessReport>> {
    const status = await this.repo.textbookStatus(textbookKey);
    if (!status) return notFound(textbookKey);

    const structure = await this.repo.loadStructure(textbookKey);
    if (!structure) return notFound(textbookKey);

    const issues = validateStructure(structure);
    return Ok({ textbookKey, status, ready: issues.length === 0, issues });
  }

  async apply(
    ctx: AuthorContext,
    textbookKey: string,
    action: PublicationAction,
  ): Promise<Result<PublishResult>> {
    const from = await this.repo.textbookStatus(textbookKey);
    if (!from) return notFound(textbookKey);

    const outcome = checkTransition(from, action);
    if (!outcome.allowed) {
      // The domain names its own refusals; the transport must not rewrite them.
      return Err(
        Errors.conflict(outcome.code, outcome.reason, { textbookKey, from, action }),
      );
    }

    if (REQUIRES_VALID_STRUCTURE.has(action)) {
      const structure = await this.repo.loadStructure(textbookKey);
      if (!structure) return notFound(textbookKey);

      const issues = validateStructure(structure);
      if (issues.length > 0) {
        return Err(
          Errors.precondition(
            'content.structure_invalid',
            'This textbook cannot be submitted for review until its structure is valid.',
            { textbookKey, issueCount: issues.length, issues },
          ),
        );
      }
    }

    // Read the concept list BEFORE the transition. After archiving, the
    // published-content filters exclude the whole book, so the very query that
    // tells us which concepts were retired would come back empty.
    const retiredConcepts =
      outcome.to === 'ARCHIVED' ? await this.conceptKeysOf(textbookKey) : [];

    const publishedAt = outcome.publishes ? this.clock.now() : undefined;
    await this.repo.setTextbookStatus(textbookKey, outcome.to, publishedAt);

    if (retiredConcepts.length > 0 && this.retirement) {
      try {
        await this.retirement.conceptsRetired(retiredConcepts);
      } catch {
        // Best-effort, like the audit writer: an editor archiving a book must
        // not be blocked by a downstream listener. The claims left open are
        // stale rather than wrong, and the next archive sweep catches them.
      }
    }

    if (this.audit) {
      try {
        await this.audit.record({
          actorKey: ctx.actorKey,
          action: `content.${action.toLowerCase()}`,
          targetKey: textbookKey,
          details: { from, to: outcome.to },
        });
      } catch {
        // Best-effort; see ContentAuditWriter.
      }
    }

    return Ok({
      textbookKey,
      from,
      to: outcome.to,
      publishedAt: publishedAt ? publishedAt.toISOString() : null,
    });
  }

  private async conceptKeysOf(textbookKey: string): Promise<string[]> {
    const structure = await this.repo.loadStructure(textbookKey);
    return structure ? structure.concepts.map((concept) => concept.key) : [];
  }
}

function notFound(textbookKey: string): Result<never> {
  return Err(
    Errors.notFound('content.textbook_not_found', 'No textbook with this key.', { textbookKey }),
  );
}
