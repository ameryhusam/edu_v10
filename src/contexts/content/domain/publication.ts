/**
 * Content readiness lifecycle — PURE.
 *
 * ── What this is NOT ───────────────────────────────────────────────────────
 *
 * Owner ruling, 2026-09-12: **Edu7 does not publish or approve textbooks.** A
 * textbook enters the system as an already-approved external source; the
 * ministry or publisher owns that decision and Edu7 cannot confer or revoke it
 * — there is not even a code path that creates a Textbook row.
 *
 * This state machine answers one narrower question: *is Edu7's own ingested
 * copy complete and consistent enough to serve to a learner?* Read `PUBLISHED`
 * as **ACTIVE — available for use inside Edu7**. See
 * docs/PUBLISHING-LIFECYCLE-GATE.md §10 for the audit behind that distinction,
 * and for why the enum value keeps its current spelling for now.
 *
 * ── The machine ────────────────────────────────────────────────────────────
 *
 * One axis, four states. There is no `isPublished` boolean and there never
 * will be: legacy carried both and had to reconcile them by guessing, using a
 * status value its own constant did not define.
 *
 *   DRAFT ──submit──> IN_REVIEW ──approve──> PUBLISHED ──archive──> ARCHIVED
 *     ^                   │                                            │
 *     └──── reject ───────┘                     restore ───────────────┘
 *
 * The rule that matters most is the one that is absent: nothing returns to
 * DRAFT. Withdrawing content learners have already been assessed against would
 * retroactively change what their evidence was about.
 */

/** The four states. Ordered by lifecycle progression, not alphabetically. */
export const PUBLICATION_STATES = ['DRAFT', 'IN_REVIEW', 'PUBLISHED', 'ARCHIVED'] as const;

export type PublicationState = (typeof PUBLICATION_STATES)[number];

/** Named actions, so a caller states intent rather than a target state. */
export const PUBLICATION_ACTIONS = ['SUBMIT', 'REJECT', 'APPROVE', 'ARCHIVE', 'RESTORE'] as const;

export type PublicationAction = (typeof PUBLICATION_ACTIONS)[number];

export interface TransitionAllowed {
  readonly allowed: true;
  readonly to: PublicationState;
  /** True when the transition publishes for the first time (sets publishedAt). */
  readonly publishes: boolean;
}

export interface TransitionRefused {
  readonly allowed: false;
  /** Stable code — safe to switch on, safe to translate. */
  readonly code: string;
  readonly reason: string;
}

export type TransitionOutcome = TransitionAllowed | TransitionRefused;

const TRANSITIONS: Readonly<Record<PublicationAction, { from: PublicationState; to: PublicationState }>> = {
  SUBMIT: { from: 'DRAFT', to: 'IN_REVIEW' },
  REJECT: { from: 'IN_REVIEW', to: 'DRAFT' },
  APPROVE: { from: 'IN_REVIEW', to: 'PUBLISHED' },
  ARCHIVE: { from: 'PUBLISHED', to: 'ARCHIVED' },
  RESTORE: { from: 'ARCHIVED', to: 'PUBLISHED' },
};

export function isPublicationState(value: string): value is PublicationState {
  return (PUBLICATION_STATES as readonly string[]).includes(value);
}

export function isPublicationAction(value: string): value is PublicationAction {
  return (PUBLICATION_ACTIONS as readonly string[]).includes(value);
}

/**
 * May `action` be applied to content currently in `from`?
 *
 * Every refusal is named. "Invalid state transition" tells an author nothing;
 * "content must be reviewed before publishing" tells them what to do next.
 */
export function checkTransition(from: PublicationState, action: PublicationAction): TransitionOutcome {
  const rule = TRANSITIONS[action];

  if (rule.from === from) {
    return { allowed: true, to: rule.to, publishes: action === 'APPROVE' };
  }

  // Refusals worth naming individually, because each has different advice.
  if (action === 'APPROVE' && from === 'DRAFT') {
    return {
      allowed: false,
      code: 'content.review_required',
      reason: 'Content must be submitted for review before it can be made available.',
    };
  }
  if (from === 'PUBLISHED' || from === 'ARCHIVED') {
    if (action === 'SUBMIT' || action === 'REJECT') {
      return {
        allowed: false,
        code: 'content.published_cannot_return_to_draft',
        reason:
          'Content that is already available to learners cannot return to draft. ' +
          'Ingest the publisher\'s corrected edition as a new textbook instead.',
      };
    }
  }
  if (action === 'RESTORE' && from === 'PUBLISHED') {
    return {
      allowed: false,
      code: 'content.already_published',
      reason: 'This content is already available to learners.',
    };
  }
  if (action === 'ARCHIVE' && from === 'ARCHIVED') {
    return {
      allowed: false,
      code: 'content.already_archived',
      reason: 'This content is already archived.',
    };
  }

  return {
    allowed: false,
    code: 'content.invalid_transition',
    reason: `Content in ${from} cannot be ${actionVerb(action)}.`,
  };
}

function actionVerb(action: PublicationAction): string {
  switch (action) {
    case 'SUBMIT':
      return 'submitted for review';
    case 'REJECT':
      return 'rejected';
    case 'APPROVE':
      // "made available", never "published": Edu7 activates its own copy, it
      // does not publish a textbook.
      return 'made available';
    case 'ARCHIVE':
      return 'archived';
    case 'RESTORE':
      return 'restored';
  }
}

/**
 * Is the content tree locked against structural change?
 *
 * PUBLISHED and ARCHIVED are both locked. Mastery is computed from evidence
 * tied to a concept key, so editing a published concept silently changes what
 * a learner's history means. This is why the lock exists — it is a
 * precondition for mastery being interpretable, not an editorial preference.
 */
export function isStructurallyLocked(state: PublicationState): boolean {
  return state === 'PUBLISHED' || state === 'ARCHIVED';
}

/**
 * Fields that stay editable after publication.
 *
 * Legacy locked everything, which is stricter than necessary and pushes
 * authors into workarounds. The line: anything the learning or mastery engines
 * read is frozen; pure presentation is not. `orderIndex` is frozen even though
 * it is no longer identity, because it IS the structure.
 */
const PRESENTATIONAL_FIELDS: ReadonlySet<string> = new Set([
  'title',
  'name',
  'description',
  'issuer',
  'isbn',
  'totalPages',
  'startPage',
  'endPage',
  'pageNumber',
]);

export function isPresentationalField(field: string): boolean {
  return PRESENTATIONAL_FIELDS.has(field);
}

/**
 * Which of these edits are refused while published?
 *
 * Returns every offending field rather than the first: an author fixing one
 * error per request is a workflow that wastes their afternoon.
 */
export function checkEditable(
  state: PublicationState,
  fields: readonly string[],
): readonly string[] {
  if (!isStructurallyLocked(state)) return [];
  return fields.filter((f) => !isPresentationalField(f));
}

/** Learners only ever see content Edu7 has marked active. */
export function isVisibleToLearners(state: PublicationState): boolean {
  return state === 'PUBLISHED';
}
