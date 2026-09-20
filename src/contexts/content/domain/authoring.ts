/**
 * Authoring rules — PURE.
 *
 * The contract the owner ratified:
 *
 *     name → default slug → author may override → slug frozen → key derived
 *
 * Everything here exists to protect the last two steps. A concept key is
 * written into every mastery row, every piece of evidence, every decision log
 * line and every grounding chunk. If a key could change after content went
 * live, all of that history would silently rebind to a different concept —
 * and nothing would report an error, because every row would still join.
 *
 * So: renaming is always allowed and never touches the slug or the key.
 * Changing a slug is not an edit, it is a new identity, and it is refused.
 */

import { Errors } from '../../../shared/kernel/errors.js';
import { Err, Ok, type Result } from '../../../shared/kernel/result.js';
import { normalizeSlug, type Slug } from '../../../shared/kernel/identifiers.js';

/**
 * Decide a node's slug at creation time.
 *
 * With no override the slug is derived from the display name. An author who
 * supplies one gets it normalised the same way — an override chooses the
 * value, it does not bypass the format.
 *
 * The name is only ever an *input* here. After this call returns, the two are
 * independent: renaming will not re-run this function.
 */
export function resolveSlugAtCreation(name: string, override?: string | null): Result<Slug> {
  const source = override != null && String(override).trim() !== '' ? override : name;
  const slug = normalizeSlug(source);
  if (!slug.ok) {
    // Distinguish the two failures: an unusable name is the author's typo, an
    // unusable override is the author's explicit choice being rejected.
    return Err(
      Errors.validation(
        override ? 'content.slug_invalid' : 'content.slug_not_derivable',
        override
          ? 'The supplied slug contains no usable characters.'
          : 'A slug cannot be derived from this name. Supply one explicitly.',
        { name, override: override ?? null },
      ),
    );
  }
  return slug;
}

/**
 * Is this update allowed to touch the slug?
 *
 * Called on every content update. Passing the *same* slug back is accepted —
 * clients routinely PUT the whole object they just read, and refusing that
 * would make the API unusable while protecting nothing.
 */
export function checkSlugImmutable(
  currentSlug: string,
  incomingSlug: string | undefined,
): Result<void> {
  if (incomingSlug === undefined) return Ok(undefined);
  if (incomingSlug === currentSlug) return Ok(undefined);

  return Err(
    Errors.conflict(
      'content.slug_immutable',
      'A slug is frozen at creation. Create new content instead of re-identifying existing content.',
      { currentSlug, attempted: incomingSlug },
    ),
  );
}

/**
 * The fields an author may change on an existing node, by node type.
 *
 * `slug` is absent from every list on purpose — it is not "an edit that is
 * usually refused", it is not an editable field at all. `orderIndex` is also
 * absent: reordering is its own operation with its own invariants (contiguity
 * across siblings), not a per-node field write.
 */
const EDITABLE_FIELDS: Readonly<Record<ContentNodeKind, readonly string[]>> = {
  textbook: ['title', 'description', 'issuer', 'isbn', 'publishYear', 'totalPages'],
  unit: ['name', 'startPage', 'endPage', 'isActive'],
  lesson: ['name', 'description', 'estimatedMins', 'startPage', 'endPage', 'isActive'],
  concept: [
    'name',
    'description',
    'difficulty',
    'importance',
    'masteryThreshold',
    'isCore',
    'isActive',
    'pageNumber',
  ],
};

export const CONTENT_NODE_KINDS = ['textbook', 'unit', 'lesson', 'concept'] as const;

export type ContentNodeKind = (typeof CONTENT_NODE_KINDS)[number];

export function isContentNodeKind(value: string): value is ContentNodeKind {
  return (CONTENT_NODE_KINDS as readonly string[]).includes(value);
}

export function editableFieldsFor(kind: ContentNodeKind): readonly string[] {
  return EDITABLE_FIELDS[kind];
}

/**
 * Reject unknown or non-editable fields before anything reaches the database.
 *
 * Returns every offending field at once. An allow-list rather than a
 * deny-list: a field added to the schema later is refused until someone
 * decides it is safe, which is the correct default for content that mastery
 * is computed against.
 */
export function checkWritableFields(
  kind: ContentNodeKind,
  fields: readonly string[],
): Result<void> {
  const allowed = EDITABLE_FIELDS[kind];
  const rejected = fields.filter((f) => !allowed.includes(f));

  if (rejected.length === 0) return Ok(undefined);

  const slugAttempt = rejected.includes('slug');
  return Err(
    Errors.validation(
      slugAttempt ? 'content.slug_immutable' : 'content.field_not_editable',
      slugAttempt
        ? 'A slug is frozen at creation and cannot be updated.'
        : `These fields cannot be updated on a ${kind}.`,
      { rejected, editable: allowed },
    ),
  );
}

/**
 * Validate a proposed sibling ordering.
 *
 * Reordering is expressed as the complete list of sibling keys in their new
 * order, never as "move item X to position 3". A complete list cannot produce
 * duplicates or gaps, and it makes the operation idempotent — replaying it
 * yields the same tree. Positional deltas applied concurrently do not.
 */
/**
 * The suggested title for a new textbook, derived from the subject alone.
 *
 * Canonical, single-owner version of a function that used to exist as a
 * byte-for-byte duplicate in `web/src/education/admin/textbook-create-panel.tsx`
 * and `src/contexts/content/application/textbook-administration.service.ts` —
 * see docs/BACKEND-FINAL-AUDIT-AND-PRODUCTION-PLAN-2026-09-15.md §2.2. Kept
 * here, in the domain, because it is a pure naming rule with no I/O — the
 * backend service imports it directly; the web client asks for the same
 * value over the catalogue subjects API's `defaultTextbookTitle` field
 * (see `catalogue.service.ts`'s `withDefaultTitle`) rather than
 * recomputing it.
 *
 * Grade and term are deliberately NOT part of this: they are structural facts
 * about a textbook's placement, always shown alongside the title from their
 * own columns (`gradeName`, `termName`). Baking them into `title` is exactly
 * the duplication this function exists to prevent — see
 * `checkTitleDoesNotRepeatPlacement` below, which refuses a title an author
 * writes by hand that does that anyway.
 */
export function textbookTitleForSubject(subjectName: string): string {
  const trimmed = subjectName.trim();
  if (trimmed.startsWith('كتاب') || /^textbook\b/i.test(trimmed)) return trimmed;
  if (/^[A-Za-z0-9\s&-]+$/.test(trimmed)) return `Textbook ${trimmed}`;
  return `كتاب ${trimmed}`;
}

/**
 * Refuse a free-text textbook title that already contains the grade or term
 * name — the root cause of "كتاب الرياضيات الصف السابع الفصل الأول الصف
 * السابع الفصل الأول" (§2.2): the composite label every screen renders
 * appends `gradeName`/`termName` after `title` unconditionally, so a title an
 * author wrote to already include them doubles the text on screen.
 *
 * A substring match, not an exact-title match: "السابع" appearing anywhere in
 * a hand-written title is the failure mode, not just a title that equals the
 * grade name exactly.
 */
export function checkTitleDoesNotRepeatPlacement(
  title: string,
  placement: { gradeName: string; termName: string },
): Result<void> {
  const haystack = title.trim();
  if (haystack.length === 0) return Ok(undefined);

  const repeated = [placement.gradeName, placement.termName].find(
    (name) => name.trim().length > 0 && haystack.includes(name.trim()),
  );

  if (repeated) {
    return Err(
      Errors.validation(
        'content.title_repeats_placement',
        'The grade and term are shown automatically — do not repeat them in the title.',
        { title, repeated },
      ),
    );
  }

  return Ok(undefined);
}

export function checkReorder(
  currentKeys: readonly string[],
  orderedKeys: readonly string[],
): Result<void> {
  const current = new Set(currentKeys);
  const incoming = new Set(orderedKeys);

  if (incoming.size !== orderedKeys.length) {
    const seen = new Set<string>();
    const duplicates = orderedKeys.filter((k) => (seen.has(k) ? true : (seen.add(k), false)));
    return Err(
      Errors.validation('content.reorder_duplicate_key', 'A key appears more than once.', {
        duplicates: [...new Set(duplicates)],
      }),
    );
  }

  const missing = currentKeys.filter((k) => !incoming.has(k));
  const unknown = orderedKeys.filter((k) => !current.has(k));

  if (missing.length > 0 || unknown.length > 0) {
    return Err(
      Errors.validation(
        'content.reorder_incomplete',
        'A reorder must list every sibling exactly once.',
        { missing, unknown },
      ),
    );
  }

  return Ok(undefined);
}
